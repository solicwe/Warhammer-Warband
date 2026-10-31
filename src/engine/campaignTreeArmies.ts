// The army's second and third branches of the campaign tree (docs/04-campaign-tree.md): one pair per army, on that
// army's own keywords. The notable at depth 6 and the keystone are written by hand for each army; the small nodes come
// from a style (guns, blades, walls, speed, war engines) so every army gets a full branch without a thousand lines.
import type { Effect } from '../rules-engine/effects';
import type { Branch, Spec } from './campaignTree';

const s = (name: string, text: string, units: string | undefined, e: Effect | Effect[]): Spec => ({ name, text, units, e });
const R = (e: Effect, round: 'early' | 'late'): Effect => ({ ...e, if: [...(e.if ?? []), round === 'early' ? '!roundAtLeast:3' : 'roundAtLeast:3'] });

type Style = 'gun' | 'blade' | 'wall' | 'storm' | 'engine';
/** one small node of a style: its name after the keyword, what it does, and the effect */
type Move = [string, string, Effect];

const MOVES: Record<Style, Move[]> = {
  gun: [
    ['Fire Drill', 'ranged attacks re-roll Hit rolls of 1', { reroll: 'hits1', attack: 'ranged' }],
    ['Hot Rounds', 'ranged weapons: +1 Strength', { strength: 1, attack: 'ranged' }],
    ['Marksmen', 'ranged weapons: +1 Ballistic Skill', { skill: 1, attack: 'ranged' }],
    ['Range Finders', 'ranged weapons: +3" Range', { rangeBonus: 3, attack: 'ranged' }],
    ['Spotter Teams', 'ranged attacks re-roll Wound rolls of 1', { reroll: 'wounds1', attack: 'ranged' }],
    ['Hail of Fire', 'ranged weapons have [SUSTAINED HITS 1]', { abilities: ['sustained hits 1'], attack: 'ranged' }],
    ['Tracer Fire', 'ranged weapons have [IGNORES COVER]', { abilities: ['ignores cover'], attack: 'ranged' }],
    ['Firing Line', 'after Remaining Stationary: +1 to Hit with ranged attacks', { hit: 1, attack: 'ranged', if: ['stationary'] }],
    ['Opening Volley', 'rounds 1-2: ranged weapons have [LETHAL HITS]', R({ abilities: ['lethal hits'], attack: 'ranged' }, 'early')],
    ['Tank Killers', 'ranged attacks against MONSTER or VEHICLE units: +1 AP', { ap: 1, attack: 'ranged', if: ['targetMV'] }],
    ['Crossfire', 'ranged attacks against INFANTRY units: +1 AP', { ap: 1, attack: 'ranged', if: ['targetInfantry'] }],
    ['Last Magazine', 'from round 3: ranged attacks +1 to Wound', R({ wound: 1, attack: 'ranged' }, 'late')],
    ['Finishing Shots', 'ranged attacks against a unit below Starting Strength: +1 to Wound', { wound: 1, attack: 'ranged', if: ['targetBelowStarting'] }],
    ['Gun Discipline', 're-roll Battle-shock tests', { rerollShock: true }],
  ],
  blade: [
    ['Blade Drill', 'melee attacks re-roll Hit rolls of 1', { reroll: 'hits1', attack: 'melee' }],
    ['Honed Edges', 'melee weapons: +1 Strength', { strength: 1, attack: 'melee' }],
    ['Frenzy', 'after charging: +1 Attack in melee', { attacks: 1, attack: 'melee', if: ['charged'] }],
    ['Charge Drill', '+1 to Charge rolls', { chargeBonus: 1 }],
    ['Butchery', 'melee attacks re-roll Wound rolls of 1', { reroll: 'wounds1', attack: 'melee' }],
    ['Whirling Blades', 'melee weapons have [SUSTAINED HITS 1]', { abilities: ['sustained hits 1'], attack: 'melee' }],
    ['Headhunters', 'melee weapons have [PRECISION]', { abilities: ['precision'], attack: 'melee' }],
    ['Killing Blows', 'melee weapons have [LETHAL HITS]', { abilities: ['lethal hits'], attack: 'melee' }],
    ['First Blood', 'rounds 1-2: melee attacks +1 to Wound', R({ wound: 1, attack: 'melee' }, 'early')],
    ['Gutting Strikes', 'melee attacks against INFANTRY units: +1 AP', { ap: 1, attack: 'melee', if: ['targetInfantry'] }],
    ['Giant Slayers', 'melee attacks against MONSTER or VEHICLE units: +1 Strength', { strength: 1, attack: 'melee', if: ['targetMV'] }],
    ['Endless Fury', 'from round 3: +1 Attack in melee', R({ attacks: 1, attack: 'melee' }, 'late')],
    ['Bloody Momentum', 'after charging: melee attacks +1 to Wound', { wound: 1, attack: 'melee', if: ['charged'] }],
    ['Pursuit', 're-roll Charge rolls', { rerollCharge: true }],
  ],
  wall: [
    ['Plating', 'Feel No Pain 6+', { defend: { fnp: 6 } }],
    ['Bulk', '+1 Toughness', { toughness: 1 }],
    ['Hunker Down', 'in a terrain area: +1 to saving throws', { defend: { save: 1 }, if: ['inTerrain'] }],
    ['Wards', 'Feel No Pain 5+ against mortal wounds', { defend: { fnp: 5, fnpVs: 'mortal' } }],
    ['Shroud', 'ranged attacks against them: -1 to Hit', { defend: { hit: -1, vs: 'ranged' } }],
    ['Last Stand', 'below Half-strength: Feel No Pain 5+', { defend: { fnp: 5 }, if: ['belowHalfStrength'] }],
    ['Shield Wall', 'on an objective: +1 to saving throws', { defend: { save: 1 }, if: ['onObjective'] }],
    ['Unyielding', 're-roll Battle-shock tests', { rerollShock: true }],
    ['Grim Resolve', '+1 Leadership', { ld: 1 }],
    ['Bracing', 'rounds 1-2: ranged attacks against them -1 to Hit', R({ defend: { hit: -1, vs: 'ranged' } }, 'early')],
    ['Ablative Layers', 'below Half-strength: +1 to saving throws', { defend: { save: 1 }, if: ['belowHalfStrength'] }],
    ['Holdfast', '+1 OC', { oc: 1 }],
    ['Long Watch', 'from round 3: Feel No Pain 6+', R({ defend: { fnp: 6 } }, 'late')],
    ['Stand Guard', 'on an objective: Feel No Pain 6+', { defend: { fnp: 6 }, if: ['onObjective'] }],
  ],
  storm: [
    ['Swift', '+1" Move', { move: 1 }],
    ['Sprint', '+1 to Advance rolls', { advanceBonus: 1 }],
    ['Pounce', '+1 to Charge rolls', { chargeBonus: 1 }],
    ['Outrunners', 're-roll Advance rolls', { rerollAdvance: true }],
    ['Run Them Down', 're-roll Charge rolls', { rerollCharge: true }],
    ['Jink', 'ranged attacks against them: -1 to Hit', { defend: { hit: -1, vs: 'ranged' } }],
    ['Vanguard', 'rounds 1-2: +2" Move', R({ move: 2 }, 'early')],
    ['Hit and Fade', 'after charging: melee attacks +1 to Wound', { wound: 1, attack: 'melee', if: ['charged'] }],
    ['Fleet', '+2" Move', { move: 2 }],
    ['Strike First', 'after charging: melee attacks re-roll Hit rolls of 1', { reroll: 'hits1', attack: 'melee', if: ['charged'] }],
    ['Raiders', '+1 OC', { oc: 1 }],
    ['Skirmish Fire', 'ranged attacks re-roll Hit rolls of 1', { reroll: 'hits1', attack: 'ranged' }],
    ['Late Surge', 'from round 3: +1" Move and +1 OC', R({ move: 1, oc: 1 }, 'late')],
    ['Harriers', 'ranged weapons: +3" Range', { rangeBonus: 3, attack: 'ranged' }],
  ],
  engine: [
    ['Reinforced Hulls', '+1 Toughness', { toughness: 1 }],
    ['Machine Spirits', 'ranged attacks re-roll Hit rolls of 1', { reroll: 'hits1', attack: 'ranged' }],
    ['Heavy Calibre', 'ranged weapons: +1 Strength', { strength: 1, attack: 'ranged' }],
    ['Crew Drill', 'Feel No Pain 6+', { defend: { fnp: 6 } }],
    ['Overdrive', '+2" Move', { move: 2 }],
    ['Siege Shells', 'ranged attacks against MONSTER or VEHICLE units: +1 AP', { ap: 1, attack: 'ranged', if: ['targetMV'] }],
    ['Crushing Weight', 'melee weapons: +1 Strength', { strength: 1, attack: 'melee' }],
    ['Targeting Arrays', 'ranged weapons: +1 Ballistic Skill', { skill: 1, attack: 'ranged' }],
    ['Armour Belts', 'Feel No Pain 5+ against mortal wounds', { defend: { fnp: 5, fnpVs: 'mortal' } }],
    ['Long Guns', 'ranged weapons: +4" Range', { rangeBonus: 4, attack: 'ranged' }],
    ['Rolling Thunder', 'rounds 1-2: ranged weapons have [SUSTAINED HITS 1]', R({ abilities: ['sustained hits 1'], attack: 'ranged' }, 'early')],
    ['Grinding Advance', '+1 OC', { oc: 1 }],
    ['Smoke Launchers', 'ranged attacks against them: -1 to Hit', { defend: { hit: -1, vs: 'ranged' } }],
    ['Last Salvo', 'from round 3: ranged attacks +1 to Wound', R({ wound: 1, attack: 'ranged' }, 'late')],
  ],
};

