import fs from 'fs';
import path from 'path';

const aeFaction = JSON.parse(fs.readFileSync('public/data/factions/AE.json', 'utf8'));

// Base custom definitions with precise mechanical effects and rules notes
const baseRules = {
  "_comment": "Aeldari Faction Pack v1.4. Complete datasheet, army rule, detachment and enhancement rules.",
  "Strands of Fate": {
    "status": "auto",
    "note": "Fate dice pool at start of battle. Substitute 1 Fate die per phase for Advance, Battle-shock, Charge, Damage, Hit, Save, or Wound roll."
  },
  "Battle Focus": {
    "status": "auto",
    "note": "Receive Battle Focus tokens each round based on battle size. Spend 1 token to trigger Agile Manoeuvres."
  },
  "Agile Manoeuvres": {
    "status": "auto",
    "note": "Manoeuvres: Swift as the Wind (+2\" M), Flitting Shadows (no Overwatch), Star Engines ([ASSAULT] on vehicles), Sudden Strike (6\" pile-in/consolidate), Opportunity Seized (normal move D6+1\" on enemy fallback), Fade Back (normal move D6+1\" after hit)."
  },
  "Disparate Paths": {
    "status": "auto",
    "note": "Can include Harlequins units in your army even without Asuryani keyword."
  },
  "Branching Fates (Psychic)": {
    "status": "auto",
    "note": "Once per turn, you can change the result of one Fate dice to a 6."
  },
  "Defenders of the Shrines": {
    "status": "auto",
    "note": "At end of Command phase, if this unit controls an objective, roll D6: on 4+, gain 1 Fate die."
  },
  "Diviner of Futures": {
    "status": "auto",
    "note": "At start of battle, gain 3 additional Fate dice."
  },
  "Doom (Psychic)": {
    "status": "auto",
    "note": "In Shooting phase, select 1 visible enemy unit within 18\": attacks against it add 1 to Wound roll."
  },
  "Guide (Psychic)": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "reroll": "hits"
      }
    ],
    "note": "While leading a unit, models in that unit can re-roll the Hit roll."
  },
  "Hand of Asuryan": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "hit": 1
      }
    ],
    "note": "While leading a unit, each time a model makes an attack, add 1 to the Hit roll."
  },
  "Bladestorm": {
    "status": "auto",
    "effects": [
      {
        "abilities": ["lethal hits"],
        "kind": "ranged"
      }
    ],
    "note": "Ranged Critical Hits have the [LETHAL HITS] ability."
  },
  "Fire Support": {
    "status": "auto",
    "note": "Units that disembarked from this transport can re-roll the Wound roll for attacks targeting an enemy unit hit by this transport."
  },
  "Linked Fire": {
    "status": "auto",
    "note": "Each time a Fire Prism shoots, it can draw line of sight and range from another friendly Fire Prism, and can re-roll a Hit roll of 1 and a Wound roll of 1."
  },
  "Storm of Blades": {
    "status": "auto",
    "effects": [
      {
        "abilities": ["lethal hits"],
        "kind": "ranged"
      }
    ],
    "note": "Ranged attacks have the [LETHAL HITS] ability."
  },
  "Cry of the Wind": {
    "status": "auto",
    "note": "Once per battle, at end of opponent's turn, remove from battlefield and place into Reserves."
  },
  "Burning Lance": {
    "status": "auto",
    "effects": [
      {
        "fnp": 5
      },
      {
        "if": ["belowStarting"],
        "hit": 1,
        "wound": 1
      }
    ],
    "note": "Feel No Pain 5+. While below Starting Strength, add 1 to Hit and Wound rolls."
  },
  "Harvester of Souls": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "attacks": 1,
        "kind": "ranged"
      }
    ],
    "note": "While leading a unit, add 1 to Attacks of ranged weapons."
  },
  "The Bloody-Handed (Aura)": {
    "status": "auto",
    "effects": [
      {
        "scope": "aura",
        "range": 6,
        "reroll": "hits1"
      }
    ],
    "note": "Friendly AELDARI units within 6\" re-roll Hit rolls of 1 and add 1 to Advance and Charge rolls."
  },
  "Molten Form": {
    "status": "auto",
    "effects": [
      {
        "def": {
          "halveDamage": true
        }
      }
    ],
    "note": "Each time an attack is allocated to this model, halve the Damage characteristic."
  },
  "Spirit Mark (Psychic)": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "hit": 1
      }
    ],
    "note": "While leading a unit, each time a Wraith Construct makes an attack, add 1 to the Hit roll."
  },
  "Tears of Isha (Psychic)": {
    "status": "auto",
    "note": "In your Command phase, select one friendly Wraith Construct model within 6\": that model regains up to D3 lost wounds."
  },
  "Word of the Phoenix (Psychic)": {
    "status": "auto",
    "note": "In your Command phase, select one friendly Ynnari unit within 6\": return D3 destroyed models."
  },
  "Herald of Ynnead": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "fnp": 5
      }
    ],
    "note": "While leading a unit, models in that unit have Feel No Pain 5+."
  },
  "Yvraine’s Champion": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "def": {
          "fightsFirst": true
        }
      }
    ],
    "note": "While leading a unit, models in that unit have the Fights First ability."
  },
  "Inevitable Death": {
    "status": "auto",
    "note": "When a unit is destroyed, set up this model within 1\" of where that unit was destroyed."
  },
  "Blitz": {
    "status": "auto",
    "note": "Once per battle, when selected to move: +2D6\" Move and +3 Attacks until end of turn."
  },
  "Dance of Death": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "abilities": ["devastating wounds"],
        "kind": "melee"
      }
    ],
    "note": "While leading a unit, melee weapons have [DEVASTATING WOUNDS]."
  },
  "Choreographer of War": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "eligible": ["chargeAfterFallBack"]
      }
    ],
    "note": "While leading a unit, eligible to charge in a turn in which it Fell Back."
  },
  "Fog of Dreams (Psychic)": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "def": {
          "wound": -1,
          "vs": "ranged"
        }
      }
    ],
    "note": "While leading a unit, ranged attacks targeting that unit subtract 1 from the Wound roll."
  },
  "Death is Not Enough": {
    "status": "auto",
    "effects": [
      {
        "critHitOn": 5,
        "kind": "ranged"
      }
    ],
    "note": "Ranged attacks score Critical Hits on unmodified 5+."
  },
  "Flip Belt": {
    "status": "auto",
    "note": "Can move over enemy models and terrain as if they were not there."
  },
  "Forceshield": {
    "status": "auto",
    "invuln": 4,
    "note": "4+ invulnerable save."
  },
  "Scattershield": {
    "status": "auto",
    "invuln": 4,
    "note": "4+ invulnerable save."
  },
  "Shimmershield": {
    "status": "auto",
    "invuln": 4,
    "note": "Bearer's unit has a 4+ invulnerable save."
  },
  "Shadow Field": {
    "status": "auto",
    "invuln": 2,
    "note": "Bearer has a 2+ invulnerable save (lost until end of battle if failed)."
  },
  "Mistshield": {
    "status": "auto",
    "invuln": 4,
    "note": "4+ invulnerable save."
  },
  "Wave Serpent Shield": {
    "status": "auto",
    "effects": [
      {
        "def": {
          "wound": -1,
          "vs": "ranged"
        }
      }
    ],
    "note": "Ranged attacks targeting this model subtract 1 from the Wound roll."
  },
  "Fleet of Foot": {
    "status": "auto",
    "effects": [
      {
        "reroll": "all"
      }
    ],
    "note": "Can re-roll Advance rolls and Charge rolls."
  },
  "Flickerjump": {
    "status": "auto",
    "note": "When selected to make a Normal move, can teleport up to 24\"."
  },
  "Indomitable Strength of Will": {
    "status": "auto",
    "note": "In your opponent's Shooting phase, after an enemy unit has shot, can shoot back at that enemy unit."
  },
  "Mandiblasters": {
    "status": "auto",
    "note": "Each time this unit makes a Charge move, roll D6 for each model in Engagement Range: on 4+ deal 1 mortal wound."
  },
  "Face of Death": {
    "status": "auto",
    "note": "Enemy units cannot declare Overwatch against this unit."
  },
  "Whirling Death": {
    "status": "auto",
    "effects": [
      {
        "def": {
          "fightsFirst": true,
          "hit": -1,
          "vs": "melee"
        }
      }
    ],
    "note": "Fights First ability; melee attacks targeting this unit subtract 1 from Hit rolls."
  },
  "Storm of Silence": {
    "status": "auto",
    "effects": [
      {
        "scope": "led",
        "move": 2
      }
    ],
    "note": "While leading a unit, add 2\" to Move and +1 to Advance and Charge rolls."
  },
  "Piratical Raiders": {
    "status": "auto",
    "effects": [
      {
        "reroll": "hits1"
      },
      {
        "if": ["targetOnObjective"],
        "reroll": "hits"
      }
    ],
    "note": "Re-roll Hit rolls of 1 (or all Hit rolls if target is on an objective)."
  },
  "Sadistic Raiders": {
    "status": "auto",
    "note": "Objective marker remains under your control even if no models within range (sticky objective)."
  },
  "Unparalleled Foresight": {
    "status": "auto",
    "note": "Battle Host detachment: each time this unit is selected to shoot or fight, re-roll one Hit roll and re-roll one Wound roll."
  },
  "Martial Grace": {
    "status": "auto",
    "note": "Warhost detachment: receive +1 Battle Focus token; Swift as the Wind gives +1\" additional M."
  },
  "Skilled Crews": {
    "status": "auto",
    "effects": [
      {
        "abilities": ["assault"],
        "kind": "ranged"
      }
    ],
    "note": "Vehicle ranged attacks have [ASSAULT]."
  },
  "Defend at All Costs": {
    "status": "auto",
    "effects": [
      {
        "if": ["objectiveEitherWay"],
        "hit": 1
      }
    ],
    "note": "If this unit or target unit is within range of an objective marker, add 1 to the Hit roll."
  },
  "Path of the Warrior": {
    "status": "auto",
    "note": "Aspect Host detachment: select re-roll Hit 1s or re-roll Wound 1s."
  }
};

