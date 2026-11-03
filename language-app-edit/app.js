// Edit preview: plays the source video through the edit plan in data/edit.json.
const $ = (id) => document.getElementById(id);
const video = $("video");
const MAX_RATE = 16; // browsers refuse playbackRate above 16
const ZOOM_SIZE = 0.46;

let edit, zoom, transcript, words = [], capLines = [];
let pieces = [], total = 0;
let baseRate = 1, ccOn = true, zoomOn = true, raw = false, userMuted = false;
let selected = 0, dirty = false, lastJump = 0;

const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};

async function load() {
  [edit, zoom, transcript] = await Promise.all(
    ["data/edit.json", "data/zoom.json", "data/words.json"].map((u) => fetch(u).then((r) => r.json())));
  words = transcript.words;
  capLines = buildCaptionLines(words);
  bindSettings();
  rebuild();
  renderTranscript();
}

function buildCaptionLines(ws) {
  const lines = [];
  let cur = null;
  for (const w of ws) {
    if (cur && (w.s - cur.e > 0.8 || cur.n >= 10 || w.e - cur.s > 4.5)) { lines.push(cur); cur = null; }
    if (!cur) cur = { s: w.s, e: w.e, text: "", n: 0 };
    cur.text += w.w; cur.e = w.e; cur.n++;
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ ...l, text: l.text.trim() }));
}

// ---- edit plan ---------------------------------------------------------
function silencesIn(s, e) {
  const out = [], pad = 0.3;
  let prevEnd = s;
  for (const w of words) {
    if (w.e < s) continue;
    if (w.s > e) break;
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
    if (edit.autoSilence) for (const [a, b] of silencesIn(seg.s, seg.e)) {
      if (a > t) pieces.push({ s: t, e: a, rate: 1, kind: "normal", seg: i });
      pieces.push({ s: a, e: b, rate: edit.silenceSpeed, kind: "pause", seg: i });
      t = b;
    }
    if (seg.e > t) pieces.push({ s: t, e: seg.e, rate: 1, kind: "normal", seg: i });
  });
  let acc = 0;
  for (const p of pieces) { p.es = acc; acc += (p.e - p.s) / p.rate; }
  total = acc;
}

const pieceAt = (t) => {
  let lo = 0, hi = pieces.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (t < pieces[m].s) hi = m - 1; else if (t >= pieces[m].e) lo = m + 1; else return m;
  }
  return -(lo + 1); // not inside a piece; -(index of next piece) - 1
};
const editedOf = (t) => {
  const i = pieceAt(t);
  if (i >= 0) return pieces[i].es + (t - pieces[i].s) / pieces[i].rate;
  const n = -i - 1;
  return n < pieces.length ? pieces[n].es : total;
};
const sourceOf = (et) => {
  for (const p of pieces) if (et < p.es + (p.e - p.s) / p.rate) return p.s + (et - p.es) * p.rate;
  return pieces.length ? pieces[pieces.length - 1].e : 0;
};
const segAt = (t) => edit.segments.findIndex((s) => t >= s.s && t < s.e);

// ---- playback engine ---------------------------------------------------
function tick(now) {
  const t = video.currentTime;
  let piece = null;
  if (!raw && pieces.length) {
    const i = pieceAt(t);
    if (i >= 0) piece = pieces[i];
    else if (!video.paused) {
      const n = -i - 1;
      if (n >= pieces.length) video.pause(); else { video.currentTime = pieces[n].s; piece = pieces[n]; }
    }
  }
  const want = (piece ? piece.rate : 1) * baseRate;
  const rate = Math.min(want, MAX_RATE);
  if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
  if (!video.paused && want > MAX_RATE && now - lastJump > 300) {
    lastJump = now;
    video.currentTime = Math.min(piece.e, t + (want - MAX_RATE) * 0.3);
  }
  video.muted = userMuted || (piece && piece.rate > 1);
  drawOverlays(t, piece);
  drawProgress(t);
  requestAnimationFrame(tick);
}

