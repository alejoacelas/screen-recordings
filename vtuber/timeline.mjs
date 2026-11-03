// Turns the precomputed signals plus hand-picked transcript moments into one avatar state per frame.
import { mapFace } from './facemap.mjs';
export const FPS = 30;

export const BASE = {
  t: 0, mouth: 0, eyeLook: [0, 0], blink: 0, eyes: 'normal', mouthKind: 'normal', brows: null,
  blush: 0, puff: 0, hands: 'none', yaw: 0, pitch: 0, roll: 0, bob: 0, fx: [], bubble: null, ahogeKick: 0,
};

export const EXPRESSIONS = {
  idle: { state: {} },
  happy: { state: { eyes: 'happy', mouthKind: 'smile', blush: 1, hands: 'up' }, fx: 'sparkles' },
  oops: { state: { eyes: 'wide', hands: 'cover', blush: 1 }, fx: 'bang' },
  confused: { state: { tiltAdd: -0.2, hands: 'chin', brows: 'worried' }, fx: 'question' },
  grumpy: { state: { eyes: 'squint', mouthKind: 'pout', puff: 1, brows: 'angry' }, fx: 'vein' },
  sleepy: { state: { eyes: 'sleepy', tiltAdd: 0.15, pitchAdd: 0.12 }, fx: 'zzz' },
  stars: { state: { eyes: 'star', mouthKind: 'smile', blush: 1 }, fx: 'sparkles' },
  love: { state: { eyes: 'heart', mouthKind: 'smile', blush: 1 }, fx: 'hearts' },
  sweat: { state: { eyes: 'half', brows: 'worried', mouthKind: 'pout' }, fx: 'sweat' },
  shock: { state: { eyes: 'wide', mouthKind: 'o' }, fx: 'bang' },
  wave: { state: { hands: 'wave', eyes: 'happy', mouthKind: 'smile' } },
  hum: { state: { eyes: 'happy', mouthKind: 'smile', tiltAdd: 0.08 }, fx: 'notes' },
  smug: { state: { eyes: 'half', mouthKind: 'smile' } },
  pat: { state: { eyes: 'happy', mouthKind: 'smile', blush: 1 }, fx: 'hearts' },
};

// [seconds into the video, expression, duration, speech bubble]
// Times come from the Granola transcript of this recording ("Language apps recording", 2026-11-03).
export const EVENTS = [
  [1.0, 'wave', 3.5, 'hi chat~!'],
  [62, 'happy', 2.5, 'the fun way!'],
  [265, 'shock', 2.5, null],
  [280, 'sweat', 3.5, '5 devices?!'],
  [580, 'pat', 3.5, 'baby steps~'],
  [672, 'love', 3.5, "that's me!"],
  [804, 'happy', 2.5, null],
  [946, 'sweat', 3.5, 'the owl heard that'],
  [988, 'shock', 3, 'myth busted!'],
  [1004, 'oops', 2, null],
  [1244, 'stars', 3, 'vivid~!'],
  [1297, 'stars', 2.5, 'whoa!!'],
  [1309, 'happy', 2.5, 'so easy!'],
  [1409, 'grumpy', 3, 'no clicking!'],
  [1623, 'hum', 9, null],
  [1650, 'confused', 2.5, null],
  [1673, 'oops', 2, null],
  [1805, 'grumpy', 2.5, null],
  [1828, 'smug', 3, '...noted.'],
  [1841, 'sweat', 3, 's-sorry!'],
  [1884, 'pat', 3, 'there, there'],
  [1891, 'grumpy', 3, 'boo, banks!'],
  [1946, 'happy', 2.5, 'hehe~'],
  [2002, 'shock', 3, 'peasants?!'],
  [2047, 'oops', 2, null],
  [2055, 'sweat', 2, null],
  [2218, 'shock', 3, 'time flies!'],
  [2473, 'confused', 2.5, null],
  [2530, 'happy', 3, 'Guten Morgen!'],
  [2553, 'love', 3, 'Ich heiße Alejo!'],
  [2592, 'happy', 2, null],
  [2624, 'confused', 2, null],
  [2722, 'stars', 3, 'anime!!'],
  [3170, 'oops', 2.5, null],
  [3196, 'oops', 2.5, 'language!!'],
  [3211, 'grumpy', 3, 'hey!!'],
  [3247, 'sweat', 2.5, null],
  [3295, 'love', 3.5, 'Kaguya-sama!!'],
  [3310, 'happy', 2.5, 'yay!'],
  [3328, 'wave', 6, 'bye bye~'],
];

