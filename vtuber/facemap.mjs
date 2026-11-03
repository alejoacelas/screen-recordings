// Map a tracked face (MediaPipe's ARKit-style blendshapes + head pose) onto a VRoid avatar's
// per-region morph targets, the way "perfect sync" VTuber setups do.
// Each channel is calibrated against the person's own resting value (p50) and expressive peak,
// because raw scores vary a lot between people and camera angles.
import fs from 'node:fs';
import path from 'node:path';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function loadFace(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'face.json'), 'utf8'));
  const raw = new Float32Array(fs.readFileSync(path.join(dir, 'face.bin')).buffer.slice(0));
  const idx = Object.fromEntries(meta.names.map((n, i) => [n, 4 + i]));
  const P = meta.percentiles;
  const cal = (name, q) => meta.calibration[name][P.indexOf(q)];
  return { meta, frames: meta.frames, row: (i) => raw.subarray(i * 56, i * 56 + 56), idx, cal };
}

// returns { found, yaw, pitch, roll, gaze: [h, v], morphs: {Fcl_*: weight}, mouthOpen }
export function mapFace(face, i) {
  if (i >= face.frames) return null;
  const r = face.row(i), { idx, cal, meta } = face;
  if (!r[0]) return null;
  const v = (n) => r[idx[n]];
  // 0 at the person's resting value, 1 at their strong expression (with a floor so noise isn't amplified)
  const norm = (n, q = 99, floor = 0.12) => clamp((v(n) - cal(n, 50)) / Math.max(floor, cal(n, q) - cal(n, 50)));
  const avg = (a, b) => (a + b) / 2;
  const m = {};

  // eyes: blinks are short peaks, so calibrate against p99.5
  const blinkL = smoothstep(0.35, 0.8, norm('eyeBlinkLeft', 99.5, 0.3));
  const blinkR = smoothstep(0.35, 0.8, norm('eyeBlinkRight', 99.5, 0.3));
  const both = Math.min(blinkL, blinkR);
  m.Fcl_EYE_Close = both;
  m.Fcl_EYE_Close_L = blinkL - both;   // avatar's left = the person's left (camera view, not mirrored)
  m.Fcl_EYE_Close_R = blinkR - both;
  const smile = Math.max(norm('mouthSmileLeft', 99, 0.25), norm('mouthSmileRight', 99, 0.25));
  const squint = avg(norm('cheekSquintLeft', 99, 0.2), norm('cheekSquintRight', 99, 0.2));
  m.Fcl_EYE_Joy = clamp(smile * squint * 1.2) * (1 - both) * 0.8;
  m.Fcl_EYE_Surprised = clamp(avg(norm('eyeWideLeft', 99, 0.15), norm('eyeWideRight', 99, 0.15)) * 0.7) * (1 - both);

  // brows: whole brow up = surprised, inner only = worried, down = angry/focused
  const inner = norm('browInnerUp', 99, 0.15);
  const outer = avg(norm('browOuterUpLeft', 99, 0.12), norm('browOuterUpRight', 99, 0.12));
  const down = avg(norm('browDownLeft', 99, 0.15), norm('browDownRight', 99, 0.15));
  m.Fcl_BRW_Surprised = clamp(Math.min(inner, outer) * 1.1);
  m.Fcl_BRW_Sorrow = clamp((inner - outer) * 1.2);
  m.Fcl_BRW_Angry = clamp(down * 0.9);
  m.Fcl_BRW_Fun = clamp(smile * 0.6);

  // mouth: jaw opening drives "A"; rounding (pucker/funnel) drives "U"/"O"; spreading drives "I"/"E"
  const jaw = clamp((v('jawOpen') - cal('jawOpen', 10)) / Math.max(0.12, cal('jawOpen', 99) - cal('jawOpen', 10)));
  const pucker = norm('mouthPucker', 99, 0.2), funnel = norm('mouthFunnel', 99, 0.15);
  const stretch = avg(norm('mouthStretchLeft', 99, 0.15), norm('mouthStretchRight', 99, 0.15));
  const round = Math.max(pucker, funnel);
  const open = smoothstep(0.08, 0.9, jaw);
  m.Fcl_MTH_O = clamp(funnel * open * 1.1);
  m.Fcl_MTH_U = clamp(pucker * (1 - open * 0.6) * 0.75);
  m.Fcl_MTH_A = clamp(open * 0.85 * (1 - 0.6 * round));
  m.Fcl_MTH_I = clamp(stretch * (1 - open) * 0.6);
  m.Fcl_MTH_E = clamp(stretch * open * 0.5);
  m.Fcl_MTH_Fun = clamp(smile * (1 - open) * 0.95);
  m.Fcl_MTH_Joy = clamp(smile * open * 0.8);
  m.Fcl_MTH_Angry = clamp(avg(norm('mouthPressLeft', 99, 0.2), norm('mouthPressRight', 99, 0.2)) * (1 - open) * 0.5);
  m.Fcl_MTH_Sorrow = clamp(avg(norm('mouthFrownLeft', 99, 0.2), norm('mouthFrownRight', 99, 0.2)) * 0.6);
  m.Fcl_MTH_Surprised = clamp(m.Fcl_BRW_Surprised * open * 0.6);

  // gaze relative to the person's usual gaze (the camera usually sits below the screen)
  const h = (n) => v(n) - cal(n, 50);
  const gazeH = ((h('eyeLookOutLeft') - h('eyeLookInLeft')) + (h('eyeLookInRight') - h('eyeLookOutRight'))) / 2;  // + = toward own left
  const gazeV = (h('eyeLookUpLeft') + h('eyeLookUpRight') - h('eyeLookDownLeft') - h('eyeLookDownRight')) / 2;   // + = up

  // one-to-one values for "perfect sync" models that carry all 52 ARKit shapes
  const arkit = {};
  for (const name of meta.names) {
    if (name === '_neutral') continue;
    let x;
    if (name.startsWith('eyeBlink')) x = smoothstep(0.3, 0.8, norm(name, 99.5, 0.3));
    else if (name === 'jawOpen') x = jaw * 0.8;
    else if (name.startsWith('eyeLook')) x = clamp(h(name) * 2.2);
    else x = norm(name, 99, 0.15);
    arkit[name] = x;
  }
  arkit.mouthClose = 0;  // its raw score tracks lip contact, which reads as pursing on most models

  const n = meta.neutral;
  return {
    arkit,
    found: true,
    yaw: clamp((r[1] - n.yaw) * 1.3, -0.7, 0.7),
    pitch: clamp((r[2] - n.pitch) * 1.2, -0.5, 0.5),
    roll: clamp((r[3] - n.roll) * 1.2, -0.5, 0.5),
    gaze: [clamp(gazeH * 2.5, -1, 1), clamp(gazeV * 2.5, -1, 1)],
    morphs: m,
    mouthOpen: open,
  };
}
