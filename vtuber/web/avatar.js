// 3D anime-girl Alejo, built from primitives in three.js with toon shading and outlines.
// The page exposes window.renderBatch(states) -> base64 RGBA frames of the overlay,
// and window.renderSheet(states, cols) for design review.
import * as THREE from 'three';

const OUT_W = 420, OUT_H = 160;   // overlay at final size
const CH = 160;                   // square character box at the right of the overlay
const SS = 3;                     // 3D supersampling
const CHAR_X = OUT_W - CH;
const DT = 1 / 30;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(CH * SS, CH * SS);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, 1, 1, 60);
camera.position.set(-0.35, -0.3, 13);
camera.lookAt(-0.35, -0.42, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0xe6d6e6, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.9);
key.position.set(-3, 4, 6);
scene.add(key);

const out = document.createElement('canvas');
out.width = OUT_W; out.height = OUT_H;
const octx = out.getContext('2d', { willReadFrequently: true });
document.body.appendChild(out);
out.style.cssText = 'width:1260px;height:480px;image-rendering:auto';

// ---------------------------------------------------------------- materials
const grad = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: grad });
const OUTLINE = new THREE.Color(0x3a2422);
const outlineMat = (w) => new THREE.ShaderMaterial({
  uniforms: { w: { value: w }, color: { value: OUTLINE } },
  vertexShader: 'uniform float w; void main(){ vec3 p = position + normal * w; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
  fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
  side: THREE.BackSide,
});
function mesh(geo, mat, outline = 0.022) {
  const m = new THREE.Mesh(geo, mat);
  if (outline) m.add(new THREE.Mesh(geo, outlineMat(outline)));
  return m;
}

const C = {
  skin: 0xffe2d0, skinShade: 0xf0c2ae, hair: 0x5a382c, hairDark: 0x3e2620, shine: 0xb07a60,
  shirt: 0x34406a, shirtDark: 0x252e50, mint: 0x7ad6c4, mintDark: 0x4aa898, glasses: 0x2a2024,
};

// ---------------------------------------------------------------- geometry helpers
function deformHead(v) {
  let { x, y, z } = v;
  if (y < 0) {
    const k = Math.min(1, -y);
    x *= 1 - 0.34 * k * k;
    z *= 1 - 0.14 * k * k;
    if (z > 0) z += 0.07 * k * k;
    y *= 1.12;
  }
  if (z < 0) z *= 0.92;
  x *= 0.97;
  return v.set(x, y, z);
}
function deformGeo(geo, r = 1) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).divideScalar(r);
    deformHead(v).multiplyScalar(r);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
const rad = (d) => d * Math.PI / 180;
const sph = (az, el, r) => [r * Math.cos(rad(el)) * Math.sin(rad(az)), r * Math.sin(rad(el)), r * Math.cos(rad(el)) * Math.cos(rad(az))];

// tapered hair strand along a curve; the wide side lies against the head
function strand(pts, w0, t0, side = null) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const N = 30, M = 10, pos = [], idx = [];
  const T = new THREE.Vector3(), O = new THREE.Vector3(), S = new THREE.Vector3(), Nn = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N, P = curve.getPoint(t);
    curve.getTangent(t, T);
    if (side) S.set(...side).normalize();
    else {
      O.set(P.x, P.y * 0.3, P.z).normalize();
      S.crossVectors(T, O);
      if (S.lengthSq() < 1e-4) S.set(1, 0, 0);
      S.normalize();
    }
    Nn.crossVectors(S, T).normalize();
    const prof = t < 0.12 ? 0.75 + 2 * t : Math.pow(1 - t, 0.75) * 1.06 + 0.012;
    const w = w0 * prof, th = t0 * prof;
    for (let j = 0; j < M; j++) {
      const a = (j / M) * Math.PI * 2;
      // crescent-ish section: outer face bulges, inner face flatter
      const s = Math.sin(a), c = Math.cos(a);
      const q = P.clone().addScaledVector(S, c * w / 2).addScaledVector(Nn, s * th / 2 * (s > 0 ? 1 : 0.5));
      pos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c2 = a + M, d = b + M;
    idx.push(a, c2, b, b, c2, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function limb(mat, r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 16, 1, false);
  g.translate(0, 0.5, 0);
  return mesh(g, mat, 0.018);
}
function placeLimb(m, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.scale.set(1, d.length(), 1);
}

// ---------------------------------------------------------------- build the avatar
const root = new THREE.Group();
scene.add(root);
const body = new THREE.Group();
root.add(body);

const torsoGeo = new THREE.LatheGeometry([
  [0.0, -3.4], [1.42, -3.4], [1.5, -2.7], [1.45, -2.05], [1.2, -1.7], [0.62, -1.48], [0.26, -1.36], [0.0, -1.34],
].map(([r, y]) => new THREE.Vector2(r, y)), 48);
torsoGeo.scale(1, 1, 0.62);
torsoGeo.computeVertexNormals();
body.add(mesh(torsoGeo, toon(C.shirt), 0.03));
const neck = mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.8, 20), toon(C.skinShade), 0.018);
neck.position.set(0, -1.12, 0.02);
body.add(neck);
const collar = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.045, 10, 32), toon(C.shirtDark));
collar.rotation.x = Math.PI / 2 - 0.15;
collar.position.set(0, -1.42, 0.04);
collar.scale.set(1, 1, 0.9);
body.add(collar);

