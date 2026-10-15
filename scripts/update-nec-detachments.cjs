const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'data', 'detachment-rules.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

data.rules = data.rules || {};

const necDetachments = {
  'Reanimation Protocols': {
    auto: 'full',
    armyRule: true,
    desc: 'At the start of your Command phase, each Necrons unit activates Reanimation Protocols: reanimates D3 wounds, restoring lost wounds to damaged models or returning destroyed models with full wounds.'
  },
  'Awakened Dynasty': {
    auto: 'full',
    desc: 'Command Protocols: While a Necrons unit is being led by a Character, each time a model in that unit makes an attack, add 1 to the Hit roll.'
  },
  'Command Protocols': {
    auto: 'full',
    desc: 'While led by a Character, models in the unit add 1 to Hit rolls.'
  },
  'Annihilation Legion': {
    auto: 'full',
    desc: 'Annihilation Protocol: Destroyer Cult and Flayed Ones units re-roll Charge rolls and add 1 to Charge rolls. In melee, models can fight on death on a 4+.'
  },
  'Annihilation Protocol': {
    auto: 'full',
    desc: 'Destroyer Cult and Flayed Ones re-roll and get +1 to Charge rolls; 4+ fight on death in melee.'
  },
  'Canoptek Court': {
    auto: 'full',
    desc: 'Power Matrix: Cryptek and Canoptek models re-roll Hit rolls of 1 (or re-roll all Hit rolls if within the Power Matrix or within range of an objective you control).'
  },
  'Power Matrix': {
    auto: 'full',
    desc: 'Cryptek and Canoptek models re-roll Hit rolls of 1 (or all Hit rolls within Power Matrix / controlled objectives).'
  },
  'Obeisance Phalanx': {
    auto: 'full',
    desc: 'Worthy Foes: At the start of the battle, select one enemy unit. Overlord, Lychguard and Triarch units add 1 to Wound rolls against that enemy unit.'
  },
  'Worthy Foes': {
    auto: 'full',
    desc: '+1 to Wound rolls for Overlord, Lychguard, and Triarch units against the designated Worthy Foe.'
  },
  'Hypercrypt Legion': {
    auto: 'full',
    desc: 'Hyperphasing: At the end of your opponent’s turn, you can select up to 2 Necrons units (excluding units within Engagement Range) and place them into Strategic Reserves.'
  },
  'Hyperphasing': {
    auto: 'full',
    desc: 'Pick up to 2 units at end of opponent turn and place into Strategic Reserves.'
  },
  'Starshatter Arsenal': {
    auto: 'full',
    desc: 'Relentless Onslaught: Necrons Vehicle weapons have [LETHAL HITS] when targeting units within range of an objective marker.'
  },
  'Relentless Onslaught': {
    auto: 'full',
    desc: 'Necrons Vehicle weapons have [LETHAL HITS] against targets within range of an objective marker.'
  },
  'Cryptek Conclave': {
    auto: 'full',
    desc: 'Technosorcerous Augmentations: Cryptek models improve the invulnerable save of their unit to 5+ and critical hits score on 5+.'
  },
  'Technosorcerous Augmentations': {
    auto: 'full',
    desc: 'Cryptek units gain 5+ invulnerable save and Critical Hits on 5+.'
  },
  'Cursed Legion': {
    auto: 'full',
    desc: 'Cold Fervour: Flayed Ones and Destroyer Cult units gain +1 to Hit when targeting enemy units below Starting Strength.'
  },
  'Cold Fervour': {
    auto: 'full',
    desc: '+1 to Hit against below Starting Strength enemy units for Flayed Ones and Destroyer Cult.'
  },
  'Pantheon of Woe': {
    auto: 'full',
    desc: 'Cosmic Distortion: C’tan Shard models have a 4+ Feel No Pain against mortal wounds and their aura ranges are increased by 3".'
  },
  'Cosmic Distortion': {
    auto: 'full',
    desc: 'C’tan Shards gain 4+ Feel No Pain against mortal wounds and +3" aura ranges.'
  },
  'Hand of the Dynasty': {
    auto: 'full',
    desc: 'Hypermotility Protocols: Immortals and Necron Warriors ranged weapons have [ASSAULT] and can advance without failing action eligibility.'
  },
  'Hypermotility Protocols': {
    auto: 'full',
    desc: 'Immortals and Necron Warriors ranged attacks have [ASSAULT]; Advance moves do not prevent starting actions.'
  },
  'Skyshroud Spearhead': {
    auto: 'full',
    desc: 'Transdimensional Deployment: Tomb Blades units have Deep Strike and +1 to Hit on ranged attacks during the turn they arrive from Reserves.'
  },
  'Transdimensional Deployment': {
    auto: 'full',
    desc: 'Tomb Blades gain Deep Strike and +1 to Hit on ingress/reserves arrival turn.'
  },
  "The Phaeron's Armoury": {
    auto: 'full',
    desc: 'Empowered Engines: Necrons Titanic Fly units have +6" Move.'
  },
  'Empowered Engines': {
    auto: 'full',
    desc: 'Necrons Titanic Fly units have +6" Move.'
  }
};

for (const [name, rule] of Object.entries(necDetachments)) {
  data.rules[name] = rule;
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
console.log('Successfully updated detachment-rules.json with Necrons detachments!');

