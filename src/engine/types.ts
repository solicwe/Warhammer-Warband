import type { Effect } from '../rules-engine/effects';
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

export interface AbilityData { name: string; type: string; param?: string; model?: string; text: string; sheet?: string; faction?: string; mods?: { stat: string; type: 'increment' | 'set'; value: string }[] }

export interface CompositionData { name?: string; min?: number; max?: number; text: string }

export interface PointsTier { label: string; options: { models: number; pts: number }[] }

export interface DatasheetData {
  id: string;
  name: string;
  role: string;
  keywords: string[];
  factionKeywords: string[];
  ally?: string; // an allied unit from another book (its faction id: QI, QT, TL, AoI, CD)
  allyName?: string;
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
  hiddenFor?: string[]; // not available to armies of these Chapters (Black Templars have no Librarians …)
  maxPerArmy?: number;
  dupTax?: { pts: number; from: number }; // 11e: each copy of this datasheet from the Nth on costs this much more
  link: string;
}

/** One parsed line of a datasheet's wargear options (built by scripts/build-data.mjs). */
export interface WargearOption {
  text: string;
  /** one: the named/only model · upTo: up to `max` models · perN: `max` per `per` models · any: any number · all: every model or none */
  scope: 'one' | 'upTo' | 'perN' | 'any' | 'all';
  per?: number;
  perOf?: string; // perN: the models that are counted ("For every 5 Inquisitorial Agents"), else every model
  max?: number;
  stack?: boolean; // "This model can be equipped with up to 4 X": count = copies on the one model
  minModels?: number; // "If this unit contains 12 models, …"
  who: string; // model name the option applies to, '*' = any model
  replace: string[]; // items removed (weapon names, or equipment such as "Storm shield")
  choices: string[][]; // each choice: items gained (repeated for "2 x")
  pick?: number; // "two different weapons from the following list"
  pickFrom?: string[];
  requires?: string[]; // the model must carry these
  unique?: string[]; // "a model cannot be equipped with more than one X"
}

/** A wargear choice in an army list: `count` models take choice `choice` of option `opt` (choice -1 = the `picks` list). */
export interface WargearPick { opt: number; choice: number; count: number; picks?: string[] }

export interface EnhancementData { id: string; name: string; pts: number; upgrade: boolean; text: string }
export interface StratagemData { id: string; name: string; cp: number; type: string; turn: string; phase: string; text: string; short_summary?: string }

export interface DetachmentData {
  id: string;
  name: string;
  dp: number;
  forceDisposition: string | null;
  subfaction?: string; // Chapter-specific detachment
  forceDispositions?: string[]; // detachments that count as more than one Force Disposition
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
  mark?: string; // Pactbound Zealots: the Mark of Chaos picked for it (KHORNE, TZEENTCH, NURGLE, SLAANESH, CHAOS UNDIVIDED)
  enhancement?: string;
  enhancementPts?: number;
  warlord?: boolean;
  wargear?: WargearPick[];
  wargearPts?: number; // points for costed wargear and add-on models, kept in sync by the army builder
  addons?: string[]; // optional extra models bought separately, e.g. "Invader ATV"
  split?: boolean; // split into two units at Declare Battle Formations (Combat Squads …)
  embarkIn?: string; // uid of the TRANSPORT this unit starts the battle embarked within
  xp?: number; // battle experience in campaign
  honors?: string[]; // battle honors / upgrades applied to this unit
  customName?: string;
}

export interface ArmyList {
  /** the player's saved lists (home screen) */
  id?: string;
  updatedAt?: number;
  name: string;
  factionId: string;
  subfaction?: string; // sub-faction keyword, e.g. a Chapter
  battleSize: string;
  detachments: string[];
  /** the Force Disposition picked when the detachments offer more than one */
  disposition?: string;
  units: ArmyUnitEntry[];
}

// ---------- Game state ----------

