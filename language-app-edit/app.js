// Edit preview: plays the source video through the edit plan in data/edit.json.
const $ = (id) => document.getElementById(id);
const video = $("video"), stage = $("stage");
const MAX_RATE = 16;          // browsers refuse playbackRate above 16
const ZOOM_SIZE = 0.46;       // crop size for manual zoom presets (about 2.2x)
const CARD_SECONDS = 3.5;     // how long a section title stays on screen
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
  fs: '<svg viewBox="0 0 24 24"><path d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z"/></svg>',
  fsExit: '<svg viewBox="0 0 24 24"><path d="M8 5h2v5H5V8h3zm6 0h2v3h3v2h-5zM5 14h5v5H8v-3H5zm9 0h5v2h-3v3h-2z"/></svg>',
};

let edit, zoom, words = [], lines = [], capLines = [];
let pieces = [], total = 0, chapters = [];
let baseRate = 1, ccOn = true, zoomOn = true, raw = false;
let selected = 0, selRange = null, anchorLine = null;
let followUntil = 0, curLine = -1, curWord = -1, lastJump = 0;
const undoStack = [], redoStack = [];

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const duration = () => video.duration || edit.segments.at(-1).e;
function bsearch(arr, t, key = (x) => x.s) { // index of last item with key <= t, or -1
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// ---- loading -------------------------------------------------------------
async function load() {
  const get = (u) => fetch(u).then((r) => r.json());
  let transcript;
  [edit, zoom, transcript] = await Promise.all([get("data/edit.json"), get("data/zoom.json"), get("data/words.json")]);
  words = transcript.words;
  let wi = 0;
  lines = transcript.segments.map((seg, i) => {
    const next = transcript.segments[i + 1];
    const a = wi;
    while (wi < words.length && (!next || words[wi].s < next.s - 0.01)) wi++;
    return { s: seg.s, e: seg.e, a, b: wi, text: seg.t.trim() };
  }).filter((l) => l.b > l.a || l.text);
  capLines = buildCaptionLines(words);
  $("play").innerHTML = ICON.play; $("mute").innerHTML = ICON.vol; $("fs").innerHTML = ICON.fs;
  buildRateMenu();
  syncSettings();
  renderTranscript();
  rebuild();
  requestAnimationFrame(tick);
}

function buildCaptionLines(ws) {
  const out = [];
  let cur = null;
  for (const w of ws) {
    if (cur && (w.s - cur.e > 0.8 || cur.n >= 11 || w.e - cur.s > 4.5)) { out.push(cur); cur = null; }
    if (!cur) cur = { s: w.s, e: w.e, text: "", n: 0 };
    cur.text += w.w; cur.e = w.e; cur.n++;
  }
  if (cur) out.push(cur);
  for (const l of out) l.text = l.text.trim();
  return out;
}

// ---- edit plan -----------------------------------------------------------
function pausesIn(s, e) {
  const out = [], pad = 0.3;
  let prevEnd = s;
  for (let i = Math.max(0, bsearch(words, s)); i < words.length && words[i].s <= e; i++) {
    const w = words[i];
    if (w.e < s) continue;
    if (w.s - prevEnd > edit.silenceMin) out.push([prevEnd + pad, w.s - pad]);
    prevEnd = Math.max(prevEnd, w.e);
  }
  if (e - prevEnd > edit.silenceMin) out.push([prevEnd + pad, e]);
  return out;
}

function buildPlan() {
  pieces = [];
  edit.segments.forEach((seg, i) => {
    if (seg.mode === "cut") return;
    if (seg.mode === "fast") { pieces.push({ s: seg.s, e: seg.e, rate: seg.speed, kind: "fast", seg: i }); return; }
    let t = seg.s;
    if (edit.autoSilence) for (const [a, b] of pausesIn(seg.s, seg.e)) {
      if (a > t) pieces.push({ s: t, e: a, rate: 1, kind: "normal", seg: i });
      pieces.push({ s: a, e: b, rate: edit.silenceSpeed, kind: "pause", seg: i });
      t = b;
    }
    if (seg.e > t) pieces.push({ s: t, e: seg.e, rate: 1, kind: "normal", seg: i });
  });
  let acc = 0;
  for (const p of pieces) { p.es = acc; acc += (p.e - p.s) / p.rate; }
  total = acc;
  chapters = edit.sections.map((s, i) => ({ ...s, i, es: editedOf(s.t) }))
    .filter((c, i, arr) => !arr[i + 1] || editedOf(arr[i + 1].t) > c.es + 0.5);
  if (!chapters.length || chapters[0].es > 0) chapters.unshift({ t: 0, title: "Intro", es: 0, i: -1 });
  chapters.forEach((c, i) => (c.ee = chapters[i + 1]?.es ?? total));
}

function pieceIndex(t) { // >=0: inside that piece; <0: -(index of next piece) - 1
  const i = bsearch(pieces, t);
  if (i >= 0 && t < pieces[i].e) return i;
  return -(i + 1) - 1;
}
function editedOf(t) {
  const i = pieceIndex(t);
  if (i >= 0) return pieces[i].es + (t - pieces[i].s) / pieces[i].rate;
  const n = -i - 1;
  return n < pieces.length ? pieces[n].es : total;
}
function sourceOf(et) {
  const i = Math.max(0, bsearch(pieces, et, (p) => p.es));
  const p = pieces[i];
  return p ? Math.min(p.e, p.s + (et - p.es) * p.rate) : 0;
}
const segAt = (t) => { const i = bsearch(edit.segments, t); return i >= 0 && t < edit.segments[i].e ? i : edit.segments.length - 1; };
const lineAt = (t) => bsearch(lines, t);

// ---- playback engine -----------------------------------------------------
function tick(now) {
  const t = video.currentTime;
  let piece = null;
  if (!raw && pieces.length) {
    const i = pieceIndex(t);
    if (i >= 0) piece = pieces[i];
    else {
      const n = -i - 1;
      if (n >= pieces.length) { if (!video.paused) video.pause(); }
      else if (!video.paused) { video.currentTime = pieces[n].s; piece = pieces[n]; }
    }
  }
  const want = (piece ? piece.rate : 1) * baseRate;
  const rate = Math.min(want, MAX_RATE);
  if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
  if (!video.paused && want > MAX_RATE && now - lastJump > 250) {
    lastJump = now;
    video.currentTime = Math.min(piece.e, t + (want - MAX_RATE) * 0.25);
  }
  const quiet = !!piece && piece.rate > 1;
  if (video.muted !== (userMuted || quiet)) video.muted = userMuted || quiet;
  drawOverlays(t, piece);
  drawProgress(t);
  requestAnimationFrame(tick);
}

function drawOverlays(t, piece) {
  const banner = $("fastBanner");
  if (piece && piece.kind === "fast") {
    const seg = edit.segments[piece.seg];
    const html = `⏩ ${esc(seg.label || "Skipping ahead")}<span class="rate">${seg.speed}×</span>`;
    if (banner.innerHTML !== html) banner.innerHTML = html;
    banner.hidden = false;
  } else banner.hidden = true;

  const et = editedOf(t), card = $("sectionCard");
  const ch = raw ? null : chapters.find((c) => c.i >= 0 && et >= c.es && et < c.es + CARD_SECONDS);
  if (ch && !(piece && piece.kind === "fast")) { if (card.textContent !== ch.title) { card.textContent = ch.title; card.hidden = true; } card.hidden = false; }
  else card.hidden = true;

  const cap = $("caption"), ci = bsearch(capLines, t + 0.1), cl = capLines[ci];
  const show = ccOn && cl && t <= cl.e + 0.4 && !(piece && piece.kind === "fast");
  if (show) { if (cap.textContent !== cl.text) cap.textContent = cl.text; cap.hidden = false; } else cap.hidden = true;

  let z = { x: 0, y: 0, w: 1, h: 1 };
  if (zoomOn && !(piece && piece.kind === "fast")) { const k = zoom[bsearch(zoom, t, (k) => k.t)]; if (k) z = k; }
  const tf = `scale(${1 / z.w}) translate(${-z.x * 100}%, ${-z.y * 100}%)`;
  if (video.style.transform !== tf) video.style.transform = tf;
}

function drawProgress(t) {
  const et = editedOf(t);
  const timeText = `${fmt(et / baseRate)} / ${fmt(total / baseRate)}`;
  if ($("time").textContent !== timeText) $("time").textContent = timeText;
  const playIcon = video.paused ? ICON.play : ICON.pause;
  if ($("play").dataset.state !== String(video.paused)) { $("play").innerHTML = playIcon; $("play").dataset.state = String(video.paused); }
  // chapter bar fill
  const fills = $("chapters").children;
  chapters.forEach((c, i) => {
    const f = Math.min(1, Math.max(0, (et - c.es) / Math.max(0.001, c.ee - c.es)));
    const w = `${f * 100}%`;
    if (fills[i] && fills[i].firstChild.style.width !== w) fills[i].firstChild.style.width = w;
  });
  if (!barDragging) $("barThumb").style.left = `${(et / total) * 100}%`;
  const ch = chapters[bsearch(chapters, et, (c) => c.es)];
  const name = ch ? `• ${ch.title}` : "";
  if ($("chapterName").textContent !== name) $("chapterName").textContent = name;
  $("playhead").style.left = `${(t / duration()) * 100}%`;
  // transcript sync
  const li = lineAt(t);
  if (li !== curLine) {
    document.querySelector(".line.now")?.classList.remove("now");
    const el = lineEl(li);
    if (el) { el.classList.add("now"); if (performance.now() > followUntil) scrollToLine(el); }
    curLine = li;
    updateJumpButton();
  }
  const wi = bsearch(words, t);
  const wIdx = wi >= 0 && t <= words[wi].e + 0.15 ? wi : -1;
  if (wIdx !== curWord) {
    document.querySelector(".w.cur")?.classList.remove("cur");
    if (wIdx >= 0) document.querySelector(`.w[data-w="${wIdx}"]`)?.classList.add("cur");
    curWord = wIdx;
  }
}

// ---- rendering -----------------------------------------------------------
function rebuild() {
  edit.segments.sort((a, b) => a.s - b.s);
  edit.sections.sort((a, b) => a.t - b.t);
  zoom.sort((a, b) => a.t - b.t);
  selected = Math.min(selected, edit.segments.length - 1);
  buildPlan();
  renderChapterBar();
  renderTimeline();
  renderSegCard();
  renderChapterHeads();
  renderLineModes();
  const by = { normal: 0, fast: 0, pause: 0 };
  for (const p of pieces) by[p.kind] += (p.e - p.s) / p.rate;
  $("lengths").innerHTML = `Edited <b>${fmt(total)}</b> of ${fmt(duration())} · normal ${fmt(by.normal)} · sped-up sections ${fmt(by.fast)} · sped-up pauses ${fmt(by.pause)}` +
    (baseRate !== 1 ? ` · <b>${fmt(total / baseRate)}</b> at ${baseRate}×` : "");
}

function renderChapterBar() {
  $("chapters").innerHTML = chapters.map((c) =>
    `<div class="chap" style="flex:${Math.max(0.001, c.ee - c.es)}"><div class="fill"></div></div>`).join("");
}

function renderTimeline() {
  const D = duration(), pct = (t) => `${(t / D) * 100}%`;
  $("segs").innerHTML = edit.segments.map((s, i) => {
    const label = s.mode === "fast" ? `${s.speed}× ${esc(s.label || "")}` : "";
    return `<div class="seg ${s.mode}${i === selected ? " sel" : ""}" data-i="${i}" style="left:${pct(s.s)};width:${pct(s.e - s.s)}"><span>${label}</span></div>`;
  }).join("") + edit.segments.slice(1).map((s, i) => `<div class="boundary" data-b="${i + 1}" style="left:${pct(s.s)}"></div>`).join("");
  $("tlChapters").innerHTML = edit.sections.map((s, i) => {
    const end = edit.sections[i + 1]?.t ?? D;
    return `<div class="tlChap" style="left:${pct(s.t)};width:${pct(end - s.t)}" title="${esc(s.title)}">${esc(s.title)}</div>`;
  }).join("");
  $("zoomLane").innerHTML = zoom.map((k) => `<div class="zk${k.w >= 1 ? " full" : ""}" style="left:${pct(k.t)}"></div>`).join("");
}

function renderSegCard() {
  const s = edit.segments[selected];
  if (!s) return;
  const edited = s.mode === "cut" ? 0 : s.mode === "fast" ? (s.e - s.s) / s.speed : null;
  $("segInfo").textContent = `${selected + 1} of ${edit.segments.length} · ${fmt(s.s)}–${fmt(s.e)} · ${fmt(s.e - s.s)} of source` +
    (edited !== null ? ` → ${fmt(edited)}` : "");
  for (const b of $("modeBtns").children) b.classList.toggle("active", b.dataset.mode === s.mode);
  $("fastFields").classList.toggle("disabled", s.mode !== "fast");
  if (document.activeElement !== $("segLabel")) $("segLabel").value = s.label ?? "";
  $("segSpeed").value = s.speed ?? 8;
  $("segSpeedOut").textContent = s.mode === "fast" ? `${s.speed}×` : "";
  $("mergePrev").disabled = selected === 0;
  $("mergeNext").disabled = selected === edit.segments.length - 1;
}

function renderTranscript() {
  $("transcript").innerHTML = lines.map((l, i) => {
    const tx = l.b > l.a
      ? words.slice(l.a, l.b).map((w, j) => `<span class="w" data-w="${l.a + j}">${esc(w.w)}</span>`).join("")
      : esc(l.text);
    return `<div class="line" data-l="${i}"><span class="t">${fmt(l.s)}</span><span class="tx">${tx}</span></div>`;
  }).join("");
}
const lineEl = (i) => document.querySelector(`.line[data-l="${i}"]`);

function renderChapterHeads() {
  document.querySelectorAll(".chapHead").forEach((h) => h.remove());
  edit.sections.forEach((s, i) => {
    const li = Math.max(0, lineAt(s.t + 0.01));
    const target = lines[li] && lines[li].s < s.t - 0.5 && lines[li + 1] ? lineEl(li + 1) : lineEl(li);
    if (!target) return;
    const h = document.createElement("div");
    h.className = "chapHead";
    h.innerHTML = `<span class="ct" data-sec="${i}">${fmt(s.t)}</span><input data-sec="${i}" value="${esc(s.title)}" aria-label="Section title"><button class="icon del" data-delsec="${i}" title="Remove this section title">×</button>`;
    target.before(h);
  });
}

function renderLineModes() {
  lines.forEach((l, i) => {
    const el = lineEl(i);
    if (!el) return;
    const mode = edit.segments[segAt(l.s + 0.05)].mode;
    const sel = selRange && i >= selRange[0] && i <= selRange[1];
    el.classList.toggle("normal", mode === "normal");
    el.classList.toggle("fast", mode === "fast");
    el.classList.toggle("cut", mode === "cut");
    el.classList.toggle("sel", !!sel);
  });
  $("selBar").hidden = !selRange;
  if (selRange) {
    const [a, b] = selRange;
    const span = (lines[b + 1]?.s ?? lines[b].e) - lines[a].s;
    $("selInfo").textContent = `${b - a + 1} line${b > a ? "s" : ""} · ${fmt(span)}`;
  }
}

function scrollToLine(el) {
  const box = $("transcript");
  const top = el.offsetTop - box.offsetTop - box.clientHeight * 0.3;
  box.scrollTo({ top, behavior: Math.abs(box.scrollTop - top) > box.clientHeight * 2 ? "auto" : "smooth" });
}
function updateJumpButton() {
  const el = lineEl(curLine), box = $("transcript");
  if (!el) { $("jumpNow").hidden = true; return; }
  const y = el.offsetTop - box.offsetTop - box.scrollTop;
  $("jumpNow").hidden = y > 0 && y < box.clientHeight;
}

// ---- editing ---------------------------------------------------------------
const snapshot = () => JSON.stringify({ edit, zoom });
function mutate(fn) {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  fn();
  normalize();
  rebuild();
  scheduleSave();
}
function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  ({ edit, zoom } = JSON.parse(from.pop()));
  syncSettings();
  rebuild();
  scheduleSave();
}

