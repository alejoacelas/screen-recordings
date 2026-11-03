// End-to-end checks for the editor, run in real Chrome (H.264 needs it).
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const original = await (await fetch(`${URL}/data/edit.json`)).text();
const originalZoom = await (await fetch(`${URL}/data/zoom.json`)).text();

try {
  await page.goto(URL);
  await page.waitForFunction(() => typeof pieces !== "undefined" && pieces.length && video.readyState >= 2, null, { timeout: 30000 });
  await sleep(500);

  // 1. Load
  const counts = await ev(() => ({ lines: document.querySelectorAll(".line").length, heads: document.querySelectorAll(".chapHead").length,
    chaps: document.querySelectorAll(".chap").length, segs: document.querySelectorAll(".seg").length, total, dur: video.duration }));
  check("transcript, sections and timeline render", counts.lines > 100 && counts.heads >= 5 && counts.chaps >= 5 && counts.segs >= 5, JSON.stringify(counts));
  check("edited length is shorter than the source", counts.total > 600 && counts.total < counts.dur * 0.7, `${Math.round(counts.total / 60)} min of ${Math.round(counts.dur / 60)}`);
  await shot("01-loaded");

  // 2. Play from the start: section card, captions, time advances
  await page.keyboard.press("k");
  await sleep(2500);
  const s2 = await ev(() => ({ t: video.currentTime, paused: video.paused, card: !$("sectionCard").hidden && $("sectionCard").textContent, cap: !$("caption").hidden }));
  check("playback advances", !s2.paused && s2.t > 1, `t=${s2.t.toFixed(2)}`);
  check("first section title shows at the start", !!s2.card, String(s2.card));
  await shot("02-playing-start");
  await sleep(2500);
  check("captions appear while speaking", await ev(() => !$("caption").hidden), await ev(() => $("caption").textContent));

  // 3. Transcript follows playback
  await ev(() => seekSource(900));
  await sleep(1200);
  const s3 = await ev(() => {
    const el = document.querySelector(".line.now"), box = $("transcript");
    const y = el ? el.getBoundingClientRect().top - box.getBoundingClientRect().top : -1;
    return { idx: el ? +el.dataset.l : -1, expect: lineAt(video.currentTime), visible: y > 0 && y < box.clientHeight, word: !!document.querySelector(".w.cur") };
  });
  check("current transcript line matches the video", s3.idx === s3.expect, JSON.stringify(s3));
  check("current line is scrolled into view", s3.visible);
  check("current word is highlighted", s3.word);
  await shot("03-transcript-sync");

  // 4. Sped-up segment: banner, rate, mute
  const fast = await ev(() => edit.segments.find((s) => s.mode === "fast" && s.speed <= 16));
  await ev((t) => seekSource(t + 1), fast.s);
  await sleep(800);
  const s4 = await ev(() => ({ banner: !$("fastBanner").hidden && $("fastBanner").textContent, rate: video.playbackRate, muted: video.muted, tf: video.style.transform }));
  check("sped-up segment shows its title", !!s4.banner && s4.banner.includes(fast.label), String(s4.banner));
  check("sped-up segment plays at its speed and muted", Math.abs(s4.rate - fast.speed) < 0.01 && s4.muted, JSON.stringify(s4));
  check("zoom is off during sped-up segments", s4.tf.startsWith("scale(1)"), s4.tf);
  await shot("04-fast-banner");

  // 5. Speeds above 16x still move through the segment
  const vfast = await ev(() => edit.segments.find((s) => s.mode === "fast" && s.speed > 16));
  if (vfast) {
    await ev((t) => seekSource(t + 1), vfast.s);
    await sleep(300);
    const a = await ev(() => video.currentTime); await sleep(2000); const b = await ev(() => video.currentTime);
    const eff = (b - a) / 2;
    check(`${vfast.speed}x segment advances faster than 16x`, eff > 18, `${eff.toFixed(1)} s of source per second`);
  }

  // 6. Normal speed with the speed menu; pauses speed up
  await ev(() => seekSource(edit.segments[0].s + 20));
  await page.hover("#stage"); await page.click("#rateBtn"); await page.click('#rateMenu [data-rate="1.5"]');
  await sleep(400);
  const s6 = await ev(() => { const p = pieces[pieceIndex(video.currentTime)]; return { rate: video.playbackRate, kind: p && p.kind, pr: p && p.rate }; });
  check("speed menu scales playback", Math.abs(s6.rate - 1.5 * s6.pr) < 0.01, JSON.stringify(s6));
  check("time display reflects 1.5x", await ev(() => $("lengths").textContent.includes("at 1.5×")));
  await page.click("#rateBtn"); await page.click('#rateMenu [data-rate="1"]');
  check("pauses become sped-up pieces", await ev(() => pieces.some((p) => p.kind === "pause")));

  // 7. Zoom follows keyframes and toggles off
  const zk = await ev(() => zoom.find((k) => k.w < 1 && k.t > 60 && edit.segments[segAt(k.t + 2)].mode === "normal"));
  await ev((t) => seekSource(t + 2), zk.t); await sleep(1200);
  const zOn = await ev(() => video.style.transform);
  await page.keyboard.press("z"); await sleep(100);
  const zOff = await ev(() => video.style.transform);
  await page.keyboard.press("z");
  check("zoom applies at a zoom keyframe", !zOn.startsWith("scale(1)"), zOn);
  check("Z toggles zoom off", zOff.startsWith("scale(1)"), zOff);
  await sleep(900);
  await shot("05-zoomed");

  // 8. Cut a range from the transcript; playback skips it; undo restores
  await page.keyboard.press("k"); // pause
  const segsBefore = await ev(() => edit.segments.length);
  const totalBefore = await ev(() => total);
  const [la, lb] = await ev(() => { const a = lineAt(edit.segments[0].s + 60); return [a, a + 3]; });
  await page.click(`.line[data-l="${la}"] .t`);
  await page.click(`.line[data-l="${lb}"] .t`, { modifiers: ["Shift"] });
  const selShown = await ev(() => !$("selBar").hidden && $("selInfo").textContent);
  check("shift-click selects a range of lines", !!selShown && selShown.startsWith("4 lines"), String(selShown));
  await shot("06-selection");
  await page.keyboard.press("3");
  const s8 = await ev(([a, b]) => ({ segs: edit.segments.length, total, cutLines: [...Array(b - a + 1)].every((_, i) => document.querySelector(`.line[data-l="${a + i}"]`).classList.contains("cut")) }), [la, lb]);
  check("pressing 3 cuts the selected lines", s8.cutLines && s8.segs === segsBefore + 2 && s8.total < totalBefore, JSON.stringify(s8));
  const cutSeg = await ev(([a]) => edit.segments[segAt(lines[a].s + 0.05)], [la]);
  await ev((t) => { seekSource(t - 1.5); video.play(); }, cutSeg.s);
  await sleep(2500);
  const after = await ev(() => video.currentTime);
  check("playback skips the cut", after >= cutSeg.e, `cut ${cutSeg.s.toFixed(1)}–${cutSeg.e.toFixed(1)}, now ${after.toFixed(1)}`);
  await page.keyboard.press("k");
  await shot("07-after-cut");
  await page.keyboard.press("Meta+z");
  check("undo restores the segments", await ev(() => edit.segments.length) === segsBefore);
  await page.keyboard.press("Meta+Shift+z");
  check("redo reapplies the cut", await ev(() => edit.segments.length) === segsBefore + 2);
  await page.keyboard.press("Meta+z");

  // 9. Unedited mode plays through cuts
  await page.keyboard.press("u");
  check("unedited mode disables the edit", await ev(() => raw === true));
  await page.keyboard.press("u");

  // 10. Speed up a range and title it from the card
  await page.click(`.line[data-l="${la}"] .t`);
  await page.click(`.line[data-l="${la + 2}"] .t`, { modifiers: ["Shift"] });
  await page.keyboard.press("2");
  await page.fill("#segLabel", "Test title");
  await page.press("#segLabel", "Enter");
  await page.locator("#segLabel").blur();
  const s10 = await ev(() => edit.segments[selected]);
  check("2 speeds up the range and the title field names it", s10.mode === "fast" && s10.label === "Test title", JSON.stringify(s10));
  await shot("08-fast-card");
  await page.keyboard.press("Meta+z"); await page.keyboard.press("Meta+z");

  // 11. Timeline: click selects segment; drag a boundary
  const box = await page.locator("#timeline").boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + 40);
  const sel = await ev(() => ({ selected, t: video.currentTime, seg: edit.segments[selected] }));
  check("timeline click seeks and selects the segment under it", sel.t >= sel.seg.s && sel.t <= sel.seg.e, JSON.stringify({ t: sel.t, s: sel.seg.s, e: sel.seg.e }));
  const bnd = page.locator('.boundary[data-b="1"]');
  const bb = await bnd.boundingBox();
  const oldS = await ev(() => edit.segments[1].s);
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 25, bb.y + bb.height / 2, { steps: 5 }); await page.mouse.up();
  const newS = await ev(() => edit.segments[1].s);
  check("dragging a boundary moves it", newS > oldS + 5, `${oldS.toFixed(1)} → ${newS.toFixed(1)}`);
  await page.keyboard.press("Meta+z");
  check("undo restores the boundary", Math.abs((await ev(() => edit.segments[1].s)) - oldS) < 0.01);

  // 12. Chapter bar hover and click
  await page.hover("#stage");
  const cb = await page.locator("#chapterBar").boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height / 2);
  await sleep(200);
  const tip = await ev(() => !$("barHover").hidden && $("barHover").textContent);
  await shot("09-chapter-hover");
  check("chapter bar hover shows section and time", !!tip, String(tip));
  await page.mouse.click(cb.x + cb.width * 0.6, cb.y + cb.height / 2);
  const et = await ev(() => editedOf(video.currentTime) / total);
  check("chapter bar click seeks in edited time", Math.abs(et - 0.6) < 0.02, et.toFixed(3));

  // 13. Section titles: add from selection, rename, delete
  const nSec = await ev(() => edit.sections.length);
  await page.click(`.line[data-l="${la}"] .t`);
  await page.click(`.line[data-l="${la}"] .t`, { modifiers: ["Shift"] });
  await page.click("#selSection");
  await page.keyboard.type("Renamed section"); await page.keyboard.press("Enter");
  await sleep(100);
  check("adding and renaming a section title", await ev(() => edit.sections.some((s) => s.title === "Renamed section")) && await ev(() => edit.sections.length) === nSec + 1);
  await page.keyboard.press("Meta+z"); await page.keyboard.press("Meta+z");
  check("undo removes the added section", await ev(() => edit.sections.length) === nSec);

  // 14. Transcript search
  await page.fill("#search", "German");
  await sleep(200);
  const hits = await ev(() => ({ shown: document.querySelectorAll(".line:not(.hidden)").length, marks: document.querySelectorAll("mark").length }));
  check("search filters lines and highlights matches", hits.shown > 0 && hits.shown < 200 && hits.marks > 0, JSON.stringify(hits));
  await shot("10-search");
  await page.fill("#search", "");

  // 15. Autosave writes to disk
  await page.click(`.line[data-l="${la}"] .t`); await page.keyboard.press("3");
  await sleep(1500);
  const saved = await (await fetch(`${URL}/data/edit.json`)).json();
  check("edits autosave to data/edit.json", saved.segments.length === segsBefore + 2 || saved.segments.length === segsBefore + 1, `${saved.segments.length} segments on disk`);
  await page.keyboard.press("Meta+z"); await sleep(1500);

  // 16. Controls auto-hide while playing
  await ev(() => seekSource(edit.segments[0].s + 30));
  await page.mouse.move(cb.x + 200, cb.y - 200);
  await page.keyboard.press("k");
  await sleep(3200);
  check("controls hide while playing", await ev(() => stage.classList.contains("idle")));
  await page.keyboard.press("k");

  // 17. Help overlay
  await page.keyboard.press("?");
  check("? opens shortcuts", await ev(() => !$("help").hidden));
  await shot("11-help");
  await page.keyboard.press("Escape");

  // 18. Narrow window
  await page.setViewportSize({ width: 900, height: 1000 });
  await sleep(300);
  const overflow = await ev(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no horizontal overflow at 900px", !overflow);
  await shot("12-narrow");

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("test run completed", false, e.stack?.split("\n").slice(0, 3).join(" "));
  await shot("zz-crash").catch(() => {});
} finally {
  // Close first so a pending autosave can't land, then put the data files back exactly as they were.
  await browser.close();
  await fetch(`${URL}/data/edit.json`, { method: "PUT", body: original });
  await fetch(`${URL}/data/zoom.json`, { method: "PUT", body: originalZoom });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
