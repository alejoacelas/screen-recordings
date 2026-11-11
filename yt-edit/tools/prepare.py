"""Make the per-recording inputs render.py reads, for every recording in timeline.json.

uv run --with numpy --with pillow --with mlx-whisper python tools/prepare.py [rec ...]

Writes cache/<rec>/:
- words.json: Whisper word timestamps of the camera file's mic
- gray.raw: the screen at 1 fps, 160x104 grayscale (where the screen changes, for zoom and activity)
- panes.json: vertical pane dividers every 20 s, as fractions of the width
"""
import json, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RECS = json.load(open(ROOT / "timeline.json"))["recordings"]


def words(r, out):
    import mlx_whisper
    res = mlx_whisper.transcribe(f"{r['dir']}/segments/001-camera.mov", path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
                                 word_timestamps=True, language="en", condition_on_previous_text=False)
    ws = [{"w": w["word"], "s": round(w["start"], 2), "e": round(w["end"], 2)} for seg in res["segments"] for w in seg.get("words", [])]
    json.dump({"segments": [{"s": s["start"], "e": s["end"], "t": s["text"]} for s in res["segments"]], "words": ws},
              open(out, "w"), ensure_ascii=False)


def gray(r, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(r["screenOffset"]), "-i", f"{r['dir']}/segments/001-screen.mov",
                    "-t", str(r["duration"]), "-vf", "fps=1,scale=160:104,format=gray", "-f", "rawvideo", str(out)], check=True)


def panes(r, out):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(r["screenOffset"]), "-i", f"{r['dir']}/segments/001-screen.mov",
                        "-t", str(r["duration"]), "-vf", "fps=1/20,scale=1100:-1", "-q:v", "4", f"{d}/%04d.jpg"], check=True)
        res = []
        for f in sorted(Path(d).glob("*.jpg")):
            a = np.asarray(Image.open(f).convert("L")).astype(int)
            h, w = a.shape
            body = a[int(h * .06):int(h * .95)]
            score = (np.abs(body[:, 1:-1] - (body[:, :-2] + body[:, 2:]) / 2) > 6).mean(0)   # columns that are a sharp vertical line
            divs = []
            for c in [i + 1 for i in range(len(score)) if score[i] > 0.85 and 0.05 * w < i < 0.95 * w]:
                if divs and c - divs[-1][-1] <= 3:
                    divs[-1].append(c)
                else:
                    divs.append([c])
            res.append([round(float(np.mean(g)) / w, 3) for g in divs])
    json.dump(res, open(out, "w"))


if __name__ == "__main__":
    for rec in sys.argv[1:] or RECS:
        d = ROOT / "cache" / rec
        d.mkdir(parents=True, exist_ok=True)
        for name, make in (("gray.raw", gray), ("panes.json", panes), ("words.json", words)):
            if not (d / name).exists():
                print(rec, name, flush=True)
                make(RECS[rec], d / name)