export type PlayerId = 0 | 1;
export interface Pt { x: number; y: number }
export interface Seg { a: Pt; b: Pt }

export type Phase = 'formations' | 'deploy' | 'scouts' | 'command' | 'movement' | 'shooting' | 'charge' | 'fight' | 'gameover';
export type MoveKind = 'stationary' | 'normal' | 'advance' | 'fallback' | 'ingress' | 'charge' | 'pileIn' | 'consolidate' | 'deploy' | 'scout' | 'extra' | 'surge';

export interface ModelState {
  /** Shadow Field: the invulnerable save is gone for the rest of the battle */
  shadowFieldDown?: boolean;
  id: string;
  name: string;
  profile: ModelProfileData;
  source: string; // datasheet name the model comes from
  isCharacter: boolean;
  deadlyDemise?: string; // this model alone has Deadly Demise X (Warphead), even inside a bigger unit
  ritualBonus?: number; // Spirit Snare: + to its Psychic test results (max 2)
  isBodyguard: boolean;
  keywords: string[];
  weapons: WeaponData[]; // a weapon listed twice is carried twice (e.g. 2 godhammer lascannons)
  gear?: string[]; // non-weapon wargear: shields, banners, icons …
  x: number;
  y: number;
  r: number; // base radius in inches (the mean radius of an oval base or hull)
  hw?: number; // oval base / hull: half its width (inches)
  hl?: number; // oval base / hull: half its length beyond the width, along its facing (inches)
  rot?: number; // oval base / hull: which way its long axis points (radians)
  hull?: true; // set up without a base: drawn as the vehicle's hull, not an oval
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
  firingDeck?: number; // Firing Deck X: X weapons of the units embarked within shoot from this transport
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
  startEngaged?: { turn: number; ids: string[] }; // enemy units it was engaged with at the start of this turn (Thrill Seekers)
  plagueExtra?: string;
  leads?: string[]; // a lone CHARACTER: the datasheets it can lead (attaching during the battle: Mobile Vector)
  putrid?: boolean; // Putrid Detonation: its Deadly Demise makes the units it hurts Afflicted // Cornucophagus: the Plague enemy units within this unit's Contagion Range also have
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
  /** model profiles the unit can gain during the battle (Split: Blue / Brimstone Horrors) */
  templates?: ModelState[];
  /** enemy units this unit moved over in its last Normal move (Flame-wreathed, Slashing Dive) */
  movedOver?: { key: string; ids: string[] };
  /** hit by a Psychic Attack of a THOUSAND SONS PSYKER this phase (Ensorcelled Destruction / Annihilation) */
  psyHit?: { key: string; by: PlayerId };
  pts: number;
  status: 'pending' | 'reserves' | 'board' | 'destroyed' | 'embarked';
  embarkedIn: string | null;
  /** Seeker of the Unfound: the objective picked when the unit was first set up */
  seekerObjective?: string;
  /** Teleport Homer: where its token was set up at the start of the battle (removed once used) */
  homer?: Pt;
  /** abilities used once per battle / per turn by key (Miraculous Saviour, Emergency Combat Embarkation …) */
  onceUsed?: string[];
  triggered?: string[]; // conditions that hold for the rest of the battle once they happen (Vengeance for the Omnissiah)
  oncePerTurnUsed?: string[];
  transport: TransportInfo | null;
  weaponsFired: string[]; // split fire: ranged weapons already used this phase
  cantCharge: boolean; // e.g. after a rapid / combat disembark
  disembarkedTurn?: number;
  disembarkedFrom?: string; // transport id the unit disembarked from this turn
  lastStationaryTurn?: number; // turn the unit last Remained Stationary
  riledUntil?: number; // Orks: riled up by an ability until this turn index (inclusive)
  quarry?: string; // Headhunters: enemy unit id
  soulOwn?: AbilityData[]; // Soul Link: the bearer's own datasheet abilities while it copies another character's
  readied?: boolean; // Adeptus Custodes Martial Ka'tah: the unit can use one ka'tah ability
  mark?: string; // Blade Champion's Sword of the Throne: enemy unit id
  cherubUsed?: boolean; // Adepta Sororitas: Cherub once per battle
  timed?: TimedEffect[]; // temporary effects and marks from abilities
  split?: string; // split off another unit at Declare Battle Formations (Combat Squads …): the other unit's id
  sagaDone?: boolean; // Slayer's Oath: this unit has the completed-Saga benefits
  oathKills?: number; // Saga of the Bold: Oath of Moment targets this unit destroyed
  abilityPicks?: { pool: string[]; on: string[] }; // "select two of these abilities" (Author of the Codex …)
  used?: Record<string, string>; // ability limits: name -> last use key (battle / round / turn / phase)
  lastHits?: { key: string; ids: string[]; byWeapon?: Record<string, string[]> }; // enemy units hit this phase
  extraMove?: { max: number; label: string; kind: 'extra' | 'surge'; phase?: string; endIn?: 'dzOrObjective' | 'objective'; asMove?: boolean }; // a move granted by an ability, not yet made
  arriveEarly?: number; // battle round in which this unit may already arrive from Reserves (High King of Fenris …)
  chargeOnly?: { turn: number; ids: string[] }; // this turn the charge must end engaged with one of these (Snarling Protector)
  chargeMust?: { turn: number; id: string }; // this turn any charge it makes must end engaged with this unit (Lethal Obsession)
  fightOnly?: { key: string; models: string[] }; // this phase only these models fight (Rise to the Challenge: the bearer fights again)
  noChargeTurn?: number; // turn in which this unit cannot declare a charge (Meteoric Descent …)
  fellBackFrom?: string[]; // enemy units engaged with this unit when it fell back this turn
  detRerolled?: string; // `${turn}:advance|charge`: free detachment re-roll used
  detAdvanceHurt?: string; // `${turn}:advance`: Wrath of the Doomed mortal wounds taken
  scoutDone: boolean;
  battleShocked: boolean;
  isWarlordUnit: boolean;
  warlordSource?: string; // datasheet of the Warlord model in this unit
  enhancements: { name: string; text: string; model: string }[];
  // per-turn flags (reset at start of each player turn)
  move: MoveKind | null;
  advanceRoll: number | null;
  maxMoved: number;
  setUpTurn: number;
  /** Genestealer Cults: waiting in Cult Ambush (not destroyed with other Reserves after the third round) */
  cultAmbush?: boolean;
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
  /** a sealed container inside the piece: walls on all four sides (models can't stand in it, some can on its roof) */
  box?: Pt[];
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
  sabotaged?: PlayerId | null; // A Deadly Prize: enemy units ending a move on it may suffer mortal wounds while this player holds it
  mutated?: PlayerId | null; // Mutate Landscape: enemy units ending a move on it roll a D6, 4+ = D3 mortal wounds
  snared?: PlayerId | null; // Mortis Snares: the next enemy unit ending a move in range rolls a D6, 2+ = D6 mortal wounds
  warded?: PlayerId | null; // Ritual of Warding: enemy Daemons cannot be set up within 6" while this player controls it
  corrupted?: PlayerId | null; // Chaos Daemons: Corrupt Realspace / Blood Tainted objective under Daemons control with 6" Shadow of Chaos
}

