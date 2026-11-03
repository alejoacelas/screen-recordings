// Render one tile per expression for design review: node sheet.mjs OUT.png
import fs from 'node:fs';
import { openAvatar } from './browser.mjs';
import { BASE, EXPRESSIONS } from './timeline.mjs';

const tiles = Object.entries(EXPRESSIONS).map(([name, ex]) => ({
  ...BASE, ...ex.state, roll: ex.state.tiltAdd ?? 0, pitch: ex.state.pitchAdd ?? 0, t: 1.2, mouth: ex.state.mouth ?? (name === 'idle' ? 0 : 0.35),
  fx: (ex.fx ? [ex.fx] : []).map((kind) => ({ kind, age: 0.6, alpha: 1 })),
  bubble: name === 'happy' ? { text: 'Guten Morgen!', alpha: 1, scale: 1 } : null,
}));
const { page, close } = await openAvatar();
const url = await page.evaluate(([s]) => window.renderSheet(s, 4, 300), [tiles]);
fs.writeFileSync(process.argv[2], Buffer.from(url.split(',')[1], 'base64'));
await close();