// arms (short sleeves) and hands
const skinMat = toon(C.skin), shirtMat = toon(C.shirt);
const arms = [-1, 1].map((sd) => {
  const upper = limb(shirtMat, 0.2, 0.17), fore = limb(skinMat, 0.13, 0.11);
  const hand = mesh(new THREE.SphereGeometry(1, 20, 16), skinMat, 0.02);
  hand.scale.set(0.17, 0.2, 0.13);
  const thumb = mesh(new THREE.SphereGeometry(1, 12, 10), skinMat, 0.02);
  thumb.scale.set(0.06, 0.1, 0.06);
  thumb.position.set(-sd * 0.15, 0.05, 0.05);
  hand.add(thumb);
  thumb.scale.divide(hand.scale);
  thumb.position.divide(hand.scale);
  body.add(upper, fore, hand);
  return { sd, upper, fore, hand, pos: new THREE.Vector3(sd * 1.6, -3.8, 0.3) };
});

// head pivot at the neck
const headPivot = new THREE.Group();
headPivot.position.set(0, -0.85, 0);
root.add(headPivot);
const head = new THREE.Group();
head.position.set(0, 0.85, 0);
headPivot.add(head);
head.add(mesh(deformGeo(new THREE.SphereGeometry(1, 64, 48)), toon(C.skin), 0.025));
for (const sd of [-1, 1]) {
  const ear = mesh(new THREE.SphereGeometry(1, 16, 12), toon(C.skin), 0.015);
  ear.scale.set(0.09, 0.17, 0.12);
  ear.position.set(sd * 0.95, -0.12, 0.02);
  head.add(ear);
}

// face decal: expressions are painted onto a canvas texture
const FACE = { phi0: Math.PI / 2 - 0.9, phiL: 1.8, th0: Math.PI / 2 - 0.75, thL: 1.5, size: 1024 };
const faceCanvas = document.createElement('canvas');
faceCanvas.width = faceCanvas.height = FACE.size;
const fctx = faceCanvas.getContext('2d');
const faceTex = new THREE.CanvasTexture(faceCanvas);
faceTex.colorSpace = THREE.SRGBColorSpace;
faceTex.anisotropy = 4;
const faceGeo = deformGeo(new THREE.SphereGeometry(1.004, 96, 72, FACE.phi0, FACE.phiL, FACE.th0, FACE.thL), 1.004);
const faceMesh = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({
  map: faceTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false,
}));
head.add(faceMesh);

// hair
const hairMat = toon(C.hair), hairDarkMat = toon(C.hairDark);
const cap = new THREE.SphereGeometry(1.075, 64, 40, 0, Math.PI * 2, 0, 1.85);
{
  const p = cap.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.z > 0.05 && v.y < 0.5) v.multiplyScalar(0.9);   // hairline: tuck the front under the face
    v.divideScalar(1.075); deformHead(v); v.multiplyScalar(1.075);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  cap.computeVertexNormals();
}
head.add(mesh(cap, hairMat, 0.025));

