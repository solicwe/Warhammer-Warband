const fs = require('fs');
const path = require('path');

const gcPath = path.join(process.cwd(), 'public', 'data', 'factions', 'GC.json');
const gc = JSON.parse(fs.readFileSync(gcPath, 'utf8'));

const map = {};

function clean(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

function summarize(name, text, type) {
  const c = clean(text);
  if (c.length <= 320) return c;
  const s = c.slice(0, 300);
  const lastDot = s.lastIndexOf('.');
  if (lastDot > 120) return s.slice(0, lastDot + 1);
  return s + '...';
}

for (const ds of gc.datasheets) {
  for (const a of (ds.abilities || [])) {
    if (!map[a.name]) {
      map[a.name] = {
        status: 'auto',
        note: summarize(a.name, a.text, a.type)
      };
    }
  }
  for (const a of (ds.wargearAbilities || [])) {
    if (!map[a.name]) {
      map[a.name] = {
        status: 'auto',
        note: summarize(a.name, a.text, 'Wargear')
      };
    }
  }
}

for (const det of (gc.detachments || [])) {
  for (const r of (det.rules || [])) {
    if (!map[r.name]) {
      map[r.name] = {
        status: 'auto',
        note: summarize(r.name, r.text, 'Detachment')
      };
    }
  }
  for (const e of (det.enhancements || [])) {
    if (!map[e.name]) {
      map[e.name] = {
        status: 'auto',
        note: summarize(e.name, e.text, 'Enhancement')
      };
    }
  }
}

for (const ar of (gc.armyRules || [])) {
  if (!map[ar.name]) {
    map[ar.name] = {
      status: 'auto',
      note: summarize(ar.name, ar.text, 'Army Rule')
    };
  }
}

const outPath = path.join(process.cwd(), 'data', 'abilities', 'GC.json');
fs.writeFileSync(outPath, JSON.stringify(map, null, 2), 'utf8');
console.log(`Generated GC.json with ${Object.keys(map).length} abilities mapped to status: 'auto'!`);

