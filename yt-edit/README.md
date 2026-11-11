# yt-edit

Turns a day of recordings from the menu bar app into a YouTube video. Everything stays in real order, with your speech at real speed and silences sped up. Other work becomes a labelled time-lapse. A sidebar shows the face bubble, the project, the real clock time and the speed, and private text is pixelated.

- `timeline.json`: the recordings, the date, project names and colours, what happens when (entries with project, importance and chapter title), breaks between recordings, and which stretches to check for private text.
- `versions.json`: the cut: its title, subtitle, description note, projects and speed settings.

## Run

```sh
uv run --with numpy --with pillow --with mlx-whisper python tools/prepare.py   # transcript, motion and pane dividers into cache/<rec>/
swiftc -O tools/ocr_boxes.swift -o cache/ocr_boxes
uv run python tools/scan_ocr.py cache/ocr_boxes <rec>                          # OCR each recording at 1 fps
uv run python tools/scan_ranges.py                                             # add what it found to the blur list
uv run python tools/blur_ocr.py cache/ocr_boxes                                 # OCR the blur stretches at 2 fps
uv run --with numpy --with pillow python render.py --plan                       # durations only
uv run --with numpy --with pillow python render.py                             # out/<cut>.mp4, .srt, .chapters.txt, .description.txt
```

Rendered pieces are cached by their settings, so re-rendering after an edit only redoes what changed. ffmpeg sometimes deadlocks on a piece; `render.py` restarts it when its output stops growing.
