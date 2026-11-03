"""Track the face in a Rec recording and save it on the final.mp4 timeline at 30 fps.

usage: .venv-face/bin/python face.py RECORDING_DIR OUT_DIR

Reads RECORDING_DIR/manifest.json and segments/*-camera.mov, lines each camera file up with
its screen file the same way Sources/ScreenRecordings/Processor.swift does, and runs MediaPipe
Face Landmarker (52 ARKit-style blendshapes plus head pose) on every frame.

Writes
  OUT_DIR/face.bin   float32 rows: [found, yaw, pitch, roll, 52 blendshapes]  (radians; yaw + = turned to own left,
                     pitch + = looking down, roll + = head tilted toward own left shoulder)
  OUT_DIR/face.json  {"fps", "frames", "names", "neutral": {yaw, pitch, roll}}
  OUT_DIR/camera.mp4 the aligned camera with mic audio, for side-by-side checks
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

FPS, W, H = 30, 640, 360
rec, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
MODEL = Path(__file__).parent / "build/models/face_landmarker.task"


def duration(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                 str(path)], capture_output=True, text=True, check=True).stdout)


# same alignment as Processor.swift
parts = []
for seg in json.loads((rec / "manifest.json").read_text())["segments"]:
    screen, camera = rec / seg["screen"], rec / seg["camera"]
    s0, c0 = seg.get("screenStart", 0), seg.get("cameraStart", 0)
    t0 = max(s0, c0)
    dur = min(duration(screen) - (t0 - s0), duration(camera) - (t0 - c0))
    if dur > 0.1:
        parts.append((camera, t0 - c0, dur))

landmarker = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=str(MODEL)), running_mode=vision.RunningMode.VIDEO,
    output_face_blendshapes=True, output_facial_transformation_matrixes=True, num_faces=1))

rows, names, ts = [], None, 0
for camera, trim, dur in parts:
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{trim:.3f}", "-t", f"{dur:.3f}", "-i", str(camera),
                             "-vf", f"fps={FPS},scale={W}:{H}", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
                            stdout=subprocess.PIPE)
    while True:
        buf = proc.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            break
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.frombuffer(buf, np.uint8).reshape(H, W, 3))
        res = landmarker.detect_for_video(img, ts)
        ts += 1000 // FPS
        if not res.face_blendshapes:
            rows.append(None)
            continue
        cats = res.face_blendshapes[0]
        names = names or [c.category_name for c in cats]
        R = np.array(res.facial_transformation_matrixes[0])[:3, :3]
        f = R @ np.array([0, 0, 1.0])               # where the face points, camera space (x right, y up, z to camera)
        yaw = math.atan2(f[0], f[2])                # + = toward image right = the person's own left
        pitch = -math.asin(max(-1, min(1, f[1])))   # + = looking down
        roll = math.atan2(R[1, 0], R[0, 0])         # + = tilted toward image right
        rows.append([1.0, yaw, pitch, roll] + [c.score for c in cats])
    proc.wait()

n = len(rows)
arr = np.zeros((n, 56), np.float32)
for i, r in enumerate(rows):
    if r is not None:
        arr[i] = r
found = arr[:, 0] > 0
# fill short dropouts by holding the last good frame
last = None
for i in range(n):
    if found[i]:
        last = arr[i].copy()
    elif last is not None:
        arr[i, 1:] = last[1:]


# zero-lag smoothing: light on blinks and mouth (stay crisp), heavier on head pose
def smooth(x, sigma):
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(x, (r, r), mode="edge")
    return np.convolve(pad, k, mode="valid")


for c in range(1, 4):
    arr[:, c] = smooth(arr[:, c], 2.0)
for j, name in enumerate(names or []):
    if not name.startswith("eyeBlink"):
        arr[:, 4 + j] = smooth(arr[:, 4 + j], 0.8)

neutral = {k: float(np.median(arr[found, c])) if found.any() else 0.0 for k, c in (("yaw", 1), ("pitch", 2), ("roll", 3))}
(out / "face.bin").write_bytes(arr.tobytes())
# per-channel calibration: where this person's resting face and expressive peaks sit
pcts = (10, 50, 95, 99, 99.5)
cal = {name: [round(float(np.percentile(arr[found, 4 + j], q)), 4) for q in pcts] for j, name in enumerate(names or [])}
(out / "face.json").write_text(json.dumps({"fps": FPS, "frames": n, "names": names, "neutral": neutral,
                                           "percentiles": list(pcts), "calibration": cal}, indent=1))

# aligned camera clip for comparisons
inputs, filt = [], []
for k, (camera, trim, dur) in enumerate(parts):
    inputs += ["-ss", f"{trim:.3f}", "-t", f"{dur:.3f}", "-i", str(camera)]
    filt.append(f"[{k}:v]fps={FPS},scale=-2:540,setsar=1[v{k}];[{k}:a]aresample=48000[a{k}]")
concat = "".join(f"[v{k}][a{k}]" for k in range(len(parts))) + f"concat=n={len(parts)}:v=1:a=1[v][a]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt) + ";" + concat,
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac", str(out / "camera.mp4")], check=True)
print(f"{n} frames ({n / FPS:.1f} s), face found in {found.mean():.0%}, neutral pose {neutral}")
