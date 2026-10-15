const fs = require('fs');
const path = require('path');

const druPath = path.join(process.cwd(), 'public', 'data', 'factions', 'DRU.json');
const dru = JSON.parse(fs.readFileSync(druPath, 'utf8'));

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

for (const ds of dru.datasheets) {
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

for (const det of (dru.detachments || [])) {
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

// Add explicit specific effects
if (map['Shadowfield']) {
  map['Shadowfield'].effects = [{ inv: 2 }];
}
if (map['Towering Arrogance']) {
  map['Towering Arrogance'].effects = [{ oc: 1 }];
}
if (map['Hyperstimm Trafficker']) {
  map['Hyperstimm Trafficker'].effects = [{ toughness: 1 }];
}
if (map['Elixir of the Corpse Courts']) {
  map['Elixir of the Corpse Courts'].effects = [{ inv: 5 }];
}
if (map['Reaper’s Cowl']) {
  map['Reaper’s Cowl'].effects = [{ stealth: true, infiltrators: true }];
}
if (map['Webway Walker']) {
  map['Webway Walker'].effects = [{ deepStrike: true }];
}

const out = {
  _comment: 'Drukhari Faction Pack v1.2. Complete datasheet, detachment, enhancement, and army rules.',
  ...map
};

const targetPath = path.join(process.cwd(), 'data', 'abilities', 'DRU.json');
fs.writeFileSync(targetPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Successfully generated', Object.keys(out).length, 'entries to', targetPath);