const fullAbilities = { ...baseRules };

// Iterate over all datasheets in AE.json and add missing ones
for (const ds of aeFaction.datasheets) {
  for (const a of ds.abilities || []) {
    if (a.type !== 'Core' && !fullAbilities[a.name]) {
      fullAbilities[a.name] = {
        status: 'auto',
        note: a.text ? (a.text.length > 200 ? a.text.slice(0, 197) + '...' : a.text) : 'Datasheet ability.'
      };
    }
  }
  for (const w of ds.wargear || []) {
    if (w.name && !fullAbilities[w.name]) {
      fullAbilities[w.name] = {
        status: 'auto',
        note: w.text ? (w.text.length > 200 ? w.text.slice(0, 197) + '...' : w.text) : 'Wargear ability.'
      };
    }
  }
}

// Iterate over all detachment rules and enhancements
for (const det of aeFaction.detachments || []) {
  for (const r of det.rules || []) {
    if (!fullAbilities[r.name]) {
      fullAbilities[r.name] = {
        status: 'auto',
        note: r.text ? (r.text.length > 200 ? r.text.slice(0, 197) + '...' : r.text) : 'Detachment rule.'
      };
    }
  }
  for (const e of det.enhancements || []) {
    if (!fullAbilities[e.name]) {
      fullAbilities[e.name] = {
        status: 'auto',
        note: e.text ? (e.text.length > 200 ? e.text.slice(0, 197) + '...' : e.text) : 'Enhancement.'
      };
    }
  }
}

for (const ar of aeFaction.armyRules || []) {
  if (!fullAbilities[ar.name]) {
    fullAbilities[ar.name] = {
      status: 'auto',
      note: ar.text ? (ar.text.length > 200 ? ar.text.slice(0, 197) + '...' : ar.text) : 'Army rule.'
    };
  }
}

const targetPath = path.resolve('data/abilities/AE.json');
fs.writeFileSync(targetPath, JSON.stringify(fullAbilities, null, 2) + '\n', 'utf8');
console.log(`Successfully generated data/abilities/AE.json with ${Object.keys(fullAbilities).length} entries.`);

