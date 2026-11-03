// VTuber avatar from a VRM model (the format VRoid Studio, VSeeFace and Warudo use), rendered with
// pixiv's three-vrm and its MToon toon shader. Same page API as before:
// window.renderBatch(states) -> base64 RGBA overlay frames, window.renderSheet(states, cols, tile).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { drawFx, drawBubble, starPath, heartPath } from './fx.js';

const params = new URLSearchParams(location.search);
const MODEL = params.get('model') || 'AvatarSample_A';
const OUT_W = 420, OUT_H = 170, CH = 170, SS = 3, CHAR_X = OUT_W - CH, DT = 1 / 30;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CH * SS, CH * SS);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, 1, 0.05, 20);
const light = new THREE.DirectionalLight(0xffffff, Math.PI * 0.85);
light.position.set(-0.5, 1.2, 1.5);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const out = document.createElement('canvas');
out.width = OUT_W; out.height = OUT_H;
const octx = out.getContext('2d', { willReadFrequently: true });
document.body.appendChild(out);

const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));
const gltf = await loader.loadAsync(`/build/models/${MODEL}.vrm`);
const vrm = gltf.userData.vrm;
VRMUtils.removeUnnecessaryVertices(gltf.scene);
VRMUtils.combineSkeletons(gltf.scene);
VRMUtils.rotateVRM0(vrm);
// outfit: wear another VRoid model's body and clothes, rebound onto this model's skeleton by bone name
const OUTFIT = params.get('outfit') ?? (MODEL === 'PS_Female' ? 'AvatarSample_A' : '');
if (OUTFIT) {
  const og = await loader.loadAsync(`/build/models/${OUTFIT}.vrm`);
  VRMUtils.removeUnnecessaryVertices(og.scene);
  const nodes = {};
  vrm.scene.traverse((o) => { if (o.isBone || o.type === 'Object3D' || o.type === 'Bone') nodes[o.name] = o; });
  // bones only the outfit has (hood, strings) are copied in with their local rest transform
  const mapBone = (b) => {
    if (nodes[b.name]) return nodes[b.name];
    const parent = mapBone(b.parent);
    const c = new THREE.Bone(); c.name = b.name;
    c.position.copy(b.position); c.quaternion.copy(b.quaternion); c.scale.copy(b.scale);
    parent.add(c); nodes[b.name] = c;
    return c;
  };
  const matName = (o) => [o.material].flat()[0].name;
  const wear = [];
  og.scene.traverse((o) => { if (o.isSkinnedMesh && /Body|CLOTH/.test(matName(o)) && !/HAIR/.test(matName(o))) wear.push(o); });
  // hide this model's own body and clothes, keep its back hair
  vrm.scene.traverse((o) => { if (o.isSkinnedMesh && !o.morphTargetDictionary && /Body_00_SKIN|CLOTH/.test(matName(o))) o.visible = false; });
  for (const m of wear) {
    const bones = m.skeleton.bones.map(mapBone);
    m.removeFromParent();
    vrm.scene.add(m);
    m.bind(new THREE.Skeleton(bones, m.skeleton.boneInverses), m.bindMatrix);
  }
}
// hair tint: the perfect-sync base ships with grey hair; a soft chestnut matches the outfit
const HAIR = params.get('hair') ?? (MODEL === 'PS_Female' ? 'b8977f' : '');
if (HAIR) vrm.scene.traverse((o) => {
  if (o.isMesh) for (const m of [o.material].flat()) if (/HAIR/.test(m.name) && !/Outline/.test(m.name)) {
    m.color?.set(`#${HAIR}`).convertSRGBToLinear?.();
    m.shadeColorFactor?.set(`#${HAIR}`).multiplyScalar(0.55);
  }
});
vrm.scene.traverse((o) => { o.frustumCulled = false; });
scene.add(vrm.scene);
const B = (n) => vrm.humanoid.getNormalizedBoneNode(n);
const faceMeshes = [];
vrm.scene.traverse((o) => { const d = o.morphTargetDictionary; if (d && ('Fcl_EYE_Close' in d || 'jawOpen' in d)) faceMeshes.push(o); });
const PERFECT_SYNC = faceMeshes.some((m) => 'jawOpen' in m.morphTargetDictionary && 'eyeLookInLeft' in m.morphTargetDictionary);
function applyMorphs(face) {
  const morphs = PERFECT_SYNC ? face.arkit : face.morphs;
  for (const mesh of faceMeshes) {
    const d = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences;
    for (const k in d) inf[d[k]] = 0;
    for (const k in morphs) if (k in d) inf[d[k]] = morphs[k];
  }
}
const RAW = (n) => vrm.humanoid.getRawBoneNode(n);
const em = vrm.expressionManager;
const EXPR = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink'];

