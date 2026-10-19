// One effect engine for every rule that changes play without being a weapon keyword:
// detachment rules (data/detachment-rules.json), datasheet abilities (data/abilities/<faction>.json,
// or read from the ability text by abilityText.ts for factions without a file),
// and temporary effects / marks put on units by abilities (e.g. "suppressed" until your next turn).
// Rules are data: an Effect says WHO it applies to (scope), WHEN (conditions) and WHAT changes.
import abilityData from '../../data/ability-rules.json';
import acAbilities from '../../data/abilities/AC.json';
import orkAbilities from '../../data/abilities/ORK.json';
import smAbilities from '../../data/abilities/SM.json';
import tsAbilities from '../../data/abilities/TS.json';
import csmAbilities from '../../data/abilities/CSM.json';
import weAbilities from '../../data/abilities/WE.json';
import ecAbilities from '../../data/abilities/EC.json';
import dgAbilities from '../../data/abilities/DG.json';
import qiAbilities from '../../data/abilities/QI.json';
import qtAbilities from '../../data/abilities/QT.json';
import aoiAbilities from '../../data/abilities/AoI.json';
import amAbilities from '../../data/abilities/AM.json';
import tyrAbilities from '../../data/abilities/TYR.json';
import asAbilities from '../../data/abilities/AS.json';
import tauAbilities from '../../data/abilities/TAU.json';
import aeAbilities from '../../data/abilities/AE.json';
import lovAbilities from '../../data/abilities/LoV.json';
import tlAbilities from '../../data/abilities/TL.json';
import admAbilities from '../../data/abilities/AdM.json';
import druAbilities from '../../data/abilities/DRU.json';
import cdAbilities from '../../data/abilities/CD.json';
import gcAbilities from '../../data/abilities/GC.json';
import necAbilities from '../../data/abilities/NEC.json';
import gkAbilities from '../../data/abilities/GK.json';
import detData from '../../data/detachment-rules.json';
import { parseAbilityText } from './abilityText';
import { deploymentById, RULES, toPoly } from '../engine/config';
import { d6, exprAverage } from '../engine/dice';
import { baseDist, bodyTouchesPoly, circleTouchesPoly, clamp, dist, pointInPoly, pointSegDist, polyEdges } from '../engine/geometry';
import { setActionEligibilityHook, unitInRange } from '../engine/missions';
import { alive, boardUnits, engagedEnemies, hasKw, log, notifyAbilityCpGain, onBoard, other, phaseKey, setStratBlockHook, setStratHooks, setStratShockedHook, unitDistance, withinTerrain } from '../engine/state';
import type { AbilityData, GameState, ModelState, PlayerId, Pool, Pt, TimedEffect, UnitState, WeaponData, WeaponProfileData } from '../engine/types';
import { abilityLabel, condApplies, parseAbility } from '../engine/weapons';
import { hasCover, hasLos, isHidden, setScreenHook, setVisibilityHooks } from '../engine/visibility';
import { setThroughHook } from '../engine/pathing';
import { auraRangeBonus, condExact, condPatterns, effectSources, eligibleByRule, meleeStrength, moveThroughModels, moveThroughTerrain } from '../engine/events';

export type Eligibility = 'shootAfterAdvance' | 'shootAfterFallBack' | 'chargeAfterAdvance' | 'chargeAfterFallBack' | 'actionWhileEngaged' | 'actionWhileShocked' | 'actionAfterAdvance' | 'actionAfterFallBack' | 'shootAfterAction' | 'actionAfterShooting';
export type Reroll = 'hits1' | 'hits' | 'wounds1' | 'wounds12' | 'wounds' | 'damage' | 'damageOne' | 'damage1';

export interface Defend {
  vs?: 'melee' | 'ranged';
  hit?: number; // attacks that target this unit: +/- to hit
  wound?: number;
  woundIfStronger?: number; // when S > T
  woundIfStrongerOrEqual?: number; // when S >= T
  ap?: number; // worsen the attack's AP by this much
  damage?: number; // -1 D (minimum 1)
  halveDamage?: boolean;
  damageSet?: number; // the attack's Damage characteristic becomes this (Mantle of Ophelia: 1)
  inv?: number;
  invVs?: 'psychic';
  fnp?: number;
  fnpVs?: 'mortal' | 'psychic' | 'mortalPsychic' | 'damage1'; // damage1: only attacks with an unmodified Damage of 1 (WARDING CHANT)
  cover?: boolean;
  coverUnless12?: boolean;
  coverUnlessWithin?: number; // the Benefit of Cover against ranged attacks unless the attacker is within this range (Rune of Mists: 18)
  untargetableBeyond12?: boolean;
  strengthMinus?: number;
  saveBonusD1?: number;
  save?: number; // +X to save rolls (better armour save)
  invReroll1?: boolean; // re-roll an invulnerable saving throw of 1 (Daemonic Invulnerability)
  saveMax3?: boolean; // save bonus cannot improve to better than 3+ (Take Cover!)
  minHit?: number; // attacks that target this unit fail on an unmodified hit roll below this (Speediest Freeks: 4)
  negateOncePerPhase?: boolean; // once per phase: a failed save's damage becomes 0
  negateOnce?: 'turn' | 'round' | 'battle'; // … once per turn / battle round / battle instead (Surgeon Acolyte, Bastion Plate, Chaos Familiar)
  notPsychic?: boolean; // the Damage change does not apply to Psychic Attacks (Impossible Form)
  charOnly?: boolean; // only the unit's CHARACTER models (Silent Bodyguard)
  // legacy names used by the first version of detachment-rules.json
  woundMinusIfStronger?: boolean;
  rangedOnly?: boolean;
  enemyStrengthMinus?: number;
}

/** A mark on an enemy unit that makes attacks against it better for the marking player's units. */
export interface Incoming {
  by: PlayerId; // filled in when the mark is placed
  units?: string[]; // only attacks by these units of the marking player
  attack?: 'melee' | 'ranged';
  hit?: number; wound?: number; ap?: number;
  critWoundAp?: number; // improves AP by X on a Critical Wound
  reroll?: Reroll | Reroll[];
  abilities?: string[];
  noCover?: boolean;
  fromTransport?: string; // only models that disembarked from this transport this turn
  disembarked?: boolean; // only units that disembarked (from any transport) this turn
  psychic?: boolean; // only Psychic Attacks
  weaponAbilities?: string[]; // only weapons with one of these abilities (Forgefather: torrent, melta)
  damage?: number; // +X Damage (Virulent Blessing)
  rerollAttacks?: boolean; // ranged attacks against it re-roll a low number of attacks (Overwhelming Generosity)
  blastReroll?: boolean; // Blast weapons re-roll the Hit roll against it (Blight Bombardment)
  critHitOn?: number; // unmodified Hit rolls of X+ against it score a Critical Hit (Whispering Web)
  strength?: number; // +X Strength for attacks against it (Fury of the Void)
}

export interface Effect {
  scope?: 'unit' | 'model' | 'led' | 'bodyguardLed' | 'aura' | 'enemyAura' | 'army' | 'transport';
  range?: number;
  units?: string[];
  notSelf?: boolean;
  weapon?: string;
  attack?: 'melee' | 'ranged';
  if?: string[];
  // offence
  hit?: number; wound?: number; ap?: number; strength?: number; attacks?: number; damage?: number;
  critWoundAp?: number; // improves AP by X on a Critical Wound
  skill?: number; // improves WS / BS characteristic by X (Take Aim!, Fix Bayonets!)
  skillSet?: number; // the weapons' WS / BS characteristic is this (Spotter: 3+)
  rapidFireAttacks?: number; // improves Attacks of Rapid Fire weapons by X (First Rank, Fire! Second Rank, Fire!)
  reroll?: Reroll | Reroll[];
  abilities?: string[];
  critHitOn?: number;
  ignoreHitMods?: boolean;
  ignoreWoundMods?: boolean; // ignore (bad) modifiers to the wound roll
  givesCover?: boolean;
  rapidFireFullRange?: boolean; // [RAPID FIRE] counts up to the weapon's full range (Codex Fire-patterns)
  moveNearMortals?: { range: number; on: number; dmg: string; plus?: number; plusIf?: string[] }; // an enemy unit set up or ending a move within range: D6 (+plus if plusIf holds on this unit), on X+ it suffers dmg mortal wounds (FIRES OF COVENANT)
  demiseSure?: { range: number; units?: string[] }; // once per turn, a friendly model of these units destroyed within X": its Deadly Demise inflicts mortal wounds without a roll (Emotionless Clarity)
  mortalPerWound?: number; // each attack that wounds also inflicts this many mortal wounds on the target (Rapturous Blows, Radiant Champion)
  onKill?: { miracle?: number; shock?: boolean }; // once per phase, after its attacks destroyed enemy models: gain Miracle dice / that unit takes a Battle-shock test (FAITH AND FURY, RIGHTEOUS BLOWS)
  redirectWounds?: string; // each wound it would lose becomes a mortal wound on this (friendly) unit instead (THIEVES OF PAIN)
  ignoreEngaged?: { on: number; cost: 'mortal' | 'model' }; // shoots as if no enemy were in Engagement Range of it; each enemy model destroyed while engaged with it: D6, on X+ it suffers a mortal wound / loses a model (FICKLEFIRE, CALLOUS SACRIFICE)
  disembarkRange?: number; // on a TRANSPORT: its passengers may be set up wholly within X" of it (SECURE POSITIONS)
  coverBehind?: { friendly?: boolean; units?: string[] }; // units it hides (partly) have the Benefit of Cover (Ramshackle Cover, STALWART PROTECTOR)
  ignoreLdMods?: boolean; // modifiers to its Leadership (and Battle-shock tests) are ignored (Vexilla)
  stratsWhileShocked?: boolean; // can be targeted by Stratagems while Battle-shocked (Grim Determination)
  ordersStayShocked?: boolean; // Orders on it do not end when it becomes Battle-shocked (Grim Determination)
  halfRangeAlways?: boolean; // the target always counts as within half range of the weapon (Close-range Titan Killer)
  killDemiseOn?: number; // an enemy model this weapon destroys has Deadly Demise on X+ instead of a 6 (Armour Obliteration)
  // defence
  defend?: Defend;
  incoming?: Incoming;
  // the unit
  stealth?: boolean; loneOperative?: boolean; deepStrike?: boolean; fightsFirst?: boolean; scouts?: number; infiltrators?: boolean;
  oc?: number; ocSet?: number; shockedOc?: number; ocHalve?: boolean; ocZero?: boolean;
  toughness?: number; move?: number; ld?: number;
  eligible?: Eligibility[];
  cannotFallBack?: boolean; noOverwatch?: boolean; noSnapTarget?: boolean; cannotBeHidden?: boolean; detection?: number; rangeMinus?: number;
  rerollAdvance?: boolean; rerollCharge?: boolean; advanceSix?: boolean; advanceBonus?: number; chargeBonus?: number; rerollShock?: boolean;
  advanceSelfMortals?: string;
  stratDiscount?: { ids: string[]; cp: number; limit?: Limit; perArmy?: boolean; sacrifice?: boolean; fateValue?: number; yp?: number }; // yp: costs this many Yield Points (Ancestral Crest); sacrifice: one Bodyguard model is destroyed each time (Brutal Example); fateValue: a Seer Council Fate die of this value is discarded
  stratTax?: { cp: number; limit?: Limit }; // enemy aura: your opponent's stratagems on their units near it cost more
  stratCpChance?: number; // targeting this unit with a stratagem: on X+ gain 1CP
  riled?: boolean;
  forceDesperate?: boolean;
  overwatchHitOn?: number;
  moveThroughModels?: boolean; // any move: through all models
  chargeThroughModels?: boolean; // charge moves: through models other than MONSTER / VEHICLE
  chargeThroughAll?: boolean; // charge moves: through enemy models (Acrobatic Onslaught)
  advanceHazard?: boolean; // after an Advance: a hazard roll for each model
  grounded?: boolean; // cannot take to the skies
  oppMoveIngress?: boolean; // in Reserves: may arrive at the end of the opponent's Movement phase
  attacksPerEmbarked?: { per: number; max: number }; // +A for each model embarked within this unit
  oathBackup?: boolean; // Master of Battle: a second Oath of Moment target
  fightOnDeathRegain?: string; // after fighting on death: if it destroyed a model it regains these wounds and survives
  // transports and reserves
  assaultDisembark?: boolean; // units disembarking after this transport moved can still charge
  disembarkAfterAdvance?: boolean;
  noEmbark?: boolean;
  omniScrambler?: number; // enemy units arriving from Reserves cannot be set up within X"
  deepStrikeInFlow?: boolean; // Deep Strike: must be set up wholly within the army's Flow of Magic (and cannot charge that turn)
  deepStrikeRange?: number; // may Deep Strike this close to enemy units (then cannot charge that turn)
  arriveFromRound?: number;
  mobile?: boolean; // moves over dense terrain like INFANTRY
  addKeywords?: string[]; removeKeywords?: string[]; // fixed at Declare Battle Formations
  // reactions
  fightOnDeath?: number; // destroyed by a melee attack before fighting: on X+ it fights first, then is removed
  shootOnDeath?: number;
  retaliate?: { on: number; max: number }; // each melee attack allocated to this model: on X+ 1 mortal wound to the attackers
  fallBackLdTest?: boolean; // enemy aura: units selected to Fall Back must pass a Leadership test or Remain Stationary
  followFallBack?: boolean; // when an enemy unit engaged with this unit Falls Back, this unit can make a Normal move
  slowed?: boolean; // selected to move: roll D6, mortal wounds and less Move (Stasis Bomb)
  graviticFly?: boolean; // each move: D6, 4+ = D3 mortal wounds (Gravitic Pulse on a FLY unit)
  moveHalve?: boolean; // halve the Move characteristic, Advance and Charge rolls (Gravitic Pulse)
  snared?: boolean; // each Normal / Advance / Fall Back move: one D6 per model, each 1 is a mortal wound (Monofilament Snare)
  noBigGunsPenalty?: boolean;
  attacksTo?: number; // the weapon's Attacks characteristic becomes X
  damageTo?: number; // the weapon's Damage characteristic becomes X
  rangeBonusIf?: { ability: string; add: number }; // aura range grows when the holder also has this ability
  embarkedOc?: boolean; // add the OC of models embarked within this model
  ldSet?: number;
  // stratagem effects
  ocMultiply?: number; // "double the Objective Control characteristic"
  mustStay?: boolean; // must Remain Stationary this turn
  advanceFixed?: number; // Advance: no roll, add this many inches instead
  pileIn?: number; consolidate?: number; // Pile-in / Consolidation moves up to this far instead of 3"
  enemyPileMinus?: number; // enemy units engaged with it pile in / consolidate this much less (Dacatarai in Dread Host)
  freeConsolidate?: boolean; // consolidation does not need to end closer to the closest enemy model
  afterShootNoCover?: boolean; // Scouring Warpflame: after shooting, one enemy unit it hit cannot have the Benefit of Cover this phase
  surgeFixed?: number; // its surge moves are up to this far instead of rolled (Berzerker's Wrath: 8")
  moveSet?: number; // the models' Move characteristic is this (Aggressive Advance: 10")
  surgeReroll?: boolean; // a surge move's distance can be re-rolled (Forwards, for Blood!)
  suppressOnHit?: boolean; // after it shoots, one enemy unit it hit is suppressed (Unleash Hell)
  fightReach3?: boolean; // Deranged Ferocity: models within 3" of an enemy unit engaged with this unit also fight it
  glamour?: boolean; // Deceptive Glamour: enemy models only attack this unit when no Scintillating Legions unit is in reach
  taunt?: boolean; // enemy models in Engagement Range must target this unit with all their attacks
  shieldOfHonour?: boolean; // enemy models engaged with it that attack another unit have -1 to hit and wound (Shield of Honour)
  fightOnDeathCharBonus?: number; // +X to the fight-on-death roll for a CHARACTER model (Duty Unto Death)
  targetableWithin?: number; // can only be targeted by ranged attacks from models within this range
  ignoreLoneOperative?: boolean; // the attacker's ranged attacks ignore Lone Operative's 12" restriction
  ignoreMods?: boolean; // ignore modifiers to its characteristics and rolls (not saving throws)
  forceShockAura?: number; // in the opponent's next Command phase, enemy units this close must take a Battle-shock test
  creepingDread?: number; // Creeping Dread: in the opponent's Command phase, enemy PSYKER / below-strength units this close test at -1
  shockOnKill?: boolean; // after its attacks destroy models, that unit takes a Battle-shock test
  poisoned?: boolean; // Daemonic Poisons: at the start of each Command phase, 4+: D3 mortal wounds (emperorsChildren.ts)
  desperateMinus?: number; // enemy units falling back from it subtract this from their Desperate Escape tests (if: checked on this unit)
  sensational?: boolean; // Sensational Performance used: +1 S/AP was taken, so these attacks have the targeting restrictions
  chargeMustEngaged?: boolean; // its charge must end engaged with an enemy unit that was already engaged (Refusal to be Outdone)
  chargeNeedEngagedBy?: string; // after Advancing / Falling Back it may only charge units engaged with a unit with this keyword (Sycophantic Surge)
  consolidateEngage?: boolean; // a Consolidation of more than 3" must end engaged (Incessant Violence)
  deepStrikeNear?: { range: number; kw: string }; // Deep Strike: set up wholly within X" of a friendly unit with this keyword (Dark Apparitions)
  thrill?: boolean; // Thrill Seekers: shoot / charge after Advancing or Falling Back, with its targeting restrictions (emperorsChildren.ts)
  onlyTargetMarked?: string; // after Advancing / Falling Back it may only shoot or charge units with this mark (Heresy Undone: "auspex")
  svSet?: number; // the bearers' Save characteristic is this (Blood-forged Armour: 2+), fixed at Declare Battle Formations
  statM?: number; // fixed change to the bearers' Move characteristic
  statW?: number; // fixed change to the bearers' Wounds characteristic (Blasphemous Engine)
  rangeBonus?: number; // ranged weapons +X" Range
  synapseRange?: number; // Tyranids: its Synapse Range is this many inches (Synaptic Linchpin: 9)
  strengthPer5Models?: boolean; // +1 S for every 5 models in the unit (or embarked within it)
  fightOnDeathRiled?: number; // … +X to that roll while riled up
  secureAtCommandEnd?: boolean; // end of your Command phase: objectives this unit holds stay yours (Uphold the Honour)
  secureAtMovementEnd?: boolean; // end of your Movement phase: the same (Vow-sworn Crusaders' Uphold the Honour)
  surgeObjective?: boolean; // a surge move may go to the closest objective instead (Purge and Sanctify)
  noEngagedStrats?: boolean; // enemy units engaged with it (not MONSTER/VEHICLE) can't be targeted by stratagems (Coronal Susurrant)
  rerollAttackRolls?: boolean; // re-roll the number of attacks of its ranged weapons (Nightforged Battery)
  rerollHazard?: boolean; // re-roll Hazard rolls
  objConsolidate?: boolean; // its consolidation can be an objective consolidation even while engaged (Establish Supremacy)
  looseDisembark?: boolean; // disembarking models only need to be within the set-up distance, not wholly (Aggressive Disembarkation)
  stratRepeat?: { ids: string[]; limit: Limit }; // this stratagem can target this unit even if it was used this phase (Countercharge)
  freeDie?: FreeDieSpec[]; // timed: free re-rolls of one die (Prime Target: one hit, one wound and one damage roll)
  weaponRange?: number; // +X" Range for the weapons this effect covers (its weapon / if filters: e.g. Psychic weapons only)
  shootIntoEngagement?: number; // may shoot non-Blast ranged weapons at enemy units engaged with friendlies within X" (its weapon / if filters: e.g. Psychic weapons only)
  protectPrecision?: number; // roll X+ to allocate precision attacks to a bodyguard model instead (Selfless Bodyguard)
  gheistskull?: boolean; // Explosives Stratagem can target an enemy up to 18" away once per battle (Gheistskull)
  esotericExplosives?: boolean; // Explosives Stratagem inflicts mortal wounds on 3+ instead of 4+ (Esoteric Explosives)
  cannotShoot?: boolean; // unit is not eligible to shoot this phase (Amulet of Auto-Chastisement)
  ingressRange?: number; // minimum distance from enemy units when arriving via Rapid Ingress (Gift of the Prescient)
  deadlyDemiseOn?: number; // its Deadly Demise inflicts mortal wounds on X+ instead of only a 6 (Warpfire Infusion)
  spotting?: number; // in your Shooting phase enemy units have +X" detection range against this unit (All-Seeing Mutant Hordes)
  rerollRitual?: boolean; // reserved
  rerollPactLd?: boolean; // re-roll the Leadership test of a Dark Pact (Chaos Icon, Pact of Destruction)
  pactBoth?: boolean; // a Dark Pact gives both [LETHAL HITS] and [SUSTAINED HITS 1] (Ruination's Bounty)
  terrorBelow?: number; // enemy units below Starting Strength this close take a Battle-shock test in their Command phase (Terror Descends)
  terrorBelowMod?: number; // … with this modifier (Terror Made Manifest: -1)
  ignoreMoveMods?: boolean; // ignore modifiers to its Move characteristic and Advance / Charge rolls (Siege Crawler)
  chargeBonusVsOath?: number; // +X to the Charge roll when a target of the charge is your Oath / focus of hatred
  critWoundOn?: number; // unmodified Wound rolls of X+ score a Critical Wound
  cpOnOathKill?: number; // your Oath / focus target destroyed while this unit is on the battlefield: on X+ gain 1CP (Eye of Abaddon)
  retargetOath?: boolean; // … a new target is picked (the closest visible enemy unit) once per battle round (Weaponised Hatred)
  cpOnKillNear?: { range: number; on: number }; // an enemy unit destroyed within X": on Y+ gain 1CP (Soul Harvester)
  autoPassShock?: boolean; // its Battle-shock tests are passed automatically (Mob Mentality)
  shieldsNear?: number; // Grot Shields: hits against a friendly ORKS INFANTRY unit within X" become 1 mortal wound on this unit each
  thralls?: boolean; // Mortal Thralls: wound rolls against this unit hit a DAMNED unit within 3" instead (mortal wounds = Damage)
  thrallsKw?: string; // … a unit with this keyword instead of DAMNED (Double-Cross: DRUKHARI)
  arriveShock?: number; // set up on the battlefield: one enemy INFANTRY / MOUNTED unit this close and visible takes a Battle-shock test
  arriveShockAll?: number; // … every enemy unit this close takes one (Dread Reputation)
  deathRetaliate?: number; // each model of this unit destroyed by an attack: on X+ the attacking unit suffers 1 mortal wound
  healOnKill?: { on: number; max: number }; // each enemy model it destroys: on X+ it regains 1 wound (at most `max` per phase)
  charKillShock?: number; // after it fought: enemy CHARACTER models died → one enemy unit this close tests (the WARLORD: all of them)
  chargedMinus?: number; // a charge that targets this unit: subtract this from the Charge roll (Siegecraft)
  contagion?: number; // +X" to the Contagion Range of this unit's models (Blooming Pestilence; deathGuard.ts)
  contagionArmy?: number; // +X" to the Contagion Range of every model of the army (Plaguesurge)
  reviveOnKill?: boolean; // each enemy model (not MONSTER / VEHICLE) it destroys: one of its destroyed models returns (Curse of the Walking Pox)
  summonsOnKill?: boolean; // each model its Doomsday bell destroys: a Plaguebearer returns to a Plaguebearers unit within 12"
  terrorPsykerMod?: number; // terrorBelow: this modifier for PSYKER units (Tocsin of Misery)
  allIsRot?: boolean; // All Is Rot: enemy units engaged with it can still be shot; their lost wounds hurt it (5+)
  poxWall?: number; // Shambling Wall: attacks on this unit are taken by Poxwalkers within X"
  ocMin1?: boolean; // the OC penalty cannot take a model below 1 (Scabrous Soulrot)
  shockBonus?: number; // +X to its Battle-shock (and Leadership) tests (Witherbone Pipes, Tome of Bounteous Blessings)
  shockPassHeal?: boolean; // a passed Battle-shock test: one model regains D3 wounds (Battleline: D3 models return)
  fightStartShock?: number; // start of the Fight phase: enemy units engaged with it take a Battle-shock test with this modifier (Acheron's Duty)
  shockAfterAttack?: number; // after it shot or fought: one enemy unit it hit takes a Battle-shock test with this modifier (Styrix's Duty)
  throughTerrain?: boolean; // its moves go through terrain features (Imperious Advance, Flush the Quarry)
  chargedShock?: number; // an enemy unit declaring a charge within 12" of it takes a Battle-shock test with this modifier (Fortress of Intimidation)
  killShockAura?: number; // after it fought: if it destroyed an enemy unit, every enemy unit within X" takes a Battle-shock test (Conquerors Without Mercy)
}

