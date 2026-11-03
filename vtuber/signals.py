"""Precompute what drives the avatar: voice loudness per video frame and where the screen changes.

usage: signals.py VIDEO OUT_DIR
Writes OUT_DIR/mouth.bin (uint8 per 1/30 s, 0-255 mouth openness) and
OUT_DIR/look.bin (int8 x,y pairs per 1/2 s, -127..127 where the screen changed, 0,0 = none).
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

FPS = 30
video, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

# --- voice loudness -> mouth openness
pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "24000",
                      "-f", "s16le", "-"], capture_output=True, check=True).stdout
a = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
hop = 24000 // FPS
n = len(a) // hop
rms = np.sqrt((a[: n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12)
db = 20 * np.log10(rms)
floor, loud = np.percentile(db, 30), np.percentile(db, 97)
gate = floor + 0.25 * (loud - floor)
raw = np.clip((db - gate) / (loud - gate), 0, 1)
mouth = np.zeros(n, np.float32)
m = 0.0
for i, r in enumerate(raw):  # fast attack, slower release
    m = m + (r - m) * (0.7 if r > m else 0.35)
    mouth[i] = m
(out / "mouth.bin").write_bytes((mouth * 255).astype(np.uint8).tobytes())
print(f"mouth: {n} frames, floor {floor:.1f} dB, loud {loud:.1f} dB, speaking {np.mean(raw > 0.1):.0%}")

# --- where the screen changes (2 fps, 415x270 greyscale)
W, H = 415, 270
proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf",
                         f"fps=2,scale={W}:{H}:flags=area,format=gray", "-f", "rawvideo", "-"],
                        stdout=subprocess.PIPE)
look, prev = [], None
ys, xs = np.mgrid[0:H, 0:W]
while True:
    buf = proc.stdout.read(W * H)
    if len(buf) < W * H:
        break
    f = np.frombuffer(buf, np.uint8).reshape(H, W).astype(np.int16)
    xy = (0, 0)
    if prev is not None:
        d = np.abs(f - prev) > 24
        d[:12, :] = False          # menu bar clock
        d[:45, W - 110:] = False   # where the avatar sits
        cnt = d.sum()
        if cnt > 40:
            cx, cy = xs[d].mean() / W, ys[d].mean() / H
            xy = (int(np.clip((cx - 0.5) * 2, -1, 1) * 127), int(np.clip((cy - 0.5) * 2, -1, 1) * 127) or 1)
    look.append(xy)
    prev = f
proc.wait()
(out / "look.bin").write_bytes(np.array(look, np.int8).tobytes())
print(f"look: {len(look)} samples, active {np.mean([l != (0, 0) for l in look]):.0%}")