function normalize() { // merge neighbours that play the same way
  const out = [];
  for (const s of edit.segments) {
    const p = out.at(-1);
    if (s.e - s.s < 0.05) { if (p) p.e = s.e; continue; }
    if (p && p.mode === s.mode && (s.mode !== "fast" || (p.label || "") === (s.label || ""))) {
      if (s.mode === "fast" && p.autoSpeed) p.speed = autoSpeed(p.s, s.e);
      p.e = s.e;
    } else out.push({ ...s });
  }
  edit.segments = out;
}
const autoSpeed = (s, e) => Math.min(60, Math.max(4, Math.round((e - s) / 10)));

function splitAt(t) {
  const i = segAt(t), s = edit.segments[i];
  if (t - s.s < 0.3 || s.e - t < 0.3) return;
  edit.segments.splice(i + 1, 0, { ...s, s: t });
  s.e = t;
}

function setRangeMode(a, b, mode) {
  splitAt(a); splitAt(b);
  for (const s of edit.segments) if (s.s >= a - 0.01 && s.e <= b + 0.01) {
    s.mode = mode;
    if (mode === "fast") { s.speed = s.speed || autoSpeed(a, b); s.autoSpeed = true; s.label = s.label || "Skipping ahead"; }
  }
}

function applyMode(mode) {
  if (selRange) {
    const [a, b] = selRange;
    const start = lines[a].s, end = lines[b + 1]?.s ?? lines[b].e;
    mutate(() => setRangeMode(start, end, mode));
    selected = segAt(start + 0.05);
    renderTimeline(); renderSegCard();
    if (mode === "fast") $("segLabel").select();
    return;
  }
  mutate(() => {
    const s = edit.segments[selected];
    s.mode = mode;
    if (mode === "fast" && !s.speed) { s.speed = autoSpeed(s.s, s.e); s.autoSpeed = true; s.label = s.label || "Skipping ahead"; }
  });
}