export type Limit = 'battle' | 'round' | 'turn' | 'phase';

// ---------- rule tables ----------

/** `random`: picking it rolls this many D6 instead; each result N makes the Nth option (of those without `random`) active */
export interface DetChoiceOption { id: string; name: string; text: string; effects: Effect[]; random?: number; cost?: number; group?: string }
/** when 'tithe': bought with Blood Tithe points in the Command phase, active for the rest of the battle (they add up) */
/** groups: one option from each group (Code Chivalric: a Deed and a Quality); rounds: only these battle rounds;
 *  keep: picks add to the ones already active (Harbingers of Dread) */
export interface DetChoice { name: string; when: 'command' | 'round' | 'battle' | 'tithe'; uses: 'eachOnce' | 'limit' | 'free'; limit?: number; pick?: number; options: DetChoiceOption[]; groups?: string[]; rounds?: number[]; keep?: boolean }
/** An ability a detachment / army rule gives to units ("Friendly CHAPLAIN units have the following ability: …"). */
export interface DetGrant { units: string[]; models?: string; name: string; rule: AbilityRule }
export interface FreeDieSpec { kind: 'reroll' | 'setSix'; stage: 'hit' | 'wound' | 'damage' | 'any'; limit: Limit; count?: number; units?: string[]; if?: string[]; attack?: 'melee' | 'ranged' }
export interface SagaSpec { kind: 'hunter' | 'beastslayer' | 'bold'; target?: Record<string, number> }
export interface DetRule {
  auto: 'full' | 'partial' | 'manual'; effects?: Effect[]; choice?: DetChoice; manual?: string; acts?: unknown[];
  code?: boolean; // the rule is worked out by a faction module (src/factions), not by this data
  info?: boolean; // army building only: nothing happens in the battle
  grants?: DetGrant[]; freeDie?: FreeDieSpec[]; saga?: SagaSpec;
  armyRule?: boolean; needKw?: string; // army rules: apply when the army has units with this (Chapter) keyword
  oathRetarget?: { needs: string; limit: Limit }; // Recalculating: a new Oath target when the old one dies
  splits?: { datasheets: string[]; how: 'half'; label: string }; // Veterans of the Fang
  /** Combat Doctrines: this rule lets a doctrine be selected again (ids: any of these, n times; if: only when …) */
  doctrineExtra?: { ids: string[]; n: number; if?: string[] }[];
  /** Combat Doctrines always active for these units (only: no other doctrine can be active for them) */
  doctrines?: { units: string[]; ids: string[]; only?: boolean }[];
}
export const DET_RULES = (detData as unknown as { rules: Record<string, DetRule> }).rules;

/** While the bot plans a move it asks the same questions many times over: effects are worked out once per unit then. */
let memo: { fx: Map<string, Active[]>; rules: Map<PlayerId, string[]> } | null = null;
export function withRuleCache<T>(fn: () => T): T {
  const prev = memo;
  memo = { fx: new Map(), rules: new Map() };
  try { return fn(); } finally { memo = prev; }
}

/** Names of the detachment rules and army rules (Templar Vows …) in force for a player. */
export function activeRules(s: GameState, p: PlayerId): string[] {
  const hit = memo?.rules.get(p);
  if (hit) return hit;
  const out = findActiveRules(s, p);
  memo?.rules.set(p, out);
  return out;
}

function findActiveRules(s: GameState, p: PlayerId): string[] {
  const P = s.players[p];
  const out = (P.detachments ?? []).map((d) => d.name).filter((n) => DET_RULES[n]);
  for (const r of P.armyRules ?? []) {
    const d = DET_RULES[r.name];
    if (!d?.armyRule) continue;
    if (d.needKw && P.subfaction !== d.needKw && !s.units.some((u) => u.owner === p && u.factionKeywords.includes(d.needKw!))) continue;
    out.push(r.name);
  }
  return out;
}

/** Abilities that rules of the unit's army give it. */
export function grantsOf(s: GameState, u: UnitState): DetGrant[] {
  const out: DetGrant[] = [];
  for (const n of activeRules(s, u.owner)) for (const g of DET_RULES[n].grants ?? []) if (unitMatches(u, g.units)) out.push(g);
  return out;
}

export interface AbilityRule {
  status?: 'auto' | 'partial' | 'info' | 'manual';
  note?: string;
  gear?: boolean; // wargear ability: only models carrying the item count as bearers
  effects?: Effect[];
  act?: unknown; // activation spec, see activations.ts
  choice?: { name: string; pick: number; when: 'command'; options: string[]; if?: string[] }; // "select two of these abilities"
  split?: 'half' | 'byModel' | 'five'; // the unit may be split into two at Declare Battle Formations
  freeDie?: FreeDieSpec | FreeDieSpec[];
  parsed?: boolean; // read from the ability text (abilityText.ts), not hand-written
  doctrines?: string[]; // Combat Doctrines always active for the unit with this ability (Codex Adept …)
  bond?: Effect[]; // Bondsman: what the ability does to the ARMIGER model it affects (knights.ts)
  code?: boolean; // done by engine or faction code that looks the ability up by name, not by this entry
}

/** Hand-written rules per faction (Wahapedia faction id); a few cross-faction ones live in data/ability-rules.json. */
const FACTION_RULES: Record<string, Record<string, AbilityRule>> = {
  SM: smAbilities as unknown as Record<string, AbilityRule>,
  AC: acAbilities as unknown as Record<string, AbilityRule>,
  ORK: orkAbilities as unknown as Record<string, AbilityRule>,
  TS: tsAbilities as unknown as Record<string, AbilityRule>,
  CSM: csmAbilities as unknown as Record<string, AbilityRule>,
  WE: weAbilities as unknown as Record<string, AbilityRule>,
  EC: ecAbilities as unknown as Record<string, AbilityRule>,
  DG: dgAbilities as unknown as Record<string, AbilityRule>,
  QI: qiAbilities as unknown as Record<string, AbilityRule>,
  QT: qtAbilities as unknown as Record<string, AbilityRule>,
  AoI: aoiAbilities as unknown as Record<string, AbilityRule>,
  AM: amAbilities as unknown as Record<string, AbilityRule>,
  TYR: tyrAbilities as unknown as Record<string, AbilityRule>,
  AS: asAbilities as unknown as Record<string, AbilityRule>,
  TAU: tauAbilities as unknown as Record<string, AbilityRule>,
  AE: aeAbilities as unknown as Record<string, AbilityRule>,
  LoV: lovAbilities as unknown as Record<string, AbilityRule>,
  TL: tlAbilities as unknown as Record<string, AbilityRule>,
  AdM: admAbilities as unknown as Record<string, AbilityRule>,
  DRU: druAbilities as unknown as Record<string, AbilityRule>,
  CD: cdAbilities as unknown as Record<string, AbilityRule>,
  GC: gcAbilities as unknown as Record<string, AbilityRule>,
  NEC: necAbilities as unknown as Record<string, AbilityRule>,
  GK: gkAbilities as unknown as Record<string, AbilityRule>,
};
const COMMON_RULES = (abilityData as unknown as { rules: Record<string, AbilityRule> }).rules;
export const hasFactionRules = (id: string) => !!FACTION_RULES[id];

/** The datasheet an ability came from (abilities of attached units carry it). */
export const abilitySheet = (u: UnitState, a: AbilityData) => a.sheet ?? (u.sources.length === 1 ? u.sources[0] : a.model && u.sources.includes(a.model) ? a.model : u.sources[0]);

const ruleMemo = new WeakMap<AbilityData, { unit: UnitState; sheet: string; sourceFaction?: string; r: AbilityRule | undefined }>();

export function abilityRule(u: UnitState, a: AbilityData): AbilityRule | undefined {
  const sheet = abilitySheet(u, a);
  const hit = ruleMemo.get(a);
  if (hit?.unit === u && hit.sheet === sheet && hit.sourceFaction === a.faction) return hit.r;
  const keywords = u.models?.find((m) => m.source === sheet)?.keywords ?? [];
  const faction = keywords.includes('IMPERIAL KNIGHTS') ? 'QI' : keywords.includes('CHAOS KNIGHTS') ? 'QT' : a.faction;
  const r = findRule(faction === a.faction ? a : { ...a, faction }, sheet);
  ruleMemo.set(a, { unit: u, sheet, sourceFaction: a.faction, r });
  return r;
}

/** Factions whose rule files supplement the text reader rather than define every ability. */
const PARSE_TOO = new Set(['QI', 'QT', 'TYR', 'AS', 'TAU', 'AE', 'LoV', 'TL', 'AdM', 'DRU', 'CD', 'GC']);

function findRule(a: AbilityData, sheet: string): AbilityRule | undefined {
  const books = a.faction ? [FACTION_RULES[a.faction]].filter(Boolean) : Object.values(FACTION_RULES);
  for (const b of books) {
    const r = b[`${a.name}@${sheet}`] ?? b[a.name];
    if (r) return r;
  }
  const c = COMMON_RULES[`${a.name}@${sheet}`] ?? COMMON_RULES[a.name];
  if (c) return c;
  if (a.type === 'Core' || a.type === 'Faction') return undefined;
  // factions without a hand-written file: read the common patterns from the text
  return a.faction && FACTION_RULES[a.faction] && !PARSE_TOO.has(a.faction) ? undefined : parseAbilityText(a.name, a.text);
}