// rest pose with arms down, then frame the camera on the bust
function armsDown() {
  B('leftUpperArm').rotation.set(0, 0, 1.25);
  B('rightUpperArm').rotation.set(0, 0, -1.25);
}
armsDown();
vrm.update(0);
vrm.scene.updateMatrixWorld(true);
const headRest = new THREE.Vector3();
RAW('head').getWorldPosition(headRest);
const FRAME_H = 0.5;  // metres of avatar visible top to bottom
const dist = FRAME_H / 2 / Math.tan(THREE.MathUtils.degToRad(10));
const camShiftX = -0.025;
camera.position.set(headRest.x + camShiftX, headRest.y + 0.02, headRest.z + dist);
camera.lookAt(headRest.x + camShiftX, headRest.y - 0.02, headRest.z);
const lookTarget = new THREE.Object3D();
scene.add(lookTarget);
vrm.lookAt.target = lookTarget;

// ---------------------------------------------------------------- arm IK
const v3 = () => new THREE.Vector3();
function worldPos(o) { return o.getWorldPosition(v3()); }
const arms = ['left', 'right'].map((side) => {
  const sd = side === 'left' ? 1 : -1;   // character's left is +x (viewer's right)
  vrm.scene.updateMatrixWorld(true);
  const up = B(`${side}UpperArm`), lo = B(`${side}LowerArm`), hand = B(`${side}Hand`);
  return { side, sd, up, lo, hand, a: lo.position.length(), b: hand.position.length(), cur: null };
});
function aimBone(bone, child, dirWorld) {
  bone.quaternion.identity();
  bone.updateMatrixWorld(true);
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const rest = child.position.clone().normalize();
  const want = dirWorld.clone().applyQuaternion(parentQ.invert()).normalize();
  bone.quaternion.setFromUnitVectors(rest, want);
  bone.updateMatrixWorld(true);
}
function solveArm(arm, target, pole) {
  const S = worldPos(arm.up);
  const { a, b } = arm;
  const toT = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), 0.05, a + b - 1e-3);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const E = S.clone().addScaledVector(dir, a * cosA).addScaledVector(p, a * Math.sqrt(1 - cosA * cosA));
  aimBone(arm.up, arm.lo, E.clone().sub(S));
  aimBone(arm.lo, arm.hand, S.clone().addScaledVector(dir, d).sub(E));
}
// hand targets relative to the head bone (metres): x toward the character's left
const HAND_POSES = {
  cover: [[0.035, 0.0, 0.13], [-0.035, -0.005, 0.13]],
  up: [[0.17, -0.05, 0.1], [-0.17, -0.05, 0.1]],
  wave: [null, [-0.2, 0.06, 0.06]],
  chin: [null, [-0.02, -0.05, 0.11]],
};