function rng(seed) {  // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOutBack = (x) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);

export class Timeline {
  constructor(mouth, look, face = null, events = EVENTS) {
    this.mouth = mouth; this.look = look; this.face = face; this.events = events;
    this.rand = rng(7);
    this.nextBlink = 2; this.blinkStart = -9; this.doubleBlink = false;
    this.lastSpeech = 0; this.wasSpeaking = false; this.nodStart = -9;
    this.gaze = [-0.3, 0.3]; this.eye = [-0.3, 0.3]; this.headLook = [-0.3, 0.3];
    this.lastLookT = -99; this.nextGlance = 20 + this.rand() * 20; this.glanceUntil = -1;
    this.sleeping = false; this.wakeKick = 0;
    this.smMouth = 0;
  }

  state(i) {
    const t = i / FPS, R = this.rand;
    const mouth = (this.mouth[i] ?? 0) / 255;
    this.smMouth = lerp(this.smMouth, mouth, 0.2);
    const speaking = mouth > 0.08;
    let nodKick = 0;
    if (speaking) {
      if (!this.wasSpeaking && t - this.lastSpeech > 0.8 && R() < 0.4) this.nodStart = t;
      if (this.sleeping) { this.sleeping = false; this.wakeKick = 4; }
      this.lastSpeech = t;
    }
    this.wasSpeaking = speaking;
    const silence = t - this.lastSpeech;

    // gaze: follow where the screen changes, with saccades; sometimes glance at the viewer
    const li = Math.floor(t * 2) * 2;
    const lx = this.look[li] ?? 0, ly = this.look[li + 1] ?? 0;
    let target = this.gaze;
    if (lx || ly) { target = [clamp(lx / 127 * 0.9, -1, 1), clamp(ly / 127 * 0.7 + 0.1, -1, 1)]; this.lastLookT = t; }
    else if (t - this.lastLookT > 3) target = [-0.3, 0.3];
    if (t > this.nextGlance) { this.glanceUntil = t + 1.4; this.nextGlance = t + 25 + R() * 25; }
    if (t < this.glanceUntil) target = [0, 0];
    if (Math.hypot(target[0] - this.gaze[0], target[1] - this.gaze[1]) > 0.22) this.gaze = target;
    this.eye = [lerp(this.eye[0], this.gaze[0], 0.45), lerp(this.eye[1], this.gaze[1], 0.45)];
    this.headLook = [lerp(this.headLook[0], this.gaze[0], 0.05), lerp(this.headLook[1], this.gaze[1], 0.05)];

    // blinking
    if (t >= this.nextBlink) {
      this.blinkStart = t;
      this.doubleBlink = R() < 0.15;
      this.nextBlink = t + (this.doubleBlink ? 0.3 : 2 + R() * 4);
    }
    const bt = (t - this.blinkStart) / 0.16;
    const blink = bt >= 0 && bt <= 1 ? 1 - Math.abs(bt * 2 - 1) : 0;

    const st = { ...BASE, t, mouth, fx: [] };
    let tilt = 0, pitchAdd = 0;

    // hand-picked moments
    let ev = null;
    for (const e of this.events) if (t >= e[0] && t < e[0] + Math.max(e[2], e[3] ? 2.5 : 0)) ev = e;
    if (ev) {
      const [t0, name, dur, text] = ev, age = t - t0;
      const a = Math.min(1, age / 0.12, (t0 + dur - t) / 0.35);
      const ex = EXPRESSIONS[name];
      if (a > 0) {
        const s = ex.state;
        if (a > 0.4) {
          for (const k of ['eyes', 'brows', 'hands']) if (s[k]) st[k] = s[k];
          if (s.mouthKind && !(speaking && mouth > 0.25 && (s.mouthKind === 'pout' || s.mouthKind === 'flat'))) st.mouthKind = s.mouthKind;
        }
        st.blush = (s.blush || 0) * a; st.puff = (s.puff || 0) * a;
        tilt += (s.tiltAdd || 0) * a; pitchAdd += (s.pitchAdd || 0) * a;
        if (ex.fx) st.fx.push({ kind: ex.fx, age, alpha: a });
      }
      if (i === Math.ceil(t0 * FPS)) st.ahogeKick = 3;
      if (text) {
        const bdur = Math.max(dur, 2.5), ba = Math.min(1, age / 0.1, (t0 + bdur - t) / 0.3);
        st.bubble = { text, alpha: ba, scale: 0.7 + 0.3 * easeOutBack(Math.min(1, age / 0.22)) };
      }
    } else if (silence > 25) {
      // dozes off during long quiet stretches
      st.eyes = silence > 33 ? 'sleepy' : 'half';
      if (silence > 33) { this.sleeping = true; st.fx.push({ kind: 'zzz', age: silence - 33, alpha: Math.min(1, (silence - 33) / 0.5) }); }
      tilt += 0.12 * Math.min(1, (silence - 25) / 3); pitchAdd += 0.1 * Math.min(1, (silence - 25) / 3);
    }
    if (this.wakeKick) { st.ahogeKick += this.wakeKick; this.wakeKick = 0; }

    st.blink = st.eyes === 'normal' || st.eyes === 'wide' || st.eyes === 'half' ? blink : 0;
    st.eyeLook = [clamp((this.eye[0] - this.headLook[0] * 0.5) * 1.1, -1, 1), clamp((this.eye[1] - this.headLook[1] * 0.5) * 1.1, -1, 1)];
    const nt = (t - this.nodStart) / 0.45;
    const nod = nt >= 0 && nt <= 1 ? 0.1 * Math.sin(Math.PI * nt) : 0;
    st.yaw = this.headLook[0] * 0.35 + Math.sin(t * 0.6) * 0.04;
    st.pitch = this.headLook[1] * 0.16 + nod + pitchAdd + this.smMouth * 0.04;
    st.roll = Math.sin(t * 0.45) * 0.04 + tilt;
    st.bob = 0.025 * Math.sin(t * 2.1) - 0.05 * this.smMouth;
    const f = this.face && mapFace(this.face, i);
    if (f) {
      // the tracked face drives head, eyes and mouth; reactions still add effects, bubbles, blush and hands
      st.face = f;
      st.yaw = f.yaw + Math.sin(t * 0.6) * 0.01;
      st.pitch = f.pitch;
      st.roll = f.roll;
      st.mouth = f.mouthOpen;
      st.bob = 0.02 * Math.sin(t * 2.1);
      st.fx = st.fx.filter((x) => x.kind !== 'zzz');
    }
    return st;
  }
}
