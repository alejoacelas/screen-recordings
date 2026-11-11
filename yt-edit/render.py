"""Render YouTube cuts of the 10 Nov recordings from timeline.json and versions.json.

python3 render.py [version ...]      # all versions when none given
python3 render.py --plan [version]   # print the edit plan and durations without rendering
"""
import hashlib, json, os, re, subprocess, sys, threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import blurs

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
    return bool(blurs.at(rec, s, e))


def split_points(rec, s, e):
    pts = {s, e}
    for a, b in blurs.runs(rec):
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


def gap_compress(rec, s, e, speed, gap_speed, gap_min, label, proj, chapter, no_gap, gap_long=None):
    """Speed up silences of gap_min s or more to gap_speed; silences of gap_long s or more go twice as fast."""
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
                sp = gap_speed * 2 if gap_long and a - t >= gap_long else gap_speed
                out += clip(rec, t + lead, a - tail, sp, label, proj, chapter, audio=False)
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
    same = ("rec", "speed", "audio", "box", "blur", "label", "proj", "scene")
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


def scenes(v):
    """The version's scenes in order: each entry of its projects is one scene, and each run of other work in one
    recording is one 'other' scene. Ids are stable across versions: <rec>-<start second>."""
    def is_main(en):
        if en["imp"] == "cut":
            return False
        if en["proj"] == "shared":
            return en["imp"] != "minor" or "shared-minor" in v.get("include", [])
        return en["proj"] in v["projects"]
    out, entries, i = [], TL["entries"], 0
    while i < len(entries):
        en = entries[i]
        if is_main(en):
            out.append({"id": f"{en['rec']}-{en['s']}", "kind": "main", "rec": en["rec"], "entries": [en]})
            i += 1
            continue
        run = []
        while i < len(entries) and not is_main(entries[i]) and entries[i]["rec"] == en["rec"]:
            run.append(entries[i])
            i += 1
        out.append({"id": f"{en['rec']}-{en['s']}", "kind": "other", "rec": en["rec"], "entries": run})
    return out


def style_for(v, sc):
    """A scene's style: the version's own, or the one picked for this scene (another version's name, or
    'skip' / 'fast' / 'real')."""
    pick = v.get("picks", {}).get(sc["id"])
    if pick in VERSIONS:
        return VERSIONS[pick]["style"]
    st = dict(v["style"])
    if pick == "skip":
        st.update(mode="skip", other="card")
    elif pick == "fast":
        st.update(mode="fast", other="lapse", otherRatio=30, otherMin=4, otherMax=25)
    elif pick == "real":
        st.update(mode="real", hl={"speed": 1, "gapSpeed": 4, "gapMin": 3, "gapLong": 6}, other="lapse", otherRatio=30, otherMin=4, otherMax=25)
    return st


def main_scene(en, st, no_gap):
    rec, items = en["rec"], []
    label, ch, hl, rest = NAMES.get(en["proj"], ""), en.get("chapter"), st["hl"], st["rest"]
    mode = st.get("mode")
    if mode == "skip":
        return [card(f"+{round((en['e'] - en['s']) / 60)} min", en.get("chapter", ""),
                     f"{clock(rec, en['s'])} – {clock(rec, en['e'])}", 2.5, chapter=ch)]
    if mode == "real" or st.get("allHl"):
        ranges = [(en["s"], en["e"])]
    elif mode == "fast":
        ranges = []
    else:
        ranges = [snap(rec, max(a, en["s"]), min(b, en["e"])) for a, b in en.get(st.get("hlKey", "hl"), en.get("hl", []))]
    t = en["s"]
    for a, b in ranges + [(en["e"], en["e"])]:
        a, b = max(a, t), max(b, t)
        if a - t >= 5:                       # the rest of this project's footage, fast-forwarded
            target = min(rest["max"], max(rest["min"], (a - t) / rest["ratio"]))
            items += clip(rec, t, a, max(1.0, (a - t) / target), label, en["proj"], ch)
        elif a > t:
            items += gap_compress(rec, t, a, hl["speed"], hl["gapSpeed"], hl["gapMin"], label, en["proj"], ch, no_gap[rec], hl.get("gapLong"))
        if b > a:
            items += gap_compress(rec, a, b, hl["speed"], hl["gapSpeed"], hl["gapMin"], label, en["proj"], ch, no_gap[rec], hl.get("gapLong"))
        t = max(t, b)
    return items


