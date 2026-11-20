// Everything about one rule in one place: the card text, what the game's data says, the code that mentions it, the tests,
// and (when data/official/*.txt exists) the official wording.
//   npm run rule -- "Wrath of the Doomed"
//   npm run rule -- "Infernal Fusillade" --faction TS
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const fi = args.indexOf('--faction');
const only = fi >= 0 ? args.splice(fi, 2)[1] : null;
const query = args.join(' ').trim();
if (!query) { console.log('usage: npm run rule -- "<rule name>" [--faction ID]'); process.exit(1); }
const norm = (s) => String(s ?? '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const q = norm(query);
const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const hit = (name) => norm(name).includes(q);

console.log(`\n=== ${query} ===`);

// 1. the cards, as the faction files carry them
const idx = JSON.parse(read('public/data/index.json'));
let found = 0;
for (const f of idx.factions) {
  if (only && f.id !== only) continue;
  const d = JSON.parse(read(`public/data/factions/${f.id}.json`));
  const show = (kind, where, o) => { found++; console.log(`\n[${f.id}] ${kind}${where ? ' · ' + where : ''}: ${o.name}${o.cp ? ` (${o.cp}CP)` : ''}${o.pts ? ` (${o.pts} pts)` : ''}\n${(o.text ?? '').trim().replace(/^/gm, '    ')}`); };
  for (const r of d.armyRules ?? []) if (hit(r.name)) show('army rule', '', r);
  for (const det of d.detachments) {
    if (hit(det.name)) { found++; console.log(`\n[${f.id}] detachment: ${det.name}`); }
    for (const r of det.rules ?? []) if (hit(r.name)) show('detachment rule', det.name, r);
    for (const e of det.enhancements ?? []) if (hit(e.name)) show('enhancement', det.name, e);
    for (const s of det.stratagems ?? []) if (hit(s.name)) show('stratagem', det.name, s);
  }
  for (const sh of d.datasheets) {
    for (const a of sh.abilities ?? []) if (hit(a.name)) show('ability', sh.name, a);
    if (hit(sh.name)) { found++; console.log(`\n[${f.id}] datasheet: ${sh.name}  keywords: ${sh.keywords.join(', ')}`); }
  }
}
if (!found) console.log('\nNo card, ability or datasheet with that name in public/data/factions.');

// 2. what the game's rule data says (the file and the entry)
console.log('\n--- rule data (data/) ---');
for (const dir of ['data/abilities', 'data/stratagems', 'data/overrides']) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(read(`${dir}/${f}`)); } catch { continue; }
    const tables = dir === 'data/stratagems' ? [j.rules ?? {}] : [j];
    for (const t of tables) for (const [k, v] of Object.entries(t)) if (norm(k.split('@')[0]).includes(q)) console.log(`${dir}/${f}  "${k}": ${JSON.stringify(v).slice(0, 400)}`);
  }
}
for (const f of ['data/detachment-rules.json', 'data/ability-rules.json']) {
  if (!fs.existsSync(path.join(root, f))) continue;
  const j = JSON.parse(read(f));
  for (const [k, v] of Object.entries(j.rules ?? j)) if (norm(k).includes(q)) console.log(`${f}  "${k}": ${JSON.stringify(v).slice(0, 400)}`);
}

// 3. code and tests that mention it
console.log('\n--- code and tests ---');
const walk = (d, out = []) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== 'zz') walk(p, out); } else if (/\.(ts|tsx)$/.test(f)) out.push(p); } return out; };
let n = 0;
for (const f of walk(path.join(root, 'src'))) {
  read(path.relative(root, f)).split('\n').forEach((line, i) => { if (n < 25 && norm(line).includes(q)) { n++; console.log(`${path.relative(root, f).split(path.sep).join('/')}:${i + 1}: ${line.trim().slice(0, 150)}`); } });
}
if (!n) console.log('(no mention: the rule runs from data only, or not at all: check docs/RULES_STATUS.md)');

// 4. the official wording, if the documents are there
const offDir = path.join(root, 'data/official');
const txts = fs.existsSync(offDir) ? fs.readdirSync(offDir).filter((f) => f.endsWith('.txt')) : [];
console.log('\n--- official text (data/official) ---');
if (!txts.length) console.log('none yet: see data/official/README.md (download the PDFs, then npm run rules:text)');
for (const f of txts) {
  const lines = fs.readFileSync(path.join(offDir, f), 'utf8').split('\n');
  lines.forEach((line, i) => { if (norm(line).includes(q)) console.log(`${f}:${i + 1}\n${lines.slice(Math.max(0, i - 1), i + 6).map((l) => '    ' + l.trim()).join('\n')}`); });
}
console.log('');
