# vtuber

Puts an animated VTuber in the top-right corner of a screen recording. She lip-syncs to the voice, follows on-screen activity with her eyes and head, blinks, dozes off in long silences, and reacts with expressions and speech bubbles at moments listed in `timeline.mjs`.

The avatar is a VRM model, the format VRoid Studio exports, rendered with pixiv's `three-vrm` (MToon toon shader, spring-bone hair) in headless Chrome. ffmpeg composites it onto the video.

## Run

```sh
npm install
uv venv .venv && uv pip install --python .venv/bin/python numpy
mkdir -p build/models
curl -L -o build/models/AvatarSample_A.vrm https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm
.venv/bin/python signals.py VIDEO build/signals          # voice loudness + screen motion
node sheet.mjs build/sheet.png                           # expression sheet for review
node render.mjs VIDEO OUT.mp4 [START_S DURATION_S]       # omit the range for the whole video
```

Set `MODEL=<name>` to use another `.vrm` in `build/models/`.

## Drive the avatar with your face

The Rec app saves the camera next to the screen. `face.py` tracks it with MediaPipe Face Landmarker (52 ARKit-style face values plus head pose) on the `final.mp4` timeline, and `facemap.mjs` calibrates each value against your own resting face and peaks.

```sh
uv venv --python 3.12 .venv-face && uv pip install --python .venv-face/bin/python mediapipe numpy
curl -L -o build/models/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
.venv-face/bin/python face.py "<recording folder>" build/<name>     # face track + aligned camera clip
node compare.mjs build/<name> build/<name>-compare.mp4             # camera and avatar side by side
```

Models with all 52 ARKit shapes ("perfect sync") get every value one to one. Other VRoid models get them squeezed into their preset eye, brow and mouth shapes. `PS_Female` is a perfect-sync VRoid base model from [hinzka/52blendshapes-for-VRoid-face](https://github.com/hinzka/52blendshapes-for-VRoid-face) (free for any use, including redistribution).

`AvatarSample_A` is VRoid Project's official sample avatar. Its embedded license allows use by anyone, commercial use and modification, and requires no credit.

Reactions are hand-picked for one recording ("Language apps recording", 2026-11-03). For another video, replace `EVENTS` in `timeline.mjs`.