/** How much of an ability the app plays by itself, for the unit sheet. */
export type AbilityStatus = 'auto' | 'partial' | 'manual' | 'info' | 'none' | 'core';
export function abilityStatus(u: UnitState, a: AbilityData): { status: AbilityStatus; note?: string } {
  if (a.type === 'Core') return { status: 'core' };
  const r = abilityRule(u, a);
  // army rules (Aegis of the Emperor, Martial Ka'tah …) live with the detachment rules
  if (!r && DET_RULES[a.name]) return { status: DET_RULES[a.name].auto === 'full' ? 'auto' : DET_RULES[a.name].auto === 'partial' ? 'partial' : 'manual' };
  if (!r) return { status: 'none' };
  const does = !!(r.effects?.length || r.act || r.choice || r.freeDie || r.split || r.doctrines || r.bond || r.code || a.mods?.length);
  if (!r.status) return { status: does ? 'auto' : 'info', note: r.note };
  // an entry marked automated with nothing the engine runs: say so instead of showing it as automated
  if (!does && (r.status === 'auto' || r.status === 'partial')) return { status: 'manual', note: 'Not automated yet: resolve it as written' };
  return { status: r.status, note: r.note };
}

// ---------- collecting effects ----------

export interface Active {
  e: Effect;
  label: string;
  holder: UnitState; // unit that has the ability (or the affected unit for detachment / timed effects)
  bearers?: ModelState[]; // "this model" effects: only these models of the unit get it
  from?: ModelState[]; // aura: the models it is measured from (the whole receiving unit gets it)
}

const wk = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');

