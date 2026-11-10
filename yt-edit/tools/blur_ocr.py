"""Sample each blur range at 2 fps and OCR it with text boxes into cache/<rec>/blur_ocr.jsonl."""
import json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).parent.parent
TL = json.load(open(ROOT / "timeline.json"))
OCR = sys.argv[1]  # compiled tools/ocr_boxes.swift
PAD, FPS = 2, 2

for rec, ranges in TL["blur"].items():
    r = TL["recordings"][rec]
    fdir = ROOT / "cache" / rec / "blurframes"
    fdir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for a, b, _ in ranges:
        a, b = max(0, a - PAD), b + PAD
        out = fdir / f"{a}_%05d.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a + r['screenOffset']:.3f}", "-t", str(b - a),
                        "-i", f"{r['dir']}/segments/001-screen.mov", "-vf", f"fps={FPS}", "-q:v", "2", str(out)], check=True)
        for p in sorted(fdir.glob(f"{a}_*.jpg")):
            jobs.append((a + (int(p.stem.split("_")[1]) - 1) / FPS, p))
    def run(chunk):
        res = subprocess.run([OCR, *[str(p) for _, p in chunk]], capture_output=True, text=True, check=True)
        t_of = {str(p): t for t, p in chunk}
        return [{"t": t_of[d["path"]], "lines": d["lines"]} for d in map(json.loads, res.stdout.splitlines())]
    chunks = [jobs[i:i + 20] for i in range(0, len(jobs), 20)]
    with ThreadPoolExecutor(8) as ex:
        rows = sorted((x for c in ex.map(run, chunks) for x in c), key=lambda d: d["t"])
    with open(ROOT / "cache" / rec / "blur_ocr.jsonl", "w") as f:
        for d in rows:
            f.write(json.dumps(d) + "\n")
    print(rec, len(rows), "frames")
