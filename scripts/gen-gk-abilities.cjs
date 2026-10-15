const fs = require('fs');
const path = require('path');

const gkPath = path.join(process.cwd(), 'public', 'data', 'factions', 'GK.json');
const gk = JSON.parse(fs.readFileSync(gkPath, 'utf8'));

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

// 1. Army rule: Teleport Assault
map['Teleport Assault'] = {
  status: 'auto',
  note: 'At the end of your opponent’s turn, you can select up to N Grey Knights units (Incursion: 2, Strike Force: 3, Onslaught: 4) and place them into Strategic Reserves. In your next Movement phase, they can arrive via Deep Strike.'
};

// 2. Datasheet abilities
for (const ds of gk.datasheets) {
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

// 3. Detachment rules
for (const det of (gk.detachments || [])) {
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

const outPath = path.join(process.cwd(), 'data', 'abilities', 'GK.json');
fs.writeFileSync(outPath, JSON.stringify(map, null, 2), 'utf8');
console.log('Wrote', Object.keys(map).length, 'GK abilities to', outPath);