function drawOverlays(t, piece) {
  const banner = $("fastBanner");
  if (piece && piece.kind === "fast") {
    const seg = edit.segments[piece.seg];
    banner.textContent = `⏩ ${seg.label || "Skipping ahead"} · ${seg.speed}×`;
    banner.hidden = false;
  } else banner.hidden = true;

  const et = editedOf(t), card = $("sectionCard");
  const sec = raw ? null : edit.sections.find((s) => { const e = editedOf(s.t); return et >= e && et < e + 3.5; });
  if (sec) { if (card.textContent !== sec.title) card.textContent = sec.title; card.hidden = false; } else card.hidden = true;

  const cap = $("caption");
  const line = ccOn && (!piece || piece.kind !== "fast") && capLines.find((l) => t >= l.s - 0.1 && t <= l.e + 0.4);
  if (line) { if (cap.textContent !== line.text) cap.textContent = line.text; cap.hidden = false; } else cap.hidden = true;

  let z = { x: 0, y: 0, w: 1, h: 1 };
  if (zoomOn && !(piece && piece.kind === "fast")) for (const k of zoom) { if (k.t <= t) z = k; else break; }
  const tf = `scale(${1 / z.w}) translate(${-z.x * 100}%, ${-z.y * 100}%)`;
  if (video.style.transform !== tf) video.style.transform = tf;
}

let lastLine = -1;
function drawProgress(t) {
  const et = editedOf(t);
  $("time").textContent = `${fmt(et / baseRate)} / ${fmt(total / baseRate)}`;
  if (document.activeElement !== $("scrub")) $("scrub").value = total ? Math.round((et / total) * 1000) : 0;
  $("playhead").style.left = `${(t / video.duration) * 100}%`;
  $("play").textContent = video.paused ? "▶" : "❚❚";
  const li = transcript.segments.findIndex((s) => t >= s.s && t < s.e);
  if (li !== lastLine) {
    const box = $("transcript");
    box.querySelector(".now")?.classList.remove("now");
    const el = box.children[li];
    if (el) { el.classList.add("now"); box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 3; }
    lastLine = li;
  }
}

// ---- rendering ---------------------------------------------------------
function rebuild() {
  edit.segments.sort((a, b) => a.s - b.s);
  edit.sections.sort((a, b) => a.t - b.t);
  zoom.sort((a, b) => a.t - b.t);
  buildPlan();
  renderTimeline();
  renderSegPanel();
  renderSections();
  renderTranscriptModes();
  const by = { normal: 0, fast: 0, pause: 0 };
  for (const p of pieces) by[p.kind] += (p.e - p.s) / p.rate;
  $("summary").textContent = `Edited length ${fmt(total)} (normal ${fmt(by.normal)} · sped-up sections ${fmt(by.fast)} · sped-up pauses ${fmt(by.pause)}) from ${fmt(video.duration || 0)} of source` +
    (baseRate !== 1 ? ` · ${fmt(total / baseRate)} at ${baseRate}×` : "");
}

function renderTimeline() {
  const D = video.duration || edit.segments.at(-1).e;
  const pct = (t) => `${(t / D) * 100}%`;
  $("segs").innerHTML = edit.segments.map((s, i) =>
    `<div class="seg ${s.mode}${i === selected ? " sel" : ""}" style="left:${pct(s.s)};width:${pct(s.e - s.s)}" title="${fmt(s.s)}–${fmt(s.e)} ${s.mode}${s.label ? ": " + s.label : ""}"></div>`).join("") +
    edit.sections.map((s) => `<div class="sectionTick" style="left:${pct(s.t)}" title="${s.title}"></div>`).join("");
  $("zoomLane").innerHTML = zoom.map((k) => `<div class="zk" style="left:${pct(k.t)};opacity:${k.w >= 1 ? 0.35 : 1}"></div>`).join("");
}

function renderSegPanel() {
  const s = edit.segments[selected];
  if (!s) return;
  $("segInfo").textContent = `#${selected + 1} of ${edit.segments.length} · ${fmt(s.s)}–${fmt(s.e)} (${fmt(s.e - s.s)} of source)`;
  for (const b of $("modeBtns").children) b.classList.toggle("active", b.dataset.mode === s.mode);
  $("segSpeed").value = s.speed ?? "";
  $("segSpeed").disabled = s.mode !== "fast";
  $("segLabel").value = s.label ?? "";
  $("segLabel").disabled = s.mode !== "fast";
}

