import type { Effect } from './effects';
// ---------- Data (from public/data/factions/*.json, see scripts/build-data.mjs) ----------

export interface WeaponProfileData {
  name: string;
  range: number | 'Melee' | null;
  A: string;
  skill: number | null; // BS/WS as the number before "+", null = N/A (e.g. torrent)
  S: number | null;
  AP: number;
  D: string;
  abilities: string[]; // raw lowercase keywords, e.g. "rapid fire 1", "anti-infantry 4+"
}

export interface WeaponData {
  name: string;
  profiles: WeaponProfileData[];
}

export interface BaseData { w: number; h: number; text: string }

export interface ModelProfileData {
  name: string;
  M: number | null;
  T: number;
  Sv: number;
  InSv: number | null;
  W: number;
  Ld: number;
  OC: number | null;
  base: BaseData;
}

export interface AbilityData { name: string; type: string; param?: string; model?: string; text: string; sheet?: string; faction?: string }

export interface CompositionData { name?: string; min?: number; max?: number; text: string }

export interface PointsTier { label: string; options: { models: number; pts: number }[] }

export interface DatasheetData {
  id: string;
  name: string;
  role: string;
  keywords: string[];
  factionKeywords: string[];
  subfaction?: string; // e.g. the Chapter keyword ("BLOOD ANGELS"); absent = usable by any sub-faction
  models: ModelProfileData[];
  composition: CompositionData[];
  loadout: Record<string, string[]>;
  loadoutText: string;
  options: string[];
  weapons: WeaponData[];
  abilities: AbilityData[];
  leads: string[];
  isSupport: boolean;
  transport?: string;
  damaged?: { w: string; text: string };
  points: PointsTier[];
  wargearOptions?: WargearOption[];
  wargearCosts?: { name: string; pts: number }[]; // "per thunder hammer +5": charged per item carried
  link: string;
}

/** One parsed line of a datasheet's wargear options (built by scripts/build-data.mjs). */
export interface WargearOption {
  text: string;
  /** one: the named/only model · upTo: up to `max` models · perN: `max` per `per` models · any: any number · all: every model or none */
  scope: 'one' | 'upTo' | 'perN' | 'any' | 'all';
  per?: number;
  max?: number;
  stack?: boolean; // "This model can be equipped with up to 4 X": count = copies on the one model
  minModels?: number; // "If this unit contains 12 models, …"
  who: string; // model name the option applies to, '*' = any model
  replace: string[]; // items removed (weapon names, or equipment such as "Storm shield")
  choices: string[][]; // each choice: items gained (repeated for "2 x")
  pick?: number; // "two different weapons from the following list"
  pickFrom?: string[];
  requires?: string[]; // the model must carry these
}

/** A wargear choice in an army list: `count` models take choice `choice` of option `opt` (choice -1 = the `picks` list). */
export interface WargearPick { opt: number; choice: number; count: number; picks?: string[] }

export interface EnhancementData { id: string; name: string; pts: number; upgrade: boolean; text: string }
export interface StratagemData { id: string; name: string; cp: number; type: string; turn: string; phase: string; text: string }

export interface DetachmentData {
  id: string;
  name: string;
  dp: number;
  forceDisposition: string | null;
  subfaction?: string; // Chapter-specific detachment
  rules: { name: string; text: string }[];
  enhancements: EnhancementData[];
  stratagems: StratagemData[];
}

export interface FactionData {
  id: string;
  name: string;
  link: string;
  lastUpdate: string;
  armyRules: { name: string; text: string }[];
  detachments: DetachmentData[];
  datasheets: DatasheetData[];
  subfactions?: { label: string; options: SubfactionData[] };
}

export interface SubfactionData { keyword: string; name: string; color?: string }

// ---------- Army list ----------

export interface ArmyUnitEntry {
  uid: string;
  datasheet: string; // datasheet name
  models: number;
  pts: number;
  attachTo?: string; // uid of the bodyguard unit this leader/support joins
  enhancement?: string;
  enhancementPts?: number;
  warlord?: boolean;
  wargear?: WargearPick[];
  wargearPts?: number; // points for costed wargear and add-on models, kept in sync by the army builder
  addons?: string[]; // optional extra models bought separately, e.g. "Invader ATV"
  split?: boolean; // split into two units at Declare Battle Formations (Combat Squads …)
  embarkIn?: string; // uid of the TRANSPORT this unit starts the battle embarked within
}