function setZoomPreset(col) {
  const t = Math.round(video.currentTime * 10) / 10;
  mutate(() => {
    zoom = zoom.filter((k) => Math.abs(k.t - t) > 1);
    let k = { t, x: 0, y: 0, w: 1, h: 1 };
    if (col !== "full") {
      const w = ZOOM_SIZE, cx = [1 / 6, 1 / 2, 5 / 6][col];
      const row = document.querySelector("#zoomRow .active").dataset.row;
      const y = { top: 0, mid: (1 - w) / 2, bottom: 1 - w }[row];
      k = { t, x: +Math.min(1 - w, Math.max(0, cx - w / 2)).toFixed(3), y: +y.toFixed(3), w, h: w };
    }
    zoom.push(k);
  });
}

let saveTimer = null;
function scheduleSave() {
  $("saveState").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const put = (u, body) => fetch(u, { method: "PUT", body: JSON.stringify(body, null, 1) });
    try {
      const r = await Promise.all([put("data/edit.json", edit), put("data/zoom.json", zoom)]);
      $("saveState").textContent = r.every((x) => x.ok) ? "Saved" : "Save failed";
    } catch { $("saveState").textContent = "Save failed"; }
  }, 600);
}

function syncSettings() {
  $("autoSilence").checked = edit.autoSilence;
  $("silenceMin").value = edit.silenceMin;
  $("silenceSpeed").value = edit.silenceSpeed;
}