function renderSections() {
  $("sections").innerHTML = edit.sections.map((s, i) =>
    `<li><span class="t" data-i="${i}">${fmt(s.t)}</span><input data-i="${i}" value="${s.title.replace(/"/g, "&quot;")}"> <button data-del="${i}" title="Delete">×</button></li>`).join("");
}

function renderTranscript() {
  $("transcript").innerHTML = transcript.segments.map((s) =>
    `<div class="line" data-t="${s.s}"><span class="t">${fmt(s.s)}</span>${s.t.trim()}</div>`).join("");
  renderTranscriptModes();
}
function renderTranscriptModes() {
  const lines = $("transcript").children;
  transcript?.segments.forEach((s, i) => {
    const seg = edit.segments[segAt(s.s)];
    if (lines[i]) lines[i].className = `line ${seg ? seg.mode : ""}${i === lastLine ? " now" : ""}`;
  });
}

// ---- editing -----------------------------------------------------------
function changed() { dirty = true; $("saveState").textContent = "Unsaved changes"; rebuild(); }

function setMode(mode) {
  const s = edit.segments[selected];
  s.mode = mode;
  if (mode === "fast" && !s.speed) s.speed = Math.max(4, Math.ceil((s.e - s.s) / 10));
  changed();
}

function split() {
  const t = video.currentTime, i = segAt(t);
  if (i < 0) return;
  const s = edit.segments[i];
  if (t - s.s < 0.5 || s.e - t < 0.5) return;
  edit.segments.splice(i + 1, 0, { ...s, s: t });
  s.e = t;
  selected = i + 1;
  changed();
}

function moveBoundary(which) {
  const t = video.currentTime, s = edit.segments[selected];
  const prev = edit.segments[selected - 1], next = edit.segments[selected + 1];
  if (which === "start" && t < s.e - 0.5 && (!prev || t > prev.s + 0.5)) { s.s = t; if (prev) prev.e = t; }
  if (which === "end" && t > s.s + 0.5 && (!next || t < next.e - 0.5)) { s.e = t; if (next) next.s = t; }
  changed();
}

function setZoom(col) {
  const t = Math.floor(video.currentTime);
  zoom = zoom.filter((k) => Math.abs(k.t - t) > 1);
  let k = { t, x: 0, y: 0, w: 1, h: 1 };
  if (col !== "full") {
    const w = ZOOM_SIZE, cx = [1 / 6, 1 / 2, 5 / 6][col];
    const y = { top: 0, mid: (1 - w) / 2, bottom: 1 - w }[$("zoomRow").value];
    k = { t, x: +Math.min(1 - w, Math.max(0, cx - w / 2)).toFixed(3), y: +y.toFixed(3), w, h: w };
  }
  zoom.push(k);
  changed();
}

async function save() {
  const put = (u, body) => fetch(u, { method: "PUT", body: JSON.stringify(body, null, 1) });
  const r = await Promise.all([put("data/edit.json", edit), put("data/zoom.json", zoom)]);
  const ok = r.every((x) => x.ok);
  dirty = !ok;
  $("saveState").textContent = ok ? `Saved ${new Date().toLocaleTimeString()}` : "Save failed";
}

function bindSettings() {
  $("autoSilence").checked = edit.autoSilence;
  $("silenceMin").value = edit.silenceMin;
  $("silenceSpeed").value = edit.silenceSpeed;
}

