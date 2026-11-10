"""Render YouTube cuts of the 10 Nov recordings from timeline.json and versions.json.

python3 render.py [version ...]      # all versions when none given
python3 render.py --plan [version]   # print the edit plan and durations without rendering
"""
import hashlib, json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
CACHE, OUT = ROOT / "cache", ROOT / "out"
TL = json.load(open(ROOT / "timeline.json"))
VERSIONS = json.load(open(ROOT / "versions.json"))
RECS = TL["recordings"]

W, H, SW = 1920, 1080, 1660          # output size; the screen fills the left SW px, the sidebar the rest
SRC_W, SRC_H = 2940, 1912
BUB = 228
FONT = "/System/Library/Fonts/Avenir Next.ttc"
BOLD, DEMI, MED, REG = 0, 2, 5, 7
BG, FG, MUTED = (17, 18, 22), (240, 240, 240), (150, 152, 160)
COLORS = {"tracker": (239, 83, 80), "companion": (76, 175, 120), "david": (100, 150, 240),
          "eagx": (200, 160, 60), "shared": (180, 180, 190), "away": (120, 120, 130)}
NAMES = {"tracker": "Mandarin tracker", "companion": "German learning app", "david": "David's AI-reviewer project",
         "eagx": "EAGx Berlin prep", "shared": "", "away": ""}
HALLUCINATIONS = re.compile(r"^(thank you\.?|\.\.\.|you)$|you can see that you can see", re.I)


def font(size, idx=REG):
    return ImageFont.truetype(FONT, size, index=idx)


# ---------- source analysis ----------

def speech_runs(rec):
    data = json.load(open(CACHE / rec / "words.json"))
    keep = []
    for seg in data["segments"]:
        if HALLUCINATIONS.search(seg["t"].strip()) or not seg["t"].strip():
            continue
        keep.append((seg["s"], seg["e"]))
    words = [w for w in data["words"] if any(a - 0.5 <= w["s"] <= b + 0.5 for a, b in keep)]
    runs = []
    for w in words:
        s, e = w["s"] - 0.25, w["e"] + 0.3
        if runs and s - runs[-1][1] < 0.9:
            runs[-1][1] = max(runs[-1][1], e)
        else:
            runs.append([s, e])
    return runs, words


def activity(rec):
    a = np.fromfile(CACHE / rec / "gray.raw", np.uint8).reshape(-1, 104, 160).astype(np.int16)
    m = np.abs(np.diff(a, axis=0)) > 14
    m[:, :4] = False                     # menu bar and clock
    return m


FULL = (0.0, 0.0, 1.0)


def pane_bounds(divs):
    """Pane edges as fractions of the width, ignoring dividers that make a pane narrower than 0.2 (app sidebars)."""
    b = [0.0]
    for d in divs:
        if d - b[-1] >= 0.2 and 1 - d >= 0.2:
            b.append(d)
    return b + [1.0]


def zoom_target(m, t, divs):
    """Crop on the pane where the screen is changing, with edges on pane dividers; full frame otherwise."""
    win = m[max(0, t - 2): t + 4].sum(0)
    if win.sum() < 25:
        return None
    b = pane_bounds(divs)
    if len(b) == 2:
        return FULL
    cols = win.sum(0)
    share = [cols[int(b[i] * 160):int(b[i + 1] * 160)].sum() / cols.sum() for i in range(len(b) - 1)]
    k = int(np.argmax(share))
    if share[k] < 0.85:
        return FULL
    a, z = b[k], b[k + 1]
    if z - a < 0.45:                      # narrow pane: take it with its busier neighbour
        left = share[k - 1] if k > 0 else -1
        right = share[k + 1] if k + 1 < len(share) else -1
        a, z = (b[k - 1], z) if left >= right else (a, b[k + 2])
    w = round(z - a, 3)
    if w > 0.8:
        return FULL
    rows = win[:, int(a * 160):int(z * 160)].sum(1)
    nz = np.flatnonzero(rows > 0.05 * rows.max())
    top, bot = nz.min() / 104, (nz.max() + 1) / 104
    if bot - top > w:
        return FULL
    y = min(float(np.clip(bot + 0.03 - w, 0, 1 - w)), top)
    return (round(a, 3), round(max(0.0, y), 3), w)