def other_scene(run, st):
    rec, items = run[0]["rec"], []
    s, e = run[0]["s"], run[-1]["e"]
    if st["other"] == "card":
        mins = round((e - s) / 60)
        parts = describe_run(run)
        sub = "Meanwhile: " + ", ".join(parts) + "." if parts else ""
        return [card(f"+{mins} min" if mins else f"+{round(e - s)} s", sub,
                     f"{clock(rec, s)} – {clock(rec, e)}", 2.5 if len(sub) < 60 else 3.5)]
    j = 0
    while j < len(run):                      # time-lapse other work, cards for cuts
        if run[j]["imp"] == "cut":
            c = run[j]
            items.append(card(c["card"], c.get("cardSub", ""), f"{clock(rec, c['s'])} – {clock(rec, c['e'])}", 3.0))
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
    return items


def plan(vname):
    v = VERSIONS[vname]
    if "picksFile" in v:  # picks made on the scene review page: {"base": version, "picks": {scene id: pick}}
        f = ROOT / v["picksFile"]
        d = json.load(open(f)) if f.exists() else {}
        v = dict(v, style=VERSIONS[d.get("base") or v["base"]]["style"],
                 picks={k: x["pick"] for k, x in d.get("picks", {}).items() if x.get("pick")})
    no_gap = {r: [tuple(x) for x in TL.get("noGap", {}).get(r, [])] for r in RECS}
    items = [card(v["title"], v.get("subtitle", ""), "Recorded Tue 10 Nov 2026 · times shown on the right are real",
                  4.0, chapter="Intro")]
    prev_rec = None
    for sc in scenes(v):
        if prev_rec == "am" and sc["rec"] == "pm":
            items.append(card("Lunch", "Claude kept building while I ate.",
                              f"{clock('am', RECS['am']['duration'])} – {clock('pm', 0)}", 2.5))
        prev_rec = sc["rec"]
        st = style_for(v, sc)
        new = main_scene(sc["entries"][0], st, no_gap) if sc["kind"] == "main" else other_scene(sc["entries"], st)
        items += [dict(it, scene=sc["id"]) for it in new]
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


MIC_GAIN_DB, SYSTEM_GAIN_DB = 18, -10
# Software x264: the VideoToolbox hardware encoder occasionally stalled for good mid-piece.
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30",
       "-video_track_timescale", "30000", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]


MASK_FPS = 2


def masks(it):
    """Per 1/MASK_FPS s of the piece, the screen rectangles to pixelate."""
    n = int(np.ceil((it["e"] - it["s"]) * MASK_FPS)) + 1
    return [blurs.at(it["rec"], it["s"] + k / MASK_FPS, it["s"] + (k + 1) / MASK_FPS) for k in range(n)]


def mask_frames(ms):
    """Write the masks as a white-on-black PNG sequence at quarter size; returns its ffmpeg input pattern."""
    d = CACHE / "masks" / hashlib.sha1(json.dumps(ms).encode()).hexdigest()[:20]
    if not (d / "done").exists():
        d.mkdir(parents=True, exist_ok=True)
        w, h = SRC_W // 4, SRC_H // 4
        for k, rs in enumerate(ms):
            im = Image.new("L", (w, h), 0)
            dr = ImageDraw.Draw(im)
            for x, y, rw, rh in rs:
                dr.rectangle((x * w, y * h, (x + rw) * w, (y + rh) * h), fill=255)
            im.save(d / f"{k:05d}.png")
        (d / "done").touch()
    return str(d / "%05d.png")


STALL_S = 45


def run_ffmpeg(cmd, tmp, what, tries=3):
    """Run ffmpeg, restarting it when its output stops growing for STALL_S seconds.

    ffmpeg occasionally deadlocks mid-piece (all threads waiting, 0% CPU) and the same command succeeds when rerun."""
    import time
    for attempt in range(tries):
        tmp.unlink(missing_ok=True)
        with subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True) as p:
            err = []
            reader = threading.Thread(target=lambda: err.append(p.stderr.read()), daemon=True)
            reader.start()
            size, still = -1, time.time()
            while p.poll() is None:
                time.sleep(2)
                now = tmp.stat().st_size if tmp.exists() else 0
                if now != size:
                    size, still = now, time.time()
                elif time.time() - still > STALL_S:
                    p.kill()
                    break
            p.wait()
            reader.join()
            if p.returncode is not None and p.returncode >= 0:
                return subprocess.CompletedProcess(cmd, p.returncode, "", "".join(err))
        print(f"ffmpeg stalled on {what}; restarting ({attempt + 1}/{tries - 1})" if attempt < tries - 1 else f"ffmpeg stalled on {what} {tries} times", flush=True)
    raise RuntimeError(f"ffmpeg kept stalling on {what}")