export interface ArmyList {
  name: string;
  factionId: string;
  subfaction?: string; // sub-faction keyword, e.g. a Chapter
  battleSize: string;
  detachments: string[];
  units: ArmyUnitEntry[];
}

// ---------- Game state ----------

export type PlayerId = 0 | 1;
export interface Pt { x: number; y: number }
export interface Seg { a: Pt; b: Pt }

export type Phase = 'formations' | 'deploy' | 'scouts' | 'command' | 'movement' | 'shooting' | 'charge' | 'fight' | 'gameover';
export type MoveKind = 'stationary' | 'normal' | 'advance' | 'fallback' | 'ingress' | 'charge' | 'pileIn' | 'consolidate' | 'deploy' | 'scout' | 'extra' | 'surge';

export interface ModelState {
  id: string;
  name: string;
  profile: ModelProfileData;
  source: string; // datasheet name the model comes from
  isCharacter: boolean;
  isBodyguard: boolean;
  keywords: string[];
  weapons: WeaponData[]; // a weapon listed twice is carried twice (e.g. 2 godhammer lascannons)
  gear?: string[]; // non-weapon wargear: shields, banners, icons …
  x: number;
  y: number;
  r: number; // base radius in inches
  wounds: number;
  dead: boolean;
}

export interface CoreAbilities {
  fnp?: number;
  stealth?: boolean;
  loneOperative?: number;
  fightsFirst?: boolean;
  deepStrike?: boolean;
  scouts?: number;
  infiltrators?: boolean;
  deadlyDemise?: string;
  hover?: boolean;
  damaged?: number; // Damaged X: -1 to hit while wounds <= X
}

export interface TransportInfo {
  capacity: number; double: string[]; forbid: string[]; only: string[]; infantryOnly: boolean; text: string;
  /** what it carries, e.g. ["TACTICUS INFANTRY", "PHOBOS INFANTRY"]: every model must match one */
  kinds?: string[];
  /** models matching these may ride even though a forbidden keyword applies ("excluding TACTICUS CHARACTER models") */
  except?: string[];
  /** models taking more than one space: [keyword phrase, spaces] */
  spaces?: [string, number][];
}

export interface UnitState {
  id: string;
  owner: PlayerId;
  name: string;
  sources: string[];
  keywords: string[];
  factionKeywords: string[];
  models: ModelState[];
  startingStrength: number;
  abilities: AbilityData[];
  core: CoreAbilities;
  pts: number;
  status: 'pending' | 'reserves' | 'board' | 'destroyed' | 'embarked';
  embarkedIn: string | null;
  transport: TransportInfo | null;
  weaponsFired: string[]; // split fire: ranged weapons already used this phase
  cantCharge: boolean; // e.g. after a rapid / combat disembark
  disembarkedTurn?: number;
  disembarkedFrom?: string; // transport id the unit disembarked from this turn
  lastStationaryTurn?: number; // turn the unit last Remained Stationary
  riledUntil?: number; // Orks: riled up by an ability until this turn index (inclusive)
  quarry?: string; // Headhunters: enemy unit id
  timed?: TimedEffect[]; // temporary effects and marks from abilities
  split?: string; // split off another unit at Declare Battle Formations (Combat Squads …): the other unit's id
  sagaDone?: boolean; // Slayer's Oath: this unit has the completed-Saga benefits
  oathKills?: number; // Saga of the Bold: Oath of Moment targets this unit destroyed
  abilityPicks?: { pool: string[]; on: string[] }; // "select two of these abilities" (Author of the Codex …)
  used?: Record<string, string>; // ability limits: name -> last use key (battle / round / turn / phase)
  lastHits?: { key: string; ids: string[]; byWeapon?: Record<string, string[]> }; // enemy units hit this phase
  extraMove?: { max: number; label: string; kind: 'extra' | 'surge'; phase?: string }; // a move granted by an ability, not yet made
  arriveEarly?: number; // battle round in which this unit may already arrive from Reserves (High King of Fenris …)
  noChargeTurn?: number; // turn in which this unit cannot declare a charge (Meteoric Descent …)
  fellBackFrom?: string[]; // enemy units engaged with this unit when it fell back this turn
  detRerolled?: string; // `${turn}:advance|charge`: free detachment re-roll used
  detAdvanceHurt?: string; // `${turn}:advance`: Wrath of the Doomed mortal wounds taken
  scoutDone: boolean;
  battleShocked: boolean;
  isWarlordUnit: boolean;
  enhancements: { name: string; text: string; model: string }[];
  // per-turn flags (reset at start of each player turn)
  move: MoveKind | null;
  advanceRoll: number | null;
  maxMoved: number;
  setUpTurn: number;
  shotTurn: number; // global turn index of last ranged attacks (-10 = never)
  selectedToShoot: boolean;
  declaredCharge: boolean;
  chargeRoll: number | null;
  chargedTurn: number;
  chargeTargets: string[];
  fought: boolean;
  foughtFirstUntilTurn: number;
  stratagemPhase: string | null; // `${turn}:${phase}` when last targeted by own stratagem
  oneShotUsed: string[];
  buffs: Buff[];
}

