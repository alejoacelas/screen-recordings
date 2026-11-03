# Rec

A menu bar app for macOS 15+ that records your screen, system audio, microphone and camera. The camera is never shown on screen while you record. When you stop, the app adds it as a round bubble in the top-right corner and opens the result in Finder.

- **Start/stop:** ⌃⌥⌘R or the menu bar icon
- **Pause/resume:** ⌃⌥⌘P
- **Output:** `~/Movies/Screen Recordings/<date time>/final.mp4`, with the raw screen and camera files in `segments/`

Requires `brew install ffmpeg`. Build with `./build.sh install`.