/** "kw:ADEPTUS MECHANICUS VEHICLE": the words split into keywords / datasheet names the unit has (read from ability text). */
function kwPhraseMatch(u: UnitState, phrase: string): boolean {
  const K = new Set([...u.keywords, ...u.factionKeywords, ...u.sources.map((n) => n.toUpperCase())].map((k) => k.replace(/[’']/g, "'")));
  const w = phrase.replace(/[’']/g, "'").split(' ').filter(Boolean);
  const ok: boolean[] = [true, ...w.map(() => false)];
  for (let i = 0; i < w.length; i++) {
    if (!ok[i]) continue;
    for (let j = i + 1; j <= w.length; j++) {
      const k = w.slice(i, j).join(' ');
      if (K.has(k) || K.has(k.replace(/S$/, ''))) ok[j] = true;
    }
  }
  return ok[w.length];
}

export const unitMatches = (u: UnitState, filters?: string[]) => (filters ?? []).every((req) => req.split('|').some((alt) => {
  if (alt.startsWith('name:')) return u.sources.includes(alt.slice(5)) || u.name === alt.slice(5);
  if (alt.startsWith('id:')) return u.id === alt.slice(3);
  if (alt.startsWith('kw:')) return kwPhraseMatch(u, alt.slice(3));
  if (alt.startsWith('!')) return !(u.keywords.includes(alt.slice(1)) || u.factionKeywords.includes(alt.slice(1)));
  return u.keywords.includes(alt) || u.factionKeywords.includes(alt);
}));

function playerDetEffects(s: GameState, p: PlayerId): { e: Effect; label: string }[] {
  const P = s.players[p];
  const out: { e: Effect; label: string }[] = [];
  for (const name of activeRules(s, p)) {
    const d = { name };
    const r = DET_RULES[d.name];
    if (!r) continue;
    for (const e of r.effects ?? []) out.push({ e, label: d.name });
    if (r.choice && d.name !== DOCTRINES) {
      const st = P.det?.[d.name];
      for (const id of st?.active ?? []) {
        const o = r.choice.options.find((x) => x.id === id);
        for (const e of o?.effects ?? []) out.push({ e, label: o!.name });
      }
    }
  }
  return out;
}

/** Models carrying an ability: the datasheet's models, or (wargear) the models with that item. */
function bearersOf(u: UnitState, a: AbilityData, rule: AbilityRule): ModelState[] {
  const sheet = abilitySheet(u, a);
  const ms = alive(u).filter((m) => m.source === sheet);
  if (!rule.gear) return ms;
  const k = wk(a.name);
  return ms.filter((m) => (m.gear ?? []).some((g) => wk(g) === k || wk(g).includes(k) || k.includes(wk(g))) || m.weapons.some((w) => wk(w.name) === k));
}

/** Abilities chosen for "select two of these abilities" rules (Author of the Codex …) that are switched off this turn. */
export function abilityOff(u: UnitState, a: AbilityData): boolean {
  if (u.sources[0] === 'Pink Horrors' && (a.name === 'Sullen Malevolence (Aura)' || a.name === 'Exploding Horrors') && alive(u).some((m) => /pink/i.test(m.name))) return true;
  const c = u.abilityPicks;
  if (!c) return false;
  return c.pool.includes(a.name) && !c.on.includes(a.name);
}

const leaderSheet = (u: UnitState, sheet: string) => u.sources.length > 1 && sheet !== u.sources[0];
const hasLivingLeader = (u: UnitState) => u.sources.length > 1 && alive(u).some((m) => m.source !== u.sources[0]);

/** Every effect that currently applies to unit u, from any source. */
/** The effects of one ability (of unit h) that reach unit u, by scope. */
function ruleEffects(s: GameState, u: UnitState, h: UnitState, effects: Effect[], label: string, sheet: string, getBearers: () => ModelState[], out: Active[]) {
  for (const e of effects) {
    const scope = e.scope ?? 'unit';
    if (scope === 'army') {
      if (h.owner !== u.owner || !unitMatches(u, e.units)) continue;
      out.push({ e, label, holder: h });
      continue;
    }
    // "a transport this unit is embarked within has …" (Blitzboss)
    if (scope === 'transport') {
      if (h.status === 'embarked' && h.embarkedIn === u.id && unitMatches(u, e.units)) out.push({ e, label, holder: u });
      continue;
    }
    if (scope === 'aura' || scope === 'enemyAura') {
      if (!onBoard(h) || !onBoard(u)) continue;
      if (scope === 'aura' && (h.owner !== u.owner || (e.notSelf && h.id === u.id))) continue;
      if (scope === 'enemyAura' && h.owner === u.owner) continue;
      const bs = getBearers();
      if (!bs.length) continue;
      const r = (e.range ?? 6) + (e.rangeBonusIf && h.abilities.some((x) => x.name === e.rangeBonusIf!.ability) ? e.rangeBonusIf.add : 0) + auraRangeBonus(s, h);
      const near = (x: UnitState) => alive(x).some((m) => bs.some((b) => baseDist(b, m) <= r + 1e-6));
      // Chaos Knights: auras for War Dogs also reach the Knight itself (Masters of the Pack: two War Dog models in range)
      // and a CHARACTER marked by Throne Tyrannicus; A Long Leash puts War Dogs in range of an ABHORRENT unit's auras
      const dogAura = scope === 'aura' && (e.units ?? []).some((k) => k.includes('WAR DOG'));
      const tied = dogAura && (u.timed ?? []).some((t) => t.mark === `tyrannicus:${h.id}`);
      const master = dogAura && h.id === u.id && hasKw(h, 'TITANIC') && activeRules(s, h.owner).includes('Helhunt Lance')
        && boardUnits(s, h.owner).filter((x) => hasKw(x, 'WAR DOG')).flatMap((x) => alive(x).filter((m) => bs.some((b) => baseDist(b, m) <= r + 1e-6))).length >= 2;
      if (!unitMatches(u, e.units) && !tied && !master) continue;
      const leashed = (u.timed ?? []).some((t) => t.mark === `leash:${h.id}`);
      if (h.id !== u.id && !near(u) && !leashed && !tied) continue;
      out.push({ e, label, holder: h, from: bs });
      continue;
    }
    if (h.id !== u.id) continue;
    if (scope === 'led' && !(leaderSheet(h, sheet) && getBearers().length)) continue;
    if (scope === 'bodyguardLed' && !(sheet === h.sources[0] && hasLivingLeader(h))) continue;
    if (!getBearers().length) continue;
    out.push({ e, label, holder: h, bearers: scope === 'model' ? getBearers() : undefined });
  }
}

/** THIEVES OF PAIN: the friendly unit that takes this unit's lost wounds as mortal wounds, if any. */
export function woundsGoTo(s: GameState, u: UnitState): UnitState | undefined {
  const id = unitFx(s, u).find((a) => a.e.redirectWounds)?.e.redirectWounds;
  const t = id ? s.units.find((x) => x.id === id) : undefined;
  return t && t.id !== u.id && t.status === 'board' && alive(t).length && !unitFx(s, t).some((a) => a.e.redirectWounds) ? t : undefined;
}

/** Emotionless Clarity: a friendly bearer within range makes this model's Deadly Demise go off without a roll (once per turn). */
export function demiseSure(s: GameState, u: UnitState, m: ModelState): boolean {
  for (const x of boardUnits(s, u.owner)) for (const a of unitFx(s, x)) {
    const q = a.e.demiseSure;
    if (!q || a.holder.id !== x.id || !unitMatches(u, q.units) || (x.used ?? {})[`sure:${a.label}`] === String(s.turn)) continue;
    if (!alive(x).some((n) => baseDist(n, m) <= q.range + 1e-6)) continue;
    (x.used ??= {})[`sure:${a.label}`] = String(s.turn);
    log(s, `${a.label}: the Deadly Demise of ${m.name} goes off without a roll`, 'info', u.owner);
    return true;
  }
  return false;
}

/** Deadly Demise X+ for a model destroyed by this attacker's weapon (Armour Obliteration), or 6. */
export function killDemiseOn(s: GameState, A: UnitState, weapon: string): number {
  return Math.min(6, ...effectsFor(s, A).filter((a) => a.e.killDemiseOn && (!a.e.weapon || wk(weapon).includes(wk(a.e.weapon)))).map((a) => a.e.killDemiseOn!));
}

export function effectsFor(s: GameState, u: UnitState): Active[] {
  const hit = memo?.fx.get(u.id);
  if (hit) return hit;
  const out = collectEffects(s, u);
  memo?.fx.set(u.id, out);
  return out;
}

function collectEffects(s: GameState, u: UnitState): Active[] {
  const out: Active[] = [];
  for (const { e, label } of playerDetEffects(s, u.owner)) if (unitMatches(u, e.units)) out.push({ e, label, holder: u });
  const doc = DET_RULES[DOCTRINES]?.choice;
  for (const id of unitDoctrines(s, u)) {
    const o = doc?.options.find((x) => x.id === id);
    for (const e of o?.effects ?? []) if (unitMatches(u, e.units)) out.push({ e, label: o!.name, holder: u });
  }
  for (const h of s.units) {
    if (h.status === 'destroyed') continue;
    for (const a of h.abilities ?? []) {
      const rule = abilityRule(h, a);
      if (!rule?.effects?.length || abilityOff(h, a)) continue;
      let bearers: ModelState[] | undefined;
      ruleEffects(s, u, h, rule.effects, a.name, abilitySheet(h, a), () => (bearers ??= bearersOf(h, a, rule)), out);
    }
    for (const g of grantsOf(s, h)) {
      if (!g.rule.effects?.length) continue;
      ruleEffects(s, u, h, g.rule.effects, g.name, h.sources[0], () => alive(h).filter((m) => !g.models || m.keywords.includes(g.models)), out);
    }
  }
  for (const t of u.timed ?? []) out.push({ e: t.e, label: t.label, holder: u, bearers: t.models ? u.models.filter((m) => !m.dead && t.models!.includes(m.id)) : undefined });
  // army-rule effects kept by faction modules (Blessings of Khorne, Plagues, Malefic Surge ...)
  for (const src of effectSources) out.push(...src(s, u));
  return out;
}

// ---------- Combat Doctrines ----------

export const DOCTRINES = 'Combat Doctrines';

/** The combat doctrines active for a unit: the army's pick (units with the Combat Doctrines ability), one a rule or
 *  stratagem made active for this unit (a timed "doctrine:x" mark), and the ones always active for it (Codex Adept,
 *  Adept of the Codex, Wrath of Angels …). A rule that says only one doctrine can be active for a unit wins. */
export function unitDoctrines(s: GameState, u: UnitState): Set<string> {
  const out = new Set<string>();
  const P = s.players[u.owner];
  const rules = activeRules(s, u.owner);
  if (rules.includes(DOCTRINES) && u.abilities.some((a) => a.name === DOCTRINES)) for (const id of P.det?.[DOCTRINES]?.active ?? []) out.add(id);
  for (const t of u.timed ?? []) if (t.mark?.startsWith('doctrine:')) out.add(t.mark.slice(9));
  for (const a of u.abilities) { const r = abilityRule(u, a); for (const id of r?.doctrines ?? []) out.add(id); }
  for (const name of rules) {
    for (const g of DET_RULES[name]?.doctrines ?? []) {
      if (!unitMatches(u, g.units)) continue;
      if (g.only) for (const id of [...out]) if (!g.ids.includes(id)) out.delete(id);
      for (const id of g.ids) out.add(id);
    }
  }
  return out;
}

/** How many more times each combat doctrine can be selected this battle (once each, plus the detachment's extra uses). */
export function doctrineUsesLeft(s: GameState, p: PlayerId, ids: string[], used: string[]): Record<string, boolean> {
  const any = s.units.find((x) => x.owner === p);
  const grants = activeRules(s, p).flatMap((n) => DET_RULES[n]?.doctrineExtra ?? [])
    .filter((g) => !g.if || (any && g.if.every((c) => cond(c, { s, A: any, holder: any }))))
    .map((g) => ({ ...g, left: g.n }))
    .sort((a, b) => a.ids.length - b.ids.length);
  const count = (id: string) => used.filter((x) => x === id).length;
  for (const id of ids) {
    let over = count(id) - 1;
    for (const g of grants) while (over > 0 && g.left > 0 && g.ids.includes(id)) { g.left -= 1; over -= 1; }
  }
  return Object.fromEntries(ids.map((id) => [id, count(id) < 1 || grants.some((g) => g.left > 0 && g.ids.includes(id))]));
}

// ---------- conditions ----------

export interface Ctx {
  s: GameState;
  A: UnitState; // the unit the effect applies to (attacker for offence, target for defence)
  T?: UnitState; // the other unit of an attack
  m?: ModelState; // the model making the attack (or the model hit)
  w?: WeaponData;
  p?: WeaponProfileData;
  d?: number; // distance attacker model -> target
  kind?: 'melee' | 'ranged';
  holder?: UnitState;
  bearers?: ModelState[];
}

const isMVU = (u: UnitState) => hasKw(u, 'MONSTER') || hasKw(u, 'VEHICLE');
const onObjective = (s: GameState, u: UnitState) => s.objectives.some((o) => unitInRange(s, u, o));
const onOwnObjective = (s: GameState, u: UnitState) => s.objectives.some((o) => o.controller === u.owner && unitInRange(s, u, o));

/** "near:6:CHARACTER+SPACE WOLVES!WULFEN" — a friendly unit with those keywords within 6" of the ability's models. */
function nearCond(x: Ctx, spec: string): boolean {
  const [, rs, kws = ''] = spec.split(':');
  const r = Number(rs);
  const [need, not] = kws.split('!');
  const req = need ? need.split('+') : [];
  const from = x.bearers?.length ? x.bearers : alive(x.holder ?? x.A);
  const self = x.holder ?? x.A;
  return boardUnits(x.s, self.owner).some((f) => f.id !== self.id
    && req.every((k0) => k0.split('|').some((k) => f.keywords.includes(k) || f.factionKeywords.includes(k) || f.sources.includes(k)))
    && !(not && (f.keywords.includes(not) || f.sources.includes(not)))
    && alive(f).some((n) => from.some((b) => baseDist(b, n) <= r + 1e-6)));
}

/** "nearModels:6:BLOOD ANGELS+CHARACTER!WULFEN" — a friendly model (this unit's own models count) with those keywords within 6". */
function nearModelsCond(x: Ctx, spec: string): boolean {
  const [, rs, kws = ''] = spec.split(':');
  const r = Number(rs);
  const [need, not] = kws.split('!');
  const req = need ? need.split('+') : [];
  const self = x.holder ?? x.A;
  const from = x.bearers?.length ? x.bearers : alive(self);
  const has = (f: UnitState, n: ModelState, k: string) => n.keywords.includes(k) || f.factionKeywords.includes(k) || (k === 'CHARACTER' && n.isCharacter) || wk(n.source) === wk(k);
  return boardUnits(x.s, self.owner).some((f) => alive(f).some((n) => req.every((k) => has(f, n, k)) && !(not && has(f, n, not))
    && from.some((b) => b.id !== n.id && baseDist(b, n) <= r + 1e-6)));
}

/** "nearCount:6:2:AELDARI+PSYKER" — at least 2 other friendly models with those keywords within 6" of this model (Psychic Communion). */
function nearCountCond(x: Ctx, spec: string): boolean {
  const [, rs, ns, kws = ''] = spec.split(':');
  const self = x.holder ?? x.A;
  const from = x.m ? [x.m] : x.bearers?.length ? x.bearers : alive(self);
  const req = kws.split('+').filter(Boolean);
  const has = (f: UnitState, n: ModelState, k: string) => n.keywords.includes(k) || f.factionKeywords.includes(k) || f.keywords.includes(k);
  const near = boardUnits(x.s, self.owner).flatMap((f) => alive(f).filter((n) => req.every((k) => has(f, n, k)) && from.some((b) => b.id !== n.id && baseDist(b, n) <= Number(rs) + 1e-6)));
  return near.length >= Number(ns);
}

function closestEnemy(s: GameState, A: UnitState, T: UnitState): boolean {
  let best = Infinity, bestId = '';
  for (const e of boardUnits(s, other(A.owner))) {
    const d = Math.min(...alive(A).flatMap((m) => alive(e).map((n) => baseDist(m, n))));
    if (d < best - 1e-6) { best = d; bestId = e.id; }
  }
  return bestId === T.id;
}

/** The enemy unit (of `p`'s opponent) that last moved, attacked or declared a charge, this phase. */
export function lastEnemyAct(s: GameState, p: PlayerId) {
  const a = s.lastAct;
  if (!a || a.owner === p || a.turn !== s.turn || a.phase !== s.phase) return null;
  const u = s.units.find((x) => x.id === a.unitId);
  return u ? { a, u } : null;
}


/** What a Bondsman ability does to the ARMIGER model it affects (knights.ts). */
export const bondOf = (u: UnitState, name: string) => { const a = u.abilities.find((x) => x.name === name); return a ? abilityRule(u, a)?.bond : undefined; };

/** Condition names cond() did not recognise: a rule using one silently never applies (the data test checks this). */
export const unknownConds = new Set<string>();

export function cond(c: string, x: Ctx): boolean {
  const { s, A, T } = x;
  if (c.startsWith('!')) return !cond(c.slice(1), x);
  if (c.startsWith('near:')) return nearCond(x, c);
  const own = condExact.get(c);
  if (own) return own(c, x);
  for (const q of condPatterns) if (q.re.test(c)) return q.fn(c, x);
  // Snarling Protector: a friendly engaged PSYKER unit is within 12"
  if (c.startsWith('nearEngaged:')) { const [, d, k] = c.split(':'); return boardUnits(s, A.owner).some((f) => f.id !== A.id && hasKw(f, k) && engagedEnemies(s, f).length > 0 && unitDistance(A, f) <= Number(d) + 1e-6); }
  // "wholly within 12\" of your opponent's deployment zone"
  if (c.startsWith('nearEnemyDz:')) {
    const z = toPoly(deploymentById(s.deploymentId).zones[s.players[other(A.owner)].role]);
    const d = Number(c.slice(12));
    return alive(A).length > 0 && alive(A).every((m) => pointInPoly(m, z) || Math.min(...polyEdges(z).map((e) => pointSegDist(m, e))) + m.r <= d + 1e-6);
  }
  // Raider's Due: an enemy unit within range of an objective is within X" of this unit
  if (c.startsWith('enemyOnObjectiveWithin:')) { const d = Number(c.split(':')[1]); return boardUnits(s, other(A.owner)).some((e) => unitDistance(A, e) <= d + 1e-6 && s.objectives.some((o) => unitInRange(s, e, o))); }
  // Choice Samples: a friendly HERETIC ASTARTES INFANTRY unit within X" is below its Starting Strength
  if (c.startsWith('nearBelowStart:')) { const d = Number(c.split(':')[1]); return boardUnits(s, A.owner).some((f) => f.id !== A.id && hasKw(f, 'INFANTRY') && f.factionKeywords.includes('HERETIC ASTARTES') && alive(f).length < f.startingStrength && unitDistance(A, f) <= d + 1e-6); }
  if (c.startsWith('minModels:')) return alive(A).length >= Number(c.slice(10));
  // a unit embarked within this TRANSPORT has this keyword (Targetin' Gizmos: a Big Mek inside)
  if (c.startsWith('embarkedKw:')) { const k = c.slice(11); return s.units.some((x) => x.status === 'embarked' && x.embarkedIn === A.id && alive(x).some((m) => m.keywords.includes(k))); }
  if (c.startsWith('hasAbility:')) return A.abilities.some((a) => a.name === c.slice(11));
  if (c.startsWith('enh:')) return (x.holder ?? A).enhancements.some((e) => e.name === c.slice(4));
  // the target is engaged with a friendly unit with this keyword (Clutching Corruption: PLAGUE LEGIONS)
  if (c.startsWith('targetEngagedWithKw:')) { const k = c.slice(20); return !!T && boardUnits(s, A.owner).some((f) => (hasKw(f, k) || f.factionKeywords.includes(k)) && engagedEnemies(s, f).some((e) => e.id === T.id)); }
  if (c.startsWith('targetWithin:')) return !!T && unitDistance(A, T) <= Number(c.split(':')[1]) + 1e-6;
  if (c.startsWith('targetModelsAtLeast:')) return !!T && alive(T).length >= Number(c.slice(20));
  if (c === 'targetWarlord') return !!T?.isWarlordUnit;
  if (c === 'attached') return A.sources.length > 1;
  if (c === 'friendlyLostToLast') return (lastEnemyAct(s, A.owner)?.a.lost ?? []).some((id) => id !== A.id);
  if (c.startsWith('weaponHas:')) return !!x.p?.abilities.some((a) => wk(a) === wk(c.slice(10)));
  // Cultist's Brand: every other model in the unit (Dark Disciples aside) is DAMNED
  if (c === 'othersDamned') return alive(A).every((m) => (x.bearers ?? []).some((b) => b.id === m.id) || m.keywords.includes('DAMNED') || /dark disciple/i.test(m.name));
  // "visible to a friendly HURON BLACKHEART model": a friendly model with this name can see the unit
  if (c.startsWith('seenBy:')) { const n = wk(c.slice(7)); return boardUnits(s, A.owner).some((f) => alive(f).some((m) => (wk(m.name).includes(n) || wk(m.source).includes(n)) && (f.id === A.id || alive(A).some((o) => hasLos(s, m, o))))); }
  if (c.startsWith('contains:')) { const n = wk(c.slice(9)); return alive(A).some((m) => wk(m.name).includes(n) || wk(m.source).includes(n)); }
  if (c.startsWith('body:')) return A.sources[0] === c.slice(5) || wk(A.sources[0]).includes(wk(c.slice(5)));
  if (c.startsWith('leader:')) { const n = wk(c.slice(7)); return hasLivingLeader(A) && A.sources.slice(1).some((src) => n.split('|').some((x2) => wk(src).includes(x2))); }
  if (c.startsWith('within:')) return (x.d ?? Infinity) <= Number(c.slice(7)) + 1e-6;
  // a detachment choice that is active for the army (Combat Doctrines …): "detActive:assault"
  if (c.startsWith('detActive:')) {
    const id = c.slice(10);
    if (unitDoctrines(s, A).has(id)) return true;
    return Object.entries(s.players[A.owner].det ?? {}).some(([n, d]) => n !== DOCTRINES && (d as { active?: string[] }).active?.includes(id));
  }
  if (c.startsWith('beyond:')) return (x.d ?? 0) > Number(c.slice(7)) + 1e-6;
  if (c.startsWith('targetKw:')) return !!T && c.slice(9).split('|').some((k) => T.keywords.includes(k) || T.factionKeywords.includes(k));
  if (c.startsWith('targetNotKw:')) return !!T && !c.slice(12).split('|').some((k) => T.keywords.includes(k));
  if (c.startsWith('targetMarked:')) return !!T && (T.timed ?? []).some((t) => t.mark === c.slice(13) && t.by === A.owner);
  if (c.startsWith('marked:')) return (A.timed ?? []).some((t) => t.mark === c.slice(7) && t.by === A.owner);
  if (c.startsWith('modelFrom:')) return !!x.m && wk(x.m.source).includes(wk(c.slice(10)));
  if (c.startsWith('modelName:')) return !!x.m && wk(x.m.name).includes(wk(c.slice(10)));
  if (c.startsWith('hasWeapon:')) { const n = wk(c.slice(10)); return (x.bearers?.length ? x.bearers : alive(x.holder ?? A)).some((m) => m.weapons.some((w) => wk(w.name).includes(n))); }
  if (c.startsWith('farFromEnemies:')) { const r = Number(c.slice(15)); return onBoard(A) && !boardUnits(s, other(A.owner)).some((e) => unitDistance(A, e) <= r + 1e-6); }
  if (c.startsWith('nearMarked:')) { const [, mark, rs] = c.split(':'); return boardUnits(s, other(A.owner)).some((e) => (e.timed ?? []).some((t) => t.mark === mark && t.by === A.owner) && unitDistance(A, e) <= Number(rs) + 1e-6); }
  if (c.startsWith('nearModels:')) return nearModelsCond(x, c);
  if (c.startsWith('nearCount:')) return nearCountCond(x, c);
  // a detachment rule / army rule the unit's army has: "rule:Searing Soulflame" or the detachment's name
  if (c.startsWith('rule:')) return activeRules(s, A.owner).includes(c.slice(5));
  if (c.startsWith('roundAtLeast:')) return s.round >= Number(c.slice(13));
  if (c.startsWith('targetFar:')) { const r = Number(c.slice(10)); return !!T && !boardUnits(s, other(T.owner)).some((e) => unitDistance(T, e) <= r + 1e-6); }
  if (c.startsWith('enemyBetween:')) { const [lo, hi] = c.slice(13).split(':').map(Number); return boardUnits(s, other(A.owner)).some((e) => { const d = unitDistance(A, e); return d > lo + 1e-6 && d <= hi + 1e-6; }); }
  // wholly within X" of one or more battlefield edges (every model near the same or any edge)
  if (c.startsWith('nearEdge:')) { const d = Number(c.slice(9)); const W = RULES.battlefield.width, H = RULES.battlefield.height; return alive(A).every((m) => Math.min(m.x, m.y, W - m.x, H - m.y) + m.r <= d + 1e-6); }
  if (c.startsWith('enemyEngagedWithin:')) { const r = Number(c.slice(19)); return boardUnits(s, other(A.owner)).some((e) => engagedEnemies(s, e).length > 0 && unitDistance(A, e) <= r + 1e-6); }
  if (c.startsWith('pact:')) return (s.players[A.owner].pactPoints ?? 0) >= Number(c.slice(5));
  if (c.startsWith('enemyModelsEngaged:')) return engagedEnemies(s, A).flatMap(alive).filter((e) => alive(A).some((m) => baseDist(m, e) <= RULES.engagementRange + 1e-6)).length >= Number(c.slice(19));
  if (c.startsWith('bodyKw:')) return A.sources.length > 1 && alive(A).some((m) => m.source === A.sources[0] && m.keywords.includes(c.slice(7)));
  if (c.startsWith('minModels:')) return alive(A).length >= Number(c.slice(10));
  if (c.startsWith('minModelsNamed:')) { const [, n, k] = c.split(':'); return alive(A).filter((m) => wk(m.name).includes(wk(n))).length >= Number(k); }
  if (c.startsWith('modelKw:')) return !!x.m && x.m.keywords.includes(c.slice(8));
  if (c.startsWith('modelSource:')) return !!x.m && x.m.source === c.slice(12);
  if (c.startsWith('any:')) return c.slice(4).split('||').some((alt) => cond(alt, x));
  if (c.startsWith('armyHas:')) return s.units.some((f) => f.owner === A.owner && f.status !== 'destroyed' && f.sources.includes(c.slice(8)));
  if (c.startsWith('armyOnBoard:')) return boardUnits(s, A.owner).some((f) => f.sources.includes(c.slice(12)) && alive(f).some((m) => m.source === c.slice(12)));
  if (c.startsWith('disembarkedFrom:')) { const t = A.disembarkedFrom && A.disembarkedTurn === s.turn ? s.units.find((f) => f.id === A.disembarkedFrom) : undefined; return !!t && t.sources.some((n) => wk(n).includes(wk(c.slice(16)))); }
  if (c.startsWith('all:')) return c.slice(4).split('&&').every((alt) => cond(alt, x));
  if (c.startsWith('maxWBelow:')) return Math.max(...alive(A).map((m) => m.profile.W)) < Number(c.slice(10));
  if (c.startsWith('kw:')) return c.slice(3).split('|').some((k) => A.keywords.includes(k) || A.factionKeywords.includes(k) || A.sources.some((n) => wk(n) === wk(k)) || alive(A).some((m) => m.keywords.includes(k)));
  if (c.startsWith('nearLast:')) { const L = lastEnemyAct(s, A.owner); return !!L && onBoard(L.u) && unitDistance(A, L.u) <= Number(c.slice(9)) + 1e-6; }
  if (c.startsWith('doctrine:')) return unitDoctrines(s, A).has(c.slice(9));
  if (c.startsWith('marked:')) return (A.timed ?? []).some((t) => t.mark === c.slice(7));
  if (c.startsWith('friendMarked:')) return s.units.some((f) => f.owner === A.owner && (f.timed ?? []).some((t) => t.mark === c.slice(13)));
  if (c.startsWith('targetKwAll:')) return !!T && c.slice(12).split('|').some((k) => alive(T).every((n) => n.keywords.includes(k)));
  if (c.startsWith('detachment:')) return (s.players[A.owner].detachments ?? []).some((d) => d.name === c.slice(11));
  if (c.startsWith('targetNearFriendly:')) {
    // "targetNearFriendly:9:THOUSAND SONS+PSYKER": the target is within X" of a unit of A's army with all those keywords
    const [, rs, kws = ''] = c.split(':');
    const req = kws ? kws.split('+') : [];
    return !!T && boardUnits(s, A.owner).some((f) => req.every((k) => f.keywords.includes(k) || f.factionKeywords.includes(k)) && unitDistance(f, T) <= Number(rs) + 1e-6);
  }
  if (c.startsWith('meleeWeapons:')) return !!x.m && x.m.weapons.filter((w) => w.profiles[0].range === 'Melee').length >= Number(c.slice(13));
  switch (c) {
    case 'targetPsyHit': return !!T && T.psyHit?.key === `${s.turn}|${s.phase}` && T.psyHit.by === A.owner;
    case 'targetOnUncontrolledObjective': return !!T && s.objectives.some((o) => o.controller !== A.owner && unitInRange(s, T, o));
    case 'readied': return !!A.readied;
    case 'usedBattleAbility': return Object.values(A.used ?? {}).some((v) => v.startsWith('battle|'));
    case 'targetTougher': return !!T && Math.max(...alive(T).map((m) => m.profile.T)) > Math.max(...alive(x.holder ?? A).map((m) => m.profile.T));
    case 'markAlive': { const id = (x.holder ?? A).mark; return !!id && s.units.some((e) => e.id === id && e.status !== 'destroyed' && alive(e).length > 0); }
    // below starting / half strength, a single-model unit counting its wounds
    case 'belowStartingW': return A.startingStrength === 1 ? alive(A).some((m) => m.wounds < m.profile.W) : alive(A).length < A.startingStrength;
    case 'belowHalfW': return A.startingStrength === 1 ? alive(A).some((m) => m.wounds * 2 < m.profile.W) : alive(A).length * 2 < A.startingStrength;
    case 'engagedMV': return engagedEnemies(s, A).some((e) => isMVU(e));
    case 'engagedNotMV': return engagedEnemies(s, A).some((e) => !isMVU(e));
    // [LETHAL HITS] beats [SUSTAINED HITS 1] when the unit's melee attacks wound the engaged enemy on a 4+ or worse
    case 'lethalBetter': {
      const S = Math.max(0, ...alive(A).flatMap((m) => m.weapons.flatMap((w) => w.profiles.filter((p) => p.range === 'Melee').map((p) => p.S ?? 0))));
      return engagedEnemies(s, A).some((e) => Math.max(...alive(e).map((m) => m.profile.T)) >= S);
    }
    case 'targetMark': return !!T && (x.holder ?? A).mark === T.id;
    case 'advanced': return A.move === 'advance';
    case 'fellBack': return A.move === 'fallback';
    case 'targetOfAttack': return s.attack?.targetId === A.id;
    // the attack on this unit right now is a heavy one (AP -2 or better and 2+ damage a hit): worth a once-per-battle save
    case 'dangerousAttack': return s.attack?.targetId === A.id && s.attack.pools.some((p) => (p.ap ?? 0) <= -2 && exprAverage(String(p.damage ?? p.profile.D)) >= 2);
    case 'onControlledObjective': return s.objectives.some((o) => o.controller === A.owner && unitInRange(s, A, o));
    case 'hasEmbarked': return s.units.some((e) => e.embarkedIn === A.id && e.status === 'embarked');
    case 'hasEmbarkedBattleline': return s.units.some((e) => e.embarkedIn === A.id && e.status === 'embarked' && alive(e).some((m) => m.keywords.includes('BATTLELINE')));
    case 'fellBackFromLast': { const L = s.lastAct; return !!L && L.owner !== A.owner && L.turn === s.turn && !!L.fellBackFrom?.includes(A.id); }
    case 'heavyTransport': return !!A.transport && Math.max(...A.models.map((m) => m.profile.W)) >= 14;
    case 'torrentWeapon': return alive(A).some((m) => m.weapons.some((w) => w.profiles.some((p) => p.abilities.some((ab) => ab.startsWith('torrent')))));
    case 'engagedWithLast': { const L = lastEnemyAct(s, A.owner); return !!L && engagedEnemies(s, A).some((e) => e.id === L.u.id); }
    case 'targetOfLast': return !!lastEnemyAct(s, A.owner)?.a.targets.includes(A.id);
    case 'lostToLast': return !!lastEnemyAct(s, A.owner)?.a.lost.includes(A.id);
    case 'halvedByLast': return !!lastEnemyAct(s, A.owner)?.a.halved.includes(A.id);
    case 'engaged': return engagedEnemies(s, A).length > 0;
    case 'onVowed': return (s.players[A.owner].vowed ?? []).some((id) => { const o = s.objectives.find((q) => q.id === id); return !!o && unitInRange(s, A, o); });
    case 'entrenched': return alive(A).some((m) => withinTerrain(s, m).length > 0) && A.setUpTurn !== s.turn && (A.maxMoved ?? 0) <= 3 + 1e-6;
    case 'killedThisPhase': return s.destroyedByTurn.some((d) => d.turn === s.turn && d.phase === s.phase && d.killerId === A.id);
    case 'charged': return A.chargedTurn === s.turn;
    case 'normalMoved': return A.move === 'normal';
    case 'hidden': return alive(A).length > 0 && alive(A).every((n) => isHidden(s, A, n));
    case 'stationary': return A.move === 'stationary' || (A.lastStationaryTurn !== undefined && s.turn - A.lastStationaryTurn <= 1);
    case 'notAdvanced': return A.move !== 'advance';
    case 'within12': return (x.d ?? Infinity) <= 12 + 1e-6;
    case 'targetBattleShocked': return !!T && T.battleShocked;
    case 'within6': return (x.d ?? Infinity) <= 6 + 1e-6;
    case 'targetMV': return !!T && isMVU(T);
    case 'targetNotMV': return !!T && !isMVU(T);
    case 'targetMVF': return !!T && (isMVU(T) || hasKw(T, 'FORTIFICATION'));
    case 'targetCharMV': return !!T && (isMVU(T) || hasKw(T, 'CHARACTER'));
    case 'targetCharacter': return !!T && hasKw(T, 'CHARACTER');
    case 'targetInfantry': return !!T && hasKw(T, 'INFANTRY');
    case 'targetFly': return !!T && hasKw(T, 'FLY');
    case 'targetNotFly': return !!T && !hasKw(T, 'FLY');
    case 'targetFullStrength': return !!T && alive(T).length >= T.startingStrength;
    case 'targetBelowStarting': return !!T && alive(T).length < T.startingStrength;
    case 'targetBelowHalf': return !!T && alive(T).length * 2 < T.startingStrength;
    case 'targetNotBelowHalf': return !!T && alive(T).length * 2 >= T.startingStrength;
    case 'targetHidden': return !!T && alive(T).some((n) => isHidden(s, T, n));
    case 'targetNoT7': return !!T && alive(T).every((n) => n.profile.T < 7);
    case 'targetIsolated': return !!T && !boardUnits(s, T.owner).some((o) => o.id !== T.id && Math.min(...alive(o).flatMap((a1) => alive(T).map((b1) => baseDist(a1, b1)))) <= 6);
    case 'targetClosest': return !!T && closestEnemy(s, A, T);
    case 'targetOath': return !!T && s.players[A.owner].oathTarget === T.id;
    case 'targetQuarry': return !!T && A.quarry === T.id;
    case 'targetVowed': return !!T && (s.players[A.owner].vowed ?? []).some((id) => { const o = s.objectives.find((q) => q.id === id); return !!o && unitInRange(s, T, o); });
    case 'targetOnPriority': return !!T && (() => { const id = s.players[A.owner].priorityObjective; const o = s.objectives.find((q) => q.id === id); return !!o && unitInRange(s, T, o); })();
    case 'targetNearFriendlyAA12': return !!T && boardUnits(s, A.owner).some((f) => f.factionKeywords.includes('ADEPTUS ASTARTES') && Math.min(...alive(f).flatMap((a1) => alive(T).map((b1) => baseDist(a1, b1)))) <= 12);
    case 'targetEngagedFriendlyVehicle': return !!T && boardUnits(s, A.owner).some((f) => hasKw(f, 'VEHICLE') && engagedEnemies(s, f).some((e) => e.id === T.id));
    case 'targetOnObjective': return !!T && onObjective(s, T);
    case 'belowStarting': return alive(A).length < A.startingStrength;
    case 'belowStartingStrength': return alive(A).length < A.startingStrength;
    case 'belowHalf': return alive(A).length * 2 < A.startingStrength;
    case 'belowHalfStrength': return alive(A).length * 2 < A.startingStrength;
    case 'battleShocked': return A.battleShocked;
    case 'notBattleShocked': return !A.battleShocked;
    case 'inTerrain': return alive(A).some((m) => withinTerrain(s, m).length > 0);
    case 'targetInTerrain': return !!T && alive(T).some((m) => withinTerrain(s, m).length > 0);
    case 'onObjective': return onObjective(s, A);
    case 'onSeekerObjective': return !!A.seekerObjective && s.objectives.some((o) => o.id === A.seekerObjective && unitInRange(s, A, o));
    case 'onOwnObjective': return onOwnObjective(s, A);
    case 'centreOrObjective': return onObjective(s, A) || alive(A).some((m) => dist(m, { x: RULES.battlefield.width / 2, y: RULES.battlefield.height / 2 }) - m.r <= 6);
    case 'objectiveEitherWay': return onObjective(s, A) || (!!T && onObjective(s, T));
    case 'riled': return isRiled(s, A);
    case 'setUpThisTurn': return A.setUpTurn === s.turn;
    case 'chargedOrArrived': return A.chargedTurn === s.turn || A.move === 'ingress' || A.setUpTurn === s.turn;
    case 'disembarkedThisTurn': return A.disembarkedTurn === s.turn;
    case 'hasOrder': return (A.timed ?? []).some((t) => t.label.startsWith('Order: '));
    case 'heavyWeapon': return !!x.p && x.p.abilities.some((a) => a === 'heavy' || a.startsWith('heavy'));
    case 'blastWeapon': return !!x.p && x.p.abilities.includes('blast');
    case 'plasmaWeapon': return /plasma/i.test(`${x.w?.name ?? ''} ${x.p?.name ?? ''}`);
    case 'torrentAttack': return !!x.p && x.p.abilities.includes('torrent');
    case 'torrentOrMelta': return !!x.p && x.p.abilities.some((a) => a === 'torrent' || a.startsWith('melta'));
    case 'outnumberOrGangUp': return !!T && (alive(A).length > alive(T).length
      || boardUnits(s, A.owner).some((f) => f.id !== A.id && f.factionKeywords.includes('ADEPTUS ASTARTES') && engagedEnemies(s, f).some((e) => e.id === T.id)));
    case 'ownShooting': return s.phase === 'shooting' && A.owner === s.active;
    case 'ownTurn': return A.owner === s.active;
    case 'fightPhase': return s.phase === 'fight';
    case 'shootingPhase': return s.phase === 'shooting';
    case 'leaderAttached': return hasLivingLeader(A);
    // Idols of Khorne: within 6" of a friendly World Eaters MONSTER or 9" of a TITANIC unit (+3" Chosen of the Blood God)
    case 'nearIdol': return boardUnits(s, A.owner).some((f) => f.id !== A.id && f.factionKeywords.includes('WORLD EATERS') && (hasKw(f, 'MONSTER') || hasKw(f, 'TITANIC'))
      && unitDistance(A, f) <= (hasKw(f, 'TITANIC') ? 9 : 6) + (f.enhancements.some((e) => e.name === 'Chosen of the Blood God') ? 3 : 0) + 1e-6);
    // The Scent of Blood: an enemy unit below Starting Strength / Half-strength within 9"
    case 'enemyNearBelowStart': return boardUnits(s, other(A.owner)).some((e) => unitDistance(A, e) <= 9 + 1e-6 && alive(e).length < e.startingStrength);
    case 'enemyNearBelowHalf': return boardUnits(s, other(A.owner)).some((e) => unitDistance(A, e) <= 9 + 1e-6 && alive(e).length * 2 < e.startingStrength);
    case 'warlord': {
      // "if a model with this ability is your WARLORD": the bearer itself, not a Warboss leading the Warlord's unit
      const H = x.holder ?? A;
      return !!H.isWarlordUnit && (!H.warlordSource || !x.bearers?.length || x.bearers.some((m) => m.source === H.warlordSource));
    }
    case 'notCharacterModel': return !!x.m && !x.m.isCharacter && !x.m.keywords.includes('CHARACTER');
    case 'twoMeleeWeapons': return !!x.m && x.m.weapons.filter((w) => w.profiles[0].range === 'Melee').length >= 2;
    case 'engaged': return engagedEnemies(s, A).length > 0;
    case 'notEngaged': return engagedEnemies(s, A).length === 0;
    case 'onBattlefield': return onBoard(x.holder ?? A);
    case 'holderOnBattlefield': return onBoard(x.holder ?? A);
    case 'holderNotShocked': return !(x.holder ?? A).battleShocked;
    case 'targetSlayer': { const kw = s.players[A.owner].slayer?.[(x.holder ?? A).id]; return !!T && !!kw && hasKw(T, kw); }
    case 'enemyCharacterWithin12': return boardUnits(s, other(A.owner)).some((e) => hasKw(e, 'CHARACTER') && unitDistance(A, e) <= 12 + 1e-6);
    case 'engagedWithCharacter': return engagedEnemies(s, A).some((e) => hasKw(e, 'CHARACTER'));
    case 'ingressThisTurn': return A.setUpTurn === s.turn && A.move === 'ingress';
    case 'hiddenUnengaged': return onBoard(A) && engagedEnemies(s, A).length === 0 && alive(A).every((m) => isHidden(s, A, m));
    case 'onHomeObjective': return s.objectives.some((o) => o.type === 'home' && o.owner === A.owner && unitInRange(s, A, o));
    case 'targetInRangeOfObjective': return !!T && onObjective(s, T);
    case 'notMoved': return !A.move || A.move === 'stationary';
    case 'notMovedYet': return !A.move;
    case 'sameRangedWeapons': {
      const kinds = new Set(alive(A).flatMap((m) => m.weapons.filter((w) => w.profiles[0].range !== 'Melee').map((w) => w.name)));
      return kinds.size === 1;
    }
    case 'sagaDone': return !!s.players[A.owner].saga?.done || !!(x.holder ?? A).sagaDone;
    case 'psychicWeapon': return !!x.p && x.p.abilities.some((a) => a === 'psychic');
    case 'attackSLessT': return !!x.p && !!T && (x.p.S ?? 0) < Math.max(...alive(T).map((n) => n.profile.T));
    case 'transportMoved': return (A.move === 'normal' || A.move === 'advance') && A.setUpTurn !== s.turn;
    case 'destroyedUnitThisPhase': return (A.used ?? {}).killedUnit === phaseKey(s);
    case 'favoured': return s.players[A.owner].favoured === A.id;
    // made a Charge move in the previous turn and destroyed an enemy unit in that turn's Fight phase (Terrifying Spectacle)
    case 'lastTurnChargedKill': return A.chargedTurn === s.turn - 1 && s.destroyedByTurn.some((d) => d.killerId === A.id && d.turn === s.turn - 1 && d.phase === 'fight');
    case 'extraAttacksWeapon': return !!x.p && (x.p.abilities ?? []).includes('extra attacks');
    case 'vehicleNotWalker': return hasKw(A, 'VEHICLE') && !hasKw(A, 'WALKER');
    // a friendly LEGIONS OF EXCESS unit within 6" has lost models or wounds (Sustained by Agony has something to bring back)
    case 'loeHurtNear6': return boardUnits(s, A.owner).some((f) => f.factionKeywords.includes('LEGIONS OF EXCESS') && onBoard(f) && unitDistance(A, f) <= 6 + 1e-6 && (f.models.some((m) => m.dead) || alive(f).some((m) => m.wounds < m.profile.W)));
    // a friendly LEGIONS OF EXCESS unit within 6" destroyed an enemy unit this phase (Ecstatic Slaughter)
    case 'loeKillNear6': return boardUnits(s, A.owner).some((f) => f.factionKeywords.includes('LEGIONS OF EXCESS') && (f.used ?? {}).killedUnit === phaseKey(s) && unitDistance(A, f) <= 6 + 1e-6);
    case 'sustainedWeapon': return !!x.p && (x.p.abilities ?? []).some((k) => /^sustained hits/.test(k));
    case 'killedModelThisPhase': return (A.used ?? {}).killedModel === phaseKey(s);
    case 'chargeTargetEngagedWith:RAVENWING': return boardUnits(s, other(A.owner)).some((e) => unitDistance(A, e) <= 12 + 1e-6 && boardUnits(s, A.owner).some((f) => hasKw(f, 'RAVENWING') && engagedEnemies(s, f).some((g) => g.id === e.id)));
    case 'attackSLeqT': return !!x.p && !!T && (x.p.S ?? 0) <= Math.max(...alive(T).map((n) => n.profile.T));
    case 'enemyPsykerWithin12': return boardUnits(s, other(A.owner)).some((e) => hasKw(e, 'PSYKER') && unitDistance(A, e) <= 12 + 1e-6);
    case 'unengaged': return engagedEnemies(s, A).length === 0;
    case 'shotThisTurn': return A.shotTurn === s.turn;
    // set up as Reinforcements "until the end of your next Fight phase": this turn, or last (the opponent's) turn
    case 'reinforcedRecently': return (A.setUpTurn ?? 0) > 0 && (A.setUpTurn === s.turn || (A.setUpTurn === s.turn - 1 && s.active === A.owner));
    case 'lostModelsThisPhase': return (A.used ?? {}).lostModel === `${s.turn}:${s.phase}`;
    // Death Guard: the target is Afflicted / within half the weapon's range / in its own deployment zone
    case 'halfRange': return !!x.p && typeof x.p.range === 'number' && (x.d ?? Infinity) <= x.p.range / 2 + 1e-6;
    case 'whollyInOwnDz': return alive(A).every((m) => pointInPoly(m, toPoly(deploymentById(s.deploymentId).zones[s.players[A.owner].role])));
    case 'powerMatrix': return inPowerMatrix(s, A);
    case 'inEnemyDz': return alive(A).some((m) => pointInPoly(m, toPoly(deploymentById(s.deploymentId).zones[s.players[other(A.owner)].role])));
    case 'targetInOwnDz': return !!T && alive(T).some((m) => pointInPoly(m, toPoly(deploymentById(s.deploymentId).zones[s.players[T.owner].role])));
    case 'targetSeenByHolder': return !!T && (x.bearers?.length ? x.bearers : alive(x.holder ?? A)).some((b) => alive(T).some((o) => hasLos(s, b, o)));
    // defending: the attacker's model sees this unit in cover
    case 'inCover': return !!T && alive(T).some((am) => hasCover(s, am, A));
    case 'avengeVehicle': return (A.triggered ?? []).includes('avengeVehicle');
    case 'twoCharacters': return alive(A).filter((m) => m.isCharacter).length >= 2;
    case 'startingStrength5': return A.startingStrength >= 5;
    case 'attackerOnObjectiveOrTarget': return onObjective(s, A) || (!!T && onObjective(s, T));
    default: unknownConds.add(c); return false;
  }
}

const riledBase = (s: GameState, u: UnitState) => u.abilities.some((a) => a.name === 'Waaagh!') && s.players[u.owner].riledUntilTurn >= s.turn;
/** Orks: riled up by WAAAGH!, by an ability or by a timed effect. */
export function isRiled(s: GameState, u: UnitState): boolean {
  if (riledBase(s, u) || (u.riledUntil !== undefined && u.riledUntil >= s.turn)) return true;
  return effectsFor(s, u).some((a) => a.e.riled && (a.e.if ?? []).every((c) => c !== 'riled' && cond(c, { s, A: u, holder: a.holder, bearers: a.from ?? a.bearers })));
}

const holds = (a: Active, x: Ctx) => (a.e.if ?? []).every((c) => cond(c, { ...x, holder: a.holder, bearers: a.from ?? a.bearers }));
const modelOk = (a: Active, m?: ModelState) => !a.bearers || !m || a.bearers.some((b) => b.id === m.id);
const weaponOk = (a: Active, w?: WeaponData, p?: WeaponProfileData) => {
  if (!a.e.weapon) return true;
  const not = a.e.weapon.startsWith('!');
  const name = wk(not ? a.e.weapon.slice(1) : a.e.weapon);
  const has = !!w && (wk(w.name).includes(name) || wk(p?.name ?? '').includes(name));
  return not ? !!w && !has : has; // "!Thunder Hammer": every weapon but those
};
const rerolls = (e: { reroll?: Reroll | Reroll[] }): Reroll[] => (e.reroll ? (Array.isArray(e.reroll) ? e.reroll : [e.reroll]) : []);

// ---------- attacks: the attacker's side ----------

/** Effects of the attacking unit that apply to one model's attack with one weapon. */
export function offenceFor(s: GameState, A: UnitState, m: ModelState, T: UnitState, w: WeaponData, p: WeaponProfileData, kind: 'melee' | 'ranged', d: number): Active[] {
  const x: Ctx = { s, A, T, m, w, p, d, kind };
  return effectsFor(s, A).filter((a) => (!a.e.attack || a.e.attack === kind) && modelOk(a, m) && weaponOk(a, w, p) && holds(a, x)
    && (a.e.hit || a.e.wound || a.e.ap || a.e.strength || a.e.attacks || a.e.damage || a.e.reroll || a.e.abilities?.length || a.e.critHitOn || a.e.critWoundOn || a.e.critWoundAp || a.e.ignoreHitMods || a.e.ignoreWoundMods || a.e.givesCover || a.e.rapidFireFullRange || a.e.halfRangeAlways || a.e.mortalPerWound || a.e.skill || a.e.skillSet));
}

/** Marks on the target ("hit by Multi-spectrum Array: +1 to hit for your ADEPTUS ASTARTES") that help this attacker. */
export function incomingFor(s: GameState, A: UnitState, m: ModelState, T: UnitState, kind: 'melee' | 'ranged'): Incoming[] {
  return (T.timed ?? []).map((t) => t.e.incoming).filter((i): i is Incoming => !!i && i.by === A.owner && (!i.attack || i.attack === kind) && unitMatches(A, i.units)
    && (!i.fromTransport || (A.disembarkedTurn === s.turn && A.disembarkedFrom === i.fromTransport))
    && (!i.disembarked || A.disembarkedTurn === s.turn));
}

/** Extra Range for one weapon from effects that cover only some weapons (Imbued Manifestation: Psychic weapons +6"). */
export function weaponRangeFor(s: GameState, A: UnitState, m: ModelState, T: UnitState, w: WeaponData, p: WeaponProfileData): number {
  const x: Ctx = { s, A, T, m, w, p, kind: 'ranged' };
  return effectsFor(s, A).filter((a) => a.e.weaponRange && (!a.e.attack || a.e.attack === 'ranged') && modelOk(a, m) && weaponOk(a, w, p) && holds(a, x))
    .reduce((n, a) => n + (a.e.weaponRange ?? 0), 0);
}

/** Does the unit get a weapon ability from some effect, whatever the target (e.g. [ASSAULT] for Advance + shoot)? */
export function unitGrants(s: GameState, u: UnitState, ability: string, kind: 'melee' | 'ranged'): boolean {
  return effectsFor(s, u).some((a) => (!a.e.attack || a.e.attack === kind) && (Array.isArray(a.e.abilities) ? a.e.abilities.includes(ability) : a.e.abilities === ability)
    && (a.e.if ?? []).every((c) => /^target|^within|Weapon$|^!target/.test(c) || cond(c, { s, A: u, holder: a.holder, bearers: a.from ?? a.bearers })));
}

export const grants = (list: Active[], inc: Incoming[], ability: string) => list.some((a) => (Array.isArray(a.e.abilities) ? a.e.abilities.includes(ability) : a.e.abilities === ability)) || inc.some((i) => (Array.isArray(i.abilities) ? i.abilities.includes(ability) : i.abilities === ability));

/** Stable key so models with the same effects share an attack pool. */
export const fxKey = (list: Active[], inc: Incoming[]) => [...list.map((a) => `${a.label}:${JSON.stringify(a.e)}`), ...inc.map((i) => JSON.stringify(i))].sort().join(';');

export function addToExpr(expr: string, n: number): string {
  if (!n) return expr;
  const m = /^(\d+)$/.exec(expr.trim());
  if (m) return String(Math.max(1, +m[1] + n));
  const mm = /^(.*?)([+-]\d+)$/.exec(expr.trim());
  if (mm && /D/i.test(mm[1])) { const k = +mm[2] + n; return k ? `${mm[1]}${k > 0 ? '+' : ''}${k}` : mm[1]; }
  return `${expr}${n > 0 ? '+' : ''}${n}`;
}

/** Apply attacker effects + target marks + target defences to a new pool. Returns UI notes. */
export function applyAttackEffects(s: GameState, A: UnitState, T: UnitState, pool: Pool, list: Active[], inc: Incoming[], kind: 'melee' | 'ranged', d: number, toughness: number, woundNeedFn: (S: number, T: number) => number): string[] {
  const notes: string[] = [];
  const hitCap = RULES.modifierCaps.hitRoll, woundCap = RULES.modifierCaps.woundRoll;
  let strength = (pool.profile.S ?? 1) + offenceInto(s, A, T, pool, list, kind, notes);
  if (kind === 'melee') for (const b of meleeStrength(s, A)) { strength += b.n; notes.push(b.note); }
  for (const i of inc) {
    if (i.strength) { strength += i.strength; notes.push(`marked target: +${i.strength} S`); }
    if (i.hit && !pool.autoHit) { pool.hitMod = clamp(pool.hitMod + i.hit, -hitCap, hitCap); notes.push(`marked target: +${i.hit} to hit`); }
    if (i.wound) { pool.woundMod = clamp(pool.woundMod + i.wound, -woundCap, woundCap); notes.push(`marked target: +${i.wound} to wound`); }
    if (i.ap) { pool.ap -= i.ap; notes.push(`marked target: +${i.ap} AP`); }
    if (i.critWoundAp) { pool.critWoundAp = (pool.critWoundAp ?? 0) + i.critWoundAp; notes.push(`marked target: +${i.critWoundAp} AP on critical wound`); }
    if (i.critHitOn) { pool.critHitOn = Math.min(pool.critHitOn ?? 6, i.critHitOn); notes.push(`marked target: crit hit ${i.critHitOn}+`); }
    for (const r of rerolls(i)) applyReroll(pool, r, 'marked target', notes);
    if (i.blastReroll && pool.profile.abilities.includes('blast')) applyReroll(pool, 'hits', 'marked target (Blast)', notes);
    if (i.damage) { pool.damage = addToExpr(pool.damage, i.damage); notes.push(`marked target: +${i.damage} D`); }
    for (const ab of i.abilities ?? []) applyAbility(pool, ab, 'marked target', notes, kind, A, s, T);
  }
  // the target's side
  const def = defencesFor(s, T, kind, undefined, A);
  for (const { e, label } of def) {
    const df = e.defend!;
    const sm = df.strengthMinus ?? df.enemyStrengthMinus ?? 0;
    if (sm) { strength -= sm; notes.push(`${label}: S −${sm}`); }
  }
  if (strength !== (pool.profile.S ?? 1)) pool.woundNeed = woundNeedFn(Math.max(1, strength), toughness);
  pool.effS = strength;
  defenceInto(pool, def, strength, toughness, notes);
  if (notes.length) pool.woundNote = [pool.woundNote, notes.join(' · ')].filter(Boolean).join(' · ');
  void d;
  return notes;
}

/** Effects put on the attacker or the target after the attack was declared (a stratagem used "after targets are
 *  selected", such as Armour of Contempt): added to the pool just before its dice are rolled. */
export function applyLateEffects(s: GameState, A: UnitState, T: UnitState, pool: Pool, late: { attacker: TimedEffect[]; target: TimedEffect[] }, kind: 'melee' | 'ranged', toughness: number, woundNeedFn: (S: number, T: number) => number): string[] {
  const notes: string[] = [];
  const offence = late.attacker.filter((t) => !t.e.defend).map((t) => ({ e: t.e, label: t.label, holder: A }) as Active)
    .filter((a) => (!a.e.attack || a.e.attack === kind) && (a.e.if ?? []).every((c) => cond(c, { s, A, T, kind, holder: A })));
  const add = offenceInto(s, A, T, pool, offence, kind, notes);
  const strength = (pool.effS ?? pool.profile.S ?? 1) + add;
  if (add) { pool.effS = strength; pool.woundNeed = woundNeedFn(Math.max(1, strength), toughness); }
  const def = late.target.filter((t) => t.e.defend && (!t.e.defend.vs || t.e.defend.vs === kind)).map((t) => ({ e: t.e, label: t.label, holder: T }) as Active);
  defenceInto(pool, def, strength, toughness, notes);
  if (notes.length) pool.woundNote = [pool.woundNote, notes.join(' · ')].filter(Boolean).join(' · ');
  return notes;
}

/** The attacker's own modifiers into a pool; returns the change to Strength. */
function offenceInto(s: GameState, A: UnitState, T: UnitState, pool: Pool, list: Active[], kind: 'melee' | 'ranged', notes: string[]): number {
  const hitCap = RULES.modifierCaps.hitRoll, woundCap = RULES.modifierCaps.woundRoll;
  let strength = 0;
  const bump = (label: string, txt: string) => notes.push(`${label}: ${txt}`);
  for (const a of list) {
    const e = a.e;
    if (e.hit && !pool.autoHit) { pool.hitMod = clamp(pool.hitMod + e.hit, -hitCap, hitCap); bump(a.label, `${e.hit > 0 ? '+' : ''}${e.hit} hit`); }
    if (e.wound) { pool.woundMod = clamp(pool.woundMod + e.wound, -woundCap, woundCap); bump(a.label, `${e.wound > 0 ? '+' : ''}${e.wound} wound`); }
    if (e.ap) { pool.ap -= e.ap; bump(a.label, `+${e.ap} AP`); }
    if (e.critWoundAp) { pool.critWoundAp = (pool.critWoundAp ?? 0) + e.critWoundAp; bump(a.label, `+${e.critWoundAp} AP on critical wound`); }
    if (e.strength) { strength += e.strength; bump(a.label, `+${e.strength} S`); }
    if (e.attacks) { pool.attackBonus = (pool.attackBonus ?? 0) + e.attacks; bump(a.label, `+${e.attacks} A`); }
    if (e.damage) { pool.damage = addToExpr(pool.damage, e.damage); bump(a.label, `+${e.damage} D`); }
    if (e.critHitOn) { pool.critHitOn = Math.min(pool.critHitOn ?? 6, e.critHitOn); bump(a.label, `crit hit ${e.critHitOn}+`); }
    if (e.critWoundOn) { pool.critWoundOn = Math.min(pool.critWoundOn, e.critWoundOn); bump(a.label, `crit wound ${e.critWoundOn}+`); }
    if (e.ignoreHitMods) { pool.ignoreHitMods = true; bump(a.label, 'ignores Hit roll modifiers'); }
    if (e.ignoreWoundMods) { pool.ignoreWoundMods = true; bump(a.label, 'ignores Wound roll modifiers'); }
    if (e.mortalPerWound) { pool.mortalPerWound = (pool.mortalPerWound ?? 0) + e.mortalPerWound; bump(a.label, `+${e.mortalPerWound} mortal wound per wound`); }
    if (e.strengthPer5Models) {
      const n = alive(A).length + s.units.filter((p) => p.embarkedIn === A.id && p.status === 'embarked').reduce((x, p) => x + alive(p).length, 0);
      const add = Math.floor(n / 5);
      if (add) { strength += add; bump(a.label, `+${add} S`); }
    }
    if (e.attacksPerEmbarked) {
      const n = s.units.filter((p) => p.embarkedIn === A.id && p.status === 'embarked').reduce((x, p) => x + alive(p).length, 0);
      const add = Math.min(e.attacksPerEmbarked.max, n * e.attacksPerEmbarked.per);
      if (add) { pool.attackBonus = (pool.attackBonus ?? 0) + add; bump(a.label, `+${add} A`); }
    }
    if (e.attacksTo) { pool.instances = pool.instances.map((i) => ({ ...i, A: String(e.attacksTo) })); pool.profile = { ...pool.profile, A: String(e.attacksTo) }; bump(a.label, `A${e.attacksTo}`); }
    if (e.damageTo) { pool.damage = String(e.damageTo); bump(a.label, `D${e.damageTo}`); }
    for (const r of rerolls(e)) applyReroll(pool, r, a.label, notes);
    for (const ab of e.abilities ?? []) applyAbility(pool, ab, a.label, notes, kind, A, s, T);
  }
  void woundCap;
  return strength;
}

/** The target's defences (−1 to hit / wound, worse AP, hit rolls of 1-3 fail …) into a pool. */
function defenceInto(pool: Pool, def: Active[], strength: number, toughness: number, notes: string[]) {
  const hitCap = RULES.modifierCaps.hitRoll, woundCap = RULES.modifierCaps.woundRoll;
  for (const { e, label } of def) {
    const df = e.defend!;
    if (df.hit && !pool.autoHit && !pool.ignoreHitMods) { pool.hitMod = clamp(pool.hitMod + df.hit, -hitCap, hitCap); notes.push(`${label}: ${df.hit} hit`); }
    let wm = df.wound ?? 0;
    if ((df.woundIfStronger || df.woundMinusIfStronger) && strength > toughness) wm += df.woundIfStronger ?? -1;
    if (df.woundIfStrongerOrEqual && strength >= toughness) wm += df.woundIfStrongerOrEqual;
    if (pool.ignoreWoundMods && wm < 0) wm = 0;
    if (wm) { pool.woundMod = clamp(pool.woundMod + wm, -woundCap, woundCap); notes.push(`${label}: ${wm} wound`); }
    if (df.ap && pool.ap < 0) { pool.ap = Math.min(0, pool.ap + df.ap); notes.push(`${label}: AP worsened by ${df.ap}`); }
    if (df.minHit && !pool.autoHit) { pool.minHitUnmodified = Math.max(pool.minHitUnmodified ?? 0, df.minHit); notes.push(`${label}: unmodified Hit rolls of ${df.minHit - 1} or less fail`); }
  }
}

function applyReroll(pool: Pool, r: Reroll, label: string, notes: string[]) {
  if (r === 'hits' && !pool.rerollAllHits) { pool.rerollAllHits = true; notes.push(`${label}: re-roll hit`); }
  if (r === 'hits1' && !pool.rerollHits1) { pool.rerollHits1 = true; notes.push(`${label}: re-roll hit 1`); }
  if (r === 'wounds' && !pool.rerollAllWounds) { pool.rerollAllWounds = true; notes.push(`${label}: re-roll wound`); }
  if (r === 'wounds1' && !pool.rerollWounds1) { pool.rerollWounds1 = true; notes.push(`${label}: re-roll wound 1`); }
  if (r === 'wounds12' && !pool.rerollWounds12) { pool.rerollWounds12 = true; notes.push(`${label}: re-roll wound 1-2`); }
  if (r === 'damage' && !pool.rerollDamage) { pool.rerollDamage = true; notes.push(`${label}: re-roll damage`); }
  if (r === 'damage1' && !pool.rerollDamage1) { pool.rerollDamage1 = true; notes.push(`${label}: re-roll damage 1`); }
  if (r === 'damageOne' && !pool.rerollDamage && !pool.rerollDamageOne) { pool.rerollDamageOne = true; notes.push(`${label}: re-roll one Damage roll`); }
}

function applyAbility(pool: Pool, ab: string, label: string, notes: string[], kind: 'melee' | 'ranged', A: UnitState, s: GameState, T: UnitState) {
  // the same words as on a weapon profile, keyword conditions included ("lethal hits: monster/vehicle", "anti-non-vehicle 4+")
  const pa = parseAbility(ab);
  if (pa.key !== 'anti' && pa.cond && !condApplies(pa.cond, T.keywords)) return;
  const tag = abilityLabel(pa);
  switch (pa.key) {
    case 'sustained-hits': {
      const v = (pa.value ?? '1').toUpperCase();
      if (!pool.sustained || (/^\d$/.test(pool.sustained) && /^\d$/.test(v) && +v > +pool.sustained)) { pool.sustained = v; notes.push(`${label}: ${tag}`); }
      return;
    }
    case 'lethal-hits': if (!pool.lethal) { pool.lethal = true; notes.push(`${label}: ${tag}`); } return;
    case 'devastating-wounds': if (!pool.devastating) { pool.devastating = true; notes.push(`${label}: ${tag}`); } return;
    case 'precision': if (!pool.precision) { pool.precision = true; notes.push(`${label}: Precision`); } return;
    case 'precision-on-crit': if (!pool.precision && !pool.precisionOnCrit) { pool.precisionOnCrit = true; notes.push(`${label}: Precision (critical hit)`); } return;
    case 'twin-linked': if (!pool.twinLinked) { pool.twinLinked = true; notes.push(`${label}: Twin-linked`); } return;
    case 'hazardous': pool.hazardousAll = true; notes.push(`${label}: Hazardous`); return;
    case 'psychic': pool.psychic = true; return;
    case 'lance': if (kind === 'melee' && A.chargedTurn === s.turn) { pool.woundMod = clamp(pool.woundMod + 1, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll); notes.push(`${label}: Lance +1 wound`); } return;
    case 'anti': if (condApplies(pa.cond, T.keywords) && pa.on) { pool.critWoundOn = Math.min(pool.critWoundOn, pa.on); notes.push(`${label}: ${tag}`); } return;
    default: // assault / heavy / ignores cover / blast / cleave / rapid fire / close-quarters are handled while the pool is built
  }
}

/** Defensive effects of the target relevant to an attack of this kind. */
/** `attacker`: in a defence's conditions the "target…" ones look at the attacking unit (Terror Made Manifest). */
export function defencesFor(s: GameState, T: UnitState, kind: 'melee' | 'ranged', m?: ModelState, attacker?: UnitState): Active[] {
  return effectsFor(s, T).filter((a) => {
    const df = a.e.defend;
    if (!df) return false;
    const vs = df.vs ?? (df.rangedOnly ? 'ranged' : undefined);
    if (vs && vs !== kind) return false;
    if (a.bearers && m && !a.bearers.some((b) => b.id === m.id)) return false;
    if (a.bearers && !m && !alive(T).every((x) => a.bearers!.some((b) => b.id === x.id))) return false; // "this model" counts for the whole unit only if it is the whole unit
    return holds(a, { s, A: T, T: attacker, m });
  }).map((a) => ({ ...a }));
}

export const targetHasCover = (s: GameState, T: UnitState, d: number) => defencesFor(s, T, 'ranged').some((a) => a.e.defend!.cover || (a.e.defend!.coverUnless12 && d > 12 + 1e-6) || (!!a.e.defend!.coverUnlessWithin && d > a.e.defend!.coverUnlessWithin + 1e-6))
  || effectsFor(s, T).some((a) => a.e.stealth && holds(a, { s, A: T }));

/** "Cannot be targeted by ranged attacks unless the attacking model is within 12"". */
export const untargetableAt = (s: GameState, T: UnitState, d: number) => d > 12 + 1e-6 && defencesFor(s, T, 'ranged').some((a) => a.e.defend!.untargetableBeyond12);

/** Damage, invulnerable save and Feel No Pain for one model hit by an attack. */
export function modelDefence(s: GameState, T: UnitState, m: ModelState, kind: 'melee' | 'ranged' | 'mortal', psychic = false, attacker?: UnitState) {
  const list = kind === 'mortal' ? effectsFor(s, T).filter((a) => a.e.defend && modelOk(a, m) && holds(a, { s, A: T, T: attacker, m })) : defencesFor(s, T, kind, m, attacker);
  let damage = 0, damageSet: number | undefined, halve = false, inv: number | null = null, fnp: number | null = null, saveBonusD1 = 0, save = 0, worse = 0, negate = false, invReroll1 = false;
  let negateKey: 'turn' | 'round' | 'battle' | undefined;
  for (const a of list) {
    const df = a.e.defend!;
    if (a.bearers && !a.bearers.some((b) => b.id === m.id)) continue;
    if (df.charOnly && !m.isCharacter) continue;
    if (kind !== 'mortal') {
      if (df.negateOncePerPhase && T.used?.[`negate:${m.id}`] !== phaseKey(s)) negate = true;
      if (df.negateOnce && T.used?.[`negate:${df.negateOnce}`] !== negatePeriod(s, df.negateOnce)) { negate = true; negateKey = df.negateOnce; }
      if (df.damage && !(df.notPsychic && psychic)) damage += df.damage;
      if (df.halveDamage) halve = true;
      if (df.damageSet) damageSet = Math.min(damageSet ?? 99, df.damageSet);
      if (df.inv && (!df.invVs || (df.invVs === 'psychic' && psychic)) && (inv === null || df.inv < inv)) inv = df.inv;
      if (df.invReroll1) invReroll1 = true;
      if (df.saveBonusD1) saveBonusD1 = Math.max(saveBonusD1, df.saveBonusD1);
      if (df.save) {
        let add = df.save;
        if (df.saveMax3 && m.profile.Sv - add < 3) add = Math.max(0, m.profile.Sv - 3);
        if (add > 0) save = Math.max(save, add); else if (df.save < 0) worse += df.save;
      }
    }
    if (df.fnp) {
      const vs = df.fnpVs;
      const d1 = vs === 'damage1' && kind !== 'mortal' && s.attack?.pools[s.attack.idx]?.profile.D.trim() === '1';
      const ok = !vs || d1 || (vs === 'mortal' && kind === 'mortal') || (vs === 'psychic' && psychic) || (vs === 'mortalPsychic' && (kind === 'mortal' || psychic));
      if (ok && (fnp === null || df.fnp < fnp)) fnp = df.fnp;
    }
  }
  return { damage, damageSet, halve, inv, fnp, saveBonusD1, save: save + worse, negate, negateKey, invReroll1 };
}

/** Abilities of one model even after it was destroyed ("If this model is destroyed by a melee attack…"). */
function modelRules(s: GameState, u: UnitState, m: ModelState): { e: Effect; label: string }[] {
  const out: { e: Effect; label: string }[] = [];
  for (const a of u.abilities) {
    const rule = abilityRule(u, a);
    if (!rule?.effects || abilityOff(u, a) || abilitySheet(u, a) !== m.source) continue;
    for (const e of rule.effects) if ((e.scope ?? 'unit') === 'model' || (e.scope ?? 'unit') === 'unit') out.push({ e, label: a.name });
  }
  return out;
}

/** "Fights on death" and "shoots on death" that apply to this destroyed model. */
export function fightOnDeathFor(s: GameState, u: UnitState, m: ModelState): { fight?: { on: number; label: string; regain?: string }; shoot?: { on: number; label: string } } {
  const list = [
    ...effectsFor(s, u).filter((a) => !a.bearers && (a.e.fightOnDeath || a.e.shootOnDeath)).map((a) => ({ e: a.e, label: a.label, holder: a.holder })),
    ...modelRules(s, u, m).filter((r) => r.e.fightOnDeath || r.e.shootOnDeath).map((r) => ({ ...r, holder: u })),
    ...grantsOf(s, u).filter((g) => !g.models || m.keywords.includes(g.models)).flatMap((g) => (g.rule.effects ?? []).filter((e) => e.fightOnDeath || e.shootOnDeath).map((e) => ({ e, label: g.name, holder: u }))),
  ].filter((a) => (a.e.if ?? []).every((c) => cond(c, { s, A: u, m, holder: a.holder })));
  const out: ReturnType<typeof fightOnDeathFor> = {};
  for (const a of list) {
    const on = (a.e.fightOnDeath ?? 7) - (a.e.fightOnDeathRiled && isRiled(s, u) ? a.e.fightOnDeathRiled : 0)
      - (a.e.fightOnDeathCharBonus && (m.isCharacter || m.keywords.includes('CHARACTER')) ? a.e.fightOnDeathCharBonus : 0);
    if (a.e.fightOnDeath && (!out.fight || on < out.fight.on)) out.fight = { on, label: a.label, regain: a.e.fightOnDeathRegain };
    if (a.e.shootOnDeath && (!out.shoot || a.e.shootOnDeath < out.shoot.on)) out.shoot = { on: a.e.shootOnDeath, label: a.label };
  }
  return out;
}

/** Strikes of Retribution: mortal wounds back for melee attacks allocated to this model. */
export function retaliateFor(s: GameState, u: UnitState, m: ModelState): { on: number; max: number; label: string } | null {
  const r = modelRules(s, u, m).find((x) => x.e.retaliate);
  return r ? { ...r.e.retaliate!, label: r.label } : null;
}

/** Use the once-per-phase "change the Damage of that attack to 0" of a model. */
const negatePeriod = (s: GameState, k: 'turn' | 'round' | 'battle') => (k === 'turn' ? `t${s.turn}` : k === 'round' ? `r${s.round}` : 'battle');
export const useNegate = (s: GameState, T: UnitState, m: ModelState, k?: 'turn' | 'round' | 'battle') => {
  if (k) (T.used ??= {})[`negate:${k}`] = negatePeriod(s, k); else (T.used ??= {})[`negate:${m.id}`] = phaseKey(s);
};

// ---------- eligibility, rolls, stats ----------

export function canDo(s: GameState, u: UnitState, what: Eligibility): boolean {
  if (what === 'chargeAfterAdvance' || what === 'chargeAfterFallBack') {
    if (eligibleByRule(s, u, what)) return true;
  }
  return effectsFor(s, u).some((a) => {
    const el = a.e?.eligible;
    const match = Array.isArray(el) ? el.includes(what) : (typeof el === 'string' ? el === what : false);
    return match && holds(a, { s, A: u });
  });
}

const unitFx = (s: GameState, u: UnitState) => effectsFor(s, u).filter((a) => holds(a, { s, A: u }));

export function rollMods(s: GameState, u: UnitState) {
  const es = unitFx(s, u).map((a) => a.e);
  const votannHostile = s.players[u.owner]?.votannAbility === 'Hostile Acquisition' && (u.factionKeywords.includes('LEAGUES OF VOTANN') || u.keywords.includes('LEAGUES OF VOTANN'));
  return {
    rerollAdvance: es.some((e) => e.rerollAdvance) || votannHostile,
    rerollCharge: es.some((e) => e.rerollCharge) || votannHostile,
    advanceSix: es.some((e) => e.advanceSix),
    advanceBonus: es.reduce((a, e) => a + (es.some((x) => x.ignoreMods || x.ignoreMoveMods) ? Math.max(0, e.advanceBonus ?? 0) : e.advanceBonus ?? 0), 0),
    chargeBonus: es.reduce((a, e) => a + (es.some((x) => x.ignoreMods || x.ignoreMoveMods) ? Math.max(0, e.chargeBonus ?? 0) : e.chargeBonus ?? 0), 0),
    advanceFixed: Math.max(0, ...es.map((e) => e.advanceFixed ?? 0)),
    rerollShock: es.some((e) => e.rerollShock),
    rerollPactLd: es.some((e) => e.rerollPactLd || e.rerollShock),
    pactBoth: es.some((e) => e.pactBoth),
    advanceSelfMortals: es.find((e) => e.advanceSelfMortals)?.advanceSelfMortals,
  };
}

export function unitFlags(s: GameState, u: UnitState) {
  const list = unitFx(s, u);
  const es = list.map((a) => a.e);
  return {
    ordersStayShocked: es.some((e) => e.ordersStayShocked),
    ignoreLdMods: es.some((e) => e.ignoreLdMods),
    disembarkRange: Math.max(0, ...es.map((e) => e.disembarkRange ?? 0)),
    ignoreEngaged: es.find((e) => e.ignoreEngaged)?.ignoreEngaged,
    stealth: es.some((e) => e.stealth),
    loneOperative: es.some((e) => e.loneOperative),
    deepStrike: es.some((e) => e.deepStrike),
    infiltrators: es.some((e) => e.infiltrators),
    fightsFirst: es.some((e) => e.fightsFirst),
    scouts: Math.max(0, ...es.map((e) => e.scouts ?? 0)),
    move: es.some((e) => e.ignoreMods || e.ignoreMoveMods) ? es.reduce((a, e) => a + Math.max(0, e.move ?? 0), 0) : es.reduce((a, e) => a + (e.move ?? 0), 0),
    ld: es.reduce((a, e) => a + (e.ld ?? 0), 0),
    toughness: es.reduce((a, e) => a + (e.toughness ?? 0), 0),
    cannotFallBack: es.some((e) => e.cannotFallBack),
    noOverwatch: es.some((e) => e.noOverwatch),
    synapseRange: Math.max(6, ...es.map((e) => e.synapseRange ?? 6)),
    moveHalve: es.some((e) => e.moveHalve),
    graviticFly: es.some((e) => e.graviticFly),
    noSnapTarget: es.some((e) => e.noSnapTarget),
    cannotBeHidden: es.some((e) => e.cannotBeHidden),
    detection: es.reduce((a, e) => a + (e.detection ?? 0), 0),
    rangeMinus: es.reduce((a, e) => a + (e.rangeMinus ?? 0), 0),
    forceDesperate: es.some((e) => e.forceDesperate),
    overwatchHitOn: Math.min(6, ...es.map((e) => e.overwatchHitOn ?? 6)),
    moveThroughModels: es.some((e) => e.moveThroughModels),
    givesCover: es.some((e) => e.givesCover),
    assaultDisembark: es.some((e) => e.assaultDisembark),
    disembarkAfterAdvance: es.some((e) => e.disembarkAfterAdvance),
    noEmbark: es.some((e) => e.noEmbark),
    omniScrambler: Math.max(0, ...es.map((e) => e.omniScrambler ?? 0)),
    deepStrikeInFlow: es.some((e) => e.deepStrikeInFlow),
    deepStrikeRange: Math.min(RULES.reserves.enemyDistance, ...es.map((e) => e.deepStrikeRange ?? RULES.reserves.enemyDistance)),
    arriveFromRound: Math.min(RULES.reserves.firstRound, ...es.map((e) => e.arriveFromRound ?? RULES.reserves.firstRound)),
    noBigGunsPenalty: es.some((e) => e.noBigGunsPenalty),
    followFallBack: es.some((e) => e.followFallBack),
    fallBackLdTest: list.some((a) => a.e.fallBackLdTest && a.holder.owner !== u.owner),
    slowed: es.some((e) => e.slowed),
    snared: es.some((e) => e.snared),
    ldSet: Math.min(99, ...es.map((e) => e.ldSet ?? 99)),
    advanceHazard: es.some((e) => e.advanceHazard),
    rangeBonus: es.reduce((a, e) => a + (e.rangeBonus ?? 0), 0),
    shootIntoEngagement: Math.max(0, ...es.map((e) => e.shootIntoEngagement ?? 0)),
    secureAtCommandEnd: es.some((e) => e.secureAtCommandEnd),
    secureAtMovementEnd: es.some((e) => e.secureAtMovementEnd),
    surgeObjective: es.some((e) => e.surgeObjective),
    objConsolidate: es.some((e) => e.objConsolidate),
    rerollAttackRolls: es.some((e) => e.rerollAttackRolls),
    noEngagedStrats: es.some((e) => e.noEngagedStrats),
    rerollHazard: es.some((e) => e.rerollHazard),
    looseDisembark: es.some((e) => e.looseDisembark),
    grounded: es.some((e) => e.grounded),
    oppMoveIngress: es.some((e) => e.oppMoveIngress),
    oathBackup: es.some((e) => e.oathBackup),
    mustStay: es.some((e) => e.mustStay),
    pileIn: Math.max(0, ...es.map((e) => e.pileIn ?? 0)),
    enemyPileMinus: Math.max(0, ...es.map((e) => e.enemyPileMinus ?? 0)),
    consolidate: Math.max(0, ...es.map((e) => e.consolidate ?? 0)),
    freeConsolidate: es.some((e) => e.freeConsolidate),
    taunt: es.some((e) => e.taunt),
    glamour: es.some((e) => e.glamour),
    fightReach3: es.some((e) => e.fightReach3),
    moveSet: Math.max(0, ...es.map((e) => e.moveSet ?? 0)),
    surgeFixed: Math.max(0, ...es.map((e) => e.surgeFixed ?? 0)),
    surgeReroll: es.some((e) => e.surgeReroll),
    suppressOnHit: es.some((e) => e.suppressOnHit),
    afterShootNoCover: es.some((e) => e.afterShootNoCover),
    shieldOfHonour: es.some((e) => e.shieldOfHonour),
    targetableWithin: Math.min(99, ...es.map((e) => e.targetableWithin ?? 99)),
    ignoreLoneOperative: es.some((e) => e.ignoreLoneOperative),
    protectPrecision: Math.min(99, ...es.map((e) => e.protectPrecision ?? 99)),
    gheistskull: es.some((e) => e.gheistskull),
    esotericExplosives: es.some((e) => e.esotericExplosives),
    cannotShoot: es.some((e) => e.cannotShoot),
    ingressRange: Math.min(RULES.reserves.enemyDistance, ...es.map((e) => e.ingressRange ?? RULES.reserves.enemyDistance)),
    ignoreMods: es.some((e) => e.ignoreMods),
    forceShockAura: Math.max(0, ...es.map((e) => e.forceShockAura ?? 0)),
    creepingDread: Math.max(0, ...es.map((e) => e.creepingDread ?? 0)),
    terrorBelow: Math.max(0, ...es.map((e) => e.terrorBelow ?? 0)),
    terrorBelowMod: Math.min(0, ...es.map((e) => e.terrorBelowMod ?? 0)),
    chargedMinus: Math.max(0, ...es.map((e) => e.chargedMinus ?? 0)),
    thralls: es.some((e) => e.thralls),
    thrallsKw: es.find((e) => e.thrallsKw)?.thrallsKw,
    autoPassShock: es.some((e) => e.autoPassShock),
    shieldsNear: Math.max(0, ...es.map((e) => e.shieldsNear ?? 0)),
    ignoreMoveMods: es.some((e) => e.ignoreMoveMods),
    chargeBonusVsOath: es.reduce((a, e) => a + (e.chargeBonusVsOath ?? 0), 0),
    cpOnOathKill: Math.min(7, ...es.map((e) => e.cpOnOathKill ?? 7)),
    retargetOath: es.some((e) => e.retargetOath),
    cpOnKillNear: es.find((e) => e.cpOnKillNear)?.cpOnKillNear,
    arriveShock: Math.max(0, ...es.map((e) => e.arriveShock ?? 0)),
    arriveShockAll: Math.max(0, ...es.map((e) => e.arriveShockAll ?? 0)),
    deathRetaliate: Math.min(7, ...es.map((e) => e.deathRetaliate ?? 7)),
    healOnKill: es.find((e) => e.healOnKill)?.healOnKill,
    charKillShock: Math.max(0, ...es.map((e) => e.charKillShock ?? 0)),
    shockOnKill: es.some((e) => e.shockOnKill),
    onlyTargetMarked: es.find((e) => e.onlyTargetMarked)?.onlyTargetMarked,
    thrill: es.some((e) => e.thrill),
    chargeMustEngaged: es.some((e) => e.chargeMustEngaged),
    chargeNeedEngagedBy: es.find((e) => e.chargeNeedEngagedBy)?.chargeNeedEngagedBy,
    consolidateEngage: es.some((e) => e.consolidateEngage),
    deepStrikeNear: es.find((e) => e.deepStrikeNear)?.deepStrikeNear,
    sensational: es.some((e) => e.sensational),
    poisoned: es.some((e) => e.poisoned),
    deadlyDemiseOn: Math.min(6, ...es.map((e) => e.deadlyDemiseOn ?? 6)),
    shockBonus: es.reduce((a, e) => a + (e.shockBonus ?? 0), 0),
    reviveOnKill: es.some((e) => e.reviveOnKill),
    allIsRot: es.some((e) => e.allIsRot),
    poxWall: Math.max(0, ...es.map((e) => e.poxWall ?? 0)),
    summonsOnKill: es.some((e) => e.summonsOnKill),
    terrorPsykerMod: Math.min(0, ...es.map((e) => e.terrorPsykerMod ?? 0)),
    shockPassHeal: es.some((e) => e.shockPassHeal),
    fightStartShock: es.reduce<number | null>((a, e) => (e.fightStartShock === undefined ? a : Math.min(a ?? 0, e.fightStartShock)), null),
    shockAfterAttack: es.reduce<number | null>((a, e) => (e.shockAfterAttack === undefined ? a : Math.min(a ?? 0, e.shockAfterAttack)), null),
    throughTerrain: es.some((e) => e.throughTerrain),
    killShockAura: Math.max(0, ...es.map((e) => e.killShockAura ?? 0)),
    chargedShock: es.reduce<number | null>((a, e) => (e.chargedShock === undefined ? a : Math.min(a ?? 0, e.chargedShock)), null),
  };
}

// ---------- stratagem cost: discounts (Rites of Battle …), taxes (Unorthodox Strategist …), CP refunds ----------

const periodKey = (s: GameState, limit?: Limit) => (limit === 'battle' ? 'battle' : limit === 'round' ? `r${s.round}` : limit === 'turn' ? `t${s.turn}` : limit === 'phase' ? phaseKey(s) : '');
const limitBag = (s: GameState, a: Active, perArmy?: boolean) => (perArmy ? (s.players[a.holder.owner].abilityUsed ??= {}) : (a.holder.used ??= {}));
const limitFree = (s: GameState, a: Active, tag: string, limit?: Limit, perArmy?: boolean) => !limit || limitBag(s, a, perArmy)[`${tag}:${a.label}`] !== periodKey(s, limit);

interface StratParts { discount?: Active; tax?: Active; cp: number }
function stratParts(s: GameState, u: UnitState, stratId: string): StratParts {
  let discount: Active | undefined, tax: Active | undefined;
  for (const a of unitFx(s, u)) {
    const d = a.e.stratDiscount;
    if (d && a.holder.owner === u.owner && (!d.ids || d.ids.includes(stratId) || d.ids.includes('*')) && limitFree(s, a, 'strat', d.limit, d.perArmy)
      && (!d.yp || (s.players[u.owner].yieldPoints ?? 0) >= d.yp)
      && (!discount || d.cp > discount.e.stratDiscount!.cp)) discount = a;
    const t = a.e.stratTax;
    if (t && a.holder.owner !== u.owner && limitFree(s, a, 'tax', t.limit) && (!tax || t.cp > tax.e.stratTax!.cp)) tax = a;
  }
  return { discount, tax, cp: (discount?.e.stratDiscount!.cp ?? 0) - (tax?.e.stratTax!.cp ?? 0) };
}

/** CP change for a stratagem used on this unit: positive = cheaper. */
export const stratDiscount = (s: GameState, u: UnitState, stratId: string): number => stratParts(s, u, stratId).cp;

/** The stratagem was paid: use up the limited discount / tax and roll CP refunds (Infiltrator Comms Array …). */
function stratSpent(s: GameState, u: UnitState, stratId: string) {
  const { discount, tax } = stratParts(s, u, stratId);
  if (discount) {
    const d = discount.e.stratDiscount!;
    if (d.limit) limitBag(s, discount, d.perArmy)[`strat:${discount.label}`] = periodKey(s, d.limit);
    log(s, `${discount.label}: Stratagem costs ${d.cp}CP less`, 'cp', u.owner);
    const m = d.sacrifice ? alive(u).find((x) => !x.isCharacter) : undefined;
    if (m) { m.dead = true; m.wounds = 0; log(s, `${discount.label}: ${m.name} is destroyed`, 'info', u.owner); }
    const pool = s.players[u.owner].seerFate;
    if (d.fateValue && pool?.includes(d.fateValue)) pool.splice(pool.indexOf(d.fateValue), 1);
    if (d.yp) { s.players[u.owner].yieldPoints = (s.players[u.owner].yieldPoints ?? 0) - d.yp; log(s, `${discount.label}: ${d.yp}YP spent`, 'info', u.owner); }
  }
  if (tax) {
    const t = tax.e.stratTax!;
    if (t.limit) limitBag(s, tax)[`tax:${tax.label}`] = periodKey(s, t.limit);
    log(s, `${tax.label} (${tax.holder.name}): Stratagem costs ${t.cp}CP more`, 'cp', tax.holder.owner);
  }
  for (const a of unitFx(s, u)) {
    if (!a.e.stratCpChance || a.holder.owner !== u.owner) continue;
    const r = d6(s);
    const ok = r >= a.e.stratCpChance;
    if (ok) { s.players[u.owner].cp += 1; notifyAbilityCpGain(s, u.owner, 1, a.label); }
    log(s, `${a.label}: rolled ${r}${ok ? ' → +1CP' : ''}`, 'cp', u.owner);
  }
}

/** Objective Control of the models of a unit (detachment and ability bonuses, auras, enemy debuffs). */
export function ocOf(s: GameState, u: UnitState): (m: ModelState) => number {
  const list = effectsFor(s, u);
  return (m) => {
    const fx = list.filter((a) => modelOk(a, m) && holds(a, { s, A: u, m }));
    // shockedOc: the OC while Battle-shocked (negative: that much less than the characteristic, Death Mask of Ollanius)
    if (u.battleShocked) return fx.reduce((a, x) => Math.max(a, x.e.shockedOc === undefined ? 0 : x.e.shockedOc < 0 ? (m.profile.OC ?? 0) + x.e.shockedOc : x.e.shockedOc), 0);
    if (fx.some((x) => x.e.ocZero)) return 0;
    let oc = m.profile.OC ?? 0;
    for (const x of fx) if (x.e.ocSet !== undefined) oc = Math.max(oc, x.e.ocSet);
    const base = oc;
    for (const x of fx) oc += x.e.oc ?? 0;
    if (base >= 1 && oc < 1 && fx.some((x) => x.e.ocMin1)) oc = 1;
    if (fx.some((x) => x.e.embarkedOc)) oc += s.units.filter((p) => p.embarkedIn === u.id && p.status === 'embarked').reduce((a, p) => a + alive(p).reduce((b, n) => b + (n.profile.OC ?? 0), 0), 0);
    oc *= Math.max(1, ...fx.map((x) => x.e.ocMultiply ?? 1));
    if (fx.some((x) => x.e.ocHalve)) oc = Math.ceil(oc / 2);
    return Math.max(0, oc);
  };
}
export const modelOc = (s: GameState, u: UnitState, m: ModelState) => ocOf(s, u)(m);

// ---------- timed effects ----------

/** Put a timed effect on a unit (own buff, or a mark on an enemy unit). */
export function addTimed(s: GameState, u: UnitState, t: Omit<TimedEffect, 'turn'>) {
  (u.timed ??= []).push({ ...t, turn: s.turn });
}

/** Drop timed effects whose time is up. Called at phase and turn boundaries. */
export function expireTimed(s: GameState, at: 'phaseEnd' | 'turnEnd' | 'turnStart' | 'commandStart' | 'movementStart', player: PlayerId) {
  for (const u of s.units) {
    if (!u.timed?.length) continue;
    u.timed = u.timed.filter((t) => {
      switch (t.until) {
        case 'phase': return at !== 'phaseEnd';
        case 'turn': return at !== 'turnEnd';
        case 'nextTurnStart': return !(at === 'turnStart' && player === t.by);
        case 'nextCommand': return !(at === 'commandStart' && player === t.by);
        case 'nextMovement': return !(at === 'movementStart' && player === t.by);
        case 'endOfNextTurn': return !(at === 'turnEnd' && s.turn > t.turn);
        case 'opponentNextMovementEnd': return !(at === 'phaseEnd' && s.phase === 'movement' && s.active !== t.by && s.turn > t.turn);
        default: return true;
      }
    });
  }
}

/** Short labels of what currently affects a unit, for the unit card. */
export function activeLabels(s: GameState, u: UnitState): string[] {
  const out = new Set<string>();
  for (const a of effectsFor(s, u)) if (holds(a, { s, A: u }) || (a.e.if ?? []).some((c) => /target|within|charged|weapon/i.test(c))) out.add(a.label);
  return [...out];
}

export { onObjective };

// ---------- fast checks used by visibility (called very often) ----------

/** Lone Operative from an ability ("while within 3" of a friendly X unit, this model has Lone Operative"). */
export function loneOperativeNow(s: GameState, u: UnitState): boolean {
  if (u.sources.length !== 1) return false;
  for (const a of u.abilities) {
    const r = abilityRule(u, a);
    for (const e of r?.effects ?? []) if (e.loneOperative && (e.if ?? []).every((c) => cond(c, { s, A: u, holder: u, bearers: alive(u) }))) return true;
  }
  return (u.timed ?? []).some((t) => t.e.loneOperative);
}

setVisibilityHooks({
  loneOperative: loneOperativeNow,
  detection: (s, u) => unitFlags(s, u).detection
    // an identified terrain feature: enemy units within it are seen from 3" further
    + ((s.identified ?? []).some((x) => x.turn === s.turn && x.by !== u.owner && alive(u).some((m) => { const t = s.terrain.find((q) => q.id === x.terrainId); return !!t && bodyTouchesPoly(m, 0, t.poly); })) ? 3 : 0),
  cannotBeHidden: (_s, u) => (u.timed ?? []).some((t) => t.e.cannotBeHidden),
  spotting: (s, obs, u) => {
    if (s.phase !== 'shooting' || s.active === u.owner) return 0;
    const A = s.units.find((x) => x.owner !== u.owner && x.models.some((n) => n.id === obs.id));
    return A ? Math.max(0, ...unitFx(s, A).map((a) => a.e.spotting ?? 0)) : 0;
  },
});

/** Countercharge: Heroic Intervention on this unit even though the stratagem was used this phase (once per battle round). */
function stratRepeat(s: GameState, u: UnitState, id: string): boolean {
  return unitFx(s, u).some((a) => a.e.stratRepeat?.ids.includes(id) && limitFree(s, a, `repeat:${u.id}`, a.e.stratRepeat.limit));
}
function stratRepeatUsed(s: GameState, u: UnitState, id: string) {
  for (const a of unitFx(s, u)) if (a.e.stratRepeat?.ids.includes(id)) limitBag(s, a)[`repeat:${u.id}:${a.label}`] = periodKey(s, a.e.stratRepeat.limit);
}
setStratHooks(stratDiscount, (s, u, id) => { stratSpent(s, u, id); stratRepeatUsed(s, u, id); }, stratRepeat);
setScreenHook((s, x, T) => unitFx(s, x).some((a) => !!a.e.coverBehind && (!a.e.coverBehind.friendly || x.owner === T.owner) && unitMatches(T, a.e.coverBehind.units)));
setStratShockedHook((s, u) => unitFx(s, u).some((a) => a.e.stratsWhileShocked));
setStratBlockHook((s, u) => {
  if (!onBoard(u) || u.keywords.includes('MONSTER') || u.keywords.includes('VEHICLE')) return null;
  const e = engagedEnemies(s, u).find((x) => unitFlags(s, x).noEngagedStrats);
  return e ? `engaged with ${e.name} (Coronal Susurrant): cannot be targeted by Stratagems` : null;
});
setActionEligibilityHook((s, u, what) => canDo(s, u, what));
setThroughHook((s, u, kind) => {
  const f = unitFx(s, u).map((a) => a.e);
  if (f.some((e) => e.moveThroughModels)) return 'all';
  if (kind === 'charge' && f.some((e) => e.chargeThroughAll)) return 'all';
  if (kind === 'charge' && f.some((e) => e.chargeThroughModels)) return 'nonMV';
  // Super-heavy Walker: Normal, Advance and Fall Back moves go through every model but TITANIC ones
  return moveThroughModels(s, u, kind);
}, (s, u, kind) => moveThroughTerrain(s, u, kind) || unitFx(s, u).some((a) => a.e.throughTerrain));

// ---------- fixed at Declare Battle Formations ----------

/** Keyword and characteristic changes that hold for the whole battle ("while attached to a MOUNTED unit, this model has MOBILE …"). */
export function applyStaticEffects(s: GameState) {
  for (const u of s.units) {
    // keywords given by army / detachment rules (The Ravenwing, Skystrike, Sneaky Little Gitz …)
    const fixed = [...playerDetEffects(s, u.owner).map((x) => x.e).filter((e) => unitMatches(u, e.units)), ...grantsOf(s, u).flatMap((g) => g.rule.effects ?? [])]
      .filter((e) => e.addKeywords && (e.if ?? []).every((c) => cond(c, { s, A: u, holder: u })));
    for (const e of fixed) {
      for (const m of u.models) m.keywords = [...new Set([...m.keywords, ...e.addKeywords!])];
      u.keywords = [...new Set([...u.keywords, ...e.addKeywords!])];
    }
    for (const a of u.abilities) {
      const rule = abilityRule(u, a);
      for (const e of rule?.effects ?? []) {
        if (!e.mobile && !e.addKeywords && !e.removeKeywords && !e.statM && !e.svSet && !e.statW) continue;
        if (!(e.if ?? []).every((c) => cond(c, { s, A: u, holder: u }))) continue;
        const ms = (e.scope === 'model' || e.scope === undefined) && rule ? bearersOf(u, a, rule) : alive(u);
        for (const m of ms) {
          const add = [...(e.addKeywords ?? []), ...(e.mobile ? ['MOBILE'] : [])];
          m.keywords = [...new Set([...m.keywords.filter((k) => !(e.removeKeywords ?? []).includes(k)), ...add])];
          if (e.statM && m.profile.M !== undefined && m.profile.M !== null) m.profile = { ...m.profile, M: m.profile.M + e.statM };
          if (e.svSet && m.profile.Sv > e.svSet) m.profile = { ...m.profile, Sv: e.svSet };
          if (e.statW) { m.profile = { ...m.profile, W: m.profile.W + e.statW }; m.wounds += e.statW; }
        }
        u.keywords = [...new Set(alive(u).flatMap((m) => m.keywords))];
      }
    }
  }
}

/** Canoptek Court: the unit is wholly within its army's Power Matrix (its own deployment zone; No Man's Land / the
 *  opponent's zone while the army controls at least half of the objective markers there). */
function inPowerMatrix(s: GameState, A: UnitState): boolean {
  const zones = deploymentById(s.deploymentId).zones;
  const own = toPoly(zones[s.players[A.owner].role]), opp = toPoly(zones[s.players[other(A.owner)].role]);
  const ms = alive(A);
  if (!ms.length) return false;
  if (ms.every((m) => pointInPoly(m, own))) return true;
  const half = (inZone: (o: Pt) => boolean) => { const os = s.objectives.filter(inZone); return os.length > 0 && os.filter((o) => o.controller === A.owner).length * 2 >= os.length; };
  const nml = (q: Pt) => !pointInPoly(q, own) && !pointInPoly(q, opp);
  if (ms.every((m) => pointInPoly(m, own) || nml(m)) && half(nml) && (ms.every((m) => nml(m)) || ms.every((m) => !pointInPoly(m, opp)))) return true;
  if (ms.every((m) => !nml(m)) && half((o) => pointInPoly(o, opp)) && (half(nml) || ms.every((m) => pointInPoly(m, opp) || pointInPoly(m, own)))) return true;
  return false;
}
