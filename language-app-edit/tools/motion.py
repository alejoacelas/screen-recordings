"""Measure where the screen changes each second and derive default zoom keyframes.

Writes data/zoom.json: [{"t": seconds, "x","y","w","h": crop as fractions of the frame}].
"""
import json, subprocess, sys
import numpy as np

SRC, OUT = sys.argv[1], sys.argv[2]
W, H = 414, 270
TOP = 14            # skip menu bar and tab bar (clock, tab titles)
proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", SRC, "-vf", f"fps=1,scale={W}:{H},format=gray",
                         "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
masks, prev = [], None
while True:
    buf = proc.stdout.read(W * H)
    if len(buf) < W * H:
        break
    f = np.frombuffer(buf, np.uint8).reshape(H, W).astype(np.int16)
    m = np.zeros((H, W), bool) if prev is None else np.abs(f - prev) > 24
    m[:TOP] = False
    masks.append(m)
    prev = f
masks = np.array(masks)
n = len(masks)
cols = [(0, W // 3), (W // 3, 2 * W // 3), (2 * W // 3, W)]
ZH = 0.46                      # crop height as a fraction of the frame: about 2.2x zoom
ZW = ZH                        # same fraction keeps the frame's aspect ratio
FULL = {"x": 0, "y": 0, "w": 1, "h": 1}

def target(t):
    win = masks[max(0, t - 3): t + 4].sum(0)
    total = win.sum()
    if total < 60:
        return None
    per_col = np.array([win[:, a:b].sum() for a, b in cols])
    active = per_col > 0.35 * per_col.max()
    if active.sum() >= 3 or (active.sum() == 2 and not active[1]):
        return FULL
    if active.sum() == 2:
        lo, hi = np.flatnonzero(active)
        a, b = cols[lo][0], cols[hi][1]
    else:
        a, b = cols[int(per_col.argmax())]
    rows = win[:, a:b].sum(1)
    cy = (rows * np.arange(H)).sum() / rows.sum() / H
    cx = (a + b) / 2 / W
    w = max(ZW, (b - a) / W * 1.15)
    h = w
    return {"x": float(np.clip(cx - w / 2, 0, 1 - w)), "y": float(np.clip(cy - h / 2, 0, 1 - h)), "w": w, "h": h}

def differs(a, b):
    if a is None or b is None:
        return a is not b
    return any(abs(a[k] - b[k]) > 0.12 for k in "xywh")

keys, cur, cand, since = [], None, None, 0
for t in range(n):
    tg = target(t)
    if tg is None:
        continue
    if cur is None:
        cur = tg; keys.append({"t": 0, **{k: round(v, 3) for k, v in tg.items()}}); continue
    if not differs(tg, cur):
        cand = None; continue
    if cand is None or differs(tg, cand):
        cand, since = tg, t; continue
    if t - since >= 4:
        cur, cand = cand, None
        keys.append({"t": since, **{k: round(v, 3) for k, v in cur.items()}})
json.dump(keys, open(OUT, "w"), indent=0)
print(n, "seconds,", len(keys), "zoom keyframes")
