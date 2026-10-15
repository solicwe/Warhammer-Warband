const fs = require('fs');
const path = require('path');

const necPath = path.join(process.cwd(), 'public', 'data', 'factions', 'NEC.json');
const nec = JSON.parse(fs.readFileSync(necPath, 'utf8'));

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

// 1. Army rule: Reanimation Protocols
map['Reanimation Protocols'] = {
  status: 'auto',
  note: 'At the start of your Command phase, each of your Necrons units activates its Reanimation Protocols and reanimates D3 wounds.'
};

// 2. Datasheet abilities
for (const ds of nec.datasheets) {
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
for (const det of (nec.detachments || [])) {
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

const outPath = path.join(process.cwd(), 'data', 'abilities', 'NEC.json');
fs.writeFileSync(outPath, JSON.stringify(map, null, 2), 'utf8');
console.log('Wrote', Object.keys(map).length, 'NEC abilities to', outPath);

