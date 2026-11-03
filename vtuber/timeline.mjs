// Turns the precomputed signals plus hand-picked transcript moments into one avatar state per frame.
import { mapFace } from './facemap.mjs';
export const FPS = 30;

export const BASE = {
  t: 0, mouth: 0, eyeLook: [0, 0], blink: 0, eyes: 'normal', mouthKind: 'normal', brows: null,
  blush: 0, puff: 0, hands: 'none', yaw: 0, pitch: 0, roll: 0, bob: 0, fx: [], bubble: null, ahogeKick: 0,
};

// state: preset-level face (eyes, mouthKind, brows, hands, blush) plus `arkit`, extra ARKit shape weights
// layered on top (perfect-sync models only). tiltAdd/pitchAdd/yawAdd offset the head (radians).
// gaze: [x, y] overrides where she looks (x + = viewer's right, y + = down; the screen is to her lower left).
// gesture: a head movement played from the start of the event (nod, shake, giggle, recoil, sway).
export const EXPRESSIONS = {
  idle: { state: {} },
  wave: { state: { hands: 'wave', eyes: 'happy', mouthKind: 'smile', arkit: { jawOpen: 0.15 } }, gaze: [0, 0] },
  happy: { state: { eyes: 'happy', mouthKind: 'smile', blush: 1, hands: 'up', arkit: { jawOpen: 0.2 } }, fx: 'sparkles', gesture: 'giggle' },
  giggle: { state: { eyes: 'happy', mouthKind: 'smile', blush: 0.6, tiltAdd: 0.1, arkit: { cheekSquintLeft: 0.4, cheekSquintRight: 0.4 } }, fx: 'notes', gesture: 'giggle' },
  agree: { state: { mouthKind: 'smile', arkit: { mouthSmileLeft: 0.3, mouthSmileRight: 0.3 } }, gesture: 'nod' },
  // tongue out with a wink: the classic "teehee"
  tehe: { state: { mouthKind: 'smile', blush: 0.8, tiltAdd: 0.14, arkit: { eyeBlinkLeft: 1, eyeSquintLeft: 0.4, tongueOut: 1, jawOpen: 0.25, mouthSmileLeft: 0.5, mouthSmileRight: 0.5, browOuterUpRight: 0.5 } }, gaze: [0, 0] },
  smug: { state: { eyes: 'half', mouthKind: 'smile', yawAdd: 0.08, tiltAdd: -0.06, arkit: { mouthSmileLeft: 1, mouthDimpleLeft: 0.5, browOuterUpLeft: 1, browDownRight: 0.5 } }, gaze: [0, 0] },
  secret: { state: { hands: 'shh', blush: 0.5, tiltAdd: -0.08, arkit: { eyeBlinkLeft: 1, eyeSquintLeft: 0.4, mouthPucker: 0.8, browInnerUp: 0.3 } }, gaze: [0, 0] },
  think: { state: { hands: 'chin', tiltAdd: 0.1, arkit: { mouthPressLeft: 0.4, mouthPressRight: 0.4, mouthRollLower: 0.25, browDownLeft: 0.2, browDownRight: 0.2 } }, gaze: [0.35, -0.6] },
  confused: { state: { tiltAdd: -0.2, hands: 'chin', arkit: { browDownLeft: 0.6, browOuterUpRight: 0.8, mouthLeft: 0.4, mouthPressRight: 0.3 } }, fx: 'question' },
  shock: { state: { eyes: 'wide', arkit: { jawOpen: 0.35, mouthFunnel: 0.45, browInnerUp: 0.8, browOuterUpLeft: 0.7, browOuterUpRight: 0.7 } }, fx: 'bang', gesture: 'recoil' },
  oops: { state: { eyes: 'wide', hands: 'cover', blush: 1, arkit: { browInnerUp: 0.7 } }, fx: 'bang' },
  sweat: { state: { eyes: 'half', brows: 'worried', arkit: { mouthStretchLeft: 0.5, mouthStretchRight: 0.5, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2, browInnerUp: 0.5 } }, fx: 'sweat' },
  grimace: { state: { eyes: 'squint', arkit: { noseSneerLeft: 1, noseSneerRight: 1, mouthUpperUpLeft: 0.5, mouthUpperUpRight: 0.5, mouthStretchLeft: 0.5, mouthStretchRight: 0.5, browDownLeft: 0.8, browDownRight: 0.8 } }, fx: 'sweat', gesture: 'shake' },
  grumpy: { state: { eyes: 'squint', mouthKind: 'pout', arkit: { cheekPuff: 1, mouthPucker: 0.4, browDownLeft: 1, browDownRight: 1 } }, fx: 'vein' },
  aww: { state: { brows: 'worried', tiltAdd: 0.14, arkit: { browInnerUp: 1, mouthPucker: 0.4, mouthFrownLeft: 0.6, mouthFrownRight: 0.6 } }, fx: 'hearts' },
  stars: { state: { eyes: 'star', mouthKind: 'smile', blush: 1, arkit: { jawOpen: 0.25, mouthSmileLeft: 0.4, mouthSmileRight: 0.4 } }, fx: 'sparkles' },
  love: { state: { eyes: 'heart', mouthKind: 'smile', blush: 1, arkit: { jawOpen: 0.2 } }, fx: 'hearts' },
  pat: { state: { eyes: 'happy', mouthKind: 'smile', blush: 1, tiltAdd: 0.12 }, fx: 'hearts', gesture: 'nod' },
  // spots Alejo's own face when the Loom camera bubble pops up in the lower left of the screen
  spot: { state: { eyes: 'wide', blush: 0.8, arkit: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6, jawOpen: 0.2, browInnerUp: 0.5 } }, gaze: [-1, 1], fx: 'sparkles' },
  hum: { state: { eyes: 'happy', mouthKind: 'smile', tiltAdd: 0.08 }, fx: 'notes', gesture: 'sway' },
  sleepy: { state: { eyes: 'sleepy', tiltAdd: 0.15, pitchAdd: 0.12 }, fx: 'zzz' },
};