/** Tree v3: army-wide nodes that lengthen a kit's depth-5 cluster, small or conditional (the corps takes the first
 *  three of its style, the arsenal the last three, so an army with one style twice gets no name twice) */
const WIDE: Record<Style, Spec[]> = {
  gun: [
    s('Gunline Doctrine', 'Units that Remained Stationary re-roll ranged Hit rolls of 1.', undefined, { reroll: 'hits1', attack: 'ranged', if: ['stationary'] }),
    s('Ammunition Train', 'Every unit: ranged weapons +2" Range.', undefined, { rangeBonus: 2, attack: 'ranged' }),
    s('Fire Superiority', 'Rounds 1-2: ranged attacks re-roll Wound rolls of 1.', undefined, R({ reroll: 'wounds1', attack: 'ranged' }, 'early')),
    s('Concentrated Fire', 'Ranged attacks against a unit below its Starting Strength re-roll Wound rolls of 1.', undefined, { reroll: 'wounds1', attack: 'ranged', if: ['targetBelowStarting'] }),
    s('Overwatch Drills', 'Units on an objective re-roll ranged Hit rolls of 1.', undefined, { reroll: 'hits1', attack: 'ranged', if: ['onObjective'] }),
    s('Final Volleys', 'From round 3: ranged attacks re-roll Hit rolls of 1.', undefined, R({ reroll: 'hits1', attack: 'ranged' }, 'late')),
  ],
  blade: [
    s('War Cries', 'Rounds 1-2: +1 to Charge rolls.', undefined, R({ chargeBonus: 1 }, 'early')),
    s('Cut Them Down', 'Melee attacks against INFANTRY units re-roll Wound rolls of 1.', undefined, { reroll: 'wounds1', attack: 'melee', if: ['targetInfantry'] }),
    s('Duel to the Death', 'Units led by a CHARACTER re-roll melee Wound rolls of 1.', undefined, { reroll: 'wounds1', attack: 'melee', if: ['attached'] }),
    s('Into the Fray', 'Rounds 1-2: every unit re-rolls Charge rolls.', undefined, R({ rerollCharge: true }, 'early')),
    s('Melee Masters', 'From round 3: melee attacks re-roll Hit rolls of 1.', undefined, R({ reroll: 'hits1', attack: 'melee' }, 'late')),
    s('Blood Price', 'Units below Half-strength: melee weapons +1 Strength.', undefined, { strength: 1, attack: 'melee', if: ['belowHalfStrength'] }),
  ],
  wall: [
    s('Iron Line', 'Units on an objective: Feel No Pain 6+ against mortal wounds.', undefined, { defend: { fnp: 6, fnpVs: 'mortal' }, if: ['onObjective'] }),
    s('Weather the Storm', 'Rounds 1-2: Feel No Pain 6+.', undefined, R({ defend: { fnp: 6 } }, 'early')),
    s('Guardians', 'Units led by a CHARACTER: +1 to saving throws against ranged attacks.', undefined, { defend: { save: 1, vs: 'ranged' }, if: ['attached'] }),
    s('Deep Reserves', 'Units below Half-strength re-roll Battle-shock tests and get +1 OC.', undefined, { rerollShock: true, oc: 1, if: ['belowHalfStrength'] }),
    s('Fortitude', 'Every unit: +1 Leadership.', undefined, { ld: 1 }),
    s('Bulwark Line', 'Units in a terrain area: ranged attacks against them -1 to Hit.', undefined, { defend: { hit: -1, vs: 'ranged' }, if: ['inTerrain'] }),
  ],
  storm: [
    s('Rapid Deployment', 'Rounds 1-2: every unit +1" Move.', undefined, R({ move: 1 }, 'early')),
    s('Flanking Speed', 'Units below their Starting Strength re-roll Charge rolls.', undefined, { rerollCharge: true, if: ['belowStartingStrength'] }),
    s('Strike Fast', 'Units led by a CHARACTER: +1 to Advance rolls.', undefined, { advanceBonus: 1, if: ['attached'] }),
    s('Harass', 'From round 3: +1 to Advance rolls.', undefined, R({ advanceBonus: 1 }, 'late')),
    s('Ambush Drills', 'Units in a terrain area: +1 to Charge rolls.', undefined, { chargeBonus: 1, if: ['inTerrain'] }),
    s('Mobile Reserve', 'Units on an objective: +2" Move.', undefined, { move: 2, if: ['onObjective'] }),
  ],
  engine: [
    s('Field Workshops', 'Units below their Starting Strength: +1 to saving throws.', undefined, { defend: { save: 1 }, if: ['belowStartingStrength'] }),
    s('Target Priority', 'Ranged attacks against MONSTER or VEHICLE units re-roll Hit rolls of 1.', undefined, { reroll: 'hits1', attack: 'ranged', if: ['targetMV'] }),
    s('Combined Assault', 'Units led by a CHARACTER re-roll ranged Wound rolls of 1.', undefined, { reroll: 'wounds1', attack: 'ranged', if: ['attached'] }),
    s('Thunderous Advance', 'Rounds 1-2: ranged weapons +1 Strength.', undefined, R({ strength: 1, attack: 'ranged' }, 'early')),
    s('Armoured Spearhead', 'Units that charged this turn: +1 to saving throws.', undefined, { defend: { save: 1 }, if: ['charged'] }),
    s('Siege Lines', 'Units that Remained Stationary: ranged attacks against them -1 to Hit.', undefined, { defend: { hit: -1, vs: 'ranged' }, if: ['stationary'] }),
  ],
};