export interface PlayerState {
  favoured?: string; // Slaanesh's Chosen: the unit that is the army's Favoured Champions
  favouredTurn?: number; // … last changed in this turn (only the first kill in each turn passes it on)
  pledge?: { round: number; n: number; boosted?: boolean }; // Coterie of the Conceited: this battle round's pledge to Slaanesh
  pactPoints?: number; // … Pact points gained so far
  /** World Eaters: Blessings of Khorne active this battle round, extra ones (one phase / round, maybe for a keyword only), Bloodshed points */
  blessings?: { round: number; ids: string[] };
  blessingExtras?: { id: string; kw?: string; key: string }[];
  bloodshed?: number;
  /** Khorne Daemonkin: Blood Tithe points */
  tithe?: number;
  /** Death Guard: the army's Plague, a second one (Final Ingredient / Host of the Hybridised Pox), places that make
   *  enemy units Afflicted (Worldblight / Signal Pox objectives, Blighted Land terrain), the Numberless Horde template */
  plague?: string;
  /** Imperial Knights: the Oaths sworn (Code Chivalric), Honoured, the Gate Warden defensive line, expended Enhancements */
  knights?: { deeds: string[]; qualities: string[]; random?: boolean; honoured?: boolean; done?: boolean; fulfilled: number; tyrant?: string; roundBase?: number; line?: string[]; expended?: string[] };
  /** Chaos Knights: Paragons of Terror's extra Dread ability can be selected now */
  dreadBonus?: boolean;
  extraPlague?: string;
  blight?: { objId?: string; terrain?: number; untilTurn?: number }[];
  poxTemplate?: UnitState;
  /** a unit the army can add mid-battle (Gift of Change: a one-model Tzeentch Chaos Spawn), cloned when it arrives */
  spawnTemplate?: UnitState;
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
  shadowInTheWarpUsed?: boolean; // Shadow in the Warp (Tyranids)
  /** Adepta Sororitas: Miracle Dice pool (Acts of Faith) */
  miracleDice?: number[];
  /** Units that performed an Act of Faith this phase */
  actsOfFaithUsed?: string[];
  /** Aeldari: Fate Dice pool (Strands of Fate) */
  fateDice?: number[];
  /** Units that used a Fate Die this phase */
  strandsOfFateUsed?: string[];
  /** Aeldari: Battle Focus tokens */
  battleFocusTokens?: number;
  /** Agile Manoeuvres performed this phase (manoeuvre → phase key) */
  focusUsed?: Record<string, string>;
  /** Seer Council: Fate dice that make some stratagems cheaper */
  seerFate?: number[];
  /** Sonic Destruction: Vibro Cannon Platform units that shot each enemy unit this phase ("<phase>:<unit id>") */
  vibroShots?: Record<string, string[]>;
  /** Leagues of Votann: Yield Points (Prioritised Efficiency) */
  yieldPoints?: number;
  /** Leagues of Votann: Active stance */
  votannAbility?: 'Hostile Acquisition' | 'Fortify Takeover';
  /** Adeptus Mechanicus: Active Doctrina Imperative */
  admechImperative?: 'Protector Imperative' | 'Conqueror Imperative';
  /** Adeptus Mechanicus: Haloscreed Halo Override units and ability */
  admechHaloOverrideUnits?: string[];
  admechHaloOverrideAbility?: 'Electromotive Energisation' | 'Microactuator Bracing' | 'Predation Protocols' | 'Muted Servomotors';
  /** Belisarius Cawl: Machine Vengeance target unit id */
  machineVengeanceTarget?: string | null;
  acquisitionId?: string;
  ypTurn?: { turn: number; gained: number; spent: number }; // Leagues of Votann: YP gained / spent this turn // Explorator Maniple: the Acquisition objective marker
  /** Drukhari: Pain Token pool (Power from Pain) */
  painTokens?: number;
  /** Drukhari: Units empowered by spending a Pain token this phase */
  empoweredUnits?: string[];
  /** Drukhari: Reaper's Wager detachment side winning the wager */
  drukhariWagerWinning?: 'Drukhari' | 'Harlequins';
  /** Drukhari: Murderous Agenda's Contract (Kabalite Cartel) */
  contract?: { kind: 'trophy' | 'fear' | 'strength'; unitId: string; done?: boolean };
  /** Drukhari: Combat Drugs selected (not rolled) this battle (Spectacle of Spite) */
  drugsSelected?: string[];
  /** Chaos Daemons: Scintillating Legion Flux tokens pool */
  fluxTokens?: number;
  /** Chaos Daemons: Corrupted objective IDs (6" Shadow of Chaos aura + sticky control) */
  corruptedObjectives?: string[];
  /** Chaos Daemons: Units that performed Seductive Gambit this turn */
  fluxUsed?: string; // Fates in Flux: the last turn:phase:roll a Flux token re-rolled a Hit / Wound / Advance
  /** Genestealer Cults: Resurgence points pool (Cult Ambush) */
  resurgencePoints?: number;
  /** Genestealer Cults: Cult Ambush marker positions on battlefield */
  cultAmbushMarkers?: Pt[];
  /** Genestealer Cults: Summon the Cult was used */
  summonedCult?: boolean;
  /** Necrons: Obeisance Phalanx Worthy Foe designated target */
  resurrectTurn?: number; // Resurrection Orb: the turn a unit of this army last resurrected (one per turn)
  riledUntilTurn: number;
  secMode: 'none' | 'tactical' | 'fixed';
  secDeck: string[];
  secActive: string[];
  secVp: number;
  secByRound: number[];
  secFixedVp: Record<string, number>;
  secSwapUsed: boolean;
  /** detachment stratagems the player lets the game use by itself when their moment comes (e.g. Vengeful Animus) */
  autoStrats?: string[];
  /** limited stratagems: id -> battle round it was last used ("once per battle round") or -1 (once per battle) */
  stratLimits?: Record<string, number>;
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
  /** Thousand Sons Cabal of Sorcerers: Rituals attempted this turn (ritual ids) and by which models (model id -> count) */
  rituals?: { turn: number; tried: string[]; by: Record<string, number>; done?: boolean };
  /** Hexwarp Thrallband: the areas in the Flow of Magic this phase */
  flow?: { key: string; nml: boolean; opp: boolean };
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
export interface Die { v: number; o: DieOutcome; rerolled?: boolean; orig?: number; crit?: boolean }

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
  rerollWounds12?: boolean; // re-roll wound rolls of 1 and 2
  rerollAllWounds?: boolean;
  rerollDamage?: boolean;
  rerollDamageOne?: boolean; // one low damage roll of this pool may be re-rolled (Aquilon Optics)
  rerollDamage1?: boolean; // Damage rolls of 1 are re-rolled
  /** variable numbers of attacks rolled for this pool (D6, 2D3+1 …), so one can be re-rolled */
  attackRolls?: { expr: string; total: number; rerolled?: boolean }[];
  /** Command Re-roll the first damage roll below average that would not already kill the model */
  crDamage?: boolean;
  attackBonus?: number; // +A per weapon instance (e.g. Red Thirst)
  critHitOn?: number; // unmodified hit rolls of this or more are critical hits
  ignoreHitMods?: boolean; // ignore negative modifiers to hit / BS / WS
  ignoreWoundMods?: boolean; // … and to the wound roll
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
  critWoundAp?: number; // extra AP on a critical wound (Titanic Fire Support)
  damage: string;
  hazardous: number;
  hits: Die[];
  wounds: Die[];
  /** an ability lets the attacker re-roll some of these dice: they pick which (the failures by default) */
  reroll?: { stage: 'hit' | 'wound'; which: 'all' | 'ones' | 'onesTwos'; picks: number[] };
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
  /** how many timed effects each side had when the attack was declared (later ones are applied before the rolls) */
  timedAtStart?: { a: number; t: number };
}

