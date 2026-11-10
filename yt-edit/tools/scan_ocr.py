"""OCR a whole recording at 1 fps into cache/<rec>/scan_ocr.jsonl, to find private text outside the blur ranges."""
import json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).parent.parent
TL = json.load(open(ROOT / "timeline.json"))
OCR, rec = sys.argv[1], sys.argv[2]
r = TL["recordings"][rec]
fdir = ROOT / "cache" / rec / "scanframes"
fdir.mkdir(parents=True, exist_ok=True)
if not any(fdir.iterdir()):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(r["screenOffset"]), "-i", f"{r['dir']}/segments/001-screen.mov",
                    "-vf", "fps=1", "-q:v", "3", str(fdir / "%05d.jpg")], check=True)
jobs = [((int(p.stem) - 1), p) for p in sorted(fdir.glob("*.jpg"))]

def run(chunk):
    res = subprocess.run([OCR, *[str(p) for _, p in chunk]], capture_output=True, text=True, check=True)
    t_of = {str(p): t for t, p in chunk}
    return [{"t": t_of[d["path"]], "lines": d["lines"]} for d in map(json.loads, res.stdout.splitlines())]

with ThreadPoolExecutor(8) as ex:
    rows = sorted((x for c in ex.map(run, [jobs[i:i + 20] for i in range(0, len(jobs), 20)]) for x in c), key=lambda d: d["t"])
with open(ROOT / "cache" / rec / "scan_ocr.jsonl", "w") as f:
    for d in rows:
        f.write(json.dumps(d) + "\n")
print(rec, len(rows))
