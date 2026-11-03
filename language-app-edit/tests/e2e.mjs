// End-to-end checks for the player and editor, run in real Chrome (H.264 needs it).
// Usage: node tests/e2e.mjs http://127.0.0.1:8790 [screenshot-dir]
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.argv[2] ?? "http://127.0.0.1:8790";
const SHOTS = process.argv[3] ?? "shots";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const original = await (await fetch(`${URL}/data/edit.json`)).text();
const originalZoom = await (await fetch(`${URL}/data/zoom.json`)).text();
const errors = [];

async function open(path) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL + path);
  await page.waitForFunction(() => typeof pieces !== "undefined" && pieces.length && video.readyState >= 2, null, { timeout: 30000 });
  await sleep(500);
  return page;
}

try {
  // ======================= viewer mode =======================
  let page = await open("/");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

  const v1 = await ev(() => ({ editHidden: getComputedStyle($("editPane")).display === "none", items: document.querySelectorAll(".chItem").length,
    skips: document.querySelectorAll(".skipRow").length, chaps: document.querySelectorAll(".chap").length, total, dur: video.duration }));
  check("viewer: editing tools are hidden", v1.editHidden);
  check("viewer: sections list and chapter bar render", v1.items >= 5 && v1.chaps === v1.items && v1.skips >= 3, JSON.stringify(v1));
  check("viewer: highlights are much shorter than the source", v1.total > 600 && v1.total < v1.dur * 0.7, `${Math.round(v1.total / 60)} of ${Math.round(v1.dur / 60)} min`);
  await shot("01-viewer");

  await page.keyboard.press("k");
  await sleep(2500);
  const v2 = await ev(() => ({ t: video.currentTime, paused: video.paused, card: !$("sectionCard").hidden && $("sectionCard").textContent }));
  check("viewer: playback advances", !v2.paused && v2.t > 1, `t=${v2.t.toFixed(2)}`);
  check("viewer: first section title shows", !!v2.card, String(v2.card));
  await sleep(2500);
  check("viewer: captions appear while speaking", await ev(() => !$("caption").hidden), await ev(() => $("caption").textContent));
  await shot("02-viewer-playing");

  // next section button
  const c0 = await ev(() => curChap);
  await page.hover("#stage"); await page.click("#next"); await sleep(300);
  check("viewer: next-section button jumps to the next section", await ev(() => curChap) === c0 + 1, `${c0} → ${await ev(() => curChap)}`);

  // sections list click
  await page.click('.chItem[data-c="4"] .title'); await sleep(300);
  check("viewer: clicking a section seeks to it", await ev(() => curChap) === 4);

  // sped-up segment: banner, then expand from the banner
  const fast = await ev(() => edit.segments.find((s) => s.mode === "fast" && s.speed <= 16));
  await ev((t) => seekSource(t + 1), fast.s); await sleep(800);
  const v3 = await ev(() => ({ banner: !$("fastBanner").hidden && $("fastText").textContent, rate: video.playbackRate, muted: video.muted, tf: video.style.transform }));
  check("viewer: sped-up part shows its title", !!v3.banner && v3.banner.includes(fast.label), String(v3.banner));
  check("viewer: sped-up part plays fast and muted", Math.abs(v3.rate - fast.speed) < 0.01 && v3.muted, JSON.stringify(v3));
  check("viewer: zoom is off while sped up", v3.tf.startsWith("scale(1)"), v3.tf);
  await shot("03-viewer-fast");
  await page.click("#expandHere"); await sleep(400);
  const v4 = await ev(() => ({ rate: video.playbackRate, banner: !$("fastBanner").hidden, row: !!document.querySelector(".skipRow.expanded") }));
  check("viewer: 'Watch at normal speed' plays that part at 1x", v4.rate <= 6 && !v4.banner && v4.row, JSON.stringify(v4));
  await page.click(".skipRow.expanded button"); await sleep(200);
  check("viewer: Collapse restores the speed-up", await ev(() => !document.querySelector(".skipRow.expanded")));

  // 16x+ segment keeps moving
  const vfast = await ev(() => edit.segments.find((s) => s.mode === "fast" && s.speed > 16));
  if (vfast) {
    await ev((t) => seekSource(t + 1), vfast.s); await sleep(300);
    const a = await ev(() => video.currentTime); await sleep(2000); const b = await ev(() => video.currentTime);
    check(`viewer: ${vfast.speed}x part advances faster than 16x`, (b - a) / 2 > 18, `${((b - a) / 2).toFixed(1)} s of source per second`);
  }

  // "Watch in full" from the sections list
  await page.locator(".skipRow button").first().click(); await sleep(400);
  const v5 = await ev(() => { const s = edit.segments.find((x) => expanded.has(x.s)); return { t: video.currentTime, s: s && s.s, playing: !video.paused, rate: video.playbackRate }; });
  check("viewer: 'Watch in full' in the list jumps there and plays at normal speed", v5.s !== undefined && Math.abs(v5.t - v5.s) < 2 && v5.playing && v5.rate <= 6, JSON.stringify(v5));
  await page.locator(".skipRow.expanded button").first().click();

  // speed menu
  await page.hover("#stage"); await page.click("#gear"); await page.click('#rates [data-rate="1.5"]'); await sleep(300);
  await ev(() => seekSource(edit.segments[0].s + 20)); await sleep(300);
  const v6 = await ev(() => { const p = pieces[pieceIndex(video.currentTime)]; return { rate: video.playbackRate, pr: p && p.rate, time: $("time").textContent }; });
  check("viewer: speed menu scales playback", Math.abs(v6.rate - 1.5 * v6.pr) < 0.01, JSON.stringify(v6));
  await shot("04-viewer-menu");
  await page.click('#rates [data-rate="1"]');
  await page.mouse.click(5, 5);

  // a cut: toast offers to watch it
  await ev(() => { const a = edit.segments[0].s + 40; setRangeMode(a, a + 20, "cut"); normalize(); rebuild(); });
  const cut = await ev(() => edit.segments.find((s) => s.mode === "cut"));
  await ev((t) => { seekSource(t - 1.5); video.play(); }, cut.s); await sleep(2200);
  const v7 = await ev(() => ({ t: video.currentTime, toast: !$("toast").hidden && $("toastText").textContent }));
  check("viewer: playback skips a cut and says so", v7.t >= cut.e && !!v7.toast, JSON.stringify(v7));
  await shot("05-viewer-toast");
  await page.click("#toastBtn"); await sleep(400);
  const v8 = await ev((s) => ({ t: video.currentTime, exp: expanded.has(s) }), cut.s);
  check("viewer: 'Watch it' plays the cut part", v8.exp && Math.abs(v8.t - cut.s) < 1.5, JSON.stringify(v8));

  // transcript tab follows playback; clicking a skipped line plays it
  await page.click('[data-tab="transcriptTab"]');
  await ev(() => seekSource(900)); await sleep(1200);
  const v9 = await ev(() => {
    const el = document.querySelector(".line.now"), box = $("transcript");
    const y = el ? el.getBoundingClientRect().top - box.getBoundingClientRect().top : -1;
    return { idx: el ? +el.dataset.l : -1, expect: lineAt(video.currentTime), visible: y > 0 && y < box.clientHeight, word: !!document.querySelector(".w.cur") };
  });
  check("viewer: transcript highlights the current line", v9.idx === v9.expect, JSON.stringify(v9));
  check("viewer: transcript keeps the current line in view", v9.visible);
  check("viewer: transcript highlights the current word", v9.word);
  await shot("06-viewer-transcript");
  const skipLine = await ev(() => lines.findIndex((l) => { const s = edit.segments[segAt(l.s + 0.05)]; return s.mode === "fast" && !expanded.has(s.s); }));
  await page.locator(`.line[data-l="${skipLine}"]`).scrollIntoViewIfNeeded();
  await page.click(`.line[data-l="${skipLine}"] .t`); await sleep(300);
  check("viewer: clicking a skipped line expands it", await ev((i) => expanded.has(edit.segments[segAt(lines[i].s + 0.05)].s), skipLine));

  // controls hide while playing; help; narrow layout
  await page.mouse.move(800, 900); await ev(() => video.play()); await sleep(3200);
  check("viewer: controls hide while playing", await ev(() => stage.classList.contains("idle")));
  await ev(() => video.pause());
  await page.keyboard.press("?");
  check("viewer: ? opens shortcuts", await ev(() => !$("help").hidden));
  await shot("07-viewer-help");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 820, height: 1000 }); await sleep(300);
  check("viewer: no horizontal overflow at 820px", !(await ev(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await shot("08-viewer-narrow");
  await page.close();

  // ======================= edit mode =======================
  page = await open("/?edit");
  const ed = (fn, arg) => page.evaluate(fn, arg);
  const eshot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  check("edit: ?edit shows the editing tools", await ed(() => getComputedStyle($("editPane")).display !== "none"));
  await page.click('[data-tab="transcriptTab"]');
  await eshot("09-edit");

  const segsBefore = await ed(() => edit.segments.length), totalBefore = await ed(() => total);
  const la = await ed(() => lineAt(edit.segments[0].s + 60)), lb = la + 3;
  await page.locator(`.line[data-l="${la}"]`).scrollIntoViewIfNeeded();
  await page.click(`.line[data-l="${la}"] .t`);
  await page.click(`.line[data-l="${lb}"] .t`, { modifiers: ["Shift"] });
  const sel = await ed(() => !$("selBar").hidden && $("selInfo").textContent);
  check("edit: shift-click selects a range of lines", !!sel && sel.startsWith("4 lines"), String(sel));
  await eshot("10-edit-selection");
  await page.keyboard.press("3");
  const e1 = await ed(([a, b]) => ({ segs: edit.segments.length, total, cut: [...Array(b - a + 1)].every((_, i) => lineEl(a + i).classList.contains("cut")) }), [la, lb]);
  check("edit: 3 cuts the selected lines", e1.cut && e1.segs === segsBefore + 2 && e1.total < totalBefore, JSON.stringify(e1));
  const cutSeg = await ed((a) => edit.segments[segAt(lines[a].s + 0.05)], la);
  await ed((t) => { seekSource(t - 1.5); video.play(); }, cutSeg.s); await sleep(2500);
  check("edit: playback skips the new cut", await ed(() => video.currentTime) >= cutSeg.e);
  await ed(() => video.pause());
  await page.keyboard.press("Meta+z");
  check("edit: undo restores the segments", await ed(() => edit.segments.length) === segsBefore);
  await page.keyboard.press("Meta+Shift+z");
  check("edit: redo reapplies the cut", await ed(() => edit.segments.length) === segsBefore + 2);
  await sleep(1500);
  const saved = await (await fetch(`${URL}/data/edit.json`)).json();
  check("edit: changes autosave to data/edit.json", saved.segments.length === segsBefore + 2, `${saved.segments.length} on disk`);
  await page.keyboard.press("Meta+z");

  await page.click(`.line[data-l="${la}"] .t`);
  await page.click(`.line[data-l="${la + 2}"] .t`, { modifiers: ["Shift"] });
  await page.keyboard.press("2");
  await page.fill("#segLabel", "Test title"); await page.press("#segLabel", "Enter"); await page.locator("#segLabel").blur();
  const e2 = await ed(() => edit.segments[selected]);
  check("edit: 2 speeds up the range and the title field names it", e2.mode === "fast" && e2.label === "Test title", JSON.stringify({ mode: e2.mode, label: e2.label }));
  await eshot("11-edit-fast");
  await page.keyboard.press("Meta+z"); await page.keyboard.press("Meta+z");

  const tb = await page.locator("#timeline").boundingBox();
  await page.mouse.click(tb.x + tb.width * 0.5, tb.y + 40);
  const e3 = await ed(() => ({ t: video.currentTime, s: edit.segments[selected].s, e: edit.segments[selected].e }));
  check("edit: timeline click seeks and selects", e3.t >= e3.s && e3.t <= e3.e, JSON.stringify(e3));
  const bb = await page.locator('.boundary[data-b="1"]').boundingBox();
  const oldS = await ed(() => edit.segments[1].s);
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 25, bb.y + bb.height / 2, { steps: 5 }); await page.mouse.up();
  const newS = await ed(() => edit.segments[1].s);
  check("edit: dragging a boundary moves it", newS > oldS + 5, `${oldS.toFixed(1)} → ${newS.toFixed(1)}`);
  await page.keyboard.press("Meta+z");
  check("edit: undo restores the boundary", Math.abs((await ed(() => edit.segments[1].s)) - oldS) < 0.01);

  const nSec = await ed(() => edit.sections.length);
  await page.click(`.line[data-l="${la}"] .t`);
  await page.click(`.line[data-l="${la}"] .t`, { modifiers: ["Shift"] });
  await page.click("#selSection");
  await page.keyboard.type("Renamed section"); await page.keyboard.press("Enter"); await sleep(100);
  check("edit: add and rename a section title", await ed(() => edit.sections.some((s) => s.title === "Renamed section")));
  await page.keyboard.press("Meta+z"); await page.keyboard.press("Meta+z");
  check("edit: undo removes the added section", await ed(() => edit.sections.length) === nSec);

  const zk = await ed(() => zoom.find((k) => k.w < 1 && k.t > 60 && edit.segments[segAt(k.t + 2)].mode === "normal"));
  await ed((t) => seekSource(t + 2), zk.t); await sleep(1200);
  const zOn = await ed(() => video.style.transform);
  await page.keyboard.press("z"); await sleep(100);
  const zOff = await ed(() => video.style.transform);
  await page.keyboard.press("z");
  check("edit: zoom applies at keyframes and Z toggles it", !zOn.startsWith("scale(1)") && zOff.startsWith("scale(1)"), `${zOn} / ${zOff}`);
  await sleep(900);
  await eshot("12-edit-zoomed");

  await page.fill("#search", "German"); await sleep(200);
  const hits = await ed(() => ({ shown: document.querySelectorAll(".line:not(.hidden)").length, marks: document.querySelectorAll("mark").length }));
  check("edit: search filters and highlights", hits.shown > 0 && hits.shown < 200 && hits.marks > 0, JSON.stringify(hits));
  await page.fill("#search", "");

  await page.keyboard.press("e");
  check("E leaves edit mode", await ed(() => !editing && getComputedStyle($("editPane")).display === "none"));
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("test run completed", false, e.stack?.split("\n").slice(0, 3).join(" "));
} finally {
  // Close first so a pending autosave can't land, then put the data files back exactly as they were.
  await browser.close();
  await fetch(`${URL}/data/edit.json`, { method: "PUT", body: original });
  await fetch(`${URL}/data/zoom.json`, { method: "PUT", body: originalZoom });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