export type BuffKind = 'hit+1' | 'hit-1' | 'wound+1' | 'wound-1' | 'rerollHits1' | 'rerollHits' | 'rerollWounds1' | 'rerollWounds' | 'ap+1' | 'lethal' | 'sustained1' | 'devastating' | 'ignoresCover' | 'fnp5' | 'fnp6' | 'save+1' | 'damage-1' | 'smoke'
  // defensive buffs on the unit being attacked, and other stratagem effects
  | 'enemyHit-1' | 'enemyWound-1' | 'enemyAp-1' | 'fnp4' | 'cover' | 'fightsFirst' | 'advanceCharge+1';
export interface Buff { kind: BuffKind; until: 'phase' | 'turn' | 'battle'; label?: string }

export interface TerrainPiece {
  id: string;
  kind: string;
  label: string;
  category: 'exposed' | 'light' | 'dense';
  height: number;
  poly: Pt[];
  walls: Seg[];
  obstacles?: Seg[];
  objectiveId?: string;
}

export interface ObjectiveState {
  id: string;
  type: 'home' | 'central' | 'expansion';
  owner?: PlayerId; // whose home objective
  x: number;
  y: number;
  terrainId: string;
  controller: PlayerId | null;
  secured?: PlayerId | null; // stays under this player's control until the opponent controls it (Objective Secured …)
}

export interface PlayerState {
  name: string;
  factionId: string;
  factionName: string;
  cp: number;
  vp: number;
  vpByRound: number[];
  role: 'attacker' | 'defender';
  stratagemsUsed: string[]; // `${turn}:${phase}:${id}` keys
  insaneBraveryUsed: boolean;
  oathTarget: string | null; // Oath of Moment (Adeptus Astartes)
  oathWoundBonus: boolean;
  waaaghUsed: boolean; // Waaagh! War Cry (Orks)
  riledUntilTurn: number;
  secMode: 'none' | 'tactical' | 'fixed';
  secDeck: string[];
  secActive: string[];
  secVp: number;
  secByRound: number[];
  secFixedVp: Record<string, number>;
  secSwapUsed: boolean;
  armyRules: { name: string; text: string }[];
  detachments: DetachmentData[];
  /** choice-type detachment rules (Combat Doctrines …): what is active and what was used, by detachment name */
  det?: Record<string, DetChoiceState>;
  vowed?: string[]; // Inner Circle: vowed objective ids
  priorityObjective?: string; // Priority Objective Identified
  oathBackup?: string | null; // Master of Battle: second Oath of Moment target
  slayer?: Record<string, string>; // Slayer's Oath: unit id -> keyword
  subfaction?: string; // chapter / sub-faction picked in the army builder
  battleSize?: string; // incursion | strike | onslaught (some rules scale with it)
  saga?: { kind: 'hunter' | 'beastslayer' | 'bold'; tally: number; target: number; done: boolean; boasts: string[] }; // Space Wolves Sagas
  abilityUsed?: Record<string, string>; // per-army ability limits: name -> last use key
  /** Chapter Approved: chosen Force Disposition and the primary mission it gives against the opponent's */
  disposition: string;
  primaryId: string;
  mission: MissionState;
  sec: SecondaryState;
}

export interface DetChoiceState { active: string[]; used: string[]; count: number; pickedTurn?: number; round?: number }

/** A temporary effect on a unit: an own buff, or a mark placed on an enemy unit (by = the player who placed it). */
export interface TimedEffect {
  e: Effect;
  label: string;
  until: 'phase' | 'turn' | 'nextTurnStart' | 'nextCommand' | 'nextMovement' | 'endOfNextTurn' | 'opponentNextMovementEnd' | 'battle';
  by: PlayerId;
  turn: number;
  mark?: string;
  models?: string[]; // only these models ("this model" abilities)
}