// ---- player controls ---------------------------------------------------------
let userMuted = false, idleTimer = null, barDragging = false;
function flash(icon) {
  const b = $("bigIcon");
  b.hidden = true; void b.offsetWidth;
  b.innerHTML = icon; b.hidden = false;
}
function togglePlay() {
  if (video.paused) { video.play(); flash(ICON.play); } else { video.pause(); flash(ICON.pause); }
  poke();
}
function poke() {
  stage.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!video.paused && !barDragging && $("rateMenu").hidden) stage.classList.add("idle"); }, 2500);
}
function seekSource(t) {
  stage.classList.add("jump");
  video.currentTime = Math.max(0, Math.min(duration() - 0.05, t));
  followUntil = 0;
  setTimeout(() => stage.classList.remove("jump"), 50);
}
const seekEdited = (et) => seekSource(sourceOf(Math.max(0, Math.min(total - 0.01, et))));

stage.addEventListener("mousemove", poke);
stage.addEventListener("mouseleave", () => { if (!video.paused) stage.classList.add("idle"); });
video.addEventListener("click", togglePlay);
video.addEventListener("dblclick", () => $("fs").click());
["fastBanner", "sectionCard", "caption"].forEach((id) => $(id).addEventListener("click", togglePlay));
video.addEventListener("pause", poke);
$("play").onclick = togglePlay;
$("mute").onclick = () => { userMuted = !userMuted; $("mute").innerHTML = userMuted ? ICON.mute : ICON.vol; };
$("vol").oninput = (e) => { video.volume = +e.target.value; if (userMuted && video.volume > 0) $("mute").click(); };
$("fs").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen());
document.addEventListener("fullscreenchange", () => ($("fs").innerHTML = document.fullscreenElement ? ICON.fsExit : ICON.fs));
const pill = (id, get, set) => ($(id).onclick = () => { set(!get()); $(id).classList.toggle("on", get()); });
pill("cc", () => ccOn, (v) => (ccOn = v));
pill("zoomBtn", () => zoomOn, (v) => (zoomOn = v));
pill("rawBtn", () => raw, (v) => { raw = v; });
$("chapterName").onclick = () => { followUntil = 0; const el = lineEl(curLine); if (el) scrollToLine(el); };

