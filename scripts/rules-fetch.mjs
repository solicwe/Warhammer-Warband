// Downloads the official rules documents listed in scripts/official-sources.json into data/official/ (git-ignored),
// skipping what is already there. Games Workshop material: for local use, never committed.
//   npm run rules:fetch            then   npm run rules:text
import fs from 'node:fs';
import path from 'node:path';

const spec = JSON.parse(fs.readFileSync('scripts/official-sources.json', 'utf8'));
const dir = path.join(process.cwd(), 'data/official');
fs.mkdirSync(dir, { recursive: true });
let got = 0, skipped = 0, failed = 0;
for (const f of spec.files) {
  const out = path.join(dir, `${f.name}.pdf`);
  if (fs.existsSync(out) && fs.statSync(out).size > 10000) { skipped++; continue; }
  try {
    const r = await fetch(spec.base + encodeURIComponent(f.file).replace(/%2C/g, ',').replace(/%26/g, '&'), { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('not a PDF');
    fs.writeFileSync(out, buf);
    got++;
    console.log(`${f.name}.pdf  ${(buf.length / 1e6).toFixed(1)} MB`);
  } catch (e) { failed++; console.error(`${f.name}: ${e.message}`); }
}
console.log(`downloaded ${got}, already there ${skipped}, failed ${failed}`);
