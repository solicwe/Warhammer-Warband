// Builds public/images/manifest.json from the image files in public/images/units/<FACTION>/.
// A file is matched to a datasheet by its name: "Intercessor Squad" ← intercessor-squad.webp (or .jpg/.png/.avif).
//   npm run images            write the manifest, list files that matched nothing
//   npm run images -- --missing   also list the datasheets of SM / ORK that have no image yet
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'public/images');
const UNITS = path.join(DIR, 'units');
const EXT = /\.(webp|jpe?g|png|avif|gif)$/i;
const FOCUS = ['SM', 'ORK'];

/** Same rule as imageSlug() in src/ui/portraits.ts. */
const slug = (name) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const factionFile = (id) => path.join(ROOT, 'public/data/factions', `${id}.json`);
const datasheets = (id) => (fs.existsSync(factionFile(id)) ? JSON.parse(fs.readFileSync(factionFile(id), 'utf8')).datasheets.map((d) => d.name) : []);
const allFactions = fs.readdirSync(path.join(ROOT, 'public/data/factions')).map((f) => f.replace(/\.json$/, ''));

const units = {};
const unmatched = [];
let count = 0;
for (const folder of fs.existsSync(UNITS) ? fs.readdirSync(UNITS).sort() : []) {
  const dir = path.join(UNITS, folder);
  if (!fs.statSync(dir).isDirectory()) continue;
  // the folder's own faction first, then every other faction (a file in the wrong folder still works)
  const order = [folder, ...allFactions.filter((f) => f !== folder)];
  for (const file of fs.readdirSync(dir).filter((f) => EXT.test(f)).sort()) {
    const s = slug(file.replace(EXT, ''));
    let hit;
    for (const f of order) {
      const name = datasheets(f).find((n) => slug(n) === s);
      if (name) { hit = name; break; }
    }
    if (!hit) { unmatched.push(`units/${folder}/${file}`); continue; }
    (units[folder] ??= {})[hit] = `units/${folder}/${file}`;
    count++;
  }
}

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ version: 1, units }, null, 2) + '\n');
console.log(`public/images/manifest.json: ${count} images`);
if (unmatched.length) console.log(`no datasheet matches (rename to the datasheet name, e.g. intercessor-squad.webp):\n  ${unmatched.join('\n  ')}`);
if (process.argv.includes('--missing')) {
  for (const f of FOCUS) {
    const have = new Set(Object.keys(units[f] ?? {}));
    const missing = datasheets(f).filter((n) => !have.has(n));
    console.log(`\n${f}: ${missing.length} without an image`);
    for (const n of missing) console.log(`  ${slug(n)}  (${n})`);
  }
}