// ---------------------------------------------------------------- per-frame application
const sim = { vowel: 'aa', vowelUntil: 0, init: false };
function applyState(st) {
  const t = st.t;
  for (const n of EXPR) em.setValue(n, 0);
  // ARKit shapes aren't bound to any preset expression, so nothing else resets them between frames
  for (const mesh of faceMeshes) for (const k in mesh.morphTargetDictionary) if (!k.startsWith('Fcl_')) mesh.morphTargetInfluences[mesh.morphTargetDictionary[k]] = 0;
  // head and body
  const { yaw, pitch, roll } = st;
  B('spine').rotation.set(pitch * 0.1, yaw * 0.2, roll * 0.2);
  B('neck').rotation.set(pitch * 0.4, yaw * 0.35, roll * 0.4);
  B('head').rotation.set(pitch * 0.6, yaw * 0.55, roll * 0.6);
  B('chest').rotation.set(0.015 * Math.sin(t * 2.1), 0, 0);
  vrm.humanoid.normalizedHumanBonesRoot.position.y = st.bob * 0.12;
  // arms: blend hand positions toward the pose with IK; otherwise rest down
  armsDown();
  B('leftLowerArm').rotation.set(0, 0, 0); B('rightLowerArm').rotation.set(0, 0, 0);
  B('leftHand').rotation.set(0, 0, 0); B('rightHand').rotation.set(0, 0, 0);
  vrm.scene.updateMatrixWorld(true);
  const H = worldPos(RAW('head'));
  const pose = HAND_POSES[st.hands];
  arms.forEach((arm, i) => {
    const restHand = worldPos(arm.hand);
    let target = restHand;
    if (pose && pose[i]) {
      const [x, y, z] = pose[i];
      target = H.clone().add(new THREE.Vector3(x, y, z));
      if (st.hands === 'up') target.y += Math.abs(Math.sin(t * 9)) * 0.025;
    }
    arm.cur = arm.cur ? arm.cur.lerp(target, 0.22) : target.clone();
    if (arm.cur.distanceTo(restHand) > 0.01) {
      solveArm(arm, arm.cur, new THREE.Vector3(arm.sd * 0.6, -1, -0.4));
      if (st.hands === 'wave' && arm.side === 'right') arm.hand.rotation.z = Math.sin(t * 11) * 0.5;
      if (st.hands === 'cover' || st.hands === 'chin') arm.hand.rotation.x = -0.6;
    }
  });
  if (st.face) {
    // perfect-sync models move the eyes with their eyeLook* shapes; others aim the eye bones
    const [gx, gy] = PERFECT_SYNC ? [0, 0] : st.face.gaze;
    lookTarget.position.set(H.x + gx * 0.6, H.y + 0.06 + gy * 0.4, H.z + 1.0);
    vrm.update(DT);
    applyMorphs(st.face);
    return;
  }
  // face
  const eyes = st.eyes;
  if (eyes === 'happy') em.setValue('happy', 1);
  else if (eyes === 'wide') em.setValue('surprised', 0.75);
  else if (eyes === 'squint') { em.setValue('angry', 0.85); }
  else if (eyes === 'sleepy') { em.setValue('relaxed', 0.5); em.setValue('blink', 0.75); }
  else if (eyes === 'half') em.setValue('blink', 0.4 + 0.6 * st.blink);
  else em.setValue('blink', st.blink);
  if (st.brows === 'worried') em.setValue('sad', 0.45);
  if (st.mouthKind === 'smile' && eyes !== 'happy') em.setValue('relaxed', Math.max(em.getValue('relaxed'), 0.45));
  if (st.mouthKind === 'pout') { em.setValue('angry', Math.max(em.getValue('angry'), 0.35)); em.setValue('ou', 0.35); }
  // lip sync: vary vowels while talking so it doesn't look like a flapping hinge
  const m = st.mouth;
  if (st.mouthKind === 'o') em.setValue('ou', 0.9);
  else if (m > 0.06) {
    if (t >= sim.vowelUntil) {
      const r = (Math.sin(t * 91.7) + 1) / 2;
      sim.vowel = r < 0.45 ? 'aa' : r < 0.6 ? 'oh' : r < 0.75 ? 'ee' : r < 0.88 ? 'ih' : 'ou';
      sim.vowelUntil = t + 0.1 + r * 0.08;
    }
    em.setValue(sim.vowel, Math.min(1, m * 1.1));
    if (sim.vowel !== 'aa') em.setValue('aa', m * 0.3);
  }
  // gaze
  const [lx, ly] = st.eyeLook;
  lookTarget.position.set(H.x + lx * 0.6, H.y + 0.06 - ly * 0.4, H.z + 1.0);
  vrm.update(DT);
  // extra ARKit shapes on top of the preset expressions (perfect-sync models only)
  if (st.arkit) for (const mesh of faceMeshes) {
    const d = mesh.morphTargetDictionary, inf = mesh.morphTargetInfluences;
    for (const k in st.arkit) if (k in d) inf[d[k]] = Math.min(1, inf[d[k]] + st.arkit[k]);
  }
}