// ---- events ------------------------------------------------------------
const togglePlay = () => (video.paused ? video.play() : video.pause());
$("play").onclick = togglePlay;
$("stage").onclick = togglePlay;
$("scrub").oninput = (e) => { video.currentTime = sourceOf((e.target.value / 1000) * total); };
$("rate").onchange = (e) => { baseRate = +e.target.value; rebuild(); };
const toggle = (id, get, set) => { $(id).onclick = () => { set(!get()); $(id).classList.toggle("on", get()); }; };
toggle("cc", () => ccOn, (v) => (ccOn = v));
toggle("zoomBtn", () => zoomOn, (v) => (zoomOn = v));
toggle("rawBtn", () => raw, (v) => (raw = v));
$("mute").onclick = () => { userMuted = !userMuted; $("mute").textContent = userMuted ? "🔇" : "🔊"; };
$("vol").oninput = (e) => (video.volume = +e.target.value);
$("fs").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $("stage").requestFullscreen());

$("timeline").onclick = (e) => {
  const r = $("timeline").getBoundingClientRect();
  const t = ((e.clientX - r.left) / r.width) * video.duration;
  video.currentTime = t;
  const i = segAt(t);
  if (i >= 0) { selected = i; renderTimeline(); renderSegPanel(); }
};
for (const b of $("modeBtns").children) b.onclick = () => setMode(b.dataset.mode);
$("segSpeed").onchange = (e) => { edit.segments[selected].speed = Math.max(2, +e.target.value); changed(); };
$("segLabel").onchange = (e) => { edit.segments[selected].label = e.target.value; changed(); };
$("split").onclick = split;
$("mergeNext").onclick = () => {
  const s = edit.segments[selected], n = edit.segments[selected + 1];
  if (n) { s.e = n.e; edit.segments.splice(selected + 1, 1); changed(); }
};
$("nudgeStart").onclick = () => moveBoundary("start");
$("nudgeEnd").onclick = () => moveBoundary("end");
$("autoSilence").onchange = (e) => { edit.autoSilence = e.target.checked; changed(); };
$("silenceMin").onchange = (e) => { edit.silenceMin = Math.max(1, +e.target.value); changed(); };
$("silenceSpeed").onchange = (e) => { edit.silenceSpeed = Math.min(16, Math.max(2, +e.target.value)); changed(); };
for (const b of $("zoomBtns").querySelectorAll("[data-z]")) b.onclick = () => setZoom(b.dataset.z === "full" ? "full" : +b.dataset.z);
$("zoomDel").onclick = () => {
  const t = video.currentTime, k = zoom.filter((z) => z.t <= t).at(-1);
  if (k) { zoom.splice(zoom.indexOf(k), 1); changed(); }
};
$("save").onclick = save;
$("addSection").onclick = () => { edit.sections.push({ t: +video.currentTime.toFixed(2), title: "New section" }); changed(); };
$("sections").onclick = (e) => {
  if (e.target.dataset.del) { edit.sections.splice(+e.target.dataset.del, 1); changed(); }
  else if (e.target.classList.contains("t")) video.currentTime = edit.sections[+e.target.dataset.i].t;
};
$("sections").onchange = (e) => { if (e.target.dataset.i) { edit.sections[+e.target.dataset.i].title = e.target.value; changed(); } };
$("transcript").onclick = (e) => {
  const el = e.target.closest(".line");
  if (!el) return;
  video.currentTime = +el.dataset.t;
  const i = segAt(+el.dataset.t);
  if (i >= 0) { selected = i; renderTimeline(); renderSegPanel(); }
};

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); return; }
  if (e.target.matches("input, select, textarea")) return;
  const k = e.key;
  if (k === " ") { e.preventDefault(); togglePlay(); }
  else if (k === "ArrowLeft") video.currentTime -= e.shiftKey ? 30 : 5;
  else if (k === "ArrowRight") video.currentTime += e.shiftKey ? 30 : 5;
  else if (k === "1") setMode("normal");
  else if (k === "2") setMode("fast");
  else if (k === "3") setMode("cut");
  else if (k === "s") split();
  else if (k === "c") $("cc").click();
  else if (k === "z") $("zoomBtn").click();
  else if (k === "r") $("rawBtn").click();
  else if (k === "m") $("mute").click();
  else if (k === "f") $("fs").click();
});
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

video.addEventListener("loadedmetadata", () => { if (edit) rebuild(); });
load().then(() => requestAnimationFrame(tick));
