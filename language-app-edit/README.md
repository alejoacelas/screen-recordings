# Language app recording edit

Cuts the 55-minute "Building a Multilingual Reading Tracker Companion" screen recording down to about 20 minutes. Sections play at normal speed, sped up with a title, or cut. The zoom follows the active Warp pane.

## Run the editor

```sh
ln -sf ~/Downloads/"Building a Multilingual Reading Tracker Companion.mp4" media/source.mp4
python3 tools/serve.py        # http://127.0.0.1:8790
```

Click the timeline to pick a segment. Keys: `1` normal, `2` speed up, `3` cut, `s` split at playhead, `space` play, `←/→` ±5 s (shift ±30 s), `c` captions, `z` zoom, `r` unedited source, `⌘S` save.

## Data

- `data/edit.json`: segments (normal, fast, cut), section titles and pause speed-up settings. The editor saves here.
- `data/zoom.json`: zoom keyframes as crop fractions of the frame. The editor saves here.
- `data/words.json`: Whisper word timestamps (`tools/transcribe.py`).

## Rebuild defaults

```sh
ffmpeg -i media/source.mp4 -ac 1 -ar 16000 media/audio.wav
uv run --with mlx-whisper python -I tools/transcribe.py media/audio.wav data/words.json
uv run --with numpy python -I tools/motion.py media/source.mp4 data/zoom.json
python3 tools/default_edit.py data/words.json data/edit.json 3334.27
```
