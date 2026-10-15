const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'data', 'detachment-rules.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

data.rules = data.rules || {};

const gcDetachments = {
  'Cult Ambush': {
    auto: 'full',
    armyRule: true,
    desc: 'Starts with Resurgence points (Incursion: 6, Strike Force: 10, Onslaught: 14). When a unit is destroyed, spend Resurgence points to return it to Cult Ambush and place a Cult Ambush marker >9" from enemies.'
  },
  'Cult Icon': {
    auto: 'full',
    armyRule: true,
    desc: 'In your Command phase, 1 destroyed model is returned to this unit (or D3 destroyed models if this unit is within range of an objective marker you control).'
  },
  'Host of Ascension': {
    auto: 'full',
    desc: 'A Perfect Ambush: Each time a Genestealer Cults unit is set up from Reserves or Cult Ambush, until the end of the turn, ranged weapons have [SUSTAINED HITS 1] and melee weapons score Critical Hits on an unmodified Hit roll of 5+.'
  },
  'A Perfect Ambush': {
    auto: 'full',
    desc: 'Units arriving from Reserves get [SUSTAINED HITS 1] on ranged attacks and [CRITICAL HITS 5+] in melee.'
  },
  'Xenocreed Congregation': {
    auto: 'full',
    desc: 'Unquestioning Fanaticism: Each time a Battleline model is destroyed in melee, on a 5+ it can make 1 melee attack before removal. Characters grant their unit 5+ Feel No Pain.'
  },
  'Unquestioning Fanaticism': {
    auto: 'full',
    desc: 'Battleline models fight on death on 5+ in melee; Characters grant 5+ Feel No Pain.'
  },
  'Biosanctic Broodsurge': {
    auto: 'full',
    desc: 'Hypermorphic Fury: Aberrant, Genestealer and Abominant models get +1 Attack to melee weapons. While within 6" of a friendly Patriarch or Biophagus, add 1 to Wound rolls.'
  },
  'Hypermorphic Fury': {
    auto: 'full',
    desc: '+1 Melee Attack for Aberrant/Genestealer/Abominant; +1 to Wound within 6" of Patriarch or Biophagus.'
  },
  'Outlander Claw': {
    auto: 'full',
    desc: 'Rapid Takeover: Vehicle and Mounted units gain [SCOUTS 6"] and re-roll Wound rolls of 1.'
  },
  'Rapid Takeover': {
    auto: 'full',
    desc: 'Vehicle and Mounted units have [SCOUTS 6"] and re-roll Wound rolls of 1.',
    effects: [
      { units: ['kw:VEHICLE', 'kw:MOUNTED'], scouts: 6, attack: { rerollWounds1: true } }
    ]
  },
  'Brood Brother Auxilia': {
    auto: 'full',
    desc: 'Integrated Tactics: Astra Militarum units up to 500/1000 pts can be included. +1 to Hit when attacking enemy units targeted by Astra Militarum.'
  },
  'Integrated Tactics': {
    auto: 'full',
    desc: '+1 to Hit when attacking enemy units targeted by friendly Astra Militarum units.'
  },
  'BROOD BROTHERS': {
    auto: 'full',
    desc: 'Allows Astra Militarum detachment allies in your army.'
  },
  'Final Day': {
    auto: 'full',
    desc: 'Psionic Parasitism / Star Children’s Blessing: Each round choose +2" Move, [LETHAL HITS] on ranged weapons, or 5+ Invulnerable save.'
  },
  'Psionic Parasitism': {
    auto: 'full',
    desc: 'In Command phase, pick one blessing: +2" Move, [LETHAL HITS] on ranged, or 5+ Invulnerable.'
  },
  'Heroes of the Uprising': {
    auto: 'full',
    desc: 'Killer Reputation: Characters get +1 Attack and +1 Strength in melee, and leading units re-roll Advance and Charge rolls.'
  },
  'Killer Reputation': {
    auto: 'full',
    desc: '+1 Attack and +1 Strength to Character melee weapons; re-roll Advance and Charge while leading a unit.'
  },
  'Purestrain Broodswarm': {
    auto: 'full',
    desc: 'Enemy Within: Purestrain Genestealers gain [STEALTH] and [INFILTRATORS], and can arrive from Reserves within 6" of enemy units.'
  },
  'Enemy Within': {
    auto: 'full',
    desc: 'Purestrain Genestealers have [STEALTH] and [INFILTRATORS], and can deep strike within 6" of enemy units.',
    effects: [
      { units: ['PURESTRAIN GENESTEALERS'], stealth: true, core: { infiltrators: true } }
    ]
  },
  'Xenocult Masses': {
    auto: 'full',
    desc: 'Hordes of the Faithful: Place 1 additional Cult Ambush marker within 6" of each placed marker. Neophyte Hybrids gain +1 to Hit while within range of an objective.'
  },
  'Hordes of the Faithful': {
    auto: 'full',
    desc: 'Place 1 extra Cult Ambush marker within 6"; Neophyte Hybrids gain +1 to Hit on objectives.'
  }
};

for (const [key, rule] of Object.entries(gcDetachments)) {
  data.rules[key] = rule;
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
console.log(`Updated detachment-rules.json with ${Object.keys(gcDetachments).length} Genestealer Cults rules!`);

