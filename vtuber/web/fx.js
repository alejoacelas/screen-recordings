// 2D effects drawn around the avatar: sparkles, hearts, zzz, notes, ?, !!, sweat, anger vein, speech bubble.
function strokePath(c, w, color, build) {
  c.beginPath(); build(c); c.lineWidth = w; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
export function starPath(c, x, y, r, spin) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = spin + i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    c[i ? 'lineTo' : 'moveTo'](x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  c.closePath();
}
export function heartPath(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y + r);
  c.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.4, x, y - r * 0.45);
  c.bezierCurveTo(x + r * 0.7, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r);
  c.closePath();
}
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
export function drawFx(c, st, hx, hy, s) {
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
export function drawBubble(c, b, rightX, cy) {
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