def shots(rec):
    """Zoom boxes over time with a hold, as [(start_second, box)]."""
    m = activity(rec)
    panes = json.load(open(CACHE / rec / "panes.json"))
    out, cur, cand, since = [], (0.0, 0.0, 1.0), None, 0
    out.append((0, cur))
    differs = lambda p, q: p is None or q is None or any(abs(i - j) > 0.1 for i, j in zip(p, q))
    for t in range(len(m)):
        tg = zoom_target(m, t, panes[min(t // 20, len(panes) - 1)])
        if tg is None or not differs(tg, cur):
            cand = None
            continue
        if cand is None or differs(tg, cand):
            cand, since = tg, t
        elif t - since >= 3 and t - out[-1][0] >= 8:
            cur, cand = cand, None
            out.append((since, cur))
    return out


_cache = {}


def rec_data(rec):
    if rec not in _cache:
        runs, words = speech_runs(rec)
        _cache[rec] = {"runs": runs, "words": words, "shots": shots(rec)}
    return _cache[rec]


def box_at(rec, t):
    sh = rec_data(rec)["shots"]
    box = sh[0][1]
    for s, b in sh:
        if s > t:
            break
        box = b
    return box


# ---------- edit plan ----------

def clock(rec, t):
    base = datetime.strptime("2026-11-10 " + RECS[rec]["clock"], "%Y-%m-%d %H:%M:%S")
    return (base + timedelta(seconds=t)).strftime("%H:%M")


def blurred(rec, s, e):
    return any(a < e and s < b for a, b, _ in TL["blur"].get(rec, []))


def split_points(rec, s, e):
    pts = {s, e}
    for a, b, _ in TL["blur"].get(rec, []):
        pts |= {p for p in (a, b) if s < p < e}
    return sorted(pts)


def clip(rec, s, e, speed, label, proj, chapter=None, audio=None, zoom=True):
    """One stretch of source at one speed, split at blur edges and (at normal speed) zoom changes."""
    audio = speed <= 1.6 if audio is None else audio
    pts = split_points(rec, s, e)
    if zoom and speed <= 2.5:
        sh = rec_data(rec)["shots"]
        pts = sorted(set(pts) | {t for t, _ in sh if s + 1 < t < e - 1})
    out = []
    for a, b in zip(pts, pts[1:]):
        if b - a < 0.15:
            continue
        if zoom and speed <= 2.5:
            box = box_at(rec, a)
        elif zoom:
            boxes = {box_at(rec, t) for t in np.arange(a, b, 2.0)}
            box = boxes.pop() if len(boxes) == 1 else (0.0, 0.0, 1.0)
        else:
            box = (0.0, 0.0, 1.0)
        out.append({"kind": "clip", "rec": rec, "s": round(a, 2), "e": round(b, 2), "speed": round(speed, 2),
                    "audio": audio, "box": box, "blur": blurred(rec, a, b), "label": label, "proj": proj,
                    "chapter": chapter})
    return out


def gap_compress(rec, s, e, speed, gap_speed, gap_min, label, proj, chapter, no_gap):
    if any(a < e and s < b for a, b in no_gap):
        return clip(rec, s, e, speed, label, proj, chapter)
    runs = [(max(a, s), min(b, e)) for a, b in rec_data(rec)["runs"] if a < e and b > s]
    out, t = [], s
    for a, b in runs + [(e, e)]:
        if a > t:
            if a - t >= gap_min:
                lead, tail = (0.3 if t > s else 0), (0.2 if a < e else 0)
                if lead:
                    out += clip(rec, t, t + lead, speed, label, proj, chapter)
                out += clip(rec, t + lead, a - tail, gap_speed, label, proj, chapter, audio=False)
                if tail:
                    out += clip(rec, a - tail, a, speed, label, proj, chapter)
            else:
                out += clip(rec, t, a, speed, label, proj, chapter)
        if b > max(a, t):
            out += clip(rec, max(a, t), b, speed, label, proj, chapter)
        t = max(t, b)
    return out


def snap(rec, a, b):
    """Move highlight edges out to the nearest sentence edge, at most 4 s away."""
    for rs, re_ in rec_data(rec)["runs"]:
        if rs < a < re_ and a - rs <= 4:
            a = rs
        if rs < b < re_ and re_ - b <= 4:
            b = re_
    return a, b


def merge(items):
    out = []
    same = ("rec", "speed", "audio", "box", "blur", "label", "proj")
    for it in items:
        p = out[-1] if out else None
        if (p and p["kind"] == it["kind"] == "clip" and all(p[k] == it[k] for k in same)
                and abs(p["e"] - it["s"]) < 0.02 and (it["chapter"] in (None, p["chapter"]))):
            p["e"] = it["e"]
        else:
            out.append(dict(it))
    return out


def describe_run(run):
    projs = []
    for en in run:
        n = "a break" if en["proj"] == "away" else NAMES.get(en["proj"]) or ""
        if n and n not in projs:
            projs.append(n)
    return projs


def card(title, sub="", foot="", dur=3.0, chapter=None):
    return {"kind": "card", "title": title, "sub": sub, "foot": foot, "dur": dur, "chapter": chapter}


def plan(vname):
    v = VERSIONS[vname]
    st = v["style"]
    no_gap = {r: [tuple(x) for x in TL.get("noGap", {}).get(r, [])] for r in RECS}
    items = [card(v["title"], v.get("subtitle", ""), "Recorded Tue 10 Nov 2026 · times shown on the right are real",
                  4.0, chapter="Intro")]
    entries = TL["entries"]

    def is_main(en):
        if en["imp"] == "cut":
            return False
        if en["proj"] == "shared":
            return en["imp"] != "minor" or "shared-minor" in v.get("include", [])
        return en["proj"] in v["projects"]

    i, prev_rec = 0, None
    while i < len(entries):
        en = entries[i]
        if prev_rec == "am" and en["rec"] == "pm":
            items.append(card("Lunch", "Claude kept building while I ate.",
                              f"{clock('am', RECS['am']['duration'])} – {clock('pm', 0)}", 2.5))
        prev_rec = en["rec"]
        rec = en["rec"]
        if is_main(en):
            label, ch, hl, rest = NAMES.get(en["proj"], ""), en.get("chapter"), st["hl"], st["rest"]
            ranges = [snap(rec, max(a, en["s"]), min(b, en["e"])) for a, b in en.get(st.get("hlKey", "hl"), en.get("hl", []))]
            t = en["s"]
            for a, b in ranges + [(en["e"], en["e"])]:
                a, b = max(a, t), max(b, t)
                if a - t >= 5:                       # the rest of this project's footage, fast-forwarded
                    target = min(rest["max"], max(rest["min"], (a - t) / rest["ratio"]))
                    items += clip(rec, t, a, max(1.0, (a - t) / target), label, en["proj"], ch)
                elif a > t:
                    items += gap_compress(rec, t, a, hl["speed"], hl["gapSpeed"], hl["gapMin"], label, en["proj"], ch, no_gap[rec])
                if b > a:
                    items += gap_compress(rec, a, b, hl["speed"], hl["gapSpeed"], hl["gapMin"], label, en["proj"], ch, no_gap[rec])
                t = max(t, b)
            i += 1
            continue
        run = []
        while i < len(entries) and not is_main(entries[i]) and entries[i]["rec"] == rec:
            run.append(entries[i])
            i += 1
        s, e = run[0]["s"], run[-1]["e"]
        mins = round((e - s) / 60)
        if st["other"] == "card":
            parts = describe_run(run)
            sub = "Meanwhile: " + ", ".join(parts) + "." if parts else ""
            items.append(card(f"+{mins} min" if mins else f"+{round(e - s)} s", sub,
                              f"{clock(rec, s)} – {clock(rec, e)}", 2.5 if len(sub) < 60 else 3.5))
            continue
        j = 0
        while j < len(run):                      # faithful: time-lapse other work, cards for cuts
            if run[j]["imp"] == "cut":
                c = run[j]
                items.append(card(c["card"], c.get("cardSub", ""),
                                  f"{clock(rec, c['s'])} – {clock(rec, c['e'])}", 3.0))
                j += 1
                continue
            k = j
            while k < len(run) and run[k]["imp"] != "cut":
                k += 1
            seg = run[j:k]
            a, b = seg[0]["s"], seg[-1]["e"]
            target = min(st["otherMax"], max(st["otherMin"], (b - a) / st["otherRatio"]))
            label = "Meanwhile: " + ", ".join(describe_run(seg))
            items += clip(rec, a, b, (b - a) / target, label, "other", zoom=False)
            j = k
    return merge(items)


def dur(it):
    return it["dur"] if it["kind"] == "card" else (it["e"] - it["s"]) / it["speed"]


# ---------- rendering ----------

def text_block(d, xy, text, f, fill, width, spacing=6):
    x, y = xy
    words, line = text.split(), ""
    for w in words:
        trial = (line + " " + w).strip()
        if d.textlength(trial, font=f) > width and line:
            d.text((x, y), line, font=f, fill=fill)
            y += f.size + spacing
            line = w
        else:
            line = trial
    if line:
        d.text((x, y), line, font=f, fill=fill)
        y += f.size + spacing
    return y


def png(name, draw_fn):
    p = CACHE / "png" / (hashlib.sha1(name.encode()).hexdigest()[:16] + ".png")
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        img = Image.new("RGB", (W, H), BG)
        draw_fn(ImageDraw.Draw(img))
        img.save(p)
    return p


def sidebar_png(it):
    rec, s, e = it["rec"], it["s"], it["e"]
    t = clock(rec, s) if it["speed"] <= 2.5 or clock(rec, s) == clock(rec, e) else f"{clock(rec, s)}–{clock(rec, e)}"
    sp = "real time" if it["speed"] <= 1.05 else f"{it['speed']:.1f}× speed" if it["speed"] < 3 else f"{round(it['speed'])}× speed"
    color = COLORS.get(it["proj"], MUTED)

    def draw(d):
        x = SW + 16
        y = 20 + BUB + 26
        if it["label"]:
            d.rectangle((x, y + 4, x + 6, y + 26), fill=color)
            y = text_block(d, (x + 16, y), it["label"], font(21, DEMI), FG, W - x - 30)
            y += 14
        d.text((x, y), t, font=font(34 if it["speed"] <= 2.5 else 26, DEMI), fill=FG)
        y += 46
        d.text((x, y), "Tue 10 Nov", font=font(18), fill=MUTED)
        y += 34
        d.rounded_rectangle((x, y, x + 150, y + 34), 8, fill=(40, 42, 50) if it["speed"] <= 1.05 else (70, 50, 20))
        d.text((x + 12, y + 5), sp, font=font(18, MED), fill=FG)
        if it["blur"]:
            y += 52
            text_block(d, (x, y), "Blurred: private information on screen", font(16), MUTED, W - x - 20)
    return png(json.dumps(["side3", it["label"], t, sp, it["proj"], it["blur"]]), draw)


def card_png(c):
    def draw(d):
        y = 400 if c["sub"] else 470
        d.text((W // 2, y), c["title"], font=font(72, DEMI), fill=FG, anchor="mm")
        if c["sub"]:
            words, lines, line = c["sub"].split(), [], ""
            for w in words:
                trial = (line + " " + w).strip()
                if d.textlength(trial, font=font(38)) > 1300 and line:
                    lines.append(line)
                    line = w
                else:
                    line = trial
            lines.append(line)
            for k, ln in enumerate(lines):
                d.text((W // 2, y + 100 + k * 54), ln, font=font(38), fill=(200, 200, 205), anchor="mm")
        if c["foot"]:
            d.text((W // 2, 900), c["foot"], font=font(26), fill=MUTED, anchor="mm")
    return png(json.dumps(["card2", c["title"], c["sub"], c["foot"]]), draw)


def mask_png():
    p = CACHE / "png" / f"mask{BUB}.png"
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        big = Image.new("L", (BUB * 4, BUB * 4), 0)
        ImageDraw.Draw(big).ellipse((0, 0, BUB * 4 - 1, BUB * 4 - 1), fill=255)
        big.resize((BUB, BUB), Image.LANCZOS).save(p)
    return p


ENC = ["-c:v", "h264_videotoolbox", "-b:v", "9M", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30",
       "-video_track_timescale", "30000", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]


def render_item(it):
    key = hashlib.sha1(json.dumps(["v4", it], sort_keys=True).encode()).hexdigest()[:20]
    out = CACHE / "pieces" / f"{key}.mp4"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.mp4")
    if it["kind"] == "card":
        cmd = ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", str(it["dur"]),
               "-i", str(card_png(it)), "-f", "lavfi", "-t", str(it["dur"]),
               "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v", "-map", "1:a", *ENC, "-t", str(it["dur"]), str(tmp)]
    else:
        r = RECS[it["rec"]]
        d = it["e"] - it["s"]
        od = d / it["speed"]
        x, y, w = it["box"]
        cw, ch = int(SRC_W * w) // 2 * 2, int(SRC_H * w) // 2 * 2
        cx, cy = int(SRC_W * x) // 2 * 2, int(SRC_H * y) // 2 * 2
        fx, fy, fs = r["face"]
        blur = f",scale={SW // 24}:{H // 24},scale={SW}:{H}:flags=bicubic" if it["blur"] else ""
        sp = it["speed"]
        fc = (f"[0:v]setpts=PTS-STARTPTS,fps={30 / sp:.5f},crop={cw}:{ch}:{cx}:{cy},scale={SW}:{H}:flags=lanczos{blur},"
              f"setpts=PTS/{sp},fps=30[scr];"
              f"[1:v]setpts=PTS-STARTPTS,fps={30 / sp:.5f},crop={fs}:{fs}:{fx}:{fy},scale={BUB}:{BUB},setpts=PTS/{sp},fps=30,"
              f"format=yuva420p[cam];[cam][3:v]alphamerge[bub];"
              f"[2:v][scr]overlay=0:0:shortest=1[b1];[b1][bub]overlay={SW + (W - SW - BUB) // 2}:20:shortest=1,"
              f"format=yuv420p[v]")
        if it["audio"]:
            tempo = f",atempo={sp}" if abs(sp - 1) > 0.01 else ""
            fc += (f";[0:a]asetpts=PTS-STARTPTS[sa];[1:a]asetpts=PTS-STARTPTS[ma];"
                   f"[sa][ma]amix=inputs=2:duration=longest:normalize=0{tempo},aresample=48000[a]")
            amap = ["-map", "[a]"]
            extra = []
        else:
            extra = ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            amap = ["-map", "4:a"]
        cmd = ["ffmpeg", "-v", "error", "-y",
               "-hwaccel", "videotoolbox", "-ss", f"{it['s'] + r['screenOffset']:.3f}", "-t", f"{d:.3f}",
               "-i", f"{r['dir']}/segments/001-screen.mov",
               "-ss", f"{it['s']:.3f}", "-t", f"{d:.3f}", "-i", f"{r['dir']}/segments/001-camera.mov",
               "-loop", "1", "-framerate", "30", "-t", f"{od + 1:.3f}", "-i", str(sidebar_png(it)),
               "-loop", "1", "-framerate", "30", "-t", f"{od + 1:.3f}", "-i", str(mask_png()), *extra,
               "-filter_complex", fc, "-map", "[v]", *amap, *ENC, "-t", f"{od:.3f}", str(tmp)]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if res.returncode:
        raise RuntimeError(f"ffmpeg failed for {it}: {res.stderr[-1500:]}")
    tmp.rename(out)
    return out


def probe_dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", str(p)]).strip())


REPLACE = [(r"\bclothe?s?\b|\bclot\b|\bclog\b", "Claude"), (r"\bmoles?\b", lambda m: "model" + ("s" if m.group(0).endswith("s") else "")),
           (r"\bill limbs\b", "LLMs"), (r"\bplico\b|\bplayco\b", "Pleco"), (r"\breadwass\b|\bread voice\b|\bratewise\b", "Readwise"),
           (r"\bchajip(d|t)i\b", "ChatGPT"), (r"\b(entropic|antropic)\b", "Anthropic"), (r"\bdebut thing\b", "David thing"),
           (r"\beag ?xberlin\b|\begx berlin\b|\byou gx berlin\b", "EAGx Berlin"), (r"\btori\b", "Tauri"), (r"\bgustern\b", "gestern")]


def fix(text):
    for pat, rep in REPLACE:
        text = re.sub(pat, rep, text, flags=re.I)
    return text


def ts(t, srt=True):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    if srt:
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s % 1) * 1000):03d}"
    return f"{int(h)}:{int(m):02d}:{int(s):02d}" if h else f"{int(m)}:{int(s):02d}"


def captions_and_chapters(items, starts):
    cues, chapters = [], []
    for it, t0 in zip(items, starts):
        ch = it.get("chapter")
        if ch and (not chapters or chapters[-1][1] != ch):
            chapters.append((t0, ch))
        if it["kind"] != "clip" or not it["audio"]:
            continue
        for w in rec_data(it["rec"])["words"]:
            if it["s"] <= w["s"] < it["e"]:
                cues.append((t0 + (w["s"] - it["s"]) / it["speed"], t0 + (min(w["e"], it["e"]) - it["s"]) / it["speed"], w["w"]))
    lines, cur = [], []
    for c in cues:
        if cur and (c[0] - cur[-1][1] > 0.8 or len(" ".join(x[2].strip() for x in cur + [c])) > 42):
            lines.append(cur)
            cur = []
        cur.append(c)
    if cur:
        lines.append(cur)
    srt = []
    for n, ln in enumerate(lines, 1):
        text = fix(" ".join(x[2].strip() for x in ln))
        srt.append(f"{n}\n{ts(ln[0][0])} --> {ts(max(ln[-1][1], ln[0][0] + 0.8))}\n{text}\n")
    merged = []
    for t, name in chapters:
        if merged and t - merged[-1][0] < 10:
            continue
        if merged and merged[-1][1] == name:
            continue
        merged.append((t, name))
    return "\n".join(srt), "\n".join(f"{ts(t, False)} {n}" for t, n in merged)


def render(vname):
    items = plan(vname)
    with ThreadPoolExecutor(6) as ex:
        files = list(ex.map(render_item, items))
    starts, t = [], 0.0
    for f in files:
        starts.append(t)
        t += probe_dur(f)
    OUT.mkdir(exist_ok=True)
    lst = CACHE / f"{vname}.txt"
    lst.write_text("".join(f"file '{f}'\n" for f in files))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                    "-movflags", "+faststart", str(OUT / f"{vname}.mp4")], check=True)
    srt, chapters = captions_and_chapters(items, starts)
    (OUT / f"{vname}.srt").write_text(srt)
    (OUT / f"{vname}.chapters.txt").write_text(chapters + "\n")
    json.dump({"duration": t, "items": [dict(it, start=round(s, 2)) for it, s in zip(items, starts)]},
              open(OUT / f"{vname}.json", "w"), indent=1)
    print(f"{vname}: {t / 60:.1f} min, {len(items)} pieces")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--plan":
        for vn in args[1:] or [k for k in VERSIONS if not k.startswith("_")]:
            items = plan(vn)
            print(f"{vn}: {sum(map(dur, items)) / 60:.1f} min, {len(items)} pieces")
        sys.exit()
    for vn in args or [k for k in VERSIONS if not k.startswith("_")]:
        render(vn)
