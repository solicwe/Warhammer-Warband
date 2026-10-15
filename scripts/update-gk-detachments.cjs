const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'data', 'detachment-rules.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

data.rules = data.rules || {};

const gkDetachments = {
  'Teleport Assault': {
    auto: 'full',
    armyRule: true,
    desc: 'At the end of your opponent’s turn, select up to N Grey Knights units (Incursion: 2, Strike Force: 3, Onslaught: 4) and place them into Strategic Reserves. In your next Movement phase, they can arrive via Deep Strike.'
  },
  'Teleport Strike Force': {
    auto: 'full',
    desc: 'Teleport Shunt: Each time a Grey Knights unit with Teleport Assault Advances, until the end of the phase it can Fly and is eligible to shoot and charge.'
  },
  'Teleport Shunt': {
    auto: 'full',
    desc: 'Advance moves grant Fly and do not prevent shooting or charging.'
  },
  'Warpbane Task Force': {
    auto: 'full',
    desc: 'Hallowed Ground: While a friendly Grey Knights unit is within range of an objective marker you control or wholly within your territory, improve its invulnerable save by 1 (to a max of 4+) and add 1 to Hit rolls.'
  },
  'Hallowed Ground': {
    auto: 'full',
    desc: '+1 to Hit rolls and improved invulnerable save while on controlled objectives or in own territory.'
  },
  'Brotherhood Strike': {
    auto: 'full',
    desc: 'Fury of Titan: Brotherhood Terminator and Paladin Squad models re-roll Hit rolls of 1.'
  },
  'Fury of Titan': {
    auto: 'full',
    desc: 'Brotherhood Terminator and Paladin models re-roll Hit rolls of 1.',
    effects: [
      { units: ['kw:TERMINATOR'], attack: { rerollHits1: true } }
    ]
  },
  'Hallowed Conclave': {
    auto: 'full',
    desc: 'Duty Before All: Grey Knights Character models gain +1 Attack to melee weapons and +1 to Objective Control.'
  },
  'Duty Before All': {
    auto: 'full',
    desc: 'Character models gain +1 Melee Attack and +1 OC.'
  },
  'Banishers': {
    auto: 'full',
    desc: 'Channelled Force: Melee weapons equipped by Grey Knights models gain [LETHAL HITS]. In addition, against Daemon and Psyker units, add 1 to the Damage characteristic.'
  },
  'Channelled Force': {
    auto: 'full',
    desc: 'Melee weapons have [LETHAL HITS]; +1 Damage against Daemon and Psyker targets.'
  },
  'Sanctic Spearhead': {
    auto: 'full',
    desc: 'Mailed Fist: Nemesis Dreadknight models add 1 to the Damage characteristic of melee attacks during the turn they charged.'
  },
  'Mailed Fist': {
    auto: 'full',
    desc: '+1 Damage to Nemesis Dreadknight melee attacks on the turn they charged.'
  },
  'Augurium Task Force': {
    auto: 'full',
    desc: 'Prescient Redeployment: After determining who has the first turn, you can redeploy up to 3 Grey Knights units.'
  },
  'Prescient Redeployment': {
    auto: 'full',
    desc: 'Redeploy up to 3 units after first turn is determined.'
  },
  'Argent Assault': {
    auto: 'full',
    desc: 'Dauntless Champions: When a Paladin Squad is selected to fight, if Strength is lower than target Toughness, add 1 to Wound rolls.'
  },
  'Dauntless Champions': {
    auto: 'full',
    desc: 'Paladin Squad models get +1 to Wound when Strength < target Toughness.'
  },
  'Fires of Purgation': {
    auto: 'full',
    desc: 'Searing Soulflame: When a Purgation Squad pins an enemy unit, that enemy makes a Battle-shock test with a -1 modifier.'
  },
  'Searing Soulflame': {
    auto: 'full',
    desc: 'Pinned units test Battle-shock at -1.'
  },
  'Immaterial Interdiction': {
    auto: 'full',
    desc: 'Echojump: After shooting, an Interceptor Squad can make a D6" surge move.'
  },
  'Echojump': {
    auto: 'full',
    desc: 'Interceptor Squads can make a D6" surge move after shooting.'
  }
};

for (const [name, rule] of Object.entries(gkDetachments)) {
  data.rules[name] = rule;
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
console.log('Successfully updated detachment-rules.json with Grey Knights detachments!');