const bangs = new THREE.Group();
head.add(bangs);
const bangSpecs = [
  // az0, end elevation, end az shift, width
  [-58, -14, 6, 0.34], [-44, 6, 10, 0.3], [-32, 12, 14, 0.32], [-19, 9, 16, 0.32], [-6, 15, 18, 0.32],
  [7, 10, 18, 0.32], [20, 16, 16, 0.3], [33, 11, 12, 0.3], [46, 4, 8, 0.3], [58, -10, 4, 0.32],
];
for (const [az, el, shift, w] of bangSpecs) {
  const pts = [sph(az * 0.55, 66, 1.05), sph(az * 0.8 + shift * 0.3, 44, 1.12), sph(az + shift * 0.75, 26, 1.13),
    sph(az + shift, el, 1.1)];
  bangs.add(mesh(strand(pts, w, 0.09), hairMat, 0.018));
}
// angel-ring shine across the crown
for (const [a0, a1] of [[-0.95, -0.25], [-0.12, 0.5], [0.62, 0.95]]) {
  const g = new THREE.TorusGeometry(1.15 * Math.cos(rad(46)), 0.028, 8, 24, a1 - a0);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: C.shine }));
  m.rotation.set(-Math.PI / 2, 0, -Math.PI / 2 + a0);   // arc sweeps across the front
  m.position.set(0, 1.15 * Math.sin(rad(46)), 0);
  head.add(m);
}

const sideLocks = [-1, 1].map((sd) => {
  const g = new THREE.Group();
  g.position.set(sd * 0.92, 0.5, 0.4);
  const pts = [[0, 0.05, 0], [sd * 0.12, -0.5, 0.06], [sd * 0.1, -1.15, 0.0], [sd * -0.02, -1.75, -0.08],
    [sd * -0.16, -2.05, 0.0]];
  g.add(mesh(strand(pts, 0.36, 0.11, [0, 0, 1]), hairMat, 0.02));
  head.add(g);
  return g;
});

const backHair = new THREE.Group();
backHair.position.set(0, 0.5, 0);
head.add(backHair);
for (let i = 0; i < 13; i++) {
  const az = 98 + i * (164 / 12);
  const p1 = sph(az, 0, 1.17), sd = Math.sign(p1[0]) || 0;
  const pts = [sph(az, 48, 1.02), p1, [p1[0] * 1.08, -1.1, p1[2] * 1.02 - 0.05],
    [p1[0] * 1.14 + sd * 0.05, -2.0, p1[2] * 0.95 - 0.15], [p1[0] * 1.1 + sd * 0.1, -2.75, p1[2] * 0.85 - 0.2]]
    .map(([x, y, z]) => [x, y - 0.5, z]);
  backHair.add(mesh(strand(pts, 0.52, 0.16), i % 2 ? hairMat : hairDarkMat, 0.02));
}

const ahoge = new THREE.Group();
ahoge.position.set(0, 1.02, 0.2);
head.add(ahoge);
ahoge.add(mesh(strand([[0, 0, 0], [0, 0.3, 0.08], [0.04, 0.5, 0.3], [0.08, 0.43, 0.52], [0.06, 0.3, 0.5]],
  0.1, 0.05, [1, 0, 0]), hairMat, 0.016));

// star hair clip
{
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 0.055 : 0.13;
    i ? sh.lineTo(r * Math.cos(a), r * Math.sin(a)) : sh.moveTo(r * Math.cos(a), r * Math.sin(a));
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
  const clip = mesh(g, toon(C.mint), 0.012);
  clip.position.set(...sph(-50, 22, 1.17));
  clip.lookAt(new THREE.Vector3(...sph(-50, 22, 3)));
  clip.rotateZ(0.3);
  head.add(clip);
}