/** Visual events for the board (animations). Not rules state; capped to the last few. */
export type FxEvent =
  | { seq: number; kind: 'move'; unitId: string; owner: PlayerId; moveKind: MoveKind; paths: [string, Pt[]][] }
  | { seq: number; kind: 'place'; unitId: string; owner: PlayerId; at?: Pt }
  /** a unit fails a Battle-shock test */
  | { seq: number; kind: 'shock'; unitId: string; owner: PlayerId; at: Pt }
  /** wounds regained or destroyed models returned */
  | { seq: number; kind: 'heal'; unitId: string; owner: PlayerId; at: Pt; n: number; revive?: boolean }
  /** the blast and range of a Deadly Demise explosion */
  | { seq: number; kind: 'explosion'; at: Pt; range: number; radius: number; hits: number }
  | { seq: number; kind: 'attack'; attackKind: 'shoot' | 'fight' | 'overwatch'; attackerId: string; targetId: string; owner: PlayerId; from: Pt; to: Pt; dmg: number; killed: number; dead: Pt[]; deadIds?: string[];
      style?: 'bullet' | 'beam' | 'flame' | 'blast' | 'melee'; shooters?: Pt[]; victims?: Pt[]; shots?: number; hits?: number;
      /** one entry per weapon fired, so each weapon gets its own look (plasma balls, assault cannon streams …) */
      volleys?: { fx: WeaponFx; shots: number; hits: number; models: number }[];
      /** the attack told step by step (the screen counts it up stage by stage) */
      report?: AttackReport }
  | { seq: number; kind: 'mortal'; unitId: string; n: number; at: Pt; deadIds?: string[] }
  /** a roll worth showing big on screen (advance, charge, battle-shock) */
  | { seq: number; kind: 'roll'; owner: PlayerId | null; title: string; dice: number[]; result: string; good?: boolean; unitId?: string; at?: Pt }
  /** roll-off between the players */
  | { seq: number; kind: 'rolloff'; title: string; a: number; b: number; winner: PlayerId; result: string }
  /** tactical secondary cards just drawn (shown face up, one after the other) */
  | { seq: number; kind: 'cards'; owner: PlayerId; ids: string[] }
  /** the start of the battle: both players' Primary Mission cards */
  | { seq: number; kind: 'primary' }
  /** a Psychic Ritual (Thousand Sons): from the sorcerer to its target, with the Ritual's own look */
  | { seq: number; kind: 'ritual'; owner: PlayerId; ritual: string; name: string; from: Pt; to: Pt; ok: boolean; text?: string }
  /** a hero uses a big ability or a stratagem: a burst of light around it and the ability's name */
  | { seq: number; kind: 'skill'; unitId: string; owner: PlayerId; at: Pt; name: string; who: string; style: SkillStyle; epic: boolean; grand?: boolean };