// [seconds into the video, expression, duration, speech bubble]
// Times come from the Granola transcript of this recording ("Language apps recording", 2026-11-03),
// checked against frames of the video.
export const EVENTS = [
  [1.0, 'wave', 3.5, 'hi chat~!'],
  [60, 'tehe', 3, 'the fun way~'],              // opens Claude with dangerously-skip-permissions
  [84, 'think', 3.5, null],                     // "what would be tricky?"
  [261, 'shock', 2.5, null],                    // "Pleco is a phone app. Holy shit"
  [276, 'sweat', 3.5, '5 devices?!'],
  [325, 'agree', 2, null],                      // "let's just do the Chrome thing first"
  [575, 'pat', 3.5, 'baby steps~'],             // "a little ashamed ... manual it is"
  [600, 'grimace', 2.2, null],                  // "a channel list, that's awful"
  [671, 'love', 3.5, "that's me!"],            // "we'll just use an LLM friend"
  [804, 'happy', 2.5, null],                    // "0% Chinese comes as Chinese, perfect"
  [946, 'sweat', 3.5, 'the owl heard that'],   // "I hate Duolingo"
  [986, 'shock', 3, 'myth busted!'],            // learning styles don't work
  [1004, 'oops', 2, null],                      // "evidence is shit"
  [1049, 'giggle', 2.5, null],                  // "because I'm too lazy"
  [1243, 'stars', 3, 'vivid~!'],
  [1296, 'stars', 2.5, 'whoa!!'],               // "the 3 apps can all be tracked from your Mac"
  [1308, 'happy', 2.5, 'so easy!'],
  [1408, 'grumpy', 3, 'no clicking!'],
  [1623, 'hum', 9, null],                       // "now I'm waiting for stuff"
  [1643, 'spot', 3.5, 'a wild Alejo!'],         // his Loom camera bubble shows up
  [1649.5, 'confused', 2.5, null],              // Full Disk Access: "what is this? I have no clue"
  [1672, 'oops', 2, null],                      // Warp has to quit and reopen
  [1804, 'grimace', 2.5, null],                 // Readwise login: "ugh"
  [1828, 'smug', 3, '...noted.'],               // "you guys can take over my account"
  [1841, 'sweat', 2.5, null],                   // "why don't you have desktop control tools?"
  [1859, 'secret', 3, 'top secret~'],           // "I won't tell you the problem with my codecs"
  [1884, 'pat', 3, 'there, there'],             // "I hate myself"
  [1891, 'grumpy', 3, 'boo, banks!'],
  [1946, 'happy', 2.5, null],                   // "nice work"
  [2003, 'shock', 3, 'peasants?!'],
  [2047, 'oops', 2, null],                      // "fuck that guy"
  [2055, 'sweat', 2, null],                     // "2 test failures, whatever"
  [2104, 'aww', 3, null],                       // "my life is hard, guys"
  [2217, 'shock', 3, 'time flies!'],            // "30, 40 minutes already"
  [2370, 'giggle', 2.5, 'Stravaganza~'],        // names the project david-stravaganza
  [2473, 'confused', 2.5, null],                // "this is dark mode, I don't know why"
  [2529, 'wave', 3, 'Guten Morgen!'],
  [2553, 'love', 3, 'Ich heiße Alejo!'],
  [2567, 'giggle', 2.5, null],                  // "behave yourself, Harry"
  [2596, 'happy', 2, null],                     // "this is actually good, I like this"
  [2625, 'confused', 2, null],                  // "what? I need more background"
  [2645, 'sweat', 2.5, null],                   // "this I cannot read anymore"
  [2675, 'agree', 2, null],                     // "it's fun, it's easy"
  [2722, 'stars', 3, 'anime!!'],
  [2908, 'sweat', 2.5, null],                   // "kind of expensive"
  [3170, 'oops', 2.5, null],                    // "and I'll be like, f*** off"
  [3196, 'oops', 2.5, 'language!!'],
  [3211, 'grumpy', 3, 'hey!!'],                 // "Anthropic is absurd"
  [3247, 'sweat', 2.5, null],                   // "how come I cannot copy things"
  [3295, 'love', 3.5, 'Kaguya-sama!!'],
  [3310, 'happy', 2.5, 'yay!'],                 // "nice, it's working"
  [3326, 'wave', 8, 'bye bye~'],
];