// glasses
const glassesMat = new THREE.MeshBasicMaterial({ color: C.glasses });
const glasses = new THREE.Group();
head.add(glasses);
for (const sd of [-1, 1]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.03, 10, 48), glassesMat);
  ring.position.set(sd * 0.37, -0.12, 1.05);
  ring.rotation.y = sd * 0.28;
  glasses.add(ring);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.255, 40),
    new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.1, depthWrite: false }));
  lens.position.copy(ring.position);
  lens.rotation.copy(ring.rotation);
  glasses.add(lens);
  const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
  glint.position.set(sd * 0.37 + 0.12, -0.02, 1.07 - sd * 0.02);
  glint.rotation.set(0, sd * 0.28, -0.7);
  glasses.add(glint);
  const temple = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 8), glassesMat);
  placeLimb(temple, new THREE.Vector3(sd * 0.635, -0.08, 0.96), new THREE.Vector3(sd * 0.98, -0.05, 0.05));
  glasses.add(temple);
}
{
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.025, 8, 16, Math.PI), glassesMat);
  bridge.position.set(0, -0.09, 1.1);
  glasses.add(bridge);
}

// headset
const headset = new THREE.Group();
head.add(headset);
{
  const band = mesh(new THREE.TorusGeometry(1.2, 0.06, 12, 64, Math.PI), toon(C.mint), 0.02);
  band.position.set(0, -0.06, -0.05);
  band.rotation.x = -0.12;
  headset.add(band);
  for (const sd of [-1, 1]) {
    const cup = mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 32), toon(C.mint), 0.022);
    cup.rotation.z = Math.PI / 2;
    cup.position.set(sd * 1.16, -0.08, 0.0);
    headset.add(cup);
    const cap2 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.17, 24), toon(C.mintDark));
    cap2.rotation.z = Math.PI / 2;
    cap2.position.set(sd * 1.2, -0.08, 0.0);
    headset.add(cap2);
  }
  const boom = new THREE.CatmullRomCurve3([[-1.2, -0.25, 0.15], [-1.05, -0.72, 0.55], [-0.38, -0.72, 0.98]]
    .map((p) => new THREE.Vector3(...p)));
  headset.add(mesh(new THREE.TubeGeometry(boom, 24, 0.03, 8), toon(C.mintDark), 0.012));
}
const micTip = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff7890 }));
micTip.position.set(-0.36, -0.72, 0.99);
headset.add(micTip);
micTip.add(new THREE.Mesh(micTip.geometry, outlineMat(0.015)));