function buildRateMenu() {
  $("rateMenu").innerHTML = [0.75, 1, 1.25, 1.5, 1.75, 2].map((r) =>
    `<button data-rate="${r}" class="${r === baseRate ? "cur" : ""}">${r === 1 ? "Normal" : r + "×"}</button>`).join("");
}
$("rateBtn").onclick = (e) => { e.stopPropagation(); $("rateMenu").hidden = !$("rateMenu").hidden; };
$("rateMenu").onclick = (e) => {
  const r = e.target.dataset.rate;
  if (!r) return;
  baseRate = +r;
  $("rateBtn").textContent = `${baseRate}×`;
  buildRateMenu(); rebuild();
  $("rateMenu").hidden = true;
};
document.addEventListener("click", (e) => { if (!$("rateWrap").contains(e.target)) $("rateMenu").hidden = true; });

// chapter bar: hover preview and drag to scrub (edited time)
const bar = $("chapterBar");
const barTime = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total; };
bar.addEventListener("pointermove", (e) => {
  const et = barTime(e), r = bar.getBoundingClientRect();
  const ci = Math.max(0, bsearch(chapters, et, (c) => c.es));
  const hv = $("barHover");
  hv.querySelector(".tt-title").textContent = chapters[ci]?.title ?? "";
  hv.querySelector(".tt-time").textContent = fmt(et / baseRate);
  hv.style.left = `${Math.min(r.width - 80, Math.max(80, e.clientX - r.left))}px`;
  hv.hidden = false;
  [...$("chapters").children].forEach((el, i) => el.classList.toggle("hover", i === ci));
  if (barDragging) { $("barThumb").style.left = `${(et / total) * 100}%`; seekEdited(et); }
});
bar.addEventListener("pointerleave", () => { $("barHover").hidden = true; document.querySelector(".chap.hover")?.classList.remove("hover"); });
bar.addEventListener("pointerdown", (e) => { barDragging = true; bar.classList.add("drag"); bar.setPointerCapture(e.pointerId); seekEdited(barTime(e)); });
bar.addEventListener("pointerup", () => { barDragging = false; bar.classList.remove("drag"); });

