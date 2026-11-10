"""Build out/index.html: every rendered version with its chapters, intro script and YouTube description."""
import html, json, re
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "out"
VERSIONS = {k: v for k, v in json.load(open(ROOT / "versions.json")).items() if not k.startswith("_")}
scripts = dict(re.findall(r"^## (.+?)\n\n(.*?)(?=\n## |\Z)", (ROOT / "intro-scripts.md").read_text(), re.S | re.M))
SCRIPT_FOR = {"tracker": "Mandarin tracker", "companion": "German learning app", "both": "Both apps", "full": "Full day"}
STYLE = {"short": "Short: highlights at real speed, the rest of this project fast-forwarded, other work replaced by a 'meanwhile' card.",
         "faithful": "Faithful: wider highlights, the rest of this project at about 6× speed, other work shown as a labelled time-lapse.",
         "medium": "Medium: the short cut's highlights, with the rest of each scene at about 6× so you see the work happening; other work is a card.",
         "realtime": "Real time: every minute of both apps at real speed, only silences sped up; other work as a time-lapse.",
         "full": "Full day: all four projects, highlights at real speed and the rest at about 10×."}

EDIT_NOTE = ("How this was edited: everything is in the order it happened. The clock on the right shows the real time, "
             "and sped-up parts show their speed. I cut a snack break and a chat with my house cleaner, and blurred "
             "screens with other people's information or my billing details.")


def secs(t):
    m, s = t.split(":")[-2:]
    h = t.split(":")[0] if t.count(":") == 2 else 0
    return int(h) * 3600 + int(m) * 60 + int(s)


cards = []
for name, v in VERSIONS.items():
    mp4 = OUT / f"{name}.mp4"
    if not mp4.exists():
        continue
    meta = json.load(open(OUT / f"{name}.json"))
    chapters = [ln.split(" ", 1) for ln in (OUT / f"{name}.chapters.txt").read_text().splitlines() if ln.strip()]
    family = name.split("-")[0]
    style = STYLE[v["style"]["name"]] if "picksFile" not in v else "Your mix: the treatment you picked for each scene on the scene page."
    script = scripts.get(SCRIPT_FOR[family], "").strip()
    desc = f"{v['subtitle']}\n\n{EDIT_NOTE}\n\n" + "\n".join(f"{t} {c}" for t, c in chapters)
    ch_html = "".join(f'<li><button data-t="{secs(t)}">{t}</button> {html.escape(c)}</li>' for t, c in chapters)
    cards.append(f"""
<section id="{name}">
  <h2>{html.escape(name)} <span class="len">{meta['duration'] / 60:.1f} min</span></h2>
  <p class="style">{html.escape(style)}</p>
  <video controls preload="metadata" src="{name}.mp4"><track kind="captions" src="{name}.vtt" srclang="en" label="English"></video>
  <div class="cols">
    <div><h3>Chapters</h3><ol class="chapters">{ch_html}</ol></div>
    <div><h3>Intro script</h3><div class="script">{html.escape(script).replace(chr(10) + chr(10), '<br><br>')}</div>
      <h3>YouTube description <button class="copy">Copy</button></h3><textarea readonly rows="10">{html.escape(desc)}</textarea></div>
  </div>
</section>""")
    srt = (OUT / f"{name}.srt").read_text()
    (OUT / f"{name}.vtt").write_text("WEBVTT\n\n" + re.sub(r"(\d\d:\d\d:\d\d),(\d\d\d)", r"\1.\2", srt))

nav = "".join(f'<a href="#{n}">{n}</a>' for n in VERSIONS if (OUT / f"{n}.mp4").exists())
page = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recording cuts</title><style>
:root{{--bg:#fafafa;--fg:#1b1b1f;--muted:#666;--card:#fff;--line:#e3e3e8;--accent:#2f6fde}}
@media (prefers-color-scheme:dark){{:root{{--bg:#141418;--fg:#ececf0;--muted:#a0a0aa;--card:#1d1d23;--line:#30303a;--accent:#7aa7ff}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:16px}}
nav{{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);display:flex;gap:12px;flex-wrap:wrap;z-index:1}}
nav a{{color:var(--accent);text-decoration:none}}
section{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:20px 0}}
h2{{margin:0 0 4px}} .len{{color:var(--muted);font-weight:400;font-size:16px}} .style{{color:var(--muted);margin:0 0 10px}}
video{{width:100%;border-radius:6px;background:#000}}
.cols{{display:grid;grid-template-columns:1fr 1fr;gap:20px}} @media (max-width:760px){{.cols{{grid-template-columns:1fr}}}}
.chapters{{padding-left:0;list-style:none;margin:0}} .chapters li{{margin:2px 0}}
.chapters button{{font:13px ui-monospace,monospace;background:none;border:1px solid var(--line);color:var(--accent);border-radius:4px;cursor:pointer;min-width:56px}}
.script{{background:var(--bg);padding:10px;border-radius:6px}} textarea{{width:100%;box-sizing:border-box;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;font:13px/1.4 ui-monospace,monospace}}
.copy{{font-size:12px;margin-left:8px;cursor:pointer}}
</style></head><body><main>
<h1>Cuts of the 10 Nov recordings</h1>
<p>Click a chapter time to jump there. Captions are on the CC button. To mix the both-apps cuts scene by scene, use the <a href="scenes.html">scene page</a>.</p>
<nav>{nav}</nav>
{''.join(cards)}
</main><script>
document.querySelectorAll('.chapters button').forEach(b=>b.onclick=()=>{{const v=b.closest('section').querySelector('video');v.currentTime=+b.dataset.t;v.play()}});
document.querySelectorAll('.copy').forEach(b=>b.onclick=()=>{{const t=b.closest('div').querySelector('textarea');navigator.clipboard.writeText(t.value).then(()=>{{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)}})}});
</script></body></html>"""
(OUT / "index.html").write_text(page)
print("wrote", OUT / "index.html", len(cards), "versions")
