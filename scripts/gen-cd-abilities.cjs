const fs = require('fs');
const path = require('path');

const cdPath = path.join(process.cwd(), 'public', 'data', 'factions', 'CD.json');
const cd = JSON.parse(fs.readFileSync(cdPath, 'utf8'));

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

for (const ds of cd.datasheets) {
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

for (const det of (cd.detachments || [])) {
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

// Army rules
for (const ar of (cd.armyRules || [])) {
  if (!map[ar.name]) {
    map[ar.name] = {
      status: 'auto',
      note: summarize(ar.name, ar.text, 'Army Rule')
    };
  }
}

// Enrich specific abilities with engine effects
if (map['The Endless Gift']) {
  map['The Endless Gift'].effects = [{ defend: { fnp: 5 } }];
}
if (map['Swollen with Power']) {
  map['Swollen with Power'].effects = [{ wounds: 2 }];
}
if (map['Bane-forged Weapons']) {
  map['Bane-forged Weapons'].effects = [{ strength: 1 }];
}
if (map['Delirious Grace']) {
  map['Delirious Grace'].effects = [{ defend: { hit: -1, vs: 'melee' } }];
}
if (map['Instrument of Chaos']) {
  map['Instrument of Chaos'].effects = [{ chargeBonus: 1, advanceBonus: 1 }];
}
if (map['Rage Embodied (Aura)']) {
  map['Rage Embodied (Aura)'].effects = [{ chargeBonus: 1 }];
}
if (map['Greater Daemon of Khorne (Aura)']) {
  map['Greater Daemon of Khorne (Aura)'].effects = [{ reroll: 'hits1' }];
}
if (map['Greater Daemon of Tzeentch (Aura)']) {
  map['Greater Daemon of Tzeentch (Aura)'].effects = [{ reroll: 'hits1' }];
}
if (map['Greater Daemon of Nurgle (Aura)']) {
  map['Greater Daemon of Nurgle (Aura)'].effects = [{ reroll: 'hits1' }];
}
if (map['Greater Daemon of Slaanesh (Aura)']) {
  map['Greater Daemon of Slaanesh (Aura)'].effects = [{ reroll: 'hits1' }];
}
if (map['Bellow of Endless Fury']) {
  map['Bellow of Endless Fury'].effects = [{ attacks: 1 }];
}
if (map['A’rgath, the King of Blades']) {
  map['A’rgath, the King of Blades'].effects = [{ attacks: 1, strength: 1 }];
}
if (map['The Everstave']) {
  map['The Everstave'].effects = [{ strength: 1, range: 3 }];
}

const out = {
  _comment: 'Chaos Daemons Faction Pack v1.2. Complete datasheet, detachment, enhancement, and army rules.',
  ...map
};

const targetPath = path.join(process.cwd(), 'data', 'abilities', 'CD.json');
fs.writeFileSync(targetPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Successfully generated', Object.keys(out).length, 'entries to', targetPath);
