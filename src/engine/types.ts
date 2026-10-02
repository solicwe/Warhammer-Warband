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

export interface AbilityData { name: string; type: string; param?: string; model?: string; text: string }

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
  link: string;
}

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
export type MoveKind = 'stationary' | 'normal' | 'advance' | 'fallback' | 'ingress' | 'charge' | 'pileIn' | 'consolidate' | 'deploy' | 'scout';

export interface ModelState {
  id: string;
  name: string;
  profile: ModelProfileData;
  source: string; // datasheet name the model comes from
  isCharacter: boolean;
  isBodyguard: boolean;
  keywords: string[];
  weapons: WeaponData[];
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

export interface TransportInfo { capacity: number; double: string[]; forbid: string[]; only: string[]; infantryOnly: boolean; text: string }

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
}

export interface LogEntry { turn: number; round: number; player: PlayerId | null; text: string; kind?: 'roll' | 'info' | 'vp' | 'cp' | 'kill' }

export type DieOutcome = 'miss' | 'hit' | 'crit' | 'auto' | 'wound' | 'critWound' | 'saved' | 'fail' | 'pass';
export interface Die { v: number; o: DieOutcome; rerolled?: boolean; orig?: number }

export interface Pool {
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
  woundNeed: number;
  woundMod: number;
  woundNote: string;
  critWoundOn: number;
  sustained: string | null;
  lethal: boolean;
  devastating: boolean;
  twinLinked: boolean;
  precision: boolean;
  ap: number;
  damage: string;
  hazardous: number;
  hits: Die[];
  wounds: Die[];
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
  | { kind: 'counteroffensive'; player: PlayerId };

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
  version: 2;
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
  deploymentId: string;
  primaryId: string;
  attackerPlayer: PlayerId;
  window: Window | null;
  attack: AttackSession | null;
  fight: FightState | null;
  shockTests: ShockTest[];
  destroyedByTurn: { turn: number; owner: PlayerId; unitId: string }[];
  controlAtTurnStart: (PlayerId | null)[];
  log: LogEntry[];
  winner: PlayerId | null | 'draw';
  botPlayer?: PlayerId | null;
  fx?: FxEvent[];
  botTried?: string[]; // bot bookkeeping: units already considered this phase
  fxSeq?: number;
}
