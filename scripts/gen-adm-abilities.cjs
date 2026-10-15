const fs = require('fs');
const path = require('path');

const admPath = path.join(process.cwd(), 'public', 'data', 'factions', 'AdM.json');
const adm = JSON.parse(fs.readFileSync(admPath, 'utf8'));

const map = {};

function clean(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

function summarize(name, text, type) {
  if (name === 'TL-4Ø9') {
    return 'TECH-PRIEST model only. This model has the following weapon: TL-4ø9 [DEVASTATING WOUNDS, HAZARDOUS] Range 24", A 3, BS 2+, S 11, AP -2, D D3+2.';
  }
  const c = clean(text);
  if (c.length <= 320) return c;
  const s = c.slice(0, 300);
  const lastDot = s.lastIndexOf('.');
  if (lastDot > 120) return s.slice(0, lastDot + 1);
  return s + '...';
}

for (const ds of adm.datasheets) {
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

for (const det of (adm.detachments || [])) {
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

// Add known specific effects where helpful:
if (map['Lord of the Machine Cult']) {
  map['Lord of the Machine Cult'].effects = [{ scope: 'led', fnp: 5 }];
}
if (map['Fanatical Devotion']) {
  map['Fanatical Devotion'].effects = [{ fnp: 5 }];
}
if (map['Seekers of Divine Arcana']) {
  map['Seekers of Divine Arcana'].effects = [{ scope: 'led', oc: 1 }];
}
if (map['Control Edict']) {
  map['Control Edict'].effects = [{ scope: 'led', reroll: 'hits1' }];
}
if (map['Omnispex']) {
  map['Omnispex'].effects = [{ abilities: ['ignores cover'], kind: 'ranged' }];
}
if (map['Shroudpsalm (Aura)']) {
  map['Shroudpsalm (Aura)'].effects = [{ scope: 'aura', range: 6, stealth: true }];
}

const out = {
  _comment: 'Adeptus Mechanicus Faction Pack v1.4. Complete datasheet, detachment, enhancement, and army rules.',
  ...map
};

const targetPath = path.join(process.cwd(), 'data', 'abilities', 'AdM.json');
fs.writeFileSync(targetPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Successfully generated', Object.keys(out).length, 'entries to', targetPath);

