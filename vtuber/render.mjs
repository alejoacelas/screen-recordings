// Composite the avatar onto the recording.
// usage: node render.mjs VIDEO OUT.mp4 [START_SECONDS DURATION_SECONDS]
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { openAvatar } from './browser.mjs';
import { Timeline, FPS } from './timeline.mjs';

const [video, outFile, startArg, durArg] = process.argv.slice(2);
const mouth = new Uint8Array(fs.readFileSync('build/signals/mouth.bin'));
const look = new Int8Array(fs.readFileSync('build/signals/look.bin').buffer.slice(0));
const total = mouth.length;
const start = startArg ? Math.round(Number(startArg) * FPS) : 0;
const count = durArg ? Math.round(Number(durArg) * FPS) : total - start;
const WARM = Math.min(start, 90);   // settle smoothing and springs before the first output frame

const { page, close } = await openAvatar();
const { W, H } = await page.evaluate(() => window.OUT);
const ffArgs = ['-v', 'error', '-y', '-ss', String(start / FPS), '-t', String(count / FPS), '-i', video,
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
  '-filter_complex', '[0:v][1:v]overlay=x=W-w-2:y=0:format=auto[v]', '-map', '[v]', '-map', '0:a?',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
  '-movflags', '+faststart', outFile];
const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((r) => ff.on('close', r));

const tl = new Timeline(mouth, look);
for (let i = 0; i < start - WARM; i++) tl.state(i);   // cheap: advances blink/gaze/sleep state
const BATCH = 15, t0 = Date.now();
for (let i = start - WARM; i < start + count; i += BATCH) {
  const states = [];
  for (let k = i; k < Math.min(i + BATCH, start + count); k++) states.push(tl.state(k));
  const b64 = await page.evaluate((s) => window.renderBatch(s), states);
  const buf = Buffer.from(b64, 'base64');
  const skip = Math.max(0, start - i) * W * H * 4;
  if (skip < buf.length && !ff.stdin.write(buf.subarray(skip))) await new Promise((r) => ff.stdin.once('drain', r));
  const doneFrames = i + BATCH - start;
  if (doneFrames > 0 && doneFrames % (FPS * 60) < BATCH) {
    const rate = doneFrames / ((Date.now() - t0) / 1000);
    console.log(`${(doneFrames / FPS / 60).toFixed(1)} min rendered, ${rate.toFixed(0)} fps, eta ${((count - doneFrames) / rate / 60).toFixed(1)} min`);
  }
}
ff.stdin.end();
const code = await done;
await close();
console.log(code === 0 ? `wrote ${outFile} in ${((Date.now() - t0) / 1000).toFixed(0)} s` : `ffmpeg exited ${code}`);