import type { WeaponFx } from './weaponFx';
export type SkillStyle = 'holy' | 'psychic' | 'fury' | 'waaagh' | 'tech' | 'shield';

export type Window =
  | { kind: 'fireOverwatch'; player: PlayerId }
  | { kind: 'rapidIngress'; player: PlayerId }
  | { kind: 'smokescreen'; player: PlayerId }
  | { kind: 'heroicIntervention'; player: PlayerId }
  | { kind: 'counteroffensive'; player: PlayerId }
  /** abilities that let units react out of turn ("if an enemy unit ends a move within 8\", this unit can make a Normal move") */
  | { kind: 'abilityMove'; player: PlayerId; offers: { unitId: string; key: string; label: string }[]; label: string }
  /** Coterie of the Conceited: the player pledges how many enemy units the army will destroy this battle round */
  | { kind: 'pledge'; player: PlayerId; max: number }
  /** Blessings of Khorne: the dice rolled and the ways to use them; the player picks one (or none) */
  | { kind: 'blessings'; player: PlayerId; dice: number[]; picks: import('../factions/blessings').BlessingPick[]; extra?: { label: string; kw?: string; until: 'phase' | 'round' }; rerolls?: number; rerollFrom?: string }
  /** a rule asks the player to pick one unit ("select one enemy unit hit by those attacks"); `acts` go to it */
  | { kind: 'pickUnit'; player: PlayerId; label: string; units: string[]; holderId: string; acts: import('../rules-engine/activations').Action[] }
  /** detachment stratagems the player can use right now, at a moment the engine reported ("just after an enemy unit has shot") */
  | { kind: 'stratReaction'; player: PlayerId; on: string; ctx: { unitId?: string; modelId?: string; killerId?: string }; offers: { stratId: string; units: string[] }[]; label: string; resume?: 'endPhase' };