const title = (k: string) => k.toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());

/** what a branch needs from an army: its keywords (k[0] the core, k[1] and k[2] the others), the depth-6 notable with its
 *  6-node bonus, and the keystone */
interface Kit { name: string; about: string; style: Style; k: [string, string, string]; notable: Spec; keystone?: Spec }

/** A whole branch from a kit: 7 nodes on the main line and side clusters of 3, 6 and 3. */
function build(id: string, kit: Kit, keystone: Spec, wide: number): Branch {
  const m = MOVES[kit.style];
  const node = (ki: number, mi: number): Spec => {
    const kw = kit.k[ki], [noun, text, e] = m[mi];
    return s(`${title(kw)} ${noun}`, `${kw}: ${text}.`, kw, e);
  };
  return {
    id, name: kit.name, about: kit.about,
    main: [node(0, 0), node(1, 1), node(0, 2), node(2, 3), node(1, 4), kit.notable, keystone],
    sideA: [node(0, 5), node(1, 6), node(2, 7)],
    sideB: [node(2, 8), node(0, 9), node(1, 10), ...WIDE[kit.style].slice(wide, wide + 3)],
    sideC: [node(1, 11), node(2, 12), node(0, 13)],
  };
}

const bonus = (count: number, text: string, e: Effect) => ({ count, text, e });

/** the titan keystone of an army that can field titanic units or Knights: its name and the units it opens */
const titan = (name: string, what: string): Spec => ({ name, text: `Keystone. ${what} can be recruited. -20 Scrap after every won battle.`, titan: true, scrap: -20 });
const QUESTOR = titan('Questor Oath', 'Imperial Knights and other TITANIC allies');
const DREAD_PACT = titan('Dread Pact', 'Chaos Knights and other TITANIC allies');

