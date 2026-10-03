// Freeze the current bot as the "baseline" opponent for scripts/bot-arena (src/engine/baseline/*).
// The copy imports the real engine; its global hooks (dice re-rolls, defensive stratagems) are left out,
// so those decisions are made by the live bot code for both sides and the arena measures the rest.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SRC = path.join(ROOT, 'src/engine');
const OUT = path.join(SRC, 'baseline');
const MODS = ['bot', 'botEval', 'botMove', 'botStrats'];
fs.mkdirSync(OUT, { recursive: true });
for (const m of MODS) {
  let t = fs.readFileSync(path.join(SRC, `${m}.ts`), 'utf8');
  // engine imports point one level up; bot-to-bot imports stay inside the baseline folder
  t = t.replace(/from '\.\/([A-Za-z]+)'/g, (all, name) => (MODS.includes(name) ? all : `from '../${name}'`));
  if (m === 'botStrats') {
    t = t.replace(/^setDiceHook\(/m, 'export const baselineDiceHook = (');
    t = t.replace(/^onAttackStart\(/m, 'export const baselineStartHook = (');
  }
  fs.writeFileSync(path.join(OUT, `${m}.ts`), `// @ts-nocheck — frozen copy of src/engine/${m}.ts (scripts/bot-baseline/snapshot.mjs)\n` + t);
}
console.log('baseline bot frozen in src/engine/baseline/');