export interface FightState {
  step: 'pileIn' | 'fight' | 'consolidate';
  stepPlayer: PlayerId; // pile-in / consolidate: whose units are moving
  chooser: PlayerId;
  eligible: string[]; // unit ids eligible at start of fight step
  fought: string[];
  forcedNext: string | null; // counteroffensive
  movedThisStep: string[];
}

export interface ShockTest { unitId: string; result: number | null; passed: boolean | null; auto?: boolean; mod?: number }

export type BotLevel = 'easy' | 'normal' | 'hard' | 'expert';

/** One attack as the screen tells it: each stage's count, what changed the odds at that stage, and how it compares
 *  with what was to be expected. */
export interface AttackReport {
  attacker: string;
  target: string;
  weapons: string[];
  shots: number;
  hits: number;
  crits: number;
  wounds: number;
  /** wounds that got through the saves (failed saves, Devastating Wounds and wounds with no save) */
  unsaved: number;
  mortals: number;
  dmg: number;
  /** models in the target unit when the attack began */
  before: number;
  killed: number;
  destroyed: boolean;
  /** points of the target's unit destroyed by this attack */
  pts: number;
  chips: { stage: 'attacks' | 'hit' | 'wound' | 'save'; label: string }[];
}

/** The battle so far, for the round and end-of-battle summaries. */
export interface BattleStats {
  kills: { round: number; turn: number; by: PlayerId; attackerId: string; targetId: string; models: number; pts: number; destroyed: boolean }[];
}