// ---- edit timeline: click to seek and select, drag boundaries ----------------
const tl = $("timeline");
const tlTime = (e) => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration(); };
let dragB = null, dragStart = null;
tl.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".boundary");
  if (b) {
    dragB = +b.dataset.b; dragStart = snapshot();
    b.classList.add("drag"); tl.setPointerCapture(e.pointerId);
    return;
  }
  const t = tlTime(e);
  selected = segAt(t);
  selRange = null;
  seekSource(t);
  renderTimeline(); renderSegCard(); renderLineModes();
});
tl.addEventListener("pointermove", (e) => {
  const t = tlTime(e), r = tl.getBoundingClientRect();
  if (dragB !== null) {
    const prev = edit.segments[dragB - 1], cur = edit.segments[dragB];
    const nt = Math.max(prev.s + 0.5, Math.min(cur.e - 0.5, t));
    prev.e = cur.s = Math.round(nt * 100) / 100;
    seekSource(nt);
    buildPlan(); renderTimeline(); renderChapterBar();
    tl.querySelector(`.boundary[data-b="${dragB}"]`)?.classList.add("drag");
  }
  const li = Math.max(0, lineAt(t));
  const hv = $("tlHover");
  hv.innerHTML = `<span class="t">${fmt(t)}</span>${esc(lines[li]?.text.slice(0, 90) ?? "")}`;
  hv.style.left = `${Math.min(r.width - 160, Math.max(160, e.clientX - r.left))}px`;
  hv.hidden = false;
});
tl.addEventListener("pointerleave", () => ($("tlHover").hidden = true));
tl.addEventListener("pointerup", () => {
  if (dragB === null) return;
  undoStack.push(dragStart); redoStack.length = 0;
  dragB = null;
  normalize(); rebuild(); scheduleSave();
});

