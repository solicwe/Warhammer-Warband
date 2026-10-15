const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'data', 'detachment-rules.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

data.rules = data.rules || {};

const cdDetachments = {
  'The Shadow of Chaos': {
    auto: 'full',
    armyRule: true,
    desc: 'Deployment zone is always Shadow of Chaos; No Man\'s Land and enemy zone while controlling half of objectives.'
  },
  'Daemonic Manifestation': {
    auto: 'full',
    armyRule: true,
    desc: 'Friendly Legiones Daemonica within Shadow of Chaos get +1 to Battle-shock and heal D3 wounds (or return D3 Battleline models) on success.'
  },
  'Daemonic Terror': {
    auto: 'full',
    armyRule: true,
    desc: 'Enemy units within Shadow of Chaos or within 6" of Greater Daemons have -1 to Battle-shock and suffer D3 mortal wounds on failure.'
  },
  'Daemonic Pact': {
    auto: 'full',
    armyRule: true,
    desc: 'Allows up to 250/500/750 pts of Legiones Daemonica in Chaos Knights or Heretic Astartes with 1:1 Battleline ratio.'
  },
  'Daemonic Incursion': {
    auto: 'full',
    desc: 'Warp Rifts: Deep strike >6" away from enemies when wholly in Shadow of Chaos or within 6" of friendly Greater Daemon.'
  },
  'Warp Rifts': {
    auto: 'full',
    desc: 'Deep strike >6" away when in Shadow of Chaos.'
  },
  'Legion of Excess': {
    auto: 'full',
    desc: 'Beguiling Aura: Slaanesh units can charge after Falling Back. Seductive Gambit: +1 Attack or Sustained Hits on charge.',
    effects: [{ units: ['SLAANESH'], eligible: ['chargeAfterFallBack'] }]
  },
  'Scintillating Legion': {
    auto: 'full',
    desc: 'Fates in Flux: Start with 3 Flux tokens to reroll advance, hit, wound, damage, save, or hazard.'
  },
  'Blood Legion': {
    auto: 'full',
    desc: 'Murdercall: Surge D6" when enemy ends move within 8". Blood Tainted: Sticky objectives on kill.'
  },
  'Plague Legion': {
    auto: 'full',
    desc: 'Melancholic Miasma: 9" around Nurgle daemons is Shadow of Chaos. Command phase forces Battle-shock test.'
  },
  'Shadow Legion': {
    auto: 'full',
    desc: 'Umbral blessings of the Dark Master: Khorne advance and charge, Tzeentch stealth and -1 to hit in melee, Nurgle -1 to wound if S > T.',
    effects: [
      { units: ['KHORNE'], eligible: ['chargeAfterAdvance', 'shootAfterAdvance'] },
      { units: ['TZEENTCH'], stealth: true, defend: { hit: -1, vs: 'melee' } },
      { units: ['NURGLE'], defend: { woundIfStronger: -1 } }
    ]
  },
  'Cavalcade of Chaos': {
    auto: 'full',
    desc: 'Heralds of the Chariot: impact mortals on charge, 3" engagement reach.'
  },
  'Lords of the Warp': {
    auto: 'full',
    desc: 'Loci of Power: Friendly CHARACTER models (excluding MONSTER) have +1 Ld and +1 OC.',
    effects: [{ units: ['CHARACTER', '!MONSTER'], rolls: { oc: 1 } }]
  },
  'Warptide': {
    auto: 'full',
    desc: 'Shudderblink: Friendly BATTLELINE units advance: ranged weapons gain [ASSAULT] and can charge.',
    effects: [{ units: ['BATTLELINE'], eligible: ['chargeAfterAdvance'] }]
  }
};

for (const [k, v] of Object.entries(cdDetachments)) {
  data.rules[k] = v;
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
console.log('Successfully updated detachment-rules.json with', Object.keys(cdDetachments).length, 'Chaos Daemons rules!');