function project(p) { const v = p.clone().project(camera); return [(v.x + 1) / 2, (1 - v.y) / 2]; }
function anchors() {
  const H = worldPos(RAW('head'));
  const le = worldPos(RAW('leftEye') || RAW('head')), re = worldPos(RAW('rightEye') || RAW('head'));
  const eyeMid = le.clone().add(re).multiplyScalar(0.5);
  const fwd = new THREE.Vector3(0, 0, 0.03);
  return { head: project(H.clone().add(new THREE.Vector3(0, 0.07, 0))), le: project(le.add(fwd)), re: project(re.add(fwd)),
    cheekL: project(eyeMid.clone().add(new THREE.Vector3(0.042, -0.03, 0.05))),
    cheekR: project(eyeMid.clone().add(new THREE.Vector3(-0.042, -0.03, 0.05))) };
}
function drawFaceExtras(c, st, A, dx, dy, size) {
  const P = ([x, y]) => [dx + x * size, dy + y * size];
  const [lx, ly] = P(A.le), [rx, ry] = P(A.re);
  const eyeD = Math.hypot(lx - rx, ly - ry);
  if (st.blush > 0.05) for (const ch of [A.cheekL, A.cheekR]) {
    const [x, y] = P(ch);
    const g = c.createRadialGradient(x, y, 0, x, y, eyeD * 0.32);
    g.addColorStop(0, `rgba(255,120,140,${0.45 * st.blush})`); g.addColorStop(1, 'rgba(255,120,140,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y, eyeD * 0.32, eyeD * 0.18, 0, 0, 7); c.fill();
  }
  if (st.eyes === 'star' || st.eyes === 'heart') for (const [x, y] of [[lx, ly], [rx, ry]]) {
    const r = eyeD * 0.27;
    if (st.eyes === 'star') { starPath(c, x, y, r, st.t * 1.5); c.fillStyle = '#ffd04a'; }
    else { heartPath(c, x, y + r * 0.1, r * 0.85); c.fillStyle = '#ff5c80'; }
    c.fill(); c.lineWidth = Math.max(1, r * 0.14); c.strokeStyle = '#ffffff'; c.stroke();
  }
  return eyeD;
}
function renderInto(c, st, dx, dy, size) {
  applyState(st);
  renderer.render(scene, camera);
  c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(renderer.domElement, dx, dy, size, size); c.restore();
  const A = anchors();
  const eyeD = drawFaceExtras(c, st, A, dx, dy, size);
  return { hx: dx + A.head[0] * size, hy: dy + A.head[1] * size, s: eyeD * 0.04 };
}
function composeFrame(st) {
  octx.clearRect(0, 0, OUT_W, OUT_H);
  const { hx, hy, s } = renderInto(octx, st, CHAR_X, 0, CH);
  octx.save();
  octx.globalCompositeOperation = 'destination-in';
  const g = octx.createLinearGradient(0, OUT_H - 50, 0, OUT_H - 4);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  octx.fillStyle = g; octx.fillRect(0, 0, OUT_W, OUT_H);
  octx.restore();
  drawFx(octx, st, hx, hy, s);
  drawBubble(octx, st.bubble, hx - 60 * s / 0.62, 30);
}

async function toBase64(u8) {
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([u8])); });
  return url.slice(url.indexOf(',') + 1);
}
window.renderBatch = async (states) => {
  const all = new Uint8Array(OUT_W * OUT_H * 4 * states.length);
  states.forEach((st, i) => { composeFrame(st); all.set(octx.getImageData(0, 0, OUT_W, OUT_H).data, i * OUT_W * OUT_H * 4); });
  return toBase64(all);
};
window.renderSheet = (states, cols, tile) => {
  const rows = Math.ceil(states.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * tile; sheet.height = rows * tile;
  const c = sheet.getContext('2d');
  c.fillStyle = '#26262c'; c.fillRect(0, 0, sheet.width, sheet.height);
  states.forEach((st, i) => {
    const dx = (i % cols) * tile, dy = Math.floor(i / cols) * tile;
    for (const a of arms) a.cur = null;
    for (let k = 0; k < 40; k++) applyState({ ...st, t: st.t + k * DT });   // settle hair physics and hands
    const { hx, hy, s } = renderInto(c, st, dx, dy, tile);
    drawFx(c, st, hx, hy, s);
    if (st.bubble) drawBubble(c, st.bubble, hx - 60 * s / 0.62, dy + 34);
  });
  return sheet.toDataURL('image/png');
};
const big = document.createElement('canvas');
const bctx = big.getContext('2d', { willReadFrequently: true });
window.renderAvatarBatch = async (states, size) => {
  big.width = big.height = size;
  const all = new Uint8Array(size * size * 4 * states.length);
  states.forEach((st, i) => {
    bctx.fillStyle = '#2b2b33'; bctx.fillRect(0, 0, size, size);
    const { hx, hy, s } = renderInto(bctx, st, 0, 0, size);
    drawFx(bctx, st, hx, hy, s);
    all.set(bctx.getImageData(0, 0, size, size).data, i * size * size * 4);
  });
  return toBase64(all);
};
window.OUT = { W: OUT_W, H: OUT_H };
window.ready = true;