/** each army's two extra branches (corps, arsenal), and its titan keystone if it can field any */
export const ARMY_KITS: Record<string, { corps: Kit; arsenal: Kit; titan?: Spec }> = {
  SM: {
    corps: { name: 'Veteran Companies', about: 'Terminators, Gravis and Dreadnoughts: durable veterans that hit hard up close. Keystone: TERMINATOR re-roll all Wound rolls in melee.', style: 'wall', k: ['TERMINATOR', 'GRAVIS', 'DREADNOUGHT'],
      notable: { ...s('Crux Terminatus', 'TERMINATOR: Feel No Pain 5+.', 'TERMINATOR', { defend: { fnp: 5 } }), bonus: bonus(6, 'With 6 branch nodes: GRAVIS +1 Toughness.', { toughness: 1 }) },
      keystone: s('First Company', 'Keystone. TERMINATOR melee attacks re-roll Wound rolls; every TERMINATOR unit -1" Move.', 'TERMINATOR', [{ reroll: 'wounds', attack: 'melee' }, { move: -1 }]) },
    arsenal: { name: 'Strike Elements', about: 'Jump packs, Phobos infiltrators and fast attack: hit first, hit where it hurts.', style: 'storm', k: ['JUMP PACK', 'PHOBOS', 'MOUNTED'],
      notable: { ...s('Death From the Skies', 'JUMP PACK: after charging, +1 Attack in melee.', 'JUMP PACK', { attacks: 1, attack: 'melee', if: ['charged'] }), bonus: bonus(6, 'With 6 branch nodes: PHOBOS ranged weapons have [PRECISION].', { abilities: ['precision'], attack: 'ranged' }) } },
    titan: titan('Knights and Gunships', 'Thunderhawks, Imperial Knights and other TITANIC units'),
  },
  AM: {
    corps: { name: 'Regiments', about: 'Line infantry by the hundred: orders, volleys and lasguns that do not stop.', style: 'gun', k: ['REGIMENT', 'PLATOON', 'MILITARUM TEMPESTUS'],
      notable: { ...s('First Rank, Fire!', 'REGIMENT: ranged weapons have [SUSTAINED HITS 1] after Remaining Stationary.', 'REGIMENT', { abilities: ['sustained hits 1'], attack: 'ranged', if: ['stationary'] }), bonus: bonus(6, 'With 6 branch nodes: PLATOON +1 OC.', { oc: 1 }) },
      keystone: s('Expendable', 'Keystone. INFANTRY: +1 OC and re-roll Battle-shock tests; -1 Toughness.', 'INFANTRY', [{ oc: 1, rerollShock: true }, { toughness: -1 }]) },
    arsenal: { name: 'Armoured Company', about: 'Tank squadrons and artillery: the hammer of the Imperial Guard.', style: 'engine', k: ['SQUADRON', 'ARTILLERY', 'VEHICLE'],
      notable: { ...s('Hull-down Gunners', 'SQUADRON: after Remaining Stationary, +1 to Hit with ranged attacks.', 'SQUADRON', { hit: 1, attack: 'ranged', if: ['stationary'] }), bonus: bonus(6, 'With 6 branch nodes: ARTILLERY ranged weapons +1 Damage.', { damage: 1, attack: 'ranged' }) } },
    titan: titan('Super-heavy Requisition', 'Baneblades and other TITANIC units'),
  },
  AS: {
    corps: { name: 'Orders Militant', about: 'Battle Sisters and Celestians: faith, bolters and holy fire.', style: 'gun', k: ['BATTLELINE', 'CELESTIAN', 'CANONESS'],
      notable: { ...s('Acts of Faith', 'BATTLELINE: Feel No Pain 6+ and ranged attacks re-roll Wound rolls of 1.', 'BATTLELINE', [{ defend: { fnp: 6 } }, { reroll: 'wounds1', attack: 'ranged' }]), bonus: bonus(6, 'With 6 branch nodes: those units also +1 to saving throws.', { defend: { save: 1 } }) },
      keystone: s('Martyrdom', 'Keystone. INFANTRY below Half-strength: +1 to Hit and +1 to Wound; -1 OC.', 'INFANTRY', [{ hit: 1, wound: 1, if: ['belowHalfStrength'] }, { oc: -1 }]) },
    arsenal: { name: 'Penitent Engines', about: 'Penitents, Repentia and Seraphim: the redemptive charge.', style: 'blade', k: ['PENITENT', 'JUMP PACK', 'VEHICLE'],
      notable: { ...s('Engines of Redemption', 'PENITENT: after charging, melee weapons +1 Damage.', 'PENITENT', { damage: 1, attack: 'melee', if: ['charged'] }), bonus: bonus(6, 'With 6 branch nodes: JUMP PACK re-roll Charge rolls.', { rerollCharge: true }) } },
    titan: QUESTOR,
  },
  AC: {
    corps: { name: 'Shield Host', about: 'Custodian Guard and Terminators: the Emperor\'s chosen, one blade at a time.', style: 'blade', k: ['INFANTRY', 'TERMINATOR', 'CHARACTER'],
      notable: { ...s('Martial Ka\'tah', 'INFANTRY melee weapons have [LETHAL HITS] after charging.', 'INFANTRY', { abilities: ['lethal hits'], attack: 'melee', if: ['charged'] }), bonus: bonus(6, 'With 6 branch nodes: CHARACTER melee weapons +1 Damage.', { damage: 1, attack: 'melee' }) },
      keystone: s('Ten Thousand', 'Keystone. INFANTRY: +1 Attack in melee; -1 OC.', 'INFANTRY', [{ attacks: 1, attack: 'melee' }, { oc: -1 }]) },
    arsenal: { name: 'Talons and Sisters', about: 'Sisters of Silence, Dreadnoughts and grav-tanks.', style: 'engine', k: ['ANATHEMA PSYKANA', 'DREADNOUGHT', 'VEHICLE'],
      notable: { ...s('Null Maidens', 'ANATHEMA PSYKANA: Feel No Pain 4+ against mortal wounds and psychic attacks.', 'ANATHEMA PSYKANA', { defend: { fnp: 4, fnpVs: 'mortalPsychic' } }), bonus: bonus(6, 'With 6 branch nodes: DREADNOUGHT +1 Toughness.', { toughness: 1 }) } },
    titan: QUESTOR,
  },
  AdM: {
    corps: { name: 'Skitarii Legions', about: 'Skitarii, Sicarians and Pteraxii: precise, augmented troops.', style: 'gun', k: ['SKITARII', 'SICARIAN', 'PTERAXII'],
      notable: { ...s('Doctrina Imperatives', 'SKITARII: ranged weapons +1 AP after Remaining Stationary.', 'SKITARII', { ap: 1, attack: 'ranged', if: ['stationary'] }), bonus: bonus(6, 'With 6 branch nodes: SICARIAN melee weapons +1 Damage.', { damage: 1, attack: 'melee' }) },
      keystone: s('Protector Protocols', 'Keystone. SKITARII ranged attacks +1 to Hit; -2" Move.', 'SKITARII', [{ hit: 1, attack: 'ranged' }, { move: -2 }]) },
    arsenal: { name: 'Cult Mechanicus', about: 'Tech-priests, Kataphron servitors and the war-robots of the Legio Cybernetica.', style: 'engine', k: ['CULT MECHANICUS', 'KATAPHRON', 'LEGIO CYBERNETICA'],
      notable: { ...s('Binharic Litanies', 'CULT MECHANICUS: Feel No Pain 5+.', 'CULT MECHANICUS', { defend: { fnp: 5 } }), bonus: bonus(6, 'With 6 branch nodes: LEGIO CYBERNETICA +1 Attack in melee.', { attacks: 1, attack: 'melee' }) } },
    titan: QUESTOR,
  },
  AE: {
    corps: { name: 'Aspect Shrines', about: 'Aspect Warriors and Phoenix Lords: one perfect way of war each.', style: 'blade', k: ['ASPECT WARRIORS', 'PHOENIX LORD', 'JUMP PACK'],
      notable: { ...s('Path of the Warrior', 'ASPECT WARRIORS: melee weapons have [LETHAL HITS].', 'ASPECT WARRIORS', { abilities: ['lethal hits'], attack: 'melee' }), bonus: bonus(6, 'With 6 branch nodes: PHOENIX LORD +1 Attack.', { attacks: 1 }) },
      keystone: s('Battle Focus', 'Keystone. INFANTRY: +2" Move and re-roll Advance rolls; -1 Toughness.', 'INFANTRY', [{ move: 2, rerollAdvance: true }, { toughness: -1 }]) },
    arsenal: { name: 'Wraith Host', about: 'Wraithguard, Guardians and grav-tanks: the craftworld\'s walls.', style: 'wall', k: ['WRAITH CONSTRUCT', 'GUARDIANS', 'VEHICLE'],
      notable: { ...s('Spirit Stones', 'WRAITH CONSTRUCT: +1 Toughness.', 'WRAITH CONSTRUCT', { toughness: 1 }), bonus: bonus(6, 'With 6 branch nodes: those units also Feel No Pain 6+.', { defend: { fnp: 6 } }) } },
    titan: titan('Wraithknight Awakening', 'Wraithknights'),
  },
  CD: {
    corps: { name: 'Blood and Excess', about: 'Bloodletters and Daemonettes: Khorne\'s fury and Slaanesh\'s speed.', style: 'blade', k: ['KHORNE', 'SLAANESH', 'MONSTER'],
      notable: { ...s('Skulls for the Throne', 'KHORNE: after charging, +1 Attack and +1 Strength in melee.', 'KHORNE', { attacks: 1, strength: 1, attack: 'melee', if: ['charged'] }), bonus: bonus(6, 'With 6 branch nodes: SLAANESH +2" Move.', { move: 2 }) },
      keystone: s('Unchecked Slaughter', 'Keystone. Melee weapons have [LETHAL HITS]; every unit -1 to saving throws.', undefined, [{ abilities: ['lethal hits'], attack: 'melee' }, { defend: { save: -1 } }]) },
    arsenal: { name: 'Change and Decay', about: 'Horrors and Plaguebearers: warpfire and festering endurance.', style: 'wall', k: ['NURGLE', 'TZEENTCH', 'DAEMON'],
      notable: { ...s('Rotting Resilience', 'NURGLE: Feel No Pain 5+.', 'NURGLE', { defend: { fnp: 5 } }), bonus: bonus(6, 'With 6 branch nodes: TZEENTCH ranged weapons +1 Damage.', { damage: 1, attack: 'ranged' }) } },
    titan: DREAD_PACT,
  },
  QT: {
    corps: { name: 'Dreadblades', about: 'War Dogs and Abhorrent knights: hunters that run prey down.', style: 'blade', k: ['WAR DOG', 'ABHORRENT', 'CERASTUS'],
      notable: { ...s('Harbingers of Dread', 'WAR DOG: after charging, melee weapons +1 Damage.', 'WAR DOG', { damage: 1, attack: 'melee', if: ['charged'] }), bonus: bonus(6, 'With 6 branch nodes: CERASTUS +2" Move.', { move: 2 }) },
      keystone: s('Pack Hunters', 'Keystone. WAR DOG re-roll Charge rolls and +1 OC; -1 Toughness.', 'WAR DOG', [{ rerollCharge: true, oc: 1 }, { toughness: -1 }]) },
    arsenal: { name: 'Infernal Household', about: 'The great Chaos Knights and their War Dog packs.', style: 'engine', k: ['TITANIC', 'WAR DOG', 'ACASTUS'],
      notable: { ...s('Iconoclast Fiefdom', 'TITANIC: Feel No Pain 6+ and +1 OC.', 'TITANIC', [{ defend: { fnp: 6 } }, { oc: 1 }]), bonus: bonus(6, 'With 6 branch nodes: ACASTUS ranged weapons +1 Damage.', { damage: 1, attack: 'ranged' }) },
      keystone: s('Despoiler Lords', 'Keystone. TITANIC: +1 Attack and +1 Strength in melee; -2" Move.', 'TITANIC', [{ attacks: 1, strength: 1, attack: 'melee' }, { move: -2 }]) },
  },
  CSM: {
    corps: { name: 'Black Legion', about: 'Terminators, Chaos Lords and Legionaries: the Long War, in person.', style: 'blade', k: ['TERMINATOR', 'CHAOS LORD', 'BATTLELINE'],
      notable: { ...s('Veterans of the Long War', 'BATTLELINE: melee attacks re-roll Wound rolls.', 'BATTLELINE', { reroll: 'wounds', attack: 'melee' }), bonus: bonus(6, 'With 6 branch nodes: those units also Feel No Pain 6+.', { defend: { fnp: 6 } }) },
      keystone: s('Dark Apotheosis', 'Keystone. CHARACTER: +1 Attack and +1 Damage; -1 Toughness.', 'CHARACTER', [{ attacks: 1, damage: 1 }, { toughness: -1 }]) },
    arsenal: { name: 'The Damned Host', about: 'Cultists, Raptors and daemon engines.', style: 'storm', k: ['DAMNED', 'JUMP PACK', 'VEHICLE'],
      notable: { ...s('Fodder of the Gods', 'DAMNED: +1 OC and re-roll Battle-shock tests.', 'DAMNED', { oc: 1, rerollShock: true }), bonus: bonus(6, 'With 6 branch nodes: JUMP PACK +1 Attack after charging.', { attacks: 1, attack: 'melee', if: ['charged'] }) } },
    titan: titan('Lord of Skulls Pact', 'Lords of Skulls, Chaos Knights and other TITANIC units'),
  },
  DG: {
    corps: { name: 'Plague Companies', about: 'Plague Marines and Blightlord Terminators: slow, rotten and unkillable.', style: 'wall', k: ['BATTLELINE', 'TERMINATOR', 'CHARACTER'],
      notable: { ...s('Disgustingly Resilient', 'BATTLELINE: Feel No Pain 5+.', 'BATTLELINE', { defend: { fnp: 5 } }), bonus: bonus(6, 'With 6 branch nodes: TERMINATOR +1 Toughness.', { toughness: 1 }) },
      keystone: s('Inexorable', 'Keystone. INFANTRY: Feel No Pain 5+; -2" Move.', 'INFANTRY', [{ defend: { fnp: 5 } }, { move: -2 }]) },
    arsenal: { name: 'Daemon Engines', about: 'Plague engines, Helbrutes and daemon engines.', style: 'engine', k: ['VEHICLE', 'DAEMON', 'WALKER'],
      notable: { ...s('Blighted Hulls', 'VEHICLE: Feel No Pain 5+.', 'VEHICLE', { defend: { fnp: 5 } }), bonus: bonus(6, 'With 6 branch nodes: DAEMON melee weapons +1 AP.', { ap: 1, attack: 'melee' }) } },
    titan: DREAD_PACT,
  },
  DRU: {
    corps: { name: 'Cults and Covens', about: 'Wyches, Haemonculi and Archons: pain made into a weapon.', style: 'blade', k: ['WYCH CULT', 'HAEMONCULUS COVENS', 'ARCHON'],
      notable: { ...s('Power from Pain', 'WYCH CULT: Feel No Pain 6+, and from round 3 +1 Attack in melee.', 'WYCH CULT', [{ defend: { fnp: 6 } }, R({ attacks: 1, attack: 'melee' }, 'late')]), bonus: bonus(6, 'With 6 branch nodes: HAEMONCULUS COVENS +1 Toughness.', { toughness: 1 }) },
      keystone: s('Thirst for Agony', 'Keystone. Melee weapons have [SUSTAINED HITS 1]; every unit -1 Toughness.', undefined, [{ abilities: ['sustained hits 1'], attack: 'melee' }, { toughness: -1 }]) },
    arsenal: { name: 'Realspace Raiders', about: 'Kabals, Scourges and skimmers: strike and be gone.', style: 'storm', k: ['KABAL', 'SCOURGES', 'VEHICLE'],
      notable: { ...s('Raiding Skiffs', 'VEHICLE: +2" Move and ranged attacks against them -1 to Hit.', 'VEHICLE', [{ move: 2 }, { defend: { hit: -1, vs: 'ranged' } }]), bonus: bonus(6, 'With 6 branch nodes: KABAL ranged weapons +1 AP.', { ap: 1, attack: 'ranged' }) },
      keystone: s('Hit and Gone', 'Keystone. Every unit: +2" Move and re-roll Advance rolls; -1 OC.', undefined, [{ move: 2, rerollAdvance: true }, { oc: -1 }]) },
  },
  EC: {
    corps: { name: 'Noise and Excess', about: 'Legionaries of Slaanesh: speed, sensation and screaming guns.', style: 'gun', k: ['BATTLELINE', 'INFANTRY', 'CHARACTER'],
      notable: { ...s('Sonic Overload', 'INFANTRY ranged weapons have [SUSTAINED HITS 1] and +3" Range.', 'INFANTRY', { abilities: ['sustained hits 1'], rangeBonus: 3, attack: 'ranged' }), bonus: bonus(6, 'With 6 branch nodes: CHARACTER +1 Attack.', { attacks: 1 }) },
      keystone: s('Thrill-seekers', 'Keystone. Every unit: +2" Move and +1 to Charge rolls; -1 to saving throws.', undefined, [{ move: 2, chargeBonus: 1 }, { defend: { save: -1 } }]) },
    arsenal: { name: 'Daemons of Excess', about: 'Daemon Princes, Maulerfiends and daemon engines.', style: 'blade', k: ['DAEMON', 'MONSTER', 'VEHICLE'],
      notable: { ...s('Exquisite Agony', 'DAEMON: melee weapons have [LETHAL HITS].', 'DAEMON', { abilities: ['lethal hits'], attack: 'melee' }), bonus: bonus(6, 'With 6 branch nodes: VEHICLE Feel No Pain 6+.', { defend: { fnp: 6 } }) } },
    titan: DREAD_PACT,
  },
  GC: {
    corps: { name: 'The Uprising', about: 'Acolytes, Neophytes and the Patriarch\'s brood: the cult rises.', style: 'blade', k: ['INFANTRY', 'ACOLYTE HYBRIDS', 'CHARACTER'],
      notable: { ...s('Day of Ascension', 'INFANTRY: rounds 1-2, +1 Attack in melee and +1 to Charge rolls.', 'INFANTRY', R({ attacks: 1, chargeBonus: 1, attack: 'melee' }, 'early')), bonus: bonus(6, 'With 6 branch nodes: ACOLYTE HYBRIDS +1 AP in melee.', { ap: 1, attack: 'melee' }) },
      keystone: s('Cult Ambush', 'Keystone. INFANTRY: +1 OC and re-roll Charge rolls; -1 Toughness.', 'INFANTRY', [{ oc: 1, rerollCharge: true }, { toughness: -1 }]) },
    arsenal: { name: 'Brood Brothers', about: 'Stolen tanks, bikes and guard regiments turned to the cult.', style: 'gun', k: ['VEHICLE', 'MOUNTED', 'BATTLELINE'],
      notable: { ...s('Borrowed Firepower', 'VEHICLE ranged weapons: +1 Strength and +1 AP against MONSTER or VEHICLE units.', 'VEHICLE', [{ strength: 1, attack: 'ranged' }, { ap: 1, attack: 'ranged', if: ['targetMV'] }]), bonus: bonus(6, 'With 6 branch nodes: MOUNTED +2" Move.', { move: 2 }) },
      keystone: s('Purloined Arsenal', 'Keystone. VEHICLE ranged attacks re-roll Hit rolls; -1" Move.', 'VEHICLE', [{ reroll: 'hits', attack: 'ranged' }, { move: -1 }]) },
  },
  GK: {
    corps: { name: 'Brotherhoods', about: 'Terminators and psyker-knights: daemon hunters in silver.', style: 'blade', k: ['TERMINATOR', 'PSYKER', 'CHARACTER'],
      notable: { ...s('Hammerhand', 'PSYKER melee weapons: +1 Strength and +1 Damage.', 'PSYKER', { strength: 1, damage: 1, attack: 'melee' }), bonus: bonus(6, 'With 6 branch nodes: those units also Feel No Pain 6+.', { defend: { fnp: 6 } }) },
      keystone: s('Sanctic Purity', 'Keystone. Psychic weapons +1 Damage; PSYKER units -1 Toughness.', 'PSYKER', [{ damage: 1, if: ['psychicWeapon'] }, { toughness: -1 }]) },
    arsenal: { name: 'Nemesis Armoury', about: 'Land Raiders, Dreadknights and the Brotherhood\'s war engines.', style: 'engine', k: ['LAND RAIDER', 'VEHICLE', 'WALKER'],
      notable: { ...s('Psybolt Ammunition', 'VEHICLE ranged weapons: +1 AP.', 'VEHICLE', { ap: 1, attack: 'ranged' }), bonus: bonus(6, 'With 6 branch nodes: LAND RAIDER Feel No Pain 5+.', { defend: { fnp: 5 } }) } },
    titan: QUESTOR,
  },
  AoI: {
    corps: { name: 'The Ordos', about: 'Inquisitors and their retinues: Xenos, Hereticus, Malleus.', style: 'gun', k: ['INQUISITOR', 'RETINUE', 'ORDO XENOS'],
      notable: { ...s('Inquisitorial Mandate', 'INQUISITOR: ranged weapons have [PRECISION] and Feel No Pain 5+.', 'INQUISITOR', [{ abilities: ['precision'], attack: 'ranged' }, { defend: { fnp: 5 } }]), bonus: bonus(6, 'With 6 branch nodes: RETINUE +1 Attack.', { attacks: 1 }) },
      keystone: s('Exterminatus Authority', 'Keystone. Every attack: +1 AP; every unit -1 OC.', undefined, [{ ap: 1 }, { oc: -1 }]) },
    arsenal: { name: 'Agents in the Field', about: 'Assassins, Arbites and Voidfarers: the Imperium\'s hidden hands.', style: 'storm', k: ['OFFICIO ASSASSINORUM', 'ADEPTUS ARBITES', 'VOIDFARERS'],
      notable: { ...s('Execution Force', 'OFFICIO ASSASSINORUM: melee and ranged weapons +1 Damage.', 'OFFICIO ASSASSINORUM', { damage: 1 }), bonus: bonus(6, 'With 6 branch nodes: ADEPTUS ARBITES +1 OC.', { oc: 1 }) } },
    titan: QUESTOR,
  },
  QI: {
    corps: { name: 'Questor Household', about: 'Questoris, Cerastus and Armiger knights: honour and the charge.', style: 'blade', k: ['QUESTORIS', 'ARMIGER', 'CERASTUS'],
      notable: { ...s('Code Chivalric', 'QUESTORIS: after charging, +1 Attack in melee and +1 Damage.', 'QUESTORIS', { attacks: 1, damage: 1, attack: 'melee', if: ['charged'] }), bonus: bonus(6, 'With 6 branch nodes: ARMIGER +2" Move.', { move: 2 }) },
      keystone: s('Ion Bulwark', 'Keystone. TITANIC: +1 to saving throws against ranged attacks and Feel No Pain 6+; -1" Move.', 'TITANIC', [{ defend: { save: 1, vs: 'ranged' } }, { defend: { fnp: 6 } }, { move: -1 }]) },
    arsenal: { name: 'Dominus Battery', about: 'Dominus and Acastus knights: the household\'s heavy guns.', style: 'engine', k: ['DOMINUS', 'ACASTUS', 'TITANIC'],
      notable: { ...s('Siege Protocols', 'DOMINUS: after Remaining Stationary, +1 to Hit with ranged attacks.', 'DOMINUS', { hit: 1, attack: 'ranged', if: ['stationary'] }), bonus: bonus(6, 'With 6 branch nodes: ACASTUS ranged weapons +1 Damage.', { damage: 1, attack: 'ranged' }) } },
    titan: titan('Legio Pact', 'Titans of the Legio Titanicus'),
  },
  LoV: {
    corps: { name: 'Hearthkyn Holds', about: 'Hearthkyn warriors, Cthonian miners and Exo-armour: the Kin\'s steady wall.', style: 'gun', k: ['BATTLELINE', 'EXOARMOUR', 'CTHONIAN'],
      notable: { ...s('Grudge Marked', 'BATTLELINE: ranged attacks against a unit below Starting Strength re-roll Hit rolls.', 'BATTLELINE', { reroll: 'hits', attack: 'ranged', if: ['targetBelowStarting'] }), bonus: bonus(6, 'With 6 branch nodes: EXOARMOUR +1 Toughness.', { toughness: 1 }) },
      keystone: s('Ancestral Grudge', 'Keystone. Ranged attacks against a unit below Starting Strength +1 to Wound; every unit -1" Move.', undefined, [{ wound: 1, attack: 'ranged', if: ['targetBelowStarting'] }, { move: -1 }]) },
    arsenal: { name: 'Hernkyn and Ironkin', about: 'Pioneer bikers, Kapricus carriers and Ironkin steeljacks.', style: 'storm', k: ['HERNKYN', 'KAPRICUS', 'IRONKIN STEELJACKS'],
      notable: { ...s('Pioneer Scouts', 'HERNKYN: +2" Move and ranged weapons +3" Range.', 'HERNKYN', [{ move: 2 }, { rangeBonus: 3, attack: 'ranged' }]), bonus: bonus(6, 'With 6 branch nodes: IRONKIN STEELJACKS Feel No Pain 5+.', { defend: { fnp: 5 } }) },
      keystone: s('Void-hardened', 'Keystone. VEHICLE: +1 Toughness and Feel No Pain 6+; -1 OC.', 'VEHICLE', [{ toughness: 1, defend: { fnp: 6 } }, { oc: -1 }]) },
  },
  NEC: {
    corps: { name: 'Destroyer Cults', about: 'Destroyers, Canoptek constructs and Crypteks: the hunger to end all life.', style: 'gun', k: ['DESTROYER CULT', 'CANOPTEK', 'CRYPTEK'],
      notable: { ...s('Hardwired for Destruction', 'DESTROYER CULT: ranged attacks re-roll Hit rolls.', 'DESTROYER CULT', { reroll: 'hits', attack: 'ranged' }), bonus: bonus(6, 'With 6 branch nodes: CANOPTEK +2" Move.', { move: 2 }) },
      keystone: s('Nihilakh Annihilation', 'Keystone. Ranged weapons +1 AP; every unit -1 OC.', undefined, [{ ap: 1, attack: 'ranged' }, { oc: -1 }]) },
    arsenal: { name: 'Royal Court', about: 'Overlords, Triarch Praetorians and the Necron war engines.', style: 'wall', k: ['NOBLE', 'TRIARCH', 'VEHICLE'],
      notable: { ...s('My Will Be Done', 'NOBLE: Feel No Pain 5+ and +1 Attack.', 'NOBLE', [{ defend: { fnp: 5 } }, { attacks: 1 }]), bonus: bonus(6, 'With 6 branch nodes: TRIARCH re-roll Wound rolls of 1.', { reroll: 'wounds1' }) } },
    titan: titan('Monolith Phalanx', 'Monoliths, Obelisks and Tesseract Vaults'),
  },
  ORK: {
    corps: { name: 'Speed Freeks', about: 'Wartrakks, buggies and bikers: fasta is betta.', style: 'storm', k: ['SPEED FREEKS', 'VEHICLE', 'BIG MEK'],
      notable: { ...s('Red Ones Go Fasta', 'SPEED FREEKS: +2" Move and re-roll Advance rolls.', 'SPEED FREEKS', { move: 2, rerollAdvance: true }), bonus: bonus(6, 'With 6 branch nodes: VEHICLE +1 Attack after charging.', { attacks: 1, attack: 'melee', if: ['charged'] }) },
      keystone: s('Full Throttle', 'Keystone. VEHICLE: +3" Move and +1 to Charge rolls; -1 Toughness.', 'VEHICLE', [{ move: 3, chargeBonus: 1 }, { toughness: -1 }]) },
    arsenal: { name: 'Snaggas and Mega Armour', about: 'Beast Snagga boyz, Meganobz and Warbosses: the hardest gits.', style: 'blade', k: ['BEAST SNAGGA', 'MEGA ARMOUR', 'WARBOSS'],
      notable: { ...s('Monster Hunters', 'BEAST SNAGGA: melee attacks against MONSTER or VEHICLE units re-roll Wound rolls.', 'BEAST SNAGGA', { reroll: 'wounds', attack: 'melee', if: ['targetMV'] }), bonus: bonus(6, 'With 6 branch nodes: those units also +1 Toughness.', { toughness: 1 }) } },
    titan: titan('Gargant Mob', 'Stompas, Gorkanauts and other TITANIC units'),
  },
  TAU: {
    corps: { name: 'Hunter Cadres', about: 'Battlesuits, Crisis teams and markerlights: precise, mobile firepower.', style: 'gun', k: ['BATTLESUIT', 'CRISIS', 'MARKERLIGHT'],
      notable: { ...s('Mont\'ka', 'BATTLESUIT: rounds 1-2, ranged weapons +1 AP.', 'BATTLESUIT', R({ ap: 1, attack: 'ranged' }, 'early')), bonus: bonus(6, 'With 6 branch nodes: CRISIS ranged weapons have [LETHAL HITS].', { abilities: ['lethal hits'], attack: 'ranged' }) },
      keystone: s('Kauyon', 'Keystone. From round 3, ranged weapons have [SUSTAINED HITS 1] and +1 to Hit; rounds 1-2, -1 to Hit with ranged attacks.', undefined, [R({ abilities: ['sustained hits 1'], hit: 1, attack: 'ranged' }, 'late'), R({ hit: -1, attack: 'ranged' }, 'early')]) },
    arsenal: { name: 'Kroot and Fire Caste', about: 'Kroot hunters, Fire Warriors and grav-tanks.', style: 'wall', k: ['KROOT', 'FIRE WARRIOR', 'VEHICLE'],
      notable: { ...s('Hunting Packs', 'KROOT: +2" Move and in a terrain area +1 to saving throws.', 'KROOT', [{ move: 2 }, { defend: { save: 1 }, if: ['inTerrain'] }]), bonus: bonus(6, 'With 6 branch nodes: VEHICLE Feel No Pain 6+.', { defend: { fnp: 6 } }) } },
    titan: titan('Supremacy Clearance', 'Stormsurges and Ta\'unar Supremacy Armour'),
  },
  TS: {
    corps: { name: 'Rubricae and Tzaangors', about: 'Rubric Marines, Scarab Occult and Tzaangor warbands.', style: 'gun', k: ['RUBRICAE', 'MUTANT', 'TERMINATOR'],
      notable: { ...s('Inferno Bolts', 'RUBRICAE: ranged weapons +1 AP.', 'RUBRICAE', { ap: 1, attack: 'ranged' }), bonus: bonus(6, 'With 6 branch nodes: MUTANT +1 Attack in melee.', { attacks: 1, attack: 'melee' }) },
      keystone: s('All Is Dust', 'Keystone. RUBRICAE: +1 Toughness and +1 to saving throws; -1" Move.', 'RUBRICAE', [{ toughness: 1, defend: { save: 1 } }, { move: -1 }]) },
    arsenal: { name: 'Daemons of Change', about: 'Daemon Princes, Tzaangors and daemon engines of Tzeentch.', style: 'wall', k: ['DAEMON', 'MUTANT', 'VEHICLE'],
      notable: { ...s('Mutating Flesh', 'DAEMON: Feel No Pain 5+.', 'DAEMON', { defend: { fnp: 5 } }), bonus: bonus(6, 'With 6 branch nodes: VEHICLE ranged weapons +1 Damage.', { damage: 1, attack: 'ranged' }) } },
    titan: DREAD_PACT,
  },
  TYR: {
    corps: { name: 'Synaptic Swarms', about: 'Gaunts and Synapse creatures: the swarm that never ends.', style: 'storm', k: ['SYNAPSE', 'ENDLESS MULTITUDE', 'INFANTRY'],
      notable: { ...s('Shadow of the Hive', 'ENDLESS MULTITUDE: +1 OC and +1 Attack in melee.', 'ENDLESS MULTITUDE', { oc: 1, attacks: 1, attack: 'melee' }), bonus: bonus(6, 'With 6 branch nodes: SYNAPSE Feel No Pain 5+.', { defend: { fnp: 5 } }) },
      keystone: s('Devour', 'Keystone. INFANTRY: +1 Attack and re-roll Charge rolls; -1 to saving throws.', 'INFANTRY', [{ attacks: 1, rerollCharge: true, attack: 'melee' }, { defend: { save: -1 } }]) },
    arsenal: { name: 'Monstrous Bio-forms', about: 'Hive Tyrants, Harvesters and the great beasts.', style: 'blade', k: ['MONSTER', 'HARVESTER', 'HIVE TYRANT'],
      notable: { ...s('Bio-weapon Symbiosis', 'MONSTER: melee weapons +1 Damage.', 'MONSTER', { damage: 1, attack: 'melee' }), bonus: bonus(6, 'With 6 branch nodes: those units also Feel No Pain 6+.', { defend: { fnp: 6 } }) } },
    titan: titan('Bio-titan Spawning', 'Harridans, Hierophants and other bio-titans'),
  },
  WE: {
    corps: { name: 'Berzerker Warbands', about: 'Berzerkers, Eightbound and Exalted champions: blood for the Blood God.', style: 'blade', k: ['BATTLELINE', 'POSSESSED', 'CHARACTER'],
      notable: { ...s('Butcher\'s Nails', 'BATTLELINE: after charging, +1 Attack and +1 Strength in melee.', 'BATTLELINE', { attacks: 1, strength: 1, attack: 'melee', if: ['charged'] }), bonus: bonus(6, 'With 6 branch nodes: POSSESSED Feel No Pain 5+.', { defend: { fnp: 5 } }) },
      keystone: s('Skulls Without End', 'Keystone. Melee weapons +1 Damage; every unit -1 to saving throws.', undefined, [{ damage: 1, attack: 'melee' }, { defend: { save: -1 } }]) },
    arsenal: { name: 'Daemons of Khorne', about: 'Daemon Princes, Juggernauts and Khornate daemon engines.', style: 'engine', k: ['DAEMON', 'MONSTER', 'VEHICLE'],
      notable: { ...s('Brass Fury', 'VEHICLE: melee weapons +1 Strength and +1 Attack.', 'VEHICLE', { strength: 1, attacks: 1, attack: 'melee' }), bonus: bonus(6, 'With 6 branch nodes: DAEMON +2" Move.', { move: 2 }) } },
    titan: titan('Lord of Skulls Pact', 'Lords of Skulls, Chaos Knights and other TITANIC units'),
  },
};

/** the army's corps and arsenal branches (the arsenal ends in the titan keystone when the army has one); none for an
 *  army without a kit */
export function armyBranches(factionId: string): Branch[] {
  const kit = ARMY_KITS[factionId];
  if (!kit) return [];
  return [
    build('corps', kit.corps, kit.corps.keystone!, 0),
    build('arsenal', kit.arsenal, kit.titan ?? kit.arsenal.keystone!, 3),
  ];
}