// ---- segment card ------------------------------------------------------------
for (const b of $("modeBtns").children) b.onclick = () => { selRange = null; applyMode(b.dataset.mode); };
$("segLabel").onchange = (e) => mutate(() => (edit.segments[selected].label = e.target.value));
$("segSpeed").oninput = (e) => { $("segSpeedOut").textContent = `${e.target.value}×`; };
$("segSpeed").onchange = (e) => mutate(() => { const s = edit.segments[selected]; s.speed = +e.target.value; s.autoSpeed = false; });
$("split").onclick = () => mutate(() => { splitAt(video.currentTime); selected = segAt(video.currentTime); });
$("mergePrev").onclick = () => mutate(() => {
  const s = edit.segments[selected], p = edit.segments[selected - 1];
  if (p) { p.e = s.e; edit.segments.splice(selected, 1); selected--; }
});
$("mergeNext").onclick = () => mutate(() => {
  const s = edit.segments[selected], n = edit.segments[selected + 1];
  if (n) { s.e = n.e; edit.segments.splice(selected + 1, 1); }
});
$("autoSilence").onchange = (e) => mutate(() => (edit.autoSilence = e.target.checked));
$("silenceMin").onchange = (e) => mutate(() => (edit.silenceMin = Math.max(1, +e.target.value)));
$("silenceSpeed").onchange = (e) => mutate(() => (edit.silenceSpeed = Math.min(16, Math.max(2, +e.target.value))));
for (const b of $("zoomBtns").children) b.onclick = () => setZoomPreset(b.dataset.z === "full" ? "full" : +b.dataset.z);
$("zoomRow").onclick = (e) => {
  if (!e.target.dataset.row) return;
  for (const b of $("zoomRow").children) b.classList.toggle("active", b === e.target);
};
$("zoomDel").onclick = () => {
  const i = bsearch(zoom, video.currentTime, (k) => k.t);
  if (i >= 0) mutate(() => zoom.splice(i, 1));
};