/** State behind secondary cards that need choices or actions. */
export interface SecondaryState {
  temptingTarget?: string; // objective id
  beacon?: string; // unit id
  guards: { objId: string; unitId: string }[];
  cleansed: { objId: string; turn: number }[];
  plundered: { terrainId: string; turn: number }[];
}

/** Per-player primary-mission bookkeeping (markers, trapped/decoyed objectives, completed actions …). */
export interface MissionState {
  trapped: { terrainId: string; turn: number }[];
  decoyed: string[]; // objective ids
  consecrated: string[];
  triangulated: string[];
  condemned: string[]; // enemy unit ids, until the start of your next turn
  consecrationUnits: string[];
  surveilled: { unitId: string; turn: number }[];
  done: { action: string; unitId: string; turn: number; objId?: string; terrainId?: string }[];
}

export interface OperationMarker { id: string; owner: PlayerId; x: number; y: number; objId?: string; terrainId?: string; kind: string }
export interface PendingAction { player: PlayerId; unitId: string; action: string; turn: number; objId?: string; terrainId?: string }
export interface TurnSnapshot {
  turn: number;
  inRangeObj: string[];
  inRangeCentral: string[];
  inTerrain: Record<string, string[]>;
}

export interface LogEntry { turn: number; round: number; player: PlayerId | null; text: string; kind?: 'roll' | 'info' | 'vp' | 'cp' | 'kill' }

export type DieOutcome = 'miss' | 'hit' | 'crit' | 'auto' | 'wound' | 'critWound' | 'saved' | 'fail' | 'pass';
export interface Die { v: number; o: DieOutcome; rerolled?: boolean; orig?: number }

export interface Pool {
  snap?: boolean; // Snap Shooting: 6s hit but are not critical hits (15.09)
  defApplied?: boolean; // defensive stratagem effects of the target already folded in
  key: string;
  weapon: string;
  profile: WeaponProfileData;
  models: number; // attacking models
  instances: { A: string; extras: string[]; flat: number }[]; // per weapon instance: A + rapid fire/blast/cleave
  attacks: number;
  attackNote: string;
  skill: number | null; // effective BS/WS after cover/plunging
  skillNote: string;
  hitMod: number;
  hitNote: string;
  hitOn6Only: boolean;
  minHitUnmodified?: number;
  autoHit: boolean;
  noHitReroll: boolean;
  rerollAllHits?: boolean;
  rerollHits1?: boolean; // from detachment rules (unit buffs are checked separately)
  rerollWounds1?: boolean;
  rerollAllWounds?: boolean;
  rerollDamage?: boolean;
  attackBonus?: number; // +A per weapon instance (e.g. Red Thirst)
  critHitOn?: number; // unmodified hit rolls of this or more are critical hits
  ignoreHitMods?: boolean; // ignore negative modifiers to hit / BS / WS
  effS?: number; // Strength after rule modifiers (for "if S > T" effects)
  hazardousAll?: boolean;
  psychic?: boolean;
  woundNeed: number;
  woundMod: number;
  woundNote: string;
  critWoundOn: number;
  sustained: string | null;
  lethal: boolean;
  devastating: boolean;
  twinLinked: boolean;
  precision: boolean;
  precisionOnCrit?: boolean; // only attacks that scored a critical hit have [PRECISION]
  noHazard?: boolean; // hazardous tests automatically passed
  ap: number;
  damage: string;
  hazardous: number;
  hits: Die[];
  wounds: Die[];
  /** an ability lets the attacker re-roll some of these dice: they pick which (the failures by default) */
  reroll?: { stage: 'hit' | 'wound'; which: 'all' | 'ones'; picks: number[] };
  autoWounds: number;
  saves: Die[];
  saveTargets: string[]; // per save die: model name it was checked against
  mortalFromDev: number[];
  damageLines: string[];
  killed: number;
  done: boolean;
}

export interface AttackSession {
  kind: 'shoot' | 'fight' | 'overwatch';
  attackerId: string;
  targetId: string;
  pools: Pool[];
  idx: number;
  stage: 'hit' | 'wound' | 'save' | 'damage' | 'done';
  hazardousRolls: number[];
  summary: string[];
  aliveBefore?: string[]; // model ids alive when the attack started (for effects)
  attackerBuffsAtStart?: string[]; // attacker buffs already counted when the pools were built
  woundsBefore?: number;
  free?: boolean; // attacks made by a destroyed model ("fights on death"): the unit is not marked as having fought / shot
  allocated?: Record<string, number>; // melee attacks allocated per target model id (Strikes of Retribution)
  negated?: string[]; // model ids whose once-per-phase damage negation was used in this attack
  /** a bot attacks a player's unit: the player rolls the saves (and may use Command Re-roll) */
  defenderRolls?: boolean;
}