// small, unprompted face changes between reactions so she never looks frozen
const AMBIENT = [
  { arkit: { mouthSmileLeft: 0.3, mouthSmileRight: 0.3, cheekSquintLeft: 0.15, cheekSquintRight: 0.15 } },
  { arkit: { mouthPressLeft: 0.35, mouthPressRight: 0.35, mouthRollLower: 0.2, browDownLeft: 0.2, browDownRight: 0.2 }, tilt: 0.06 },
  { arkit: { browOuterUpRight: 0.45, browInnerUp: 0.2 }, tilt: -0.07 },
  { arkit: { mouthSmileLeft: 0.35, mouthDimpleLeft: 0.25 } },
  { arkit: { mouthLeft: 0.3, mouthPucker: 0.15 }, tilt: 0.05 },
  { arkit: { mouthPucker: 0.25, mouthShrugLower: 0.2, browInnerUp: 0.2 } },
];
// mouth shapes that would fight the lip sync while she talks
const MOUTH_HOLD = /^(mouthPucker|mouthFunnel|mouthPress|mouthRoll|mouthShrug|cheekPuff|tongueOut|mouthLeft|mouthRight)/;

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

// head offsets for a gesture `age` seconds after it starts: [yaw, pitch, roll]
function gesture(kind, age) {
  if (kind === 'nod') return age < 0.9 ? [0, 0.1 * Math.sin(Math.PI * (age / 0.45)) ** 2, 0] : [0, 0, 0];
  if (kind === 'shake') return age < 1.0 ? [0.1 * Math.sin(age * Math.PI * 5) * (1 - age), 0, 0] : [0, 0, 0];
  if (kind === 'giggle') return age < 1.2 ? [0, -0.035 * Math.abs(Math.sin(age * 13)) * (1.2 - age), 0.03 * Math.sin(age * 6.5)] : [0, 0, 0];
  if (kind === 'recoil') return [0, -0.1 * Math.min(1, age / 0.12) * Math.max(0.4, 1 - age / 2), 0];
  if (kind === 'sway') return [0, 0, 0.07 * Math.sin(age * 3.2)];
  return [0, 0, 0];
}

export class Timeline {
  constructor(mouth, look, face = null, events = EVENTS) {
    this.mouth = mouth; this.look = look; this.face = face; this.events = events;
    this.rand = rng(7); this.ambRand = rng(11);
    this.nextBlink = 2; this.blinkStart = -9; this.doubleBlink = false;
    this.lastSpeech = 0; this.wasSpeaking = false; this.nodStart = -9;
    this.gaze = [-0.3, 0.3]; this.eye = [-0.3, 0.3]; this.headLook = [-0.3, 0.3];
    this.lastLookT = -99; this.nextGlance = 20 + this.rand() * 20; this.glanceUntil = -1;
    this.sleeping = false; this.wakeKick = 0;
    this.smMouth = 0;
    this.amb = null; this.nextAmb = 8;
  }