// ---- transcript sidebar ------------------------------------------------------
const box = $("transcript");
box.addEventListener("wheel", () => (followUntil = performance.now() + 4000), { passive: true });
box.addEventListener("scroll", updateJumpButton, { passive: true });
$("jumpNow").onclick = () => { followUntil = 0; const el = lineEl(curLine); if (el) scrollToLine(el); };
box.addEventListener("click", (e) => {
  if (e.target.dataset.delsec) { mutate(() => edit.sections.splice(+e.target.dataset.delsec, 1)); return; }
  if (e.target.classList.contains("ct")) { seekSource(edit.sections[+e.target.dataset.sec].t); return; }
  const el = e.target.closest(".line");
  if (!el) return;
  const i = +el.dataset.l;
  if (e.shiftKey && anchorLine !== null) {
    selRange = [Math.min(anchorLine, i), Math.max(anchorLine, i)];
    window.getSelection()?.removeAllRanges();
  } else {
    selRange = (e.metaKey || e.ctrlKey) ? [i, i] : null;
    anchorLine = i;
    const w = e.target.closest(".w");
    seekSource(w ? words[+w.dataset.w].s : lines[i].s);
    followUntil = performance.now() + 1500;
  }
  selected = segAt(lines[i].s + 0.05);
  renderTimeline(); renderSegCard(); renderLineModes();
});
box.addEventListener("change", (e) => {
  if (e.target.dataset.sec !== undefined) mutate(() => (edit.sections[+e.target.dataset.sec].title = e.target.value));
});
box.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") e.target.blur(); });
for (const b of $("selBar").querySelectorAll("[data-set]")) b.onclick = () => applyMode(b.dataset.set);
$("selClear").onclick = () => { selRange = null; renderLineModes(); };
$("selSection").onclick = () => {
  const t = lines[selRange[0]].s;
  mutate(() => edit.sections.push({ t, title: "New section" }));
  selRange = null; renderLineModes();
  const idx = edit.sections.findIndex((s) => s.t === t);
  box.querySelector(`.chapHead input[data-sec="${idx}"]`)?.select();
};
$("search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll("mark").forEach((m) => m.replaceWith(m.textContent));
  lines.forEach((l, i) => {
    const el = lineEl(i);
    const hit = !q || (l.text + " " + words.slice(l.a, l.b).map((w) => w.w).join("")).toLowerCase().includes(q);
    el.classList.toggle("hidden", !hit);
    if (q && hit) el.querySelectorAll(".w").forEach((w) => { if (w.textContent.toLowerCase().includes(q)) w.innerHTML = `<mark>${esc(w.textContent)}</mark>`; });
  });
  document.querySelectorAll(".chapHead").forEach((h) => (h.hidden = !!q));
  followUntil = q ? Infinity : 0;
});

// ---- keyboard ------------------------------------------------------------------
$("undo").onclick = () => restore(undoStack, redoStack);
$("redo").onclick = () => restore(redoStack, undoStack);
$("helpBtn").onclick = () => ($("help").hidden = false);
$("help").onclick = () => ($("help").hidden = true);
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? restore(redoStack, undoStack) : restore(undoStack, redoStack); return; }
  if (mod && e.key === "s") { e.preventDefault(); scheduleSave(); return; }
  if (e.target.matches("input[type=text], input[type=search], input[type=number]")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (mod || e.altKey) return;
  const k = e.key.toLowerCase();
  const act = {
    " ": togglePlay, k: togglePlay,
    arrowleft: () => seekSource(video.currentTime - (e.shiftKey ? 30 : 5)),
    arrowright: () => seekSource(video.currentTime + (e.shiftKey ? 30 : 5)),
    j: () => seekSource(video.currentTime - 10), l: () => seekSource(video.currentTime + 10),
    1: () => applyMode("normal"), 2: () => applyMode("fast"), 3: () => applyMode("cut"),
    s: () => $("split").click(), c: () => $("cc").click(), z: () => $("zoomBtn").click(),
    u: () => $("rawBtn").click(), f: () => $("fs").click(), m: () => $("mute").click(),
    "?": () => ($("help").hidden = !$("help").hidden),
    escape: () => { $("help").hidden = true; selRange = null; renderLineModes(); },
  }[k];
  if (act) { e.preventDefault(); act(); }
});

video.addEventListener("loadedmetadata", () => { if (edit) rebuild(); });
load();