// ---------------------------------------------------------------- face painting
function faceXY(x, y) {  // undeformed unit-sphere face point (y up) -> canvas px and local scale
  const th = Math.acos(y), st = Math.sin(th);
  const ph = Math.acos(-x / st);
  return {
    px: (ph - FACE.phi0) / FACE.phiL * FACE.size, py: (th - FACE.th0) / FACE.thL * FACE.size,
    sx: FACE.size / FACE.phiL / st, sy: FACE.size / FACE.thL / st,
  };
}
// draw with a local transform where 1 unit = k face units, y down
function at(x, y, k, fn) {
  const f = faceXY(x, y);
  fctx.save();
  fctx.setTransform(f.sx * k, 0, 0, f.sy * k, f.px, f.py);
  fn(fctx);
  fctx.restore();
}
const LASH = '#28181a', IRIS = '#80502f', IRIS_L = '#c88c5c', PUPIL = '#301a16';
function strokePath(c, w, color, build) {
  c.beginPath(); build(c); c.lineWidth = w; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function starPath(c, x, y, r, spin) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = spin + i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    c[i ? 'lineTo' : 'moveTo'](x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  c.closePath();
}
function heartPath(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y + r);
  c.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.4, x, y - r * 0.45);
  c.bezierCurveTo(x + r * 0.7, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r);
  c.closePath();
}
function drawEye(c, st, side) {  // old 2D units, eye centre at 0,0
  const [lx, ly] = st.eyeLook, kind = st.eyes, blink = st.blink;
  if (kind === 'happy') return strokePath(c, 3.4, LASH, (c) => { c.moveTo(-9, 3); c.quadraticCurveTo(0, -9, 9, 3); });
  if (kind === 'sleepy' || blink > 0.8) return strokePath(c, 3.2, LASH, (c) => { c.moveTo(-9, 1); c.quadraticCurveTo(0, 6, 9, 1); });
  if (kind === 'squint') return strokePath(c, 3.4, LASH, (c) => { c.moveTo(-6 * side, -6); c.lineTo(6 * side, 0); c.lineTo(-6 * side, 6); });
  if (kind === 'star') {
    starPath(c, 0, 0, 9.5, st.t * 1.5); c.fillStyle = '#ffc440'; c.fill(); c.lineWidth = 1.8; c.strokeStyle = LASH; c.stroke(); return;
  }
  if (kind === 'heart') { heartPath(c, 0, 1, 8.5); c.fillStyle = '#ff5c80'; c.fill(); c.lineWidth = 1.8; c.strokeStyle = LASH; c.stroke(); return; }
  let open = 1 - blink;
  if (kind === 'half') open *= 0.55;
  const big = kind === 'wide' ? 1.1 : 1;
  const rx = 9.5 * big, ry = 10 * big * open, top = -ry;
  c.save();
  c.beginPath(); c.ellipse(0, top + (ry + 9 * big * open) / 2, rx, (ry + 9 * big * open) / 2, 0, 0, Math.PI * 2);
  c.fillStyle = '#fff'; c.fill(); c.clip();
  const ix = lx * 3.2, iy = 1 + ly * 2.4, irx = kind === 'wide' ? 5.2 : 7.2, iry = kind === 'wide' ? 6.4 : 9.2;
  const g = c.createLinearGradient(0, iy - iry, 0, iy + iry);
  g.addColorStop(0, '#5a3220'); g.addColorStop(0.55, IRIS); g.addColorStop(1, IRIS_L);
  c.beginPath(); c.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2); c.fillStyle = g; c.fill();
  c.beginPath(); c.ellipse(ix, iy - 1, irx * 0.5, iry * 0.48, 0, 0, Math.PI * 2); c.fillStyle = PUPIL; c.fill();
  c.beginPath(); c.arc(ix - 2.6, iy - 3.8, 2.7, 0, 7); c.fillStyle = '#fff'; c.fill();
  c.beginPath(); c.arc(ix + 2.8, iy + 3.6, 1.3, 0, 7); c.fill();
  c.restore();
  strokePath(c, 3.2, LASH, (c) => {
    c.moveTo(-side * rx * 1.05, top + ry * 0.55);
    c.quadraticCurveTo(-side * 2, top - 2.5, side * rx * 1.05, top + ry * 0.45);
    c.lineTo(side * (rx + 3.8), top - 1.2);
  });
  strokePath(c, 1.4, 'rgba(60,30,30,0.55)', (c) => { c.moveTo(-rx * 0.6, 9 * big * open + 0.5); c.lineTo(rx * 0.6, 9 * big * open + 0.5); });
  if (kind === 'half') strokePath(c, 3, LASH, (c) => { c.moveTo(-rx, top); c.lineTo(rx, top); });
}
function drawMouth(c, st) {
  const kind = st.mouthKind;
  let m = st.mouth;
  if (kind === 'o') { c.beginPath(); c.ellipse(0, 1.5, 4, 4.8, 0, 0, 7); c.fillStyle = '#be4650'; c.fill(); c.lineWidth = 2; c.strokeStyle = LASH; c.stroke(); return; }
  if (kind === 'pout') return strokePath(c, 2.2, LASH, (c) => { c.moveTo(-7, 2); c.lineTo(-3.5, 0); c.lineTo(0, 2); c.lineTo(3.5, 0); c.lineTo(7, 2); });
  if (kind === 'flat') return strokePath(c, 2.2, LASH, (c) => { c.moveTo(-5, 1); c.lineTo(5, 1); });
  if (kind === 'smile' && m < 0.15) m = 0.5;
  if (m < 0.1) return strokePath(c, 2.2, LASH, (c) => { c.moveTo(-5, 0); c.quadraticCurveTo(0, 3, 5, 0); });
  const w = 5 + 4 * m, h = 2 + 10 * m;
  c.beginPath(); c.moveTo(-w, -1); c.quadraticCurveTo(0, 0.5, w, -1); c.bezierCurveTo(w * 0.9, h, -w * 0.9, h, -w, -1); c.closePath();
  c.fillStyle = '#be4650'; c.fill();
  c.save(); c.clip(); c.beginPath(); c.ellipse(0, h * 0.85, w * 0.7, h * 0.4, 0, 0, 7); c.fillStyle = '#ff8c96'; c.fill(); c.restore();
  c.lineWidth = 2; c.strokeStyle = LASH; c.stroke();
}
function paintFace(st) {
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, FACE.size, FACE.size);
  const puff = 1 + 0.4 * st.puff;
  for (const sd of [-1, 1]) at(sd * 0.53, -0.36, 0.017, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 10 * puff);
    const a = 0.35 + 0.45 * st.blush;
    g.addColorStop(0, `rgba(255,130,145,${a})`); g.addColorStop(1, 'rgba(255,130,145,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 11 * puff, 6 * puff, 0, 0, 7); c.fill();
    if (st.blush > 0.5) for (const dx of [-4, 0, 4]) strokePath(c, 1.2, `rgba(230,90,110,${st.blush * 0.7})`, (c) => { c.moveTo(dx + 1.5, -2.5); c.lineTo(dx - 1.5, 2.5); });
  });
  for (const sd of [-1, 1]) at(sd * 0.37, -0.11, 0.02, (c) => drawEye(c, st, sd));
  if (st.brows) for (const sd of [-1, 1]) at(sd * 0.36, 0.2, 0.017, (c) => strokePath(c, 2.6, '#3e2620', (c) => {
    if (st.brows === 'angry') { c.moveTo(-sd * 8, -3); c.lineTo(sd * 8, 3); } else { c.moveTo(-sd * 8, 2); c.lineTo(sd * 8, -3); }
  }));
  at(0, -0.36, 0.017, (c) => strokePath(c, 1.6, 'rgba(200,130,110,0.9)', (c) => { c.moveTo(0, -1.5); c.lineTo(-1.2, 1.5); }));
  at(0, -0.56, 0.026, (c) => drawMouth(c, st));
  faceTex.needsUpdate = true;
}