/** Visual events for the board (animations). Not rules state; capped to the last few. */
export type FxEvent =
  | { seq: number; kind: 'move'; unitId: string; owner: PlayerId; moveKind: MoveKind; paths: [string, Pt[]][] }
  | { seq: number; kind: 'place'; unitId: string; owner: PlayerId }
  | { seq: number; kind: 'attack'; attackKind: 'shoot' | 'fight' | 'overwatch'; attackerId: string; targetId: string; owner: PlayerId; from: Pt; to: Pt; dmg: number; killed: number; dead: Pt[];
      style?: 'bullet' | 'beam' | 'flame' | 'blast' | 'melee'; shooters?: Pt[]; victims?: Pt[]; shots?: number; hits?: number }
  | { seq: number; kind: 'mortal'; unitId: string; n: number; at: Pt }
  /** a roll worth showing big on screen (advance, charge, battle-shock) */
  | { seq: number; kind: 'roll'; owner: PlayerId | null; title: string; dice: number[]; result: string; good?: boolean }
  /** roll-off between the players */
  | { seq: number; kind: 'rolloff'; title: string; a: number; b: number; winner: PlayerId; result: string };

export type Window =
  | { kind: 'fireOverwatch'; player: PlayerId }
  | { kind: 'rapidIngress'; player: PlayerId }
  | { kind: 'smokescreen'; player: PlayerId }
  | { kind: 'heroicIntervention'; player: PlayerId }
  | { kind: 'counteroffensive'; player: PlayerId }
  /** abilities that let units react out of turn ("if an enemy unit ends a move within 8\", this unit can make a Normal move") */
  | { kind: 'abilityMove'; player: PlayerId; offers: { unitId: string; key: string; label: string }[]; label: string };

export interface FightState {
  step: 'pileIn' | 'fight' | 'consolidate';
  stepPlayer: PlayerId; // pile-in / consolidate: whose units are moving
  chooser: PlayerId;
  eligible: string[]; // unit ids eligible at start of fight step
  fought: string[];
  forcedNext: string | null; // counteroffensive
  movedThisStep: string[];
}

export interface ShockTest { unitId: string; result: number | null; passed: boolean | null; auto?: boolean }

export interface GameState {
  version: 3;
  rng: number;
  round: number;
  turn: number; // global turn index (0-based)
  firstPlayer: PlayerId;
  active: PlayerId;
  phase: Phase;
  deployTurn: PlayerId;
  players: [PlayerState, PlayerState];
  units: UnitState[];
  terrain: TerrainPiece[];
  objectives: ObjectiveState[];
  deploymentId: string; // terrain layout id (data/layouts.json)
  attackerPlayer: PlayerId;
  window: Window | null;
  attack: AttackSession | null;
  fight: FightState | null;
  shockTests: ShockTest[];
  destroyedByTurn: { turn: number; owner: PlayerId; unitId: string; killerId?: string; killerNearObj?: boolean }[];
  markers: OperationMarker[];
  modelDeaths: { turn: number; owner: PlayerId; character: boolean; W: number }[];
  pendingActions: PendingAction[];
  turnStart: TurnSnapshot | null;
  controlAtTurnStart: (PlayerId | null)[];
  log: LogEntry[];
  winner: PlayerId | null | 'draw';
  botPlayer?: PlayerId | null;
  /** players run by the bot (both for a bot-vs-bot game) */
  bots?: PlayerId[];
  /** vs bot: the player rolls their own saves when the bot attacks (and can use Command Re-roll then). Default on. */
  defenderRolls?: boolean;
  fx?: FxEvent[];
  botTried?: string[]; // bot bookkeeping: units already considered this phase
  fxSeq?: number;
  /** destroyed models that fight / shoot after the attacking unit has finished (resolved by activations.ts) */
  deathQueue?: { unitId: string; modelIds: string[]; targetId: string; kind: 'fight' | 'shoot'; label: string; regain?: string; alive?: boolean }[];
  /** models destroyed this phase that roll to come back at the end of it (Armour of Fate) */
  revivals?: { unitId: string; modelId: string; label: string; on: number; wounds: number; x: number; y: number }[];
}