export interface GameState {
  phaseTargets?: { key: string; list: [string, string][] }; // [attacker or charger, target] this phase (Thrill Seekers)
  version: 3;
  rng: number;
  round: number;
  /** battle rounds this game lasts (a short game: 3); the full 5 when unset */
  maxRounds?: number;
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
  destroyedByTurn: { turn: number; owner: PlayerId; unitId: string; killerId?: string; killerNearObj?: boolean; phase?: Phase }[];
  markers: OperationMarker[];
  modelDeaths: { turn: number; owner: PlayerId; character: boolean; W: number }[];
  pendingActions: PendingAction[];
  turnStart: TurnSnapshot | null;
  controlAtTurnStart: (PlayerId | null)[];
  log: LogEntry[];
  winner: PlayerId | null | 'draw';
  botPlayer?: PlayerId | null;
  /** how hard the bot plays: easy (no looking ahead, some slips), normal, hard (each way of playing the turn tried on
   *  two rolls of the dice), expert (more ways, three rolls each) */
  botLevel?: BotLevel;
  /** a level for one side only (measuring one level against another) */
  botLevels?: Partial<Record<PlayerId, BotLevel>>;
  /** players run by the bot (both for a bot-vs-bot game) */
  bots?: PlayerId[];
  /** players who only move and pick shooting targets: every other decision (stratagems, abilities, re-rolls, saves,
   *  battle-shock, fights, reactions) is taken for them by the bot's logic */
  autoRules?: PlayerId[];
  /** players on auto rules who still answer stratagem prompts, reactions (Overwatch, Heroic Intervention …) and pick
   *  their own Rituals themselves */
  decides?: PlayerId[];
  /** players who asked the app to deploy (and make Scouts moves for) the rest of their army */
  autoDeploy?: PlayerId[];
  /** players who chose to deploy all units directly onto the battlefield without placing in reserves */
  deployAllOnField?: PlayerId[];
  /** vs bot: the player rolls their own saves when the bot attacks (and can use Command Re-roll then). Default on. */
  defenderRolls?: boolean;
  /** ability re-rolls ("re-roll the Hit roll", Oath of Moment …) wait for the dice to be picked; off: every failed die is re-rolled at once */
  pickRerolls?: boolean;
  /** the player moves their own units in pile-in / consolidate (off: the game does it, as many models into the fight as possible) */
  manualPile?: boolean;
  /** bots that move without looking at their secondary cards (for comparing bot versions in tests) */
  botIgnoresCards?: PlayerId[];
  fx?: FxEvent[];
  stats?: BattleStats;
  campaign?: { node: string; relics: string[]; rules: string[]; relicLevels?: Record<string, number>; lootedObjectives?: string[]; reinforcementsTriggered?: number[]; dramaRounds?: number[]; titanSpawned?: boolean; allowDynamicExpansion?: boolean };
  reinforcementAlert?: { unitName: string; factionName: string; round: number; count: number; text: string } | null;
  titanAlert?: { unitName: string; factionName: string; round: number; text: string; triggered: boolean } | null;
  screenShake?: number;
  warpStormActive?: boolean;
  campaignScrap?: number; // scrap salvaged during campaign battle
  table?: { width: number; height: number };
  botTried?: string[]; // bot bookkeeping: units already considered this phase
  fxSeq?: number;
  /** destroyed models that fight / shoot after the attacking unit has finished (resolved by activations.ts) */
  /** the last unit to move / attack / declare a charge, for reactions ("just after an enemy unit has shot") */
  /** after deployment: a player re-deploying units (Master of Deceit, Strategium Command, Cerebrex Logic Engine) */
  redeploy?: { player: PlayerId; left: number; infantryOnly: boolean; source: string; done: PlayerId[]; units?: string[] };
  /** Priority Target Identified: terrain features identified this turn (enemy units within have +3" detection range) */
  identified?: { terrainId: string; by: PlayerId; turn: number }[];
  lastAct?: { unitId: string; owner: PlayerId; kind: 'move' | 'attack' | 'charge'; turn: number; phase: Phase; targets: string[]; lost: string[]; halved: string[]; fellBackFrom?: string[] };
  /** stratagem prompts waiting for the current prompt / attack to finish */
  reactQueue?: { player: PlayerId; on: string; ctx: { unitId?: string; modelId?: string; killerId?: string }; turn: number; phase: Phase }[];
  /** "turn:phase:moment" keys already offered (so ending a phase twice does not prompt twice) */
  reactDone?: string[];
  deathQueue?: { unitId: string; modelIds: string[]; targetId: string; kind: 'fight' | 'shoot'; label: string; regain?: string; alive?: boolean }[];
  /** models destroyed this phase that roll to come back at the end of it (Armour of Fate) */
  /** models made CHARACTERs for a while (Instant of Grace, Birth of a Saga): undone at their player's next Command phase */
  tempCharacters?: { unitId: string; modelId: string; by: PlayerId }[];
  /** Gift of Change: Chaos Spawn to set up at the end of the phase where a character died */
  spawns?: { owner: PlayerId; x: number; y: number; label: string }[];
  revivals?: { unitId: string; modelId: string; label: string; on: number; wounds: number; x: number; y: number; ld?: boolean; woundsRoll?: string }[];
  /** mortal wounds a unit suffers at the end of the current phase (Warpmeld Sacrifice) */
  phaseMortals?: { unitId: string; expr: string; label: string }[];
  /** Split (Horrors): destroyed Horrors that roll to split once the attacking unit has finished its attacks */
  splits?: { unitId: string; from: 'pink' | 'blue'; x: number; y: number }[];
  /** Astra Militarum Voice of Command: orders issued this turn by officer unit id */
  ordersUsed?: Record<string, number>;
  /** T'au Empire For the Greater Good: Guided, Observer, and Spotted unit pairings this phase */
  ftggPairs?: { guidedId: string; observerId: string; spottedId: string; turn: number; phase: Phase }[];
}

