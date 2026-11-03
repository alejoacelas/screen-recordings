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

`AvatarSample_A` is VRoid Project's official sample avatar. Its embedded license allows use by anyone, commercial use and modification, and requires no credit.

Reactions are hand-picked for one recording ("Language apps recording", 2026-11-03). For another video, replace `EVENTS` in `timeline.mjs`.