// ---------------------------------------------------------------- 2D effects and bubble
const FONT = '"Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';
function label(c, text, x, y, size, alpha, color = '#3a2422') {
  c.save(); c.globalAlpha = Math.max(0, Math.min(1, alpha));
  c.font = `${size}px ${FONT}`; c.textAlign = 'center';
  c.lineWidth = 4; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.strokeText(text, x, y);
  c.fillStyle = color; c.fillText(text, x, y); c.restore();
}
function sparkle(c, x, y, r) {
  c.beginPath(); c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
  c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fillStyle = '#ffcd50'; c.fill();
}
function drawFx(c, st, hx, hy, s) {
  for (const fx of st.fx) {
    const { kind, age, alpha: a } = fx;
    c.save(); c.translate(hx, hy); c.scale(s, s); c.globalAlpha = Math.max(0, Math.min(1, a));
    if (kind === 'sparkles') {
      [[-62, -58, 9], [48, -66, 7], [54, 8, 6], [-70, 12, 7]].forEach(([x, y, r], i) => sparkle(c, x, y, r * (0.6 + 0.4 * Math.sin(st.t * 9 + i * 1.7))));
    } else if (kind === 'hearts') {
      [-52, 44, 26].forEach((x, i) => { const y = -52 - ((age * 30 + i * 18) % 50); heartPath(c, x, y, 7); c.fillStyle = '#ff6e8c'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#3a2422'; c.stroke(); });
    } else if (kind === 'zzz') {
      for (let i = 0; i < 3; i++) { const ph = (age * 0.45 + i / 3) % 1; label(c, 'z', 40 + ph * 18, -52 - ph * 36, 13 + ph * 9, a * Math.min(1, (1 - ph) * 3)); }
    } else if (kind === 'notes') {
      for (let i = 0; i < 2; i++) { const ph = (age * 0.5 + i / 2) % 1; label(c, '♪', 58 + ph * 14 + i * 6, -40 - ph * 40, 18, a * Math.min(1, (1 - ph) * 3), '#4aa898'); }
    } else if (kind === 'question' || kind === 'bang') {
      const pop = Math.min(1, age * 6), sc = 0.6 + 0.4 * pop + 0.08 * Math.sin(age * 12) * (1 - Math.min(1, age));
      label(c, kind === 'question' ? '?' : '!!', 44, -58, 28 * sc, a, kind === 'question' ? '#5a78e6' : '#f0505a');
    } else if (kind === 'sweat') {
      const y = -36 + Math.min(age, 1.2) * 12;
      c.beginPath(); c.moveTo(50, y - 12); c.bezierCurveTo(58, y, 56, y + 8, 50, y + 8); c.bezierCurveTo(44, y + 8, 42, y, 50, y - 12);
      c.fillStyle = '#8cc8ff'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#3a2422'; c.stroke();
    } else if (kind === 'vein') {
      c.translate(40, -50); const k = 1 + 0.12 * Math.sin(age * 16); c.scale(k, k);
      for (let i = 0; i < 4; i++) { c.rotate(Math.PI / 2); strokePath(c, 3.2, '#e63c46', (c) => { c.moveTo(3, -9); c.quadraticCurveTo(3, -3, 9, -3); }); }
    }
    c.restore();
  }
}
function drawBubble(c, b, rightX, cy) {
  if (!b || b.alpha <= 0) return;
  c.save(); c.globalAlpha = Math.min(1, b.alpha);
  c.font = `15px ${FONT}`;
  const w = c.measureText(b.text).width, h = 30, bw = w + 24;
  c.translate(rightX, cy); c.scale(b.scale, b.scale);
  c.beginPath(); c.roundRect(-bw, -h / 2, bw, h, 14);
  c.moveTo(-8, -5); c.lineTo(10, 3); c.lineTo(-10, 8);
  c.fillStyle = '#fff'; c.fill();
  c.beginPath(); c.roundRect(-bw, -h / 2, bw, h, 14); c.lineWidth = 2.6; c.strokeStyle = '#3a2422'; c.stroke();
  c.beginPath(); c.moveTo(-1, -4.2); c.lineTo(10, 3); c.lineTo(-1, 7.4); c.fillStyle = '#fff'; c.fill();
  c.beginPath(); c.moveTo(-1, -4.6); c.lineTo(10, 3); c.lineTo(-1, 7.8); c.stroke();
  c.fillStyle = '#3a2422'; c.textBaseline = 'middle'; c.fillText(b.text, -bw + 12, 1);
  c.restore();
}

// ---------------------------------------------------------------- animation state with springs
const sim = { backZ: [0, 0], backX: [0, 0], side: [0, 0], ahoge: [0, 0], prevRoll: 0, prevPitch: 0, prevBob: 0, init: false };
function spring(s, target, k = 60, d = 9) {  // s=[x, v]
  s[1] += (k * (target - s[0]) - d * s[1]) * DT;
  s[0] += s[1] * DT;
  return s[0];
}
const HAND_POSES = {
  none: [[-1.7, -3.9, 0.3], [1.7, -3.9, 0.3]],
  cover: [[-0.2, -0.66, 1.18], [0.2, -0.62, 1.16]],
  up: [[-1.3, -0.55, 0.7], [1.3, -0.55, 0.7]],
  wave: [[-1.7, -3.9, 0.3], [1.38, -0.15, 0.6]],
  chin: [[-1.7, -3.9, 0.3], [0.28, -1.05, 1.02]],
};
function applyState(st) {
  const t = st.t;
  const yaw = st.yaw, pitch = st.pitch, roll = st.roll;
  headPivot.rotation.set(pitch, yaw, roll, 'YXZ');
  body.rotation.set(pitch * 0.15, yaw * 0.3, roll * 0.3);
  root.position.y = st.bob;
  body.scale.set(1, 1 + 0.008 * Math.sin(t * 2.1), 1);
  if (!sim.init) { sim.prevRoll = roll; sim.prevPitch = pitch; sim.prevBob = st.bob; sim.init = true; }
  // secondary motion: hair lags behind the head
  const dRoll = (roll - sim.prevRoll) / DT, dPitch = (pitch - sim.prevPitch) / DT, dBob = (st.bob - sim.prevBob) / DT;
  sim.prevRoll = roll; sim.prevPitch = pitch; sim.prevBob = st.bob;
  sim.backZ[1] -= dRoll * 0.05; sim.backX[1] -= dPitch * 0.04;
  backHair.rotation.z = spring(sim.backZ, 0, 40, 6);
  backHair.rotation.x = spring(sim.backX, 0, 40, 6);
  sim.side[1] -= dRoll * 0.08;
  const sw = spring(sim.side, 0, 50, 5);
  sideLocks.forEach((g) => { g.rotation.z = sw; });
  sim.ahoge[1] += -dBob * 0.6 - dPitch * 0.15 + (st.ahogeKick || 0);
  const ah = spring(sim.ahoge, 0, 90, 4);
  ahoge.rotation.x = ah; ahoge.rotation.z = ah * 0.4;
  // hands ease toward the pose
  const pose = HAND_POSES[st.hands] || HAND_POSES.none;
  arms.forEach((arm, i) => {
    let target = new THREE.Vector3(...pose[i]);
    if (st.hands === 'up') target.y += Math.abs(Math.sin(t * 9)) * 0.18;
    arm.pos.lerp(target, 0.22);
    const shoulder = new THREE.Vector3(arm.sd * 1.28, -1.9, 0.05);
    const handW = arm.pos.clone();
    const mid = shoulder.clone().lerp(handW, 0.5).add(new THREE.Vector3(arm.sd * 0.42, -0.35, -0.15));
    placeLimb(arm.upper, shoulder, mid);
    placeLimb(arm.fore, mid, handW);
    arm.hand.position.copy(handW);
    arm.hand.rotation.set(0, 0, st.hands === 'wave' && arm.sd > 0 ? Math.sin(t * 11) * 0.5 : arm.sd * 0.2);
  });
  micTip.material.color.setRGB(0.55 + 0.45 * Math.min(1, st.mouth * 2.2), 0.3 + 0.2 * Math.min(1, st.mouth * 2.2), 0.4);
  paintFace(st);
}

function renderInto(c, st, dx, dy, size) {
  applyState(st);
  renderer.render(scene, camera);
  c.save();
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(renderer.domElement, dx, dy, size, size);
  c.restore();
}
function headScreen(dx, dy, size) {
  const v = new THREE.Vector3();
  head.getWorldPosition(v);
  v.project(camera);
  return [dx + (v.x + 1) / 2 * size, dy + (1 - v.y) / 2 * size];
}

function composeFrame(st) {
  octx.clearRect(0, 0, OUT_W, OUT_H);
  renderInto(octx, st, CHAR_X, 0, CH);
  // fade the bust out at the bottom
  octx.save();
  octx.globalCompositeOperation = 'destination-in';
  const g = octx.createLinearGradient(0, OUT_H - 46, 0, OUT_H - 4);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  octx.fillStyle = g; octx.fillRect(0, 0, OUT_W, OUT_H);
  octx.restore();
  const [hx, hy] = headScreen(CHAR_X, 0, CH);
  drawFx(octx, st, hx, hy, 0.62);
  drawBubble(octx, st.bubble, hx - 52, 30);
}

async function toBase64(u8) {
  const blob = new Blob([u8]);
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  return url.slice(url.indexOf(',') + 1);
}
window.renderBatch = async (states) => {
  const all = new Uint8Array(OUT_W * OUT_H * 4 * states.length);
  states.forEach((st, i) => {
    composeFrame(st);
    all.set(octx.getImageData(0, 0, OUT_W, OUT_H).data, i * OUT_W * OUT_H * 4);
  });
  return toBase64(all);
};
window.resetSim = () => { sim.init = false; sim.backZ = [0, 0]; sim.backX = [0, 0]; sim.side = [0, 0]; sim.ahoge = [0, 0]; };
// Design review: tiles of the raw 3D render (supersampled) with effects.
window.renderSheet = (states, cols, tile) => {
  const rows = Math.ceil(states.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * tile; sheet.height = rows * tile;
  const c = sheet.getContext('2d');
  c.fillStyle = '#26262c'; c.fillRect(0, 0, sheet.width, sheet.height);
  states.forEach((st, i) => {
    const dx = (i % cols) * tile, dy = Math.floor(i / cols) * tile;
    window.resetSim();
    for (let k = 0; k < 20; k++) applyState(st);   // let springs and hands settle
    renderInto(c, st, dx, dy, tile);
    const [hx, hy] = headScreen(dx, dy, tile);
    drawFx(c, st, hx, hy, 0.62 * tile / CH);
    if (st.bubble) drawBubble(c, st.bubble, hx - 52 * tile / CH, dy + 34);
  });
  return sheet.toDataURL('image/png');
};
window.OUT = { W: OUT_W, H: OUT_H };
window.ready = true;
