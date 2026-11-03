# Language apps recording

Two highlight videos from one 55-minute screen recording, in which two apps get built in parallel:

- `?v=tracker`: the Chinese study tracker.
- `?v=companion`: the language-learning app.

Each video plays its own app at normal speed, with pauses sped up. The other app's stretches play sped up with a title, and viewers can watch any skipped part in full. The zoom follows the active Warp pane, and the sidebar holds sections and a synced transcript. Under the player sit speed, zoom, avatar and no-skipping options, remembered per viewer.

Add `?edit`, or press `E`, for the editing tools: a segment timeline, transcript line selection (`1` normal, `2` speed up, `3` cut), section titles, pause speed-ups, zoom presets and undo. Edits autosave to `data/edit-<video>.json`.

## Run

```sh
ln -sf ~/Downloads/"Building a Multilingual Reading Tracker Companion.mp4" media/source.mp4
ffmpeg -i media/source.mp4 -c:v h264_videotoolbox -b:v 700k -maxrate 1200k -bufsize 2M -g 60 \
  -pix_fmt yuv420p -c:a copy -movflags +faststart media/player.mp4
python3 tools/serve.py        # http://127.0.0.1:8790
```

The player uses `media/player.mp4`, which has a keyframe every 2 s. The source has one every 10 s, which makes seeks and fast playback stall.

The avatar is a separate transparent layer, `media/avatar.webm` (VP9 with alpha, 420×170, top right), rendered by `../vtuber` with `ALPHA_OUT=../language-app-edit/media/avatar.webm node render.mjs ...`. The Avatar switch appears only when that file exists.

## Data

- `data/edit-tracker.json`, `data/edit-companion.json`: each video's title, segments (normal, fast, cut), section titles and pause speed-up settings.
- `data/zoom.json`: zoom keyframes as crop fractions of the frame.
- `data/words.json`: Whisper word timestamps.

## Rebuild defaults

```sh
ffmpeg -i media/source.mp4 -ac 1 -ar 16000 media/audio.wav
uv run --with mlx-whisper python -I tools/transcribe.py media/audio.wav data/words.json
uv run --with numpy python -I tools/motion.py media/source.mp4 data/zoom.json
python3 tools/default_edit.py data/words.json data/ 3334.27
```

## Test

`tests/e2e.mjs` drives Google Chrome through Playwright; Playwright's own Chromium can't play H.264. It restores `data/` when it finishes.

```sh
npm i playwright && node tests/e2e.mjs http://127.0.0.1:8790 shots
```
