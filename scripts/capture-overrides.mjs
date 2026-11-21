// Keep hand edits of public/data safe from a rebuild: builds the data into a temporary folder without the final patches,
// compares it with public/data, writes what differs to data/overrides/final/<ID>.json (and index.json), then builds again
// with them and checks the result is the same as public/data.
//   npm run data:capture        after editing a file in public/data by hand
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { diff, deepEqual } from './json-patch.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PUB = path.join(ROOT, 'public/data');
const FINAL = path.join(ROOT, 'data/overrides/final');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const build = (out, skipFinal) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-data.mjs')], { env: { ...process.env, BUILD_OUT: out, ...(skipFinal ? { SKIP_FINAL: '1' } : {}) }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
};
const files = ['index.json', ...fs.readdirSync(path.join(PUB, 'factions')).filter((f) => f.endsWith('.json')).map((f) => `factions/${f}`)];

const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-raw-'));
build(raw, true);
fs.mkdirSync(FINAL, { recursive: true });
let patched = 0;
for (const f of files) {
  const name = f === 'index.json' ? 'index.json' : path.basename(f);
  const built = fs.existsSync(path.join(raw, f)) ? read(path.join(raw, f)) : {};
  const p = diff(built, read(path.join(PUB, f)));
  const out = path.join(FINAL, name);
  if (p === undefined) { if (fs.existsSync(out)) fs.unlinkSync(out); continue; }
  fs.writeFileSync(out, JSON.stringify(p, null, 1) + '\n');
  patched++;
  console.log(`${name}: ${JSON.stringify(p).length} characters of hand edits kept`);
}
const check = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-check-'));
build(check, false);
const bad = files.filter((f) => !deepEqual(read(path.join(check, f)), read(path.join(PUB, f))));
fs.rmSync(raw, { recursive: true, force: true });
fs.rmSync(check, { recursive: true, force: true });
if (bad.length) { console.error(`still different after the patches: ${bad.join(', ')}`); process.exit(1); }
console.log(`${patched} file(s) patched; a rebuild now gives exactly public/data`);
