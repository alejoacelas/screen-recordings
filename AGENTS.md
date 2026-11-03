# screen-recordings

Scope: tools for making screen recordings.

- The menu bar app (`Sources/`, `build.sh`) records the main display with system audio, and the camera with the microphone into a separate file that is never shown on screen. When you stop, it adds the camera as a round bubble in the upper-right corner.
- `vtuber/` renders a 3D anime avatar (three.js in headless Chrome) that reacts to the voice, the screen and transcript moments, and composites it onto a recording with ffmpeg.

- Visibility: public
- Still running or billing: none

## Menu bar app: build and install

`./build.sh install` builds, signs with the "Switcher Local Code Signing" identity and copies the app to `/Applications`. The stable signature keeps the Camera, Microphone and Screen Recording grants valid across rebuilds. On macOS 26 the grants still have to be clicked through once per Mac.

## How it works

- `Recorder.swift`: each segment, meaning the stretch between start, pause, resume and stop, gets its own `SCStream` screen file and camera file under `segments/`. Each file records the `CACurrentMediaTime()` at which it started writing into `manifest.json`. A new stream per segment is required: on macOS 26 `recordingOutputDidFinishRecording` never fires, so the code waits for `stopCapture()` to return instead.
- `Processor.swift`: ffmpeg lines up each screen and camera pair on whichever file started later, trims both to the same length, concatenates the segments, overlays the bubble and mixes system audio with the mic into `final.mp4`. ffmpeg must be at `/opt/homebrew/bin`.
- `ScreenRecordings --process <recording folder>` (the binary inside the app) rebuilds `final.mp4`. Use it after changing the bubble settings.

## Testing

Drive the app with URLs: `open screenrec://start`, `pause`, `resume`, `stop`, `toggle` or `togglepause`. Logs are in `~/Library/Logs/ScreenRecordings.log`. The other Mac (`ssh mac-air-2`) already has all three permissions granted. Copy the built app there with `ditto`, then drive it over SSH.
