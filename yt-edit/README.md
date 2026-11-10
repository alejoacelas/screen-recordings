# YouTube cuts of the 10 Nov recordings

Renders several cuts of the two 10 Nov recordings for YouTube. Each cut keeps the real order. A sidebar shows the face bubble, the project, the real clock time and the playback speed. Private screens are blurred.

- `timeline.json`: what happens when in each recording (project, importance, highlights, chapter titles) and which stretches to blur.
- `versions.json`: which projects each cut follows and how hard it compresses.
- `intro-scripts.md`: one-minute intros to record and put before each cut.

## Run

```sh
uv run --with numpy --with pillow python render.py --plan          # durations only
uv run --with numpy --with pillow python render.py [version ...]   # writes out/<version>.mp4, .srt, .chapters.txt
python3 review.py && open out/index.html                            # review page
```

`cache/<am|pm>/` needs `words.json` (Whisper word timestamps of the camera file's mic, from `../language-app-edit/tools/transcribe.py`), `gray.raw` (the screen at 1 fps, 160×104 grayscale) and `panes.json` (pane dividers every 20 s). Rendered pieces are cached by their settings, so re-rendering after an edit only redoes what changed.