def render_item(it):
    it = {k: v for k, v in it.items() if k != "scene"}
    ms = masks(it) if it.get("blur") else None
    # Sped-up pieces were re-rendered once the timestamps got a fine time base ("tb"); real-time pieces were already right.
    tag = ["x264"] + (["tb"] if it.get("speed", 1) != 1 else []) + ([f"mix{MIC_GAIN_DB}/{SYSTEM_GAIN_DB}"] if it.get("audio") else [])
    key = hashlib.sha1(json.dumps([*tag, it, ms], sort_keys=True).encode()).hexdigest()[:20]
    out = CACHE / "pieces" / f"{key}.mp4"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(f".{os.getpid()}-{threading.get_ident()}.tmp.mp4")
    if it["kind"] == "card":
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", str(it["dur"]),
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
        sp = it["speed"]
        if ms:
            # pixelate the whole frame, then show it only through the mask's rectangles
            pix = f"[0:v]setpts=PTS-STARTPTS,fps={30 / sp:.5f},split[s0][s1];" \
                  f"[s1]scale={SRC_W // 50}:{SRC_H // 50},scale={SRC_W}:{SRC_H}:flags=neighbor,format=yuva420p[px];" \
                  f"[4:v]setpts=PTS-STARTPTS,scale={SRC_W}:{SRC_H}:flags=neighbor,format=gray,fps={30 / sp:.5f}[m];" \
                  f"[px][m]alphamerge[pxa];[s0][pxa]overlay=0:0:shortest=1[sb];[sb]"
        else:
            pix = f"[0:v]setpts=PTS-STARTPTS,fps={30 / sp:.5f},"
        fc = (f"{pix}crop={cw}:{ch}:{cx}:{cy},scale={SW}:{H}:flags=lanczos,"
              f"settb=1/30000,setpts=PTS/{sp},fps=30[scr];"
              f"[1:v]setpts=PTS-STARTPTS,fps={30 / sp:.5f},crop={fs}:{fs}:{fx}:{fy},scale={BUB}:{BUB},settb=1/30000,setpts=PTS/{sp},fps=30,"
              f"format=yuva420p[cam];[cam][3:v]alphamerge[bub];"
              f"[2:v][scr]overlay=0:0:shortest=1[b1];[b1][bub]overlay={SW + (W - SW - BUB) // 2}:20:shortest=1,"
              f"format=yuv420p[v]")
        if it["audio"]:
            tempo = f",atempo={sp}" if abs(sp - 1) > 0.01 else ""
            # The mic was recorded at about -36 LUFS and YouTube playing on the computer at about -20 LUFS:
            # raise the voice and lower the computer so the computer sits about 8 dB under the voice, then limit peaks.
            fc += (f";[0:a]asetpts=PTS-STARTPTS,volume={SYSTEM_GAIN_DB}dB[sa];[1:a]asetpts=PTS-STARTPTS,volume={MIC_GAIN_DB}dB[ma];"
                   f"[sa][ma]amix=inputs=2:duration=longest:normalize=0{tempo},alimiter=limit=0.89:level=disabled,aresample=48000[a]")
            amap = ["-map", "[a]"]
            extra = []
        else:
            extra = ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            amap = ["-map", f"{5 if ms else 4}:a"]
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y",
               "-ss", f"{it['s'] + r['screenOffset']:.3f}", "-t", f"{d:.3f}",
               "-i", f"{r['dir']}/segments/001-screen.mov",
               "-ss", f"{it['s']:.3f}", "-t", f"{d:.3f}", "-i", f"{r['dir']}/segments/001-camera.mov",
               "-loop", "1", "-framerate", "30", "-t", f"{od + 1:.3f}", "-i", str(sidebar_png(it)),
               "-loop", "1", "-framerate", "30", "-t", f"{od + 1:.3f}", "-i", str(mask_png()),
               *(["-framerate", str(MASK_FPS), "-i", mask_frames(ms)] if ms else []), *extra,
               "-filter_complex", fc, "-map", "[v]", *amap, *ENC, "-t", f"{od:.3f}", str(tmp)]
    res = run_ffmpeg(cmd, tmp, f"{it['kind']} {it.get('rec', '')} {it.get('s', '')}")
    if res.returncode:
        raise RuntimeError(f"ffmpeg failed for {it}: {res.stderr[-1500:]}")
    os.replace(tmp, out)
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
    with ThreadPoolExecutor(4) as ex:
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
