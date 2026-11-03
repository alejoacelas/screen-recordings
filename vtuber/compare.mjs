// Side-by-side check of face tracking: camera on the left, the avatar it drives on the right.
// usage: node compare.mjs TRACK_DIR OUT.mp4   (TRACK_DIR from face.py)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openAvatar } from './browser.mjs';
import { Timeline, FPS } from './timeline.mjs';
import { loadFace } from './facemap.mjs';

const [dir, outFile] = process.argv.slice(2);
const face = loadFace(dir);
const N = face.frames, SIZE = 540;
const tl = new Timeline(new Uint8Array(N), new Int8Array(0), face, []);
const { page, close } = await openAvatar();
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'camera.mp4'),
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${SIZE}x${SIZE}`, '-r', String(FPS), '-i', 'pipe:0',
  '-filter_complex', '[0:v]scale=-2:540[c];[c][1:v]hstack=2,format=yuv420p[v]', '-map', '[v]', '-map', '0:a',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-shortest', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((r) => ff.on('close', r));
for (let i = 0; i < N; i += 15) {
  const states = [];
  for (let k = i; k < Math.min(i + 15, N); k++) states.push(tl.state(k));
  const buf = Buffer.from(await page.evaluate(([s, z]) => window.renderAvatarBatch(s, z), [states, SIZE]), 'base64');
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end();
console.log((await done) === 0 ? `wrote ${outFile}` : 'ffmpeg failed');
await close();