  state(i) {
    const t = i / FPS, R = this.rand;
    const mouth = (this.mouth[i] ?? 0) / 255;
    this.smMouth = lerp(this.smMouth, mouth, 0.2);
    const speaking = mouth > 0.08;
    if (speaking) {
      if (!this.wasSpeaking && t - this.lastSpeech > 0.8 && R() < 0.4) this.nodStart = t;
      if (this.sleeping) { this.sleeping = false; this.wakeKick = 4; }
      this.lastSpeech = t;
    }
    this.wasSpeaking = speaking;
    const silence = t - this.lastSpeech;

    // the reaction playing now, if any
    let ev = null;
    for (const e of this.events) if (t >= e[0] && t < e[0] + Math.max(e[2], e[3] ? 2.5 : 0)) ev = e;
    const evEx = ev && EXPRESSIONS[ev[1]];

    // gaze: follow where the screen changes, with saccades; sometimes glance at the viewer
    const li = Math.floor(t * 2) * 2;
    const lx = this.look[li] ?? 0, ly = this.look[li + 1] ?? 0;
    let target = this.gaze;
    if (lx || ly) { target = [clamp(lx / 127 * 0.9, -1, 1), clamp(ly / 127 * 0.7 + 0.1, -1, 1)]; this.lastLookT = t; }
    else if (t - this.lastLookT > 3) target = [-0.3, 0.3];
    if (t > this.nextGlance) { this.glanceUntil = t + 1.4; this.nextGlance = t + 25 + R() * 25; }
    if (t < this.glanceUntil) target = [0, 0];
    if (evEx?.gaze && t < ev[0] + ev[2]) target = evEx.gaze;
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
    let tilt = 0, pitchAdd = 0, yawAdd = 0;
    let arkit = null;

    // hand-picked moments
    if (ev) {
      const [t0, , dur, text] = ev, age = t - t0;
      const a = Math.min(1, age / 0.12, (t0 + dur - t) / 0.35);
      const ex = evEx;
      if (a > 0) {
        const s = ex.state;
        if (a > 0.4) {
          for (const k of ['eyes', 'brows', 'hands']) if (s[k]) st[k] = s[k];
          if (s.mouthKind && !(speaking && mouth > 0.25 && (s.mouthKind === 'pout' || s.mouthKind === 'flat'))) st.mouthKind = s.mouthKind;
        }
        st.blush = (s.blush || 0) * a; st.puff = (s.puff || 0) * a;
        if (s.arkit) arkit = Object.fromEntries(Object.entries(s.arkit).map(([k, w]) => [k, w * a]));
        tilt += (s.tiltAdd || 0) * a; pitchAdd += (s.pitchAdd || 0) * a; yawAdd += (s.yawAdd || 0) * a;
        if (ex.fx) st.fx.push({ kind: ex.fx, age, alpha: a });
      }
      if (ex.gesture) { const [gy, gp, gr] = gesture(ex.gesture, age); yawAdd += gy; pitchAdd += gp; tilt += gr; }
      if (i === Math.ceil(t0 * FPS)) st.ahogeKick = 3;
      if (text) {
        const bdur = Math.max(dur, 2.5), ba = Math.min(1, age / 0.1, (t0 + bdur - t) / 0.3);
        st.bubble = { text, alpha: ba, scale: 0.7 + 0.3 * easeOutBack(Math.min(1, age / 0.22)) };
      }
      this.amb = null;
    } else if (silence > 25) {
      // dozes off during long quiet stretches
      st.eyes = silence > 33 ? 'sleepy' : 'half';
      if (silence > 33) { this.sleeping = true; st.fx.push({ kind: 'zzz', age: silence - 33, alpha: Math.min(1, (silence - 33) / 0.5) }); }
      tilt += 0.12 * Math.min(1, (silence - 25) / 3); pitchAdd += 0.1 * Math.min(1, (silence - 25) / 3);
      this.amb = null;
    } else {
      // between reactions: now and then a small change of face
      if (!this.amb && t >= this.nextAmb) {
        const A = this.ambRand;
        this.amb = { ...AMBIENT[Math.floor(A() * AMBIENT.length)], t0: t, dur: 2.5 + A() * 2 };
        this.nextAmb = t + this.amb.dur + 12 + A() * 18;
      }
      if (this.amb) {
        const age = t - this.amb.t0, a = clamp(Math.min(age / 0.5, (this.amb.dur - age) / 0.5), 0, 1);
        if (age >= this.amb.dur) this.amb = null;
        else { arkit = Object.fromEntries(Object.entries(this.amb.arkit).map(([k, w]) => [k, w * a])); tilt += (this.amb.tilt || 0) * a; }
      }
    }
    if (arkit) {
      if (speaking) { const keep = clamp(1 - mouth * 2.5, 0, 1); for (const k in arkit) if (MOUTH_HOLD.test(k)) arkit[k] *= keep; }
      st.arkit = arkit;
    }
    if (this.wakeKick) { st.ahogeKick += this.wakeKick; this.wakeKick = 0; }

    st.blink = st.eyes === 'normal' || st.eyes === 'wide' || st.eyes === 'half' ? blink : 0;
    st.eyeLook = [clamp((this.eye[0] - this.headLook[0] * 0.5) * 1.1, -1, 1), clamp((this.eye[1] - this.headLook[1] * 0.5) * 1.1, -1, 1)];
    const nt = (t - this.nodStart) / 0.45;
    const nod = nt >= 0 && nt <= 1 ? 0.1 * Math.sin(Math.PI * nt) : 0;
    st.yaw = this.headLook[0] * 0.35 + Math.sin(t * 0.6) * 0.04 + yawAdd;
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
      delete st.arkit;
    }
    return st;
  }
}
