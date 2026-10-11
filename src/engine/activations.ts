// Abilities you use (buttons) or that happen at a moment of the game (triggers):
// "Once per battle, at the start of the Fight phase…", "In your Command phase, this unit heals 3 wounds",
// "Each time this unit ends a Charge move, roll one D6…", "After this unit has shot, select one enemy unit hit…".
// The specs live with the ability in data/abilities/<faction>.json ("act"), so new abilities are data, not code.
import {
  applyMortalWounds, buildFightPools, buildShootPools, expectedDamage, finishAttack, forceDie, onAttackFinished, onAttackStart, onModelKilled, onMortalWounds, rerollOne, resolveAll, startAttack,
  setFreeDamageHook, targetToughness, woundNeed,
} from './attack';
import { RULES } from './config';
import { autoPact } from './darkPacts';
import { d6, rollExpr, rollN } from './dice';
import { favouredOnKill } from './emperorsChildren';
import {
  abilityOff, abilityRule, abilitySheet, activeRules, addTimed, cond, DET_RULES, fightOnDeathFor, grantsOf, isRiled, retaliateFor, type AbilityRule, type Effect, type FreeDieSpec,
  type Incoming, type Limit, unitFlags, unitMatches,
} from './effects';
import { baseDist, circleTouchesPoly, dist } from './geometry';
import { alive, boardUnits, centreOf, engagedEnemies, hasKw, heroFx, log, onBoard, other, pace, phaseKey, playsItself, pushFx, unitById, unitDistance } from './state';
import type { AbilityData, AttackSession, GameState, ModelState, PlayerId, TimedEffect, UnitState } from './types';
import { unitVisibleTo } from './visibility';

export type Trigger =
  | 'formation' | 'battleStart' | 'roundStart' | 'commandStart' | 'command' | 'anyCommand' | 'commandEnd'
  | 'movement' | 'endOfNormalMove' | 'movementEnd' | 'shooting' | 'selectedToShoot' | 'afterShooting' | 'afterShootingButton'
  | 'selectedToFight' | 'fightStart' | 'fightStartButton' | 'afterFighting' | 'endOfCharge'
  | 'anyPhase' | 'opponentTurnEnd' | 'opponentFightEnd' | 'onDeath' | 'friendlyDeath' | 'shotByEnemy' | 'enemyMovedNear' | 'enemyFellBack'
  | 'mortalTaken' | 'becameShocked' | 'passengerDisembarks' | 'movementStart' | 'fightEnd' | 'attackStart'
  | 'attacked' | 'friendlyTargeted' | 'fightEndButton' | 'chargeStart' | 'chargeEnd'
  | 'shootingStart' | 'oppShootingStart' | 'eachCommandStart';

export type Until = TimedEffect['until'];

export interface TargetSpec {
  side: 'self' | 'friendly' | 'enemy';
  range?: number; // within X" of the ability's models
  rangeBonusIf?: { ability: string; add: number }; // … X" further when the unit also has this ability (Crown of Worms)
  engaged?: boolean; // enemy unit engaged with the ability's unit
  visible?: boolean;
  units?: string[]; // keyword filters
  notSelf?: boolean;
  hit?: boolean; // enemy unit hit by this unit's attacks this phase
  hitWeapon?: string; // … hit by attacks with this weapon
  shocked?: boolean; // friendly unit that is battle-shocked
  damaged?: boolean; // friendly unit with a wounded model
  each?: boolean; // every unit that qualifies, not one of them
  count?: number | 'round' | 'battleSize'; // with each: at most this many (closest to the enemy first; before the battle: the most expensive)
  charged?: boolean; // enemy unit that made a Charge move this phase
  closest?: boolean; // the closest enemy unit
  anywhere?: boolean; // units not on the battlefield count too (Declare Battle Formations, start of the battle)
  inReserves?: boolean; // friendly unit in Reserves
  attacker?: boolean; // the unit whose attack destroyed this model
  notLoneOperative?: boolean;
  ctxUnit?: boolean; // the unit the trigger is about (e.g. the unit disembarking)
  advanced?: boolean; // a unit that made an Advance move this turn
  movedOver?: boolean; // an enemy unit this unit moved over in its last Normal move
}

export interface Action {
  on?: 'self' | 'target' | 'attacker';
  buff?: Effect[]; // timed effect on the unit
  bearerOnly?: boolean; // … on the models that have the ability only ("this model")
  incoming?: Omit<Incoming, 'by'>; // mark: your attacks against that unit get better
  selfOnly?: boolean; // … for this unit's attacks only
  fromThisTransport?: boolean; // … for units that disembarked from this transport this turn
  fromDisembarked?: boolean; // … for units that disembarked from any transport this turn
  until?: Until;
  mark?: string;
  heal?: string; // wounds regained (on the most damaged model)
  revive?: number; // destroyed models returned
  reviveLater?: { on: number; wounds: number; ld?: boolean; woundsRoll?: string }; // this model rolls at the end of the phase to come back (ld: a Leadership test instead; woundsRoll: with that many wounds)
  mortals?: string; // mortal wounds
  mortalsVehicle?: string; // … instead, if the unit is a VEHICLE
  mortalsMV?: string; // … instead, if the unit is a MONSTER or VEHICLE
  shock?: number; // battle-shock test with this modifier (negative = harder)
  battleShock?: boolean; // the unit becomes battle-shocked
  unshock?: boolean;
  riled?: boolean; // Orks: riled up until the start of your next turn
  cp?: number;
  reserves?: boolean; // remove the unit and place it into Strategic Reserves
  earlyArrival?: boolean; // the unit may arrive from Reserves this battle round
  move?: string; // an extra Normal move of up to this many inches (dice allowed, "M" = the unit's Move)
  moveIfRiled?: string; // … this distance instead while riled up
  surge?: string; // surge move towards the closest enemy unit
  noCharge?: boolean; // … and the unit cannot declare a charge this turn
  asMove?: boolean; // … and that move is the unit's move this phase (Pulse Jet)
  setQuarry?: boolean;
  setPriority?: boolean; // Priority Objective Identified (target: the objective under the unit)
  setSlayer?: boolean; // Slayer's Oath: the keyword the enemy army has most of
  secure?: boolean; // the objective the unit is on stays yours until the opponent controls it
  attacksPerEnemyNear?: { range: number; max: number; weapon?: string };
  sacrifice?: { n: string; name: string }; // destroy this many of these models (That'll Learn Ya)
  shockPerModels?: number; // the battle-shock test gets −1 for every this many models in this unit (Roar of Mork)
  moveIfHeavyTransport?: string; // move instead if the ability's unit is a transport with 14+ wounds
  vow?: 'aggressive'; // Vowed Target: every objective you do not control becomes a Vowed objective
  tryDatButton?: 1 | 2; // Dread Mob: roll 1 or 2 different D6 on the table (2 = one hazard roll)
  attackMod?: { hit?: number; toughness?: number; noCover?: boolean }; // changes the attack being made right now
  splashMortals?: { expr: string; range: number }; // another enemy unit within X" of the target suffers mortal wounds
  shootBack?: boolean; // after the enemy unit has finished its attacks, this unit shoots it (as if it were your Shooting phase)
  log?: string;
  // stratagem actions
  if?: string[]; // only when these conditions hold (on the unit using it; "target…" ones on the other unit)
  mortalRoll?: { on: number; max?: number; plus?: number; plusIf?: string[]; all?: boolean; n?: number; nWounds?: boolean; dmg?: string; shockIfAny?: number }; // one D6 per model engaged with the target (or n dice): each X+ is a mortal wound (dmg: that many each; shockIfAny: then a Battle-shock test with this modifier)
  ldFail?: Effect[]; // the target takes a Leadership test; failed → these effects (until `until`)
  setOath?: boolean; // the target becomes your Oath of Moment target
  pileInRoll?: string; // Pile-in moves up to this many inches (rolled now) this phase
  consolidateRoll?: string; // Consolidation moves up to this many inches (rolled now) this phase
  unshot?: boolean; // the unit's ranged attacks this turn do not stop it being hidden
  moveReroll?: boolean; // re-roll the move distance when it is low
  characterModel?: boolean; // one non-CHARACTER model gains the CHARACTER keyword until your next Command phase
  reviveModel?: string; // a destroyed model with this keyword is set back up at the end of the phase with full wounds
  sabotage?: boolean; // A Deadly Prize: the objective the unit holds becomes Sabotaged
  identifyTerrain?: boolean; // Priority Target Identified: the visible terrain feature with the most enemy points in it is identified
  snare?: boolean; // Mortis Snares: the objective the unit controls becomes snared
  secureDead?: boolean; // In Sacrifice, Victory: objectives we control where the (destroyed) unit stood are secured
  ready?: boolean; // Martial Ka'tah: the unit is readied
  unready?: boolean; // … it used its ka'tah ability and is no longer readied
  setMark?: boolean; // Sword of the Throne: the target becomes this model's mark
  fightNext?: boolean; // the unit must be the next one its player selects to fight (Indomitable Guardians)
  fightAgain?: boolean;
  idol?: string; // Brazen Idol: this Idols of Khorne ability is the army's active one until your next Command phase
  tithe?: string; // gain this many Blood Tithe points (A Worthy Skull: D3)
  reviveNear?: { range: number; units: string[] }; // Daemontide: models return to the closest such unit within X" (Mounted 1, Beast D3, Infantry D6) // the unit is eligible to fight again this phase and must fight next (Helbrute Frenzy)
  moreBattleUses?: boolean; // its (once per battle) abilities that were used can be used one more time (Gilded Champion)
  splitSingles?: boolean; // the unit splits into units of one model each (Unleash the Lions)
  buffRoll?: { expr: string; fields: ('attacks' | 'strength')[]; if?: string[] }; // roll now, then +that to these characteristics (Sacrificial Blessing: D3)
  explodeModels?: { name: string; on: number }; // these models roll a D6 each: on X+ the model is destroyed and the target suffers 1 mortal wound
  shockMortals?: { mod: number; mortals: string }; // the target takes a Battle-shock test; if it fails it also suffers these mortal wounds (Nethershriek Mind-eater)
  phaseEndMortals?: string; // at the end of the phase the unit suffers these mortal wounds (Warpmeld Sacrifice)
  reviveRoll?: string; // return this many (rolled) destroyed models (Blessed Transmutations: D3+1)
  mutate?: boolean; // Mutate Landscape: the objective the unit controls is mutated (enemy units ending a move on it: 4+ D3 mortal wounds)
  pactTest?: { pass?: Effect[] }; // Desperate Pact: Leadership test; failed → D3 mortal wounds, passed → these effects (until `until`)
  mortalsTable?: { min: number; expr: string }[]; // roll one D6: the highest row it reaches is the mortal wounds the target suffers
  healNear?: { range: number; units?: string[]; heal: string }; // every friendly unit within X" (with these keywords) heals (Delicious Eating Squigs)
  buffNear?: { range: number; units?: string[]; effects: Effect[]; one?: boolean }; // timed effects on friendly units within X" (one: the closest other one)
  addKeyword?: string; // the unit gains this keyword for the rest of the battle (Daemonic Possession)
  ldFailMortals?: string; // the target takes a Leadership test; failed → it suffers these mortal wounds (Gift of Chaos)
  ldMod?: number; ldModIf?: string[]; // … with this modifier to the test (when these conditions hold for the target)
  allowCharge?: boolean; // the unit can declare a charge this turn after all (Ceaseless Onslaught: an assault disembark)
  agonyHeal?: number; // Sustained by Agony: one friendly LEGIONS OF EXCESS unit within X": Daemonettes get D3+3 models back, others 3 wounds
  chargeOnlyTarget?: boolean; // the unit's charges this turn must end engaged with the target (Lethal Obsession)
  embarkNear?: number; // the target embarks within a friendly TRANSPORT it is wholly within this many inches of (Accomplished Tactician)
  addWounds?: number; // +X to the Wounds characteristic for the rest of the battle (the ability's models; Living Carapace)
  soulLink?: boolean; // the bearer copies the datasheet abilities of a CHARACTER in the target unit and gains PSYKER (Soul Link)
  falsehood?: boolean; // one model of the target unit is replaced by this unit's model, which joins it as its Leader (Falsehood)
}

/** Embarking by a rule lives with the transports (game.ts registers it). */
let embarkNearHook: ((s: GameState, u: UnitState, range: number, why: string) => void) | null = null;
export const setEmbarkNear = (fn: typeof embarkNearHook) => { embarkNearHook = fn; };

export interface ActSpec {
  when: Trigger;
  limit?: Limit;
  per?: 'unit' | 'army';
  uses?: number | 'battleSize'; // battleSize: 1 / 2 / 3 at Incursion / Strike Force / Onslaught (Warp Portals)
  battleUses?: number; // "twice per battle" on top of the limit
  auto?: boolean; // resolves by itself at the trigger (no decision needed or always worth it)
  if?: string[];
  target?: TargetSpec;
  range?: number; // enemyMovedNear / friendlyDeath: how close the event has to be
  deathUnits?: string[]; // friendlyDeath: keywords of the destroyed model's unit
  modelDeath?: boolean; // onDeath: fires when a model with the ability dies (not only when the unit is wiped out)
  needDestroyed?: boolean; // afterFighting/afterShooting: the target unit was destroyed
  needCharacterKill?: boolean; // … an enemy CHARACTER model was destroyed
  needModelsLost?: boolean; // shotByEnemy: models were destroyed, not just wounds lost
  needMelee?: boolean; // onDeath: destroyed by a melee attack
  needUnitDestroyed?: boolean; // friendlyDeath: the whole unit was destroyed
  oppShooting?: boolean; // only in the opponent's Shooting phase
  roll?: string; // e.g. "D6"
  rollAdd?: 'per5models' | 'warlordInTarget2' | 'shockedEnemies' | 'onControlledObjective' | 'nearEnemyDz12';
  perModel?: boolean; // one die per model of this unit engaged with the target
  each?: { on: number; do: Action[] }; // per die: on X+
  table?: { min: number; max?: number; do: Action[] }[]; // by result
  ldTest?: boolean; // Leadership test: pass / fail decide what happens
  pass?: Action[];
  fail?: Action[];
  do?: Action[];
  label?: string; // short Thai summary for the button
  botUse?: 'always' | 'damaged' | 'never' | 'valuable' | 'round2' | 'round3' | 'healthy';
  botIf?: string[]; // the bot only presses it when these conditions hold too (a player may press it any time)
  botOnly?: boolean; // an automatic trigger only for a bot player (a person uses the button version)
  units?: string[]; // detachment acts: which units have it
  armyWide?: boolean; // detachment acts: one button for the army, not one per unit
}

export interface ActDef { key: string; name: string; holder: UnitState; spec: ActSpec; bearers: ModelState[] }

// ---------- collecting ----------

function specsOf(rule: { act?: unknown } | undefined): ActSpec[] {
  const a = rule?.act;
  if (!a) return [];
  return (Array.isArray(a) ? a : [a]) as ActSpec[];
}

const wk = (x: string) => x.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');

function gearBearers(a: AbilityData, rule: AbilityRule, ms: ModelState[]) {
  if (!rule.gear) return ms;
  const k = wk(a.name);
  return ms.filter((m) => (m.gear ?? []).some((g) => wk(g) === k || wk(g).includes(k) || k.includes(wk(g))) || m.weapons.some((w) => wk(w.name) === k));
}

export function actsOfUnit(s: GameState, u: UnitState, includeDead = false): ActDef[] {
  const out: ActDef[] = [];
  for (const a of u.abilities ?? []) {
    const rule = abilityRule(u, a);
    const specs = specsOf(rule);
    if (!specs.length || abilityOff(u, a)) continue;
    const sheet = abilitySheet(u, a);
    const all = gearBearers(a, rule!, u.models.filter((m) => m.source === sheet));
    const living = all.filter((m) => !m.dead);
    if (!living.length && !includeDead) continue;
    specs.forEach((spec, i) => out.push({ key: `${a.name}#${i}`, name: a.name, holder: u, spec, bearers: includeDead ? all : living }));
  }
  // Boss Boomer: the Wagon has the Intimidating Motivation / Keep Huntin' of a Warboss riding inside it
  if (u.abilities.some((a) => a.name === 'Boss Boomer')) {
    for (const p of s.units.filter((x) => x.status === 'embarked' && x.embarkedIn === u.id && alive(x).some((m) => m.keywords.includes('WARBOSS')))) {
      for (const a of p.abilities.filter((x) => /^(Intimidating Motivation|Keep Huntin)/.test(x.name))) {
        specsOf(abilityRule(p, a)).forEach((spec, i) => out.push({ key: `${a.name}#${i}`, name: a.name, holder: u, spec, bearers: alive(u) }));
      }
    }
  }
  // abilities the army's rules give this unit ("Friendly CHAPLAIN units have the following ability")
  for (const g of grantsOf(s, u)) {
    const ms = (includeDead ? u.models : alive(u)).filter((m) => !g.models || m.keywords.includes(g.models));
    if (!ms.length) continue;
    specsOf(g.rule).forEach((spec, i) => out.push({ key: `${g.name}#g${i}`, name: g.name, holder: u, spec, bearers: ms }));
  }
  // detachment rules with actions
  for (const name of activeRules(s, u.owner)) {
    const r = DET_RULES[name] as { acts?: ActSpec[] } | undefined;
    (r?.acts ?? []).forEach((spec, i) => {
      if (spec.units && !unitMatches(u, spec.units)) return;
      if (spec.armyWide) {
        const first = s.units.find((x) => x.owner === u.owner && x.status !== 'destroyed' && alive(x).length && unitMatches(x, spec.units));
        if (first?.id !== u.id) return;
      }
      out.push({ key: `${name}#d${i}`, name, holder: u, spec, bearers: alive(u) });
    });
  }
  return out;
}

// ---------- limits ----------

function period(s: GameState, limit?: Limit): string {
  switch (limit) {
    case 'battle': return 'battle';
    case 'round': return `r${s.round}`;
    case 'turn': return `t${s.turn}`;
    case 'phase': return phaseKey(s);
    default: return '';
  }
}

function usedBag(s: GameState, def: ActDef) {
  return def.spec.per === 'army' ? (s.players[def.holder.owner].abilityUsed ??= {}) : (def.holder.used ??= {});
}
const baseKey = (def: ActDef) => def.key.split('#')[0];

export function timesUsed(s: GameState, def: ActDef): number {
  if (!def.spec.limit) return 0;
  const v = usedBag(s, def)[baseKey(def)];
  if (!v) return 0;
  const [p, n] = v.split('|');
  return p === period(s, def.spec.limit) ? Number(n) || 1 : 0;
}

/** Librarius: in a battle round a PSYKER unit uses psychic abilities whose levels add up to at most its psyker level. */
const psyLevel = (def: ActDef) => Number(/\(psychic level (\d)\)/i.exec(def.name)?.[1] ?? 0);
function psykerLevel(u: UnitState): number {
  if (!u.abilities.some((a) => a.name === 'Librarius')) return 99;
  return Math.max(0, ...u.abilities.map((a) => Number(/\(psyker level (\d)\)/i.exec(a.name)?.[1] ?? 0)));
}
const psyUsed = (s: GameState, u: UnitState) => {
  const [r, n] = (u.used?.psy ?? '').split('|');
  return Number(r) === s.round ? Number(n) || 0 : 0;
};
export function psykerBudgetOk(s: GameState, def: ActDef): boolean {
  const lv = psyLevel(def);
  return !lv || psyUsed(s, def.holder) + lv <= psykerLevel(def.holder);
}

function markUsed(s: GameState, def: ActDef) {
  const lv = psyLevel(def);
  if (lv) (def.holder.used ??= {}).psy = `${s.round}|${psyUsed(s, def.holder) + lv}`;
  const bag = usedBag(s, def);
  if (def.spec.battleUses) bag[`${baseKey(def)}#n`] = String((Number(bag[`${baseKey(def)}#n`]) || 0) + 1);
  if (!def.spec.limit) return;
  bag[baseKey(def)] = `${period(s, def.spec.limit)}|${timesUsed(s, def) + 1}`;
}

const BATTLE_SIZE_N: Record<string, number> = { incursion: 1, 'strike-force': 2, strike: 2, onslaught: 3 };
const usesOf = (s: GameState, def: ActDef) => (def.spec.uses === 'battleSize' ? BATTLE_SIZE_N[s.players[def.holder.owner].battleSize ?? ''] ?? 2 : def.spec.uses ?? 1);
export const limitLeft = (s: GameState, def: ActDef) => psykerBudgetOk(s, def) && (!def.spec.limit || timesUsed(s, def) < usesOf(s, def))
  && (!def.spec.battleUses || (Number(usedBag(s, def)[`${baseKey(def)}#n`]) || 0) < def.spec.battleUses);

// ---------- timing of buttons ----------

const QUIET: Trigger[] = ['roundStart', 'commandStart', 'formation', 'battleStart', 'commandEnd', 'movementEnd', 'opponentTurnEnd'];

/** A hero's big ability (once per battle / round, dice, mortal wounds) or anything an EPIC HERO does: an effect on the board. */
function showHeroSkill(s: GameState, def: ActDef) {
  if (QUIET.includes(def.spec.when) || def.spec.armyWide) return;
  const chars = def.bearers.filter((m) => !m.dead && (m.isCharacter || m.keywords.includes('CHARACTER')));
  if (!chars.length) return;
  const epic = chars.some((m) => m.keywords.includes('EPIC HERO'));
  const dos = def.spec.do ?? [];
  const big = def.spec.limit === 'battle' || def.spec.limit === 'round' || !!def.spec.roll || !!def.spec.table
    || dos.some((a) => a.mortals || a.mortalsVehicle || a.mortalsMV || a.mortalRoll || a.surge || a.heal || a.revive);
  if (!epic && !big) return;
  const defensive = dos.some((a) => (a.buff ?? []).some((e) => e.defend?.inv || e.defend?.fnp || e.defend?.hit));
  heroFx(s, def.holder, def.name, defensive, chars, def.spec.limit === 'battle');
}

/** Unleash the Lions: every model but the first becomes a unit of its own (starting strength 1). */
export function splitSingles(s: GameState, u: UnitState, label: string) {
  const ms = alive(u);
  if (ms.length < 2) return;
  const made: string[] = [];
  ms.slice(1).forEach((m, i) => {
    const n: UnitState = structuredClone(u);
    n.id = `${u.id}~${i + 1}`;
    n.models = n.models.filter((x) => x.id === m.id);
    n.sources = [m.source];
    n.name = m.source;
    n.startingStrength = 1;
    n.isWarlordUnit = u.isWarlordUnit && m.isCharacter;
    n.abilities = n.abilities.filter((a) => !a.sheet || a.sheet === m.source);
    n.enhancements = n.enhancements.filter((e) => e.model === m.source);
    s.units.push(n);
    made.push(n.name);
  });
  const first = ms[0];
  u.models = u.models.filter((x) => x.id === first.id);
  u.sources = [first.source];
  u.name = first.source;
  u.startingStrength = 1;
  log(s, `${label}: ${u.name} splits into ${made.length + 1} units of one model each`, 'info', u.owner);
}

function timingOk(s: GameState, def: ActDef): string | null {
  const u = def.holder;
  const own = s.active === u.owner;
  switch (def.spec.when) {
    case 'command': return s.phase === 'command' && own ? null : 'Your Command phase only';
    case 'anyCommand': return s.phase === 'command' ? null : 'Command phase only';
    case 'movement': return s.phase === 'movement' && own ? null : 'Your Movement phase only';
    case 'endOfNormalMove': return s.phase === 'movement' && own && u.move === 'normal' ? null : 'After a Normal move';
    case 'shooting': return s.phase === 'shooting' && own ? null : 'Your Shooting phase only';
    case 'selectedToShoot': return s.phase === 'shooting' && own && !u.selectedToShoot ? null : 'When this unit is selected to shoot';
    case 'afterShootingButton': return s.phase === 'shooting' && own && u.shotTurn === s.turn ? null : 'After this unit has shot';
    case 'selectedToFight': return s.phase === 'fight' && !u.fought && engagedEnemies(s, u).length > 0 ? null : 'When this unit is selected to fight';
    case 'fightStartButton': return s.phase === 'fight' && (s.fight?.step === 'pileIn' || !s.fight?.fought.length) ? null : 'Start of the Fight phase';
    case 'anyPhase': return s.phase !== 'deploy' && s.phase !== 'gameover' && s.phase !== 'scouts' ? null : 'Not yet';
    case 'opponentTurnEnd': return s.phase === 'command' && own && s.turn > 0 ? null : "End of your opponent's turn (start of your Command phase)";
    case 'battleStart': return s.round === 1 && s.phase === 'command' && own ? null : 'In your first Command phase';
    case 'opponentFightEnd': return s.phase === 'fight' && !own && s.fight?.step === 'consolidate' ? null : "End of your opponent's Fight phase";
    case 'fightEndButton': return s.phase === 'fight' && s.fight?.step === 'consolidate' ? null : 'End of the Fight phase';
    default: return 'Automatic';
  }
}

// ---------- targets ----------

const from = (def: ActDef) => (def.bearers.some((b) => !b.dead) ? def.bearers.filter((b) => !b.dead) : alive(def.holder).length ? alive(def.holder) : def.bearers);
const near = (ms: ModelState[], u: UnitState, r: number) => ms.some((b) => alive(u).some((m) => baseDist(b, m) <= r + 1e-6));

export function actTargets(s: GameState, def: ActDef, ctx: FireCtx = {}): UnitState[] {
  const t = def.spec.target;
  const u = def.holder;
  if (!t || t.side === 'self') return [u];
  if (t.attacker) { const k = ctx.killerId ? unitById(s, ctx.killerId) : undefined; return k && onBoard(k) ? [k] : []; }
  if (t.ctxUnit) { const k = ctx.targetId ? unitById(s, ctx.targetId) : undefined; return k && unitMatches(k, t.units) ? [k] : []; }
  const side = t.side === 'enemy' ? other(u.owner) : u.owner;
  const pool = t.inReserves ? s.units.filter((x) => x.owner === side && x.status === 'reserves')
    : t.anywhere ? s.units.filter((x) => x.owner === side && x.status !== 'destroyed' && alive(x).length)
    : boardUnits(s, side);
  const ms = from(def);
  let out = pool.filter((x) => {
    if (t.notSelf && x.id === u.id) return false;
    if (!unitMatches(x, t.units)) return false;
    if (t.range !== undefined && x.id !== u.id && !near(ms, x, t.range + (t.rangeBonusIf && u.abilities.some((a) => a.name === t.rangeBonusIf!.ability) ? t.rangeBonusIf.add : 0))) return false;
    if (t.engaged && !engagedEnemies(s, u).some((e) => e.id === x.id)) return false;
    if (t.visible && !ms.some((m) => unitVisibleTo(s, m, x))) return false;
    if (t.shocked && !x.battleShocked) return false;
    if (t.damaged && !alive(x).some((m) => m.wounds < m.profile.W) && !(x.models.some((m) => m.dead))) return false;
    if (t.charged && x.chargedTurn !== s.turn) return false;
    if (t.advanced && x.move !== 'advance') return false;
    if (t.movedOver && !(u.movedOver?.key === phaseKey(s) && u.movedOver.ids.includes(x.id))) return false;
    if (t.notLoneOperative && (x.core.loneOperative || unitFlags(s, x).loneOperative) && x.sources.length === 1) return false;
    if (t.hit) {
      const h = u.lastHits;
      if (!h || h.key !== phaseKey(s) || !h.ids.includes(x.id)) return false;
      if (t.hitWeapon && !(h.byWeapon?.[x.id] ?? []).some((w) => wk(w).includes(wk(t.hitWeapon!)))) return false;
    }
    return true;
  });
  if (ctx.targetId && out.some((x) => x.id === ctx.targetId)) out = [...out.filter((x) => x.id === ctx.targetId), ...out.filter((x) => x.id !== ctx.targetId)];
  if (t.closest && out.length) {
    const c = [...out].sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    out = [c];
  }
  if (t.each && t.count !== undefined) {
    const sizes: Record<string, number> = { incursion: 2, strike: 3, 'strike-force': 3, onslaught: 4 };
    const n = t.count === 'round' ? s.round : t.count === 'battleSize' ? sizes[s.players[u.owner].battleSize ?? 'strike'] ?? 3 : t.count;
    const foes = boardUnits(s, other(u.owner));
    const gap = (x: UnitState) => (onBoard(x) && foes.length ? Math.min(...foes.map((e) => unitDistance(x, e))) : 99);
    out = [...out].sort((a, b) => gap(a) - gap(b) || b.pts - a.pts).slice(0, n);
  }
  return out;
}

// ---------- doing it ----------

export interface FireCtx {
  targetId?: string; killerId?: string; destroyed?: string[];
  killedCharacter?: boolean; modelsKilled?: number; melee?: boolean; deadModelId?: string;
}

function heal(s: GameState, u: UnitState, n: number) {
  let left = n;
  const ms = alive(u).filter((m) => m.wounds < m.profile.W).sort((a, b) => b.profile.W - a.profile.W);
  for (const m of ms) {
    const k = Math.min(left, m.profile.W - m.wounds);
    m.wounds += k;
    left -= k;
    if (!left) break;
  }
  if (n - left > 0) pushFx(s, { kind: 'heal', unitId: u.id, owner: u.owner, at: centreOf(u), n: n - left });
  return n - left;
}

/** Put a destroyed model back next to where it should be, not within Engagement Range of enemies. */
export function setBackUp(s: GameState, u: UnitState, m: ModelState, at: { x: number; y: number }): boolean {
  const enemies = boardUnits(s, other(u.owner)).flatMap(alive);
  const others = s.units.filter((x) => onBoard(x) || x.id === u.id).flatMap(alive).filter((o) => o.id !== m.id);
  const ok = (p: { x: number; y: number }) => p.x - m.r >= 0 && p.y - m.r >= 0 && p.x + m.r <= RULES.battlefield.width && p.y + m.r <= RULES.battlefield.height
    && others.every((o) => dist(o, p) >= o.r + m.r - 0.01) && enemies.every((e) => dist(e, p) - e.r - m.r > RULES.engagementRange + 0.02);
  if (ok(at)) { m.x = at.x; m.y = at.y; return true; }
  for (let ring = 1; ring <= 16; ring++) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const p = { x: at.x + Math.cos(ang) * ring * 0.5, y: at.y + Math.sin(ang) * ring * 0.5 };
      if (ok(p)) { m.x = p.x; m.y = p.y; return true; }
    }
  }
  return false;
}

function revive(s: GameState, u: UnitState, n: number) {
  let k = 0;
  for (const m of u.models) {
    if (k >= n) break;
    if (!m.dead || m.isCharacter) continue;
    const anchor = alive(u)[0];
    if (!anchor) break;
    m.dead = false;
    m.wounds = m.profile.W;
    if (!setBackUp(s, u, m, { x: anchor.x + anchor.r + m.r + 0.1, y: anchor.y })) { m.dead = true; m.wounds = 0; break; }
    k += 1;
  }
  if (k) pushFx(s, { kind: 'heal', unitId: u.id, owner: u.owner, at: centreOf(u), n: k, revive: true });
  return k;
}

const ldOf = (s: GameState, u: UnitState) => Math.min(...alive(u).map((m) => m.profile.Ld)) - unitFlags(s, u).ld;

/** Battle-shock test forced by an ability (2D6 + modifier vs the best Ld). */
export function shockTest(s: GameState, u: UnitState, mod: number, why: string): boolean {
  if (!onBoard(u)) return true;
  const r = rollN(s, 2);
  const ld = ldOf(s, u);
  const total = r[0] + r[1] + mod;
  const passed = total >= ld;
  pushFx(s, { kind: 'roll', owner: u.owner, title: `Battle-shock · ${u.name}`, dice: r, result: `${total} vs Ld ${ld}+ → ${passed ? 'passed' : 'failed!'}${mod ? ` (${mod})` : ''}`, good: passed });
  log(s, `${why}: ${u.name} Battle-shock test [${r.join('+')}]${mod ? ` ${mod}` : ''} = ${total} vs Ld ${ld}+ → ${passed ? 'passed' : 'Battle-shocked!'}`, 'roll', u.owner);
  if (!passed && !u.battleShocked) { u.battleShocked = true; pushFx(s, { kind: 'shock', unitId: u.id, owner: u.owner, at: centreOf(u) }); fire(s, 'becameShocked', [u]); }
  return passed;
}

/** Leadership test for an ability: 2D6 >= the best Ld of the unit. */
export function ldTest(s: GameState, u: UnitState, why: string, mod = 0): boolean {
  const r = rollN(s, 2);
  const ld = ldOf(s, u);
  const ok = r[0] + r[1] + mod >= ld;
  pushFx(s, { kind: 'roll', owner: u.owner, title: `Leadership · ${u.name}`, dice: r, result: `${r[0] + r[1]} vs ${ld}+ → ${ok ? 'passed' : 'failed'}`, good: ok });
  log(s, `${why}: Leadership test ${u.name} [${r.join('+')}] = ${r[0] + r[1]} vs ${ld}+ → ${ok ? 'passed' : 'failed'}`, 'roll', u.owner);
  return ok;
}

/** The keyword (CHARACTER / MONSTER / VEHICLE) the enemy army has the most points of. */
function slayerKeyword(s: GameState, p: PlayerId): string {
  const score = (kw: string) => s.units.filter((x) => x.owner !== p && x.status !== 'destroyed' && hasKw(x, kw)).reduce((a, x) => a + x.pts, 0);
  return ['CHARACTER', 'MONSTER', 'VEHICLE'].sort((a, b) => score(b) - score(a))[0];
}

function doActions(s: GameState, def: ActDef, acts: Action[], target: UnitState | null, ctx: FireCtx) {
  const u = def.holder;
  for (const a of acts) {
    const on = a.on === 'self' || !target ? u : a.on === 'attacker' && ctx.killerId ? unitById(s, ctx.killerId) : target;
    if (!on) continue;
    if (a.if && !a.if.every((c) => cond(c, { s, A: u, T: target ?? undefined, holder: u, bearers: def.bearers }))) continue;
    if (a.mortalRoll) {
      const q = a.mortalRoll;
      const n = q.nWounds ? Math.min(q.max ?? 99, alive(u).reduce((x, m) => x + m.wounds, 0)) : q.n ?? (q.all ? alive(u).length : alive(u).filter((m) => alive(on).some((e) => baseDist(m, e) <= RULES.engagementRange + 1e-6)).length);
      const plus = q.plus && (q.plusIf ?? []).every((c) => cond(c, { s, A: u, T: on, holder: u })) ? q.plus : 0;
      const dice = rollN(s, Math.max(1, n));
      const succ = dice.filter((v) => v + plus >= q.on).length;
      const hits = Math.min(q.max ?? 99, q.dmg ? Array.from({ length: succ }, () => rollExpr(s, q.dmg!).total).reduce((x, y) => x + y, 0) : succ);
      log(s, `${def.name}: rolled [${dice.join(' ')}]${plus ? ` +${plus}` : ''} → ${on.name} suffers ${hits} mortal wounds`, 'roll', u.owner);
      if (hits) applyMortalWounds(s, on, hits, def.name);
      if (hits && q.shockIfAny !== undefined && onBoard(on)) shockTest(s, on, q.shockIfAny, def.name);
    }
    if (a.ldFail && !ldTest(s, on, def.name)) for (const e of a.ldFail) addTimed(s, on, { e, label: def.name, until: a.until ?? 'turn', by: u.owner });
    if (a.ldFailMortals && !ldTest(s, on, def.name, a.ldMod && (a.ldModIf ?? []).every((c) => cond(c, { s, A: u, T: on, holder: u })) ? a.ldMod : 0)) { const n = rollExpr(s, a.ldFailMortals).total; log(s, `${def.name}: ${on.name} suffers ${n} mortal wound(s)`, 'roll', u.owner); applyMortalWounds(s, on, n, def.name); }
    if (a.addWounds) for (const m of (def.bearers?.length ? def.bearers : alive(on)).filter((m) => !m.dead)) { m.profile = { ...m.profile, W: m.profile.W + a.addWounds }; m.wounds += a.addWounds; }
    if (a.soulLink && target) {
      const bs = def.bearers?.[0]?.source;
      const ch = alive(target).find((m) => m.isCharacter && m.keywords.includes('INFANTRY') && !m.keywords.includes('EPIC HERO') && m.source !== bs);
      if (bs && ch) {
        u.soulOwn ??= u.abilities.filter((x) => x.sheet === bs && x.type === 'Datasheet');
        const copied = target.abilities.filter((x) => x.sheet === ch.source && x.type === 'Datasheet').map((x) => ({ ...x, sheet: bs }));
        u.abilities = [...u.abilities.filter((x) => !(x.sheet === bs && x.type === 'Datasheet')), ...copied];
        for (const m of def.bearers ?? []) if (!m.keywords.includes('PSYKER')) m.keywords = [...m.keywords, 'PSYKER'];
        if (!u.keywords.includes('PSYKER')) u.keywords.push('PSYKER');
        log(s, `${def.name}: ${u.name} takes on the abilities of ${ch.name} (${copied.map((x) => x.name).join(', ') || 'none'})`, 'info', u.owner);
      }
    }
    if (a.falsehood && target && u.status === 'reserves') {
      const foes = boardUnits(s, other(u.owner)).flatMap(alive);
      const gap = (m: ModelState) => Math.min(99, ...foes.map((e) => baseDist(m, e)));
      const victim = alive(target).filter((m) => !m.isCharacter).sort((x, y) => gap(x) - gap(y))[0];
      if (victim) {
        victim.dead = true; victim.wounds = 0; // destroyed ignoring rules triggered by a model being destroyed
        for (const m of alive(u)) { m.x = victim.x; m.y = victim.y; m.isBodyguard = false; }
        target.models.push(...u.models);
        target.sources.push(...u.sources);
        target.abilities.push(...u.abilities);
        target.enhancements.push(...u.enhancements);
        target.keywords = [...new Set([...target.keywords, ...u.keywords])];
        target.pts += u.pts;
        target.isWarlordUnit ||= u.isWarlordUnit;
        target.name = `${u.name} + ${target.name}`;
        s.units = s.units.filter((x) => x.id !== u.id);
        log(s, `${def.name}: the traitor is revealed — ${u.sources[0]} takes ${victim.name}'s place and leads ${target.name}`, 'info', u.owner);
      }
    }
    if (a.healNear) for (const f of boardUnits(s, on.owner).filter((f) => unitDistance(f, on) <= a.healNear!.range + 1e-6 && (!a.healNear!.units || unitMatches(f, a.healNear!.units)))) { heal(s, f, rollExpr(s, a.healNear.heal).total); log(s, `${def.name}: ${f.name} heals`, 'info', u.owner); }
    if (a.buffNear) {
      const near = boardUnits(s, on.owner).filter((f) => (a.buffNear!.one ? f.id !== on.id : true) && unitDistance(f, on) <= a.buffNear!.range + 1e-6 && (!a.buffNear!.units || unitMatches(f, a.buffNear!.units)) && alive(on).some((m) => unitVisibleTo(s, m, f) || f.id === on.id))
        .sort((x, y) => (y.pts * alive(y).length) / y.startingStrength - (x.pts * alive(x).length) / x.startingStrength);
      for (const f of a.buffNear.one ? near.slice(0, 1) : near) for (const e of a.buffNear.effects) addTimed(s, f, { e, label: def.name, until: a.until ?? 'phase', by: u.owner });
    }
    if (a.pactTest) {
      if (!ldTest(s, on, `${def.name} (Desperate Pact)`)) applyMortalWounds(s, on, rollExpr(s, 'D3').total, 'Desperate Pact');
      else for (const e of a.pactTest.pass ?? []) addTimed(s, on, { e, label: def.name, until: a.until ?? 'phase', by: u.owner });
    }
    if (a.mortalsTable) {
      const r = d6(s);
      const row = [...a.mortalsTable].sort((x, y) => y.min - x.min).find((x) => r >= x.min);
      const n = row ? rollExpr(s, row.expr).total : 0;
      log(s, `${def.name}: rolled ${r} → ${on.name} suffers ${n} mortal wound(s)`, 'roll', u.owner);
      if (n) applyMortalWounds(s, on, n, def.name);
    }
    if (a.addKeyword && !on.keywords.includes(a.addKeyword)) {
      on.keywords.push(a.addKeyword);
      for (const m of on.models) if (!m.keywords.includes(a.addKeyword)) m.keywords = [...m.keywords, a.addKeyword];
      log(s, `${def.name}: ${on.name} gains ${a.addKeyword}`, 'info', u.owner);
    }
    if (a.setOath) { s.players[u.owner].oathTarget = on.id; log(s, `${def.name}: ${on.name} is the Oath of Moment target`, 'info', u.owner); }
    if (a.pileInRoll) {
      const n = rollExpr(s, a.pileInRoll).total;
      addTimed(s, on, { e: { pileIn: n }, label: def.name, until: 'phase', by: u.owner });
      log(s, `${def.name}: ${on.name} can pile in ${n}"`, 'roll', u.owner);
    }
    if (a.consolidateRoll) {
      const n = rollExpr(s, a.consolidateRoll).total;
      addTimed(s, on, { e: { consolidate: n }, label: def.name, until: 'phase', by: u.owner });
      log(s, `${def.name}: ${on.name} can consolidate ${n}"`, 'roll', u.owner);
    }
    if (a.ready && !on.readied) { on.readied = true; log(s, `${def.name}: ${on.name} is readied`, 'info', u.owner); }
    if (a.unready) on.readied = false;
    if (a.idol) {
      const st = ((s.players[u.owner].det ??= {})['Cult of Blood'] ??= { active: [], used: [], count: 0 });
      st.active = [a.idol];
      log(s, `${def.name}: ${a.idol === 'rage' ? 'Idol of Infinite Rage' : a.idol === 'wrath' ? 'Idol of Burning Wrath' : 'Idol of Blessed Blood'} is active`, 'info', u.owner);
    }
    if (a.tithe) {
      const n = rollExpr(s, a.tithe).total;
      s.players[u.owner].tithe = (s.players[u.owner].tithe ?? 0) + n;
      log(s, `${def.name}: +${n} Blood Tithe points (${s.players[u.owner].tithe})`, 'info', u.owner);
    }
    if (a.reviveNear) {
      const t = boardUnits(s, on.owner).filter((f) => unitMatches(f, a.reviveNear!.units) && unitDistance(f, on) <= a.reviveNear!.range + 1e-6 && f.models.some((m) => m.dead && !m.isCharacter))
        .sort((x, y) => unitDistance(x, on) - unitDistance(y, on))[0];
      if (t) {
        const n = hasKw(t, 'MOUNTED') ? 1 : hasKw(t, 'BEAST') ? rollExpr(s, 'D3').total : rollExpr(s, 'D6').total;
        let back = 0;
        for (const m of t.models.filter((x) => x.dead && !x.isCharacter).slice(0, n)) {
          m.dead = false; m.wounds = m.profile.W;
          if (setBackUp(s, t, m, alive(t).find((x) => x.id !== m.id) ?? m)) back++; else { m.dead = true; m.wounds = 0; }
        }
        log(s, `${def.name}: ${back} model(s) return to ${t.name}`, 'info', u.owner);
      }
    }
    if (a.fightAgain && s.fight && alive(on).length) {
      on.fought = false;
      s.fight.fought = s.fight.fought.filter((id) => id !== on.id);
      if (!s.fight.eligible.includes(on.id)) s.fight.eligible.push(on.id);
      s.fight.forcedNext = on.id;
      // "the bearer can fight one additional time": only the ability's models fight
      if (a.bearerOnly && def.bearers.length) on.fightOnly = { key: phaseKey(s), models: def.bearers.map((m) => m.id) };
      log(s, `${def.name}: ${on.name} fights again next`, 'info', u.owner);
    }
    if (a.fightNext && s.fight) { s.fight.forcedNext = on.id; log(s, `${def.name}: ${on.name} must be the next unit to fight`, 'info', u.owner); }
    if (a.moreBattleUses) {
      for (const d of actsOfUnit(s, on).filter((x) => x.spec.limit === 'battle' && timesUsed(s, x) > 0)) {
        const bag = usedBag(s, d);
        const k = baseKey(d);
        const n = timesUsed(s, d) - 1;
        if (n > 0) bag[k] = `battle|${n}`; else delete bag[k];
      }
      log(s, `${def.name}: ${on.name} can use its (Once per battle) ability again`, 'info', u.owner);
    }
    if (a.splitSingles) splitSingles(s, on, def.name);
    if (a.buffRoll) {
      const n = rollExpr(s, a.buffRoll.expr).total;
      const e: Effect = { if: a.buffRoll.if };
      for (const f of a.buffRoll.fields) e[f] = n;
      addTimed(s, on, { e, label: def.name, until: a.until ?? 'phase', by: u.owner, models: a.bearerOnly ? def.bearers.map((m) => m.id) : undefined });
      log(s, `${def.name}: rolled ${n} → +${n} ${a.buffRoll.fields.join(' and ')}`, 'roll', u.owner);
    }
    if (a.explodeModels && target) {
      const ms = alive(u).filter((m) => wk(m.name).includes(wk(a.explodeModels!.name)));
      const dice = rollN(s, ms.length);
      let n = 0;
      dice.forEach((v, i) => { if (v >= a.explodeModels!.on) { ms[i].dead = true; ms[i].wounds = 0; n++; } });
      if (ms.length) log(s, `${def.name}: [${dice.join(' ')}] → ${n} model(s) explode, ${target.name} suffers ${n} mortal wounds`, 'roll', u.owner);
      if (n) applyMortalWounds(s, target, n, def.name);
    }
    if (a.setMark) { u.mark = on.id; log(s, `${def.name}: ${on.name} is ${u.name}'s mark`, 'info', u.owner); }
    if (a.unshot) { on.shotTurn = -99; log(s, `${def.name}: ${on.name} can still be Hidden although it shot`, 'info', u.owner); }
    if (a.characterModel) {
      const m = alive(on).find((x) => !x.isCharacter && /sergeant|leader|champion|headtaker/i.test(x.name)) ?? alive(on).find((x) => !x.isCharacter);
      if (m) {
        m.isCharacter = true;
        if (!m.keywords.includes('CHARACTER')) m.keywords = [...m.keywords, 'CHARACTER'];
        (s.tempCharacters ??= []).push({ unitId: on.id, modelId: m.id, by: u.owner });
        log(s, `${def.name}: ${m.name} has the CHARACTER keyword until your next Command phase`, 'info', u.owner);
      }
    }
    if (a.reviveModel) {
      const m = on.models.find((x) => x.dead && x.keywords.includes(a.reviveModel!)) ?? on.models.find((x) => x.dead && new RegExp(a.reviveModel!, 'i').test(x.name));
      if (m) {
        (s.revivals ??= []).push({ unitId: on.id, modelId: m.id, label: def.name, on: 1, wounds: m.profile.W, x: m.x, y: m.y });
        log(s, `${def.name}: ${m.name} returns at the end of the phase with full wounds`, 'info', u.owner);
      }
    }
    const models = a.bearerOnly ? def.bearers.map((m) => m.id) : undefined;
    for (const e of a.buff ?? []) addTimed(s, on, { e, label: def.name, until: a.until ?? 'phase', by: u.owner, mark: a.mark, models });
    if (a.incoming) {
      const inc: Incoming = { ...a.incoming, by: u.owner };
      if (a.selfOnly) inc.units = [...(inc.units ?? []), `id:${u.id}`];
      if (a.fromThisTransport) inc.fromTransport = u.id;
      if (a.fromDisembarked) inc.disembarked = true;
      addTimed(s, on, { e: { incoming: inc }, label: def.name, until: a.until ?? 'phase', by: u.owner, mark: a.mark ?? def.name });
    }
    if (a.attacksPerEnemyNear) {
      const q = a.attacksPerEnemyNear;
      const ms = def.bearers.filter((m) => !m.dead);
      const n = Math.min(q.max, boardUnits(s, other(u.owner)).filter((e) => near(ms, e, q.range)).length);
      if (n) addTimed(s, on, { e: { attack: 'melee', weapon: q.weapon, attacks: n }, label: def.name, until: a.until ?? 'phase', by: u.owner, models });
      log(s, `${def.name}: +${n} A`, 'info', u.owner);
    }
    if (a.heal) { const n = heal(s, on, rollExpr(s, a.heal).total); log(s, `${def.name}: ${on.name} regains ${n} wounds`, 'info', u.owner); }
    if (a.reviveRoll) { const n = revive(s, on, rollExpr(s, a.reviveRoll).total); log(s, `${def.name}: ${n} model(s) returned to ${on.name}`, 'info', u.owner); }
    if (a.mutate) {
      for (const o of s.objectives) {
        if (o.controller === u.owner && alive(on).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) { o.mutated = u.owner; o.secured = u.owner; log(s, `${def.name}: objective ${o.id} is mutated`, 'info', u.owner); }
      }
    }
    if (a.revive) { const n = revive(s, on, a.revive); if (n) log(s, `${def.name}: ${n} model(s) returned to ${on.name}`, 'info', u.owner); }
    if (a.reviveLater && ctx.deadModelId) {
      const m = on.models.find((x) => x.id === ctx.deadModelId);
      if (m) {
        (s.revivals ??= []).push({ unitId: on.id, modelId: m.id, label: def.name, on: a.reviveLater.on, wounds: a.reviveLater.wounds, x: m.x, y: m.y, ld: a.reviveLater.ld, woundsRoll: a.reviveLater.woundsRoll });
        log(s, `${def.name}: ${m.name} ${a.reviveLater.ld ? 'takes a Leadership test' : `rolls (${a.reviveLater.on}+)`} to return at the end of the phase`, 'info', u.owner);
      }
    }
    if (a.mortals || a.mortalsVehicle || a.mortalsMV) {
      const expr = a.mortalsMV && (hasKw(on, 'VEHICLE') || hasKw(on, 'MONSTER')) ? a.mortalsMV : a.mortalsVehicle && hasKw(on, 'VEHICLE') ? a.mortalsVehicle : a.mortals!;
      const n = rollExpr(s, expr).total;
      log(s, `${def.name}: ${on.name} suffers ${n} mortal wounds`, 'roll', u.owner);
      applyMortalWounds(s, on, n, def.name);
    }
    if (a.phaseEndMortals) (s.phaseMortals ??= []).push({ unitId: on.id, expr: a.phaseEndMortals, label: def.name });
    if (a.shockMortals && !shockTest(s, on, a.shockMortals.mod, def.name)) {
      const n = rollExpr(s, a.shockMortals.mortals).total;
      log(s, `${def.name}: ${on.name} failed — ${n} mortal wounds`, 'roll', u.owner);
      applyMortalWounds(s, on, n, def.name);
    }
    if (a.shock !== undefined) shockTest(s, on, a.shock - (a.shockPerModels ? Math.floor(alive(u).length / a.shockPerModels) : 0), def.name);
    if (a.battleShock && !on.battleShocked) { on.battleShocked = true; log(s, `${def.name}: ${on.name} battle-shocked`, 'info', u.owner); }
    if (a.sacrifice) {
      const n = rollExpr(s, a.sacrifice.n).total;
      const victims = alive(on).filter((m) => wk(m.name).includes(wk(a.sacrifice!.name))).slice(0, n);
      for (const m of victims) { m.dead = true; m.wounds = 0; }
      log(s, `${def.name}: ${on.name} loses ${victims.length} ${a.sacrifice.name}`, 'info', u.owner);
    }
    if (a.unshock && on.battleShocked) { on.battleShocked = false; log(s, `${def.name}: ${on.name} is no longer Battle-shocked`, 'info', u.owner); }
    if (a.riled) { on.riledUntil = s.turn + (s.active === u.owner ? 1 : 0); log(s, `${def.name}: ${on.name} riled up`, 'info', u.owner); }
    if (a.cp) { s.players[u.owner].cp += a.cp; log(s, `+${a.cp}CP (${def.name})`, 'cp', u.owner); }
    if (a.reserves) {
      on.status = 'reserves'; on.move = null;
      if (a.earlyArrival) on.arriveEarly = s.round;
      log(s, `${def.name}: ${on.name} is placed into Strategic Reserves`, 'info', u.owner);
    } else if (a.earlyArrival) {
      on.arriveEarly = s.round;
      log(s, `${def.name}: ${on.name} can arrive this battle round`, 'info', u.owner);
    }
    if (a.move) {
      const heavy = a.moveIfHeavyTransport && hasKw(u, 'TRANSPORT') && Math.max(...u.models.map((m) => m.profile.W)) >= 14;
      const expr = heavy ? a.moveIfHeavyTransport! : a.moveIfRiled && isRiled(s, on) ? a.moveIfRiled : a.move;
      let max = expr === 'M' ? Math.max(0, ...alive(on).map((m) => m.profile.M ?? 0)) + unitFlags(s, on).move : rollExpr(s, expr).total;
      if (a.moveReroll && expr !== 'M' && max < 4) { const again = rollExpr(s, expr).total; log(s, `${def.name}: move distance re-rolled ${max} → ${again}`, 'roll', u.owner); max = again; }
      on.extraMove = { max, label: def.name, kind: 'extra', phase: phaseKey(s), ...(a.asMove ? { asMove: true } : {}) };
      if (a.noCharge) on.cantCharge = true;
      log(s, `${def.name}: ${on.name} can move ${max}"${a.noCharge ? ' (cannot charge this turn)' : ''}`, 'info', u.owner);
      offerExtraMove(s, on, `${def.name}: move ${max}"`);
    }
    if (a.surge) {
      let max = unitFlags(s, on).surgeFixed || rollExpr(s, a.surge).total; // Berzerker's Wrath: up to 8" instead of rolling
      // Forwards, for Blood!: a low surge distance is rolled again
      if (unitFlags(s, on).surgeReroll && max < 5 && /D6/i.test(a.surge)) { const again = rollExpr(s, a.surge).total; log(s, `${def.name}: surge distance re-rolled ${max} → ${again}`, 'roll', u.owner); max = again; }
      on.extraMove = { max, label: def.name, kind: 'surge', phase: phaseKey(s) };
      log(s, `${def.name}: ${on.name} can surge ${on.extraMove.max}" (towards the closest enemy)`, 'info', u.owner);
      offerExtraMove(s, on, `${def.name}: surge ${on.extraMove.max}"`);
    }
    if (a.allowCharge) { on.cantCharge = false; log(s, `${def.name}: ${on.name} can still charge this turn`, 'info', u.owner); }
    if (a.agonyHeal) {
      const loe = boardUnits(s, u.owner).filter((f) => f.factionKeywords.includes('LEGIONS OF EXCESS') && unitDistance(f, on) <= a.agonyHeal! + 1e-6)
        .sort((x, y) => y.models.filter((m) => m.dead).length - x.models.filter((m) => m.dead).length)[0];
      if (loe && loe.sources.includes('Daemonettes')) { const n = revive(s, loe, rollExpr(s, 'D3+3').total); log(s, `${def.name}: ${n} Daemonettes return to ${loe.name}`, 'info', u.owner); }
      else if (loe) { const n = heal(s, loe, 3); log(s, `${def.name}: ${loe.name} regains ${n} wounds`, 'info', u.owner); }
    }
    if (a.chargeOnlyTarget && target) { u.chargeMust = { turn: s.turn, id: target.id }; log(s, `${def.name}: ${u.name}'s charge must end engaged with ${target.name}`, 'info', u.owner); }
    if (a.embarkNear) embarkNearHook?.(s, on, a.embarkNear, def.name);
    if (a.setQuarry && target) { u.quarry = target.id; log(s, `${def.name}: target ${target.name}`, 'info', u.owner); }
    if (a.setPriority) {
      const o = s.objectives.find((q) => alive(on).some((m) => dist(m, q) <= 3 + m.r)) ?? s.objectives.find((q) => q.type === 'central') ?? s.objectives[0];
      if (o) { s.players[u.owner].priorityObjective = o.id; log(s, `${def.name}: objective ${o.id}`, 'info', u.owner); }
    }
    if (a.setSlayer) {
      const kw = slayerKeyword(s, u.owner);
      (s.players[u.owner].slayer ??= {})[u.id] = kw;
      log(s, `${def.name}: ${kw}`, 'info', u.owner);
    }
    if (a.secure) {
      for (const o of s.objectives) {
        if (o.controller === u.owner && alive(on).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) { o.secured = u.owner; log(s, `${def.name}: objective ${o.id} is secured`, 'info', u.owner); }
      }
    }
    if (a.identifyTerrain) {
      // the terrain feature this unit can see that holds the most enemy points (hidden units first)
      const foes = boardUnits(s, other(u.owner));
      let best: { id: string; v: number } | null = null;
      for (const t of s.terrain.filter((q) => q.category !== 'exposed')) {
        const v = foes.filter((e) => alive(e).some((m) => circleTouchesPoly(m, m.r, t.poly))).reduce((a2, e) => a2 + e.pts, 0);
        if (v > (best?.v ?? 0)) best = { id: t.id, v };
      }
      if (best) { (s.identified ??= []).push({ terrainId: best.id, by: u.owner, turn: s.turn }); log(s, `${def.name}: terrain ${best.id} identified (enemies within it +3" detection range)`, 'info', u.owner); }
    }
    if (a.snare) {
      for (const o of s.objectives) {
        if (o.controller === u.owner && alive(on).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) { o.snared = u.owner; log(s, `${def.name}: objective ${o.id} is snared`, 'info', u.owner); }
      }
    }
    if (a.secureDead) {
      for (const o of s.objectives) {
        if (o.controller === u.owner && on.models.some((m) => dist(m, o) <= 3 + m.r + 1e-6)) { o.secured = u.owner; log(s, `${def.name}: objective ${o.id} is secured`, 'info', u.owner); }
      }
    }
    if (a.sabotage) {
      for (const o of s.objectives) {
        if (o.controller === u.owner && alive(on).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) { o.sabotaged = u.owner; o.secured = u.owner; log(s, `${def.name}: objective ${o.id} is sabotaged (enemy units ending a move on it may suffer D3 mortal wounds)`, 'info', u.owner); }
      }
    }
    if (a.vow) {
      const P = s.players[u.owner];
      P.vowed = s.objectives.filter((o) => o.controller !== u.owner).map((o) => o.id);
      log(s, `${def.name}: Aggressive Push → Vowed objectives ${P.vowed.join(', ') || '-'}`, 'info', u.owner);
    }
    if (a.tryDatButton) {
      const rows: { name: string; e: Effect }[] = [{ name: '+1 A', e: { attacks: 1 } }, { name: '+2 S', e: { strength: 2 } }, { name: '+1 AP', e: { ap: 1 } }];
      const dice: number[] = [];
      while (dice.length < a.tryDatButton) { const v = d6(s); if (!dice.includes(v)) dice.push(v); }
      const got = [...new Set(dice.map((v) => (v <= 2 ? 0 : v <= 4 ? 1 : 2)))];
      for (const i of got) addTimed(s, on, { e: rows[i].e, label: def.name, until: 'phase', by: u.owner });
      log(s, `${def.name}: rolled [${dice.join(' ')}] → ${got.map((i) => rows[i].name).join(', ')}`, 'roll', u.owner);
      if (a.tryDatButton === 2) {
        const h = d6(s);
        log(s, `${def.name}: hazard roll ${h}${h <= RULES.hazard.failOn ? ' → mortal wound' : ''}`, 'roll', u.owner);
        if (h <= RULES.hazard.failOn) applyMortalWounds(s, on, alive(on).every((m) => m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER')) ? RULES.hazard.mortalWoundsMonsterVehicle : RULES.hazard.mortalWounds, 'Hazard');
      }
    }
    if (a.attackMod && s.attack) {
      const T = unitById(s, s.attack.targetId);
      for (const p of s.attack.pools) {
        if (a.attackMod.hit && !p.autoHit) { p.hitMod = Math.max(-1, Math.min(1, p.hitMod + a.attackMod.hit)); p.hitNote = [p.hitNote, `${def.name}: +${a.attackMod.hit} hit`].filter(Boolean).join(' · '); }
        if (a.attackMod.noCover && /Cover/.test(p.skillNote) && p.skill !== null) { p.skill -= 1; p.skillNote = p.skillNote.replace(/Cover −1 BS/, `${def.name}: no cover`); }
        if (a.attackMod.toughness) { p.woundNeed = woundNeed(p.effS ?? p.profile.S ?? 1, Math.max(1, targetToughness(T, s) + a.attackMod.toughness)); p.woundNote = [p.woundNote, `${def.name}: T${a.attackMod.toughness}`].join(' · '); }
      }
      log(s, `${def.name}: ${a.attackMod.hit ? '+1 hit' : a.attackMod.noCover ? 'target has no cover' : `target T${a.attackMod.toughness}`} (this attack)`, 'info', u.owner);
    }
    if (a.shootBack && ctx.killerId) {
      const k = unitById(s, ctx.killerId);
      if (onBoard(k)) {
        (s.deathQueue ??= []).push({ unitId: u.id, modelIds: alive(u).map((m) => m.id), targetId: k.id, kind: 'shoot', label: def.name, alive: true });
        log(s, `${def.name}: ${u.name} will shoot back at ${k.name} after its attacks`, 'info', u.owner);
      }
    }
    if (a.splashMortals) {
      const others = boardUnits(s, on.owner).filter((x) => x.id !== on.id && alive(x).some((m) => alive(on).some((n) => baseDist(m, n) <= a.splashMortals!.range + 1e-6)));
      const v = others.sort((x, y) => y.pts - x.pts)[0];
      if (v) { const n = rollExpr(s, a.splashMortals.expr).total; log(s, `${def.name}: ${v.name} suffers ${n} mortal wounds`, 'roll', u.owner); applyMortalWounds(s, v, n, def.name); }
    }
    if (a.log) log(s, `${def.name}: ${a.log}`, 'info', u.owner);
  }
}

/** A unit got a move from an ability: its player gets a prompt to drag it (or skip). */
function offerExtraMove(s: GameState, u: UnitState, label: string) {
  if (!onBoard(u)) return;
  const w = s.window;
  if (w?.kind === 'abilityMove' && w.player === u.owner) {
    if (!w.offers.some((o) => o.unitId === u.id)) w.offers.push({ unitId: u.id, key: '', label });
    return;
  }
  if (w) return; // another prompt is open: the move can still be made from the unit's panel this phase
  s.window = { kind: 'abilityMove', player: u.owner, offers: [{ unitId: u.id, key: '', label }], label };
}

/** Scouring Warpflame: once the unit has shot (every gun fired, or another unit is picked to shoot), one enemy unit it
 *  hit loses the Benefit of Cover for the rest of the phase. */
function scouringDue(s: GameState, A: UnitState, force: boolean) {
  if (!unitFlags(s, A).afterShootNoCover || (A.used ??= {}).scouring === phaseKey(s)) return;
  const hit = A.lastHits?.key === phaseKey(s) ? A.lastHits.ids.map((id) => unitById(s, id)).filter(onBoard) : [];
  if (!hit.length) return;
  if (!force && alive(A).some((m) => m.weapons.some((w) => w.profiles[0].range !== 'Melee' && !A.weaponsFired.includes(w.name)))) return;
  A.used.scouring = phaseKey(s);
  offerPickUnit(s, A, 'Scouring Warpflame: pick an enemy unit hit — it cannot have the Benefit of Cover this phase', hit, [{ on: 'target', incoming: { attack: 'ranged', noCover: true }, until: 'phase' }]);
}

/** Unleash Hell: a vehicle near the bearer (or carrying it) has shot — one enemy unit it hit is suppressed (−1 to Hit). */
function unleashHellDue(s: GameState, A: UnitState, force: boolean) {
  if (s.phase !== 'shooting' || A.owner !== s.active || !unitFlags(s, A).suppressOnHit || (A.used ??= {}).unleash === phaseKey(s)) return;
  const hit = A.lastHits?.key === phaseKey(s) ? A.lastHits.ids.map((id) => unitById(s, id)).filter(onBoard) : [];
  if (!hit.length) return;
  if (!force && alive(A).some((m) => m.weapons.some((w) => w.profiles[0].range !== 'Melee' && !A.weaponsFired.includes(w.name)))) return;
  A.used.unleash = phaseKey(s);
  offerPickUnit(s, A, 'Unleash Hell: pick an enemy unit hit — it is suppressed (−1 to Hit) until your next turn', hit, [{ on: 'target', buff: [{ hit: -1 }], until: 'nextTurnStart', mark: 'suppressed' }]);
}

/** A rule asks for one unit: the bot (or a player on auto rules) takes the most valuable one, a player gets a prompt. */
function offerPickUnit(s: GameState, holder: UnitState, label: string, units: UnitState[], acts: Action[]) {
  const auto = playsItself(s, holder.owner);
  if (auto || units.length === 1 || s.window) { runActions(s, label.split(':')[0], holder, acts, [...units].sort((a, b) => b.pts - a.pts)[0]); return; }
  s.window = { kind: 'pickUnit', player: holder.owner, label, units: units.map((u) => u.id), holderId: holder.id, acts };
}

/** The player picked (or skipped, `unitId` null) the unit a pickUnit prompt asked for. */
export function resolvePickUnit(s: GameState, unitId: string | null) {
  const w = s.window;
  if (w?.kind !== 'pickUnit') return;
  s.window = null;
  if (unitId && w.units.includes(unitId)) runActions(s, w.label.split(':')[0], unitById(s, w.holderId), w.acts, unitById(s, unitId));
}

/** Use an ability now (button, or automatically at its trigger). Returns an error message or null. */
/** Actions of a rule that is not an ability (a stratagem's "your unit can make a Normal move of up to D6"" …). */
export function runActions(s: GameState, name: string, holder: UnitState, acts: Action[], target: UnitState | null) {
  doActions(s, { key: `rule:${name}`, name, holder, spec: { when: 'anyPhase' } as ActSpec, bearers: alive(holder) }, acts, target, {});
}

export function useAct(s: GameState, def: ActDef, targetId?: string, ctx: FireCtx = {}): string | null {
  if (!limitLeft(s, def)) return 'Already used';
  if (!(def.spec.if ?? []).every((c) => cond(c, { s, A: def.holder, holder: def.holder, bearers: def.bearers }))) return 'Conditions not met';
  const cands = actTargets(s, def, { ...ctx, targetId });
  const t = def.spec.target;
  if (t && t.side !== 'self' && !cands.length) return 'No valid target';
  const targets = t?.each ? cands : t && t.side !== 'self' ? [cands.find((c) => c.id === targetId) ?? cands[0]] : [def.holder];
  markUsed(s, def);
  log(s, `${def.holder.name}: ${def.name}${targets.length && targets[0].id !== def.holder.id ? ` → ${targets.map((x) => x.name).join(', ')}` : ''}`, 'info', def.holder.owner);
  showHeroSkill(s, def);
  for (const tg of targets) {
    if (def.spec.roll || def.spec.perModel) {
      const n = def.spec.perModel ? alive(def.holder).filter((m) => alive(tg).some((e) => baseDist(m, e) <= RULES.engagementRange + 1e-6)).length : 1;
      const dice = rollN(s, Math.max(1, n));
      // Warphead: the Weirdboy re-rolls a psychic roll of 1 (the Perils result)
      if (/psychic/i.test(def.name) && dice[0] === 1 && def.holder.enhancements?.some((e) => e.name === 'Warphead')) { dice[0] = rollN(s, 1)[0]; log(s, `Warphead: psychic roll of 1 re-rolled → ${dice[0]}`, 'roll', def.holder.owner); }
      let add = 0;
      if (def.spec.rollAdd === 'per5models') add = Math.floor(alive(def.holder).length / 5);
      if (def.spec.rollAdd === 'warlordInTarget2' && tg.isWarlordUnit) add = 2;
      if (def.spec.rollAdd === 'shockedEnemies') add = boardUnits(s, other(def.holder.owner)).filter((e) => e.battleShocked).length;
      if (def.spec.rollAdd === 'onControlledObjective' || def.spec.rollAdd === 'nearEnemyDz12') add = cond(def.spec.rollAdd === 'nearEnemyDz12' ? 'nearEnemyDz:12' : 'onControlledObjective', { s, A: def.holder, holder: def.holder }) ? 1 : 0;
      log(s, `${def.name}: rolled [${dice.join(' ')}]${add ? ` +${add}` : ''}`, 'roll', def.holder.owner);
      if (def.spec.each) {
        const ok = dice.filter((v) => v + add >= def.spec.each!.on).length;
        for (let k = 0; k < ok; k++) doActions(s, def, def.spec.each.do, tg, ctx);
      }
      if (def.spec.table) {
        const v = dice[0] + add;
        const row = def.spec.table.find((r) => v >= r.min && (r.max === undefined || v <= r.max));
        if (row) doActions(s, def, row.do, tg, ctx);
      }
    }
    if (def.spec.ldTest) doActions(s, def, (ldTest(s, def.holder, def.name) ? def.spec.pass : def.spec.fail) ?? [], tg, ctx);
    if (def.spec.do) doActions(s, def, def.spec.do, tg, ctx);
  }
  return null;
}

// ---------- automatic triggers ----------

function eventOk(def: ActDef, ctx: FireCtx): boolean {
  const sp = def.spec;
  if (sp.needDestroyed && !(ctx.destroyed ?? []).length) return false;
  if (sp.needCharacterKill && !ctx.killedCharacter) return false;
  if (sp.needModelsLost && !(ctx.modelsKilled ?? 0)) return false;
  if (sp.needMelee && !ctx.melee) return false;
  return true;
}

/** Run every automatic ability for this trigger. `units` limits which units' abilities are checked. */
export function fire(s: GameState, trigger: Trigger, units: UnitState[], ctx: FireCtx = {}) {
  for (const u of units) {
    for (const def of actsOfUnit(s, u, trigger === 'onDeath')) {
      if (def.spec.when !== trigger || !def.spec.auto) continue;
      if (def.spec.botOnly && !playsItself(s, u.owner)) continue;
      if (trigger === 'onDeath') {
        // "when this model is destroyed": only the model that died; otherwise only when the whole unit is gone
        if (def.spec.modelDeath ? !def.bearers.some((b) => b.id === ctx.deadModelId) : alive(u).length > 0) continue;
      }
      if (!limitLeft(s, def) || !eventOk(def, ctx)) continue;
      if (!(def.spec.if ?? []).every((c) => cond(c, { s, A: u, holder: u, bearers: def.bearers }))) continue;
      const t = def.spec.target;
      const cands = actTargets(s, def, ctx);
      if (t && t.side !== 'self' && !cands.length) continue;
      const pick = !t || t.side === 'self' || t.each ? undefined : bestTarget(s, def, cands, ctx);
      useAct(s, def, pick, ctx);
    }
  }
}

/** Which unit an automatic or bot-used ability should pick. */
export function bestTarget(s: GameState, def: ActDef, cands: UnitState[], ctx: FireCtx = {}): string | undefined {
  if (!cands.length) return undefined;
  if (ctx.targetId && cands.some((c) => c.id === ctx.targetId)) return ctx.targetId;
  const t = def.spec.target!;
  if (t.side === 'friendly') {
    const hurt = (u: UnitState) => alive(u).reduce((a, m) => a + (m.profile.W - m.wounds), 0) + u.models.filter((m) => m.dead).length * 2;
    if (t.shocked) return cands.find((c) => c.battleShocked)?.id ?? cands[0].id;
    if ((def.spec.do ?? []).some((a) => a.riled)) {
      // riling up: a battle-shocked unit first, then the unit closest to the enemy
      const foes = boardUnits(s, other(def.holder.owner));
      const gap = (x: UnitState) => (onBoard(x) && foes.length ? Math.min(...foes.map((e) => unitDistance(x, e))) : 99);
      return [...cands].sort((a, b) => Number(b.battleShocked) - Number(a.battleShocked) || gap(a) - gap(b))[0].id;
    }
    return [...cands].sort((a, b) => hurt(b) - hurt(a) || b.pts - a.pts)[0].id;
  }
  // a mark only this unit's attacks use (Marked by Fate): the enemy unit it would shoot to the best effect
  if ((def.spec.do ?? []).some((a) => a.incoming && a.selfOnly) && s.phase === 'shooting') {
    const worth = (t: UnitState) => {
      const r = buildShootPools(s, def.holder.id, t.id, { mode: 'normal' });
      if (r.error) return 0;
      return r.pools.reduce((x, p) => x + expectedDamage(s, p, t).models, 0) * (t.pts / Math.max(1, t.startingStrength));
    };
    const ranked = cands.map((t) => ({ t, v: worth(t) })).sort((a, b) => b.v - a.v);
    if (ranked[0]?.v > 0) return ranked[0].t.id;
  }
  // enemies: the most valuable, then the weakest
  return [...cands].sort((a, b) => b.pts / Math.max(1, alive(b).length) - a.pts / Math.max(1, alive(a).length))[0].id;
}

// ---------- buttons ----------

export interface ManualAct { def: ActDef; targets: UnitState[]; why: string | null; label: string }

const AUTO_ONLY: Trigger[] = ['formation', 'roundStart', 'commandStart', 'commandEnd', 'movementEnd', 'fightStart', 'afterShooting', 'afterFighting', 'endOfCharge',
  'onDeath', 'friendlyDeath', 'shotByEnemy', 'enemyMovedNear', 'enemyFellBack', 'mortalTaken', 'becameShocked', 'passengerDisembarks', 'movementStart', 'fightEnd', 'attackStart',
  'attacked', 'friendlyTargeted', 'shootingStart', 'oppShootingStart', 'eachCommandStart', 'chargeEnd'];

/** Abilities player p can use by pressing a button right now. */
export function manualActs(s: GameState, p: PlayerId): ManualAct[] {
  const out: ManualAct[] = [];
  for (const u of s.units.filter((x) => x.owner === p && (onBoard(x) || x.status === 'reserves' || x.status === 'embarked'))) {
    for (const def of actsOfUnit(s, u)) {
      if (def.spec.auto || AUTO_ONLY.includes(def.spec.when)) continue;
      if (!onBoard(u) && def.spec.when !== 'command') continue;
      if (timingOk(s, def)) continue;
      if (!limitLeft(s, def)) continue;
      const condOk = (def.spec.if ?? []).every((c) => cond(c, { s, A: u, holder: u, bearers: def.bearers }));
      const targets = actTargets(s, def);
      const why = !condOk ? 'Conditions not met' : def.spec.target && def.spec.target.side !== 'self' && !targets.length ? 'No target in range' : null;
      out.push({ def, targets, why, label: def.spec.label ?? '' });
    }
  }
  return out;
}

/** Press an ability button (by its key) for a unit. */
export function useActByKey(s: GameState, unitId: string, key: string, targetId?: string): string | null {
  const u = unitById(s, unitId);
  const def = actsOfUnit(s, u).find((d) => d.key === key);
  if (!def) return 'No such ability';
  return useAct(s, def, targetId);
}

/** The bot presses the buttons that are worth it. */
export function botUseActs(s: GameState, p: PlayerId, when?: Trigger[], unitId?: string) {
  for (const m of manualActs(s, p)) {
    if (m.why || (when && !when.includes(m.def.spec.when)) || (unitId && m.def.holder.id !== unitId)) continue;
    const use = m.def.spec.botUse ?? 'always';
    if (use === 'never') continue;
    if (use === 'damaged' && !m.targets.some((t) => alive(t).some((x) => x.wounds < x.profile.W) || t.models.some((x) => x.dead))) continue;
    if (use === 'valuable' && !(engagedEnemies(s, m.def.holder).some((e) => e.pts >= 100) || pace(s) >= 4)) continue;
    if (use === 'round2' && s.round < 2) continue;
    if (use === 'round3' && pace(s) < 3) continue;
    // a once-per-battle shooting boost is kept for a turn when the enemy is close, not spent on long-range potshots
    if (use === 'always' && (m.def.spec.limit === 'battle' || m.def.spec.battleUses) && ['selectedToShoot', 'shooting'].includes(m.def.spec.when)
      && pace(s) < 4 && !boardUnits(s, other(p)).some((e) => unitDistance(m.def.holder, e) <= 12)) continue;
    if (use === 'healthy' && alive(m.def.holder).reduce((a, x) => a + x.wounds, 0) * 2 <= m.def.holder.models.reduce((a, x) => a + x.profile.W, 0)) continue;
    // Pulse Jet: a long move instead of its own, taken while the enemy is still far off (the move is planned in botWindow)
    const longMove = m.def.spec.do?.some((a) => a.asMove);
    if (longMove && boardUnits(s, other(p)).some((e) => unitDistance(m.def.holder, e) <= 14)) continue;
    if (!longMove && m.def.spec.do?.some((a) => a.move || a.surge || a.reserves)) continue; // moves need a plan the bot does not make
    if (!(m.def.spec.botIf ?? []).every((c) => cond(c, { s, A: m.def.holder, holder: m.def.holder, bearers: m.def.bearers }))) continue;
    const pick = m.def.spec.target && m.def.spec.target.side !== 'self' && !m.def.spec.target.each ? bestTarget(s, m.def, m.targets) : undefined;
    useAct(s, m.def, pick);
  }
}

/** A unit is selected to shoot / fight: abilities that happen "when this unit is selected to …". */
export function unitSelected(s: GameState, u: UnitState, kind: 'shoot' | 'fight') {
  const key = `sel:${kind}`;
  if ((u.used ??= {})[key] === phaseKey(s)) return;
  u.used[key] = phaseKey(s);
  // Dark Pacts: made here for bots and players who leave their rules to the app; a player who decides picks it on screen
  autoPact(s, u, kind, (p) => (s.decides ?? []).includes(p) && !(s.bots ?? []).includes(p));
  if (kind === 'shoot') for (const o of boardUnits(s, u.owner)) if (o.id !== u.id) { scouringDue(s, o, true); unleashHellDue(s, o, true); }
  fire(s, kind === 'shoot' ? 'selectedToShoot' : 'selectedToFight', [u]);
}

// ---------- reactions: "if an enemy unit ends a move within 8" of this unit, this unit can make a Normal move" ----------

/** After a unit of the active player moved: units of the other player with such abilities get a prompt. */
export function offerReactions(s: GameState, trigger: 'enemyMovedNear' | 'enemyFellBack', mover: UnitState, candidates?: UnitState[]) {
  const p = other(mover.owner);
  const offers: { unitId: string; key: string; label: string }[] = [];
  for (const u of candidates ?? boardUnits(s, p)) {
    if (!onBoard(u)) continue;
    for (const def of actsOfUnit(s, u)) {
      if (def.spec.when !== trigger || !limitLeft(s, def)) continue;
      if (trigger === 'enemyMovedNear' && !(alive(mover).length && near(from(def), mover, def.spec.range ?? 8))) continue;
      if (!(def.spec.if ?? []).every((c) => cond(c, { s, A: u, holder: u, bearers: def.bearers }))) continue;
      const mv = def.spec.do?.find((a) => a.move)?.move ?? '';
      offers.push({ unitId: u.id, key: def.key, label: `${def.name}: move ${mv === 'M' ? 'Normal move' : `${mv}"`}` });
    }
  }
  if (!offers.length) return;
  const w = s.window;
  if (w?.kind === 'abilityMove' && w.player === p) {
    for (const o of offers) if (!w.offers.some((x) => x.unitId === o.unitId && x.key === o.key)) w.offers.push(o);
    return;
  }
  if (w) return;
  s.window = { kind: 'abilityMove', player: p, offers, label: `${mover.name} moved close` };
  log(s, `${s.players[p].name}: reaction abilities available (${offers.map((o) => o.label).join(', ')})`, 'info', p);
}

/** Accept one offer of the reaction prompt: the ability is used and the unit gets its move (then the player drags it). */
export function acceptOffer(s: GameState, unitId: string, key: string): string | null {
  const u = unitById(s, unitId);
  if (key) {
    const def = actsOfUnit(s, u).find((d) => d.key === key);
    if (!def) return 'No such ability';
    const err = useAct(s, def);
    if (err) return err;
  }
  const w = s.window;
  if (w?.kind === 'abilityMove') {
    w.offers = w.offers.filter((o) => o.unitId !== unitId);
    if (u.extraMove) w.offers.push({ unitId, key: '', label: `${u.extraMove.label}: move ${u.extraMove.max}"` });
  }
  return u.extraMove ? null : 'No extra move';
}

/** A move from the prompt was made: drop its offer, close the prompt when nothing is left. */
export function offerDone(s: GameState, unitId: string) {
  const w = s.window;
  if (w?.kind !== 'abilityMove') return;
  w.offers = w.offers.filter((o) => o.unitId !== unitId);
  if (!w.offers.length) s.window = null;
}

/** Close the reaction prompt; moves that were not made are lost. */
export function closeOffers(s: GameState) {
  const w = s.window;
  if (w?.kind !== 'abilityMove') return;
  for (const o of w.offers) { const u = unitById(s, o.unitId); if (!o.key) u.extraMove = undefined; }
  s.window = null;
}

// ---------- free dice from abilities (Armorium Cherub, Aquilon Optics) ----------

export interface FreeDie { key: string; label: string; kind: 'reroll' | 'setSix'; stage: 'hit' | 'wound'; bag: string; limit: Limit; name: string }

const freeList = (f: FreeDieSpec | FreeDieSpec[]) => (Array.isArray(f) ? f : [f]);

/** Free re-rolls / "change to a 6" the attacking unit can use on the dice of the attack being made. */
export function freeDiceNow(s: GameState): FreeDie[] {
  const at = s.attack;
  if (!at) return [];
  const A = unitById(s, at.attackerId);
  const kind = at.kind === 'fight' ? 'melee' : 'ranged';
  const out: FreeDie[] = [];
  const add = (name: string, tag: string, f: FreeDieSpec) => {
    if (f.units && !unitMatches(A, f.units)) return;
    if (f.attack && f.attack !== kind) return;
    if (f.if && !f.if.every((c) => cond(c, { s, A, T: unitById(s, at.targetId), holder: A }))) return;
    const bag = `free:${name}#${tag}`;
    if ((A.used ?? {})[bag] === period(s, f.limit)) return;
    const stages: ('hit' | 'wound')[] = f.stage === 'any' ? ['hit', 'wound'] : f.stage === 'hit' || f.stage === 'wound' ? [f.stage] : [];
    for (const st of stages) out.push({ key: `${bag}:${st}`, label: `${name}: ${f.kind === 'setSix' ? 'change to a 6' : 're-roll'} (${st === 'hit' ? 'Hit' : 'Wound'})`, kind: f.kind, stage: st, bag, limit: f.limit, name });
  };
  for (const a of A.abilities) {
    const rule = abilityRule(A, a);
    if (!rule?.freeDie || abilityOff(A, a)) continue;
    const sheet = abilitySheet(A, a);
    if (!gearBearers(a, rule, alive(A).filter((m) => m.source === sheet)).length) continue;
    freeList(rule.freeDie).forEach((f, i) => add(a.name, String(i), f));
  }
  for (const name of activeRules(s, A.owner)) (DET_RULES[name].freeDie ?? []).forEach((f, i) => add(name, `d${i}`, f));
  for (const t of A.timed ?? []) freeList(t.e.freeDie ?? []).forEach((f, i) => add(t.label, `t${i}`, f));
  return out;
}

/** The damage side of "re-roll one hit, wound or damage roll": a free die (stage any / damage) still unused this period. */
function takeFreeDamage(s: GameState): boolean {
  const at = s.attack;
  if (!at) return false;
  const A = unitById(s, at.attackerId);
  const kind = at.kind === 'fight' ? 'melee' : 'ranged';
  const specs: { name: string; tag: string; f: FreeDieSpec }[] = [];
  for (const a of A.abilities) {
    const rule = abilityRule(A, a);
    if (!rule?.freeDie || abilityOff(A, a)) continue;
    freeList(rule.freeDie).forEach((f, i) => specs.push({ name: a.name, tag: String(i), f }));
  }
  for (const name of activeRules(s, A.owner)) (DET_RULES[name].freeDie ?? []).forEach((f, i) => specs.push({ name, tag: `d${i}`, f }));
  for (const t of A.timed ?? []) freeList(t.e.freeDie ?? []).forEach((f, i) => specs.push({ name: t.label, tag: `t${i}`, f }));
  for (const { name, tag, f } of specs) {
    if (f.stage !== 'any' && f.stage !== 'damage') continue;
    if (f.kind !== 'reroll' || (f.units && !unitMatches(A, f.units)) || (f.attack && f.attack !== kind)) continue;
    if (f.if && !f.if.every((c) => cond(c, { s, A, T: unitById(s, at.targetId), holder: A }))) continue;
    const bag = `free:${name}#${tag}`;
    if ((A.used ?? {})[bag] === period(s, f.limit)) continue;
    (A.used ??= {})[bag] = period(s, f.limit);
    log(s, `${name}: re-roll one Damage roll`, 'info', A.owner);
    return true;
  }
  return false;
}
setFreeDamageHook(takeFreeDamage);

export function useFreeDie(s: GameState, key: string, index: number): string | null {
  const f = freeDiceNow(s).find((x) => x.key === key);
  if (!f) return 'No longer available';
  const A = unitById(s, s.attack!.attackerId);
  (A.used ??= {})[f.bag] = period(s, f.limit);
  if (f.kind === 'setSix') forceDie(s, f.stage, index, 6); else rerollOne(s, f.stage, index);
  log(s, `${f.name}: ${f.kind === 'setSix' ? 'die changed to a 6' : 'one die re-rolled'}`, 'info', A.owner);
  return null;
}

// ---------- "choose N of these abilities" (Author of the Codex …) ----------

export interface AbilityChoiceNow { unit: UnitState; name: string; pick: number; options: string[]; on: string[] }

export function abilityChoices(s: GameState, p: PlayerId): AbilityChoiceNow[] {
  const out: AbilityChoiceNow[] = [];
  for (const u of s.units.filter((x) => x.owner === p && x.status !== 'destroyed' && alive(x).length)) {
    for (const a of u.abilities) {
      const ch = abilityRule(u, a)?.choice;
      if (!ch) continue;
      if (ch.if && !ch.if.every((c) => cond(c, { s, A: u, holder: u }))) continue;
      // picked in the army builder (Daemonic Allegiance: the god keyword the unit was given) — not a choice in the battle
      const fixed = ch.options.filter((o) => u.keywords.includes(o.toUpperCase()));
      if (fixed.length >= ch.pick) { u.abilityPicks ??= { pool: ch.options, on: fixed.slice(0, ch.pick) }; continue; }
      out.push({ unit: u, name: ch.name, pick: ch.pick, options: ch.options, on: u.abilityPicks?.on ?? ch.options.slice(0, ch.pick) });
    }
  }
  return out;
}

export function pickAbilities(s: GameState, unitId: string, on: string[]) {
  const u = unitById(s, unitId);
  const ch = abilityChoices(s, u.owner).find((c) => c.unit.id === unitId);
  if (!ch) return;
  u.abilityPicks = { pool: ch.options, on: on.slice(0, ch.pick) };
  log(s, `${u.name} · ${ch.name}: ${u.abilityPicks.on.join(' + ')}`, 'info', u.owner);
}

/** Before the battle: every "choose N" ability starts with its first options so nothing counts twice. */
export function initAbilityChoices(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) for (const c of abilityChoices(s, p)) if (!c.unit.abilityPicks) c.unit.abilityPicks = { pool: c.options, on: c.options.slice(0, c.pick) };
}

// ---------- hooks from the attack sequence ----------

/** Destroyed models that fight / shoot back before they are removed ("Heroic Last Stand", "For the Chapter!"). */
function runDeathQueue(s: GameState) {
  const queue = s.deathQueue ?? [];
  if (!queue.length || s.attack) return;
  s.deathQueue = [];
  for (const q of queue) {
    const u = unitById(s, q.unitId);
    let T = unitById(s, q.targetId);
    if (!onBoard(T) && q.kind === 'shoot') {
      const alt = boardUnits(s, other(u.owner)).sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
      if (!alt) continue;
      T = alt;
    }
    if (!onBoard(T)) continue;
    const r = q.kind === 'fight' ? buildFightPools(s, u.id, T.id, { models: q.modelIds }) : buildShootPools(s, u.id, T.id, { mode: 'normal', models: q.modelIds });
    if (r.error || !r.pools.length) { log(s, `${q.label}: no weapon can target ${T.name}`, 'info', u.owner); continue; }
    const before = alive(T).length;
    log(s, q.alive ? `${q.label}: ${u.name} shoots back at ${T.name}` : `${q.label}: ${u.models.filter((m) => q.modelIds.includes(m.id)).map((m) => m.name).join(', ')} ${q.kind === 'fight' ? 'fights' : 'shoots'} before being removed → ${T.name}`, 'info', u.owner);
    const fired = [...u.weaponsFired];
    startAttack(s, q.kind, u.id, T.id, r.pools);
    s.attack!.free = true;
    if (q.kind === 'shoot' && !q.alive) for (const p of s.attack!.pools) { p.hazardous = 0; p.noHazard = true; }
    resolveAll(s);
    finishAttack(s);
    u.weaponsFired = fired; // shooting out of phase does not use up the unit's own shooting
    if (q.regain && alive(T).length < before) {
      for (const id of q.modelIds) {
        const m = u.models.find((x) => x.id === id);
        if (!m) continue;
        m.dead = false;
        m.wounds = Math.min(m.profile.W, rollExpr(s, q.regain).total);
        if (u.status === 'destroyed') { u.status = 'board'; s.destroyedByTurn = s.destroyedByTurn.filter((d) => d.unitId !== u.id || d.turn !== s.turn); }
        log(s, `${q.label}: ${m.name} destroyed a model and survives (${m.wounds} W left)`, 'info', u.owner);
      }
    }
  }
}

function retaliate(s: GameState, at: AttackSession, A: UnitState, T: UnitState) {
  for (const [id, n] of Object.entries(at.allocated ?? {})) {
    const m = T.models.find((x) => x.id === id);
    if (!m || !n) continue;
    const r = retaliateFor(s, T, m);
    if (!r) continue;
    const dice = rollN(s, Math.min(n, r.max));
    const hits = dice.filter((v) => v >= r.on).length;
    log(s, `${r.label}: ${m.name} rolled [${dice.join(' ')}] → ${hits} MW on ${A.name}`, 'roll', T.owner);
    if (hits && onBoard(A)) applyMortalWounds(s, A, hits, r.label);
  }
}

onAttackFinished((s, at, info) => {
  const A = unitById(s, at.attackerId);
  const T = unitById(s, at.targetId);
  // remember who this unit hit this phase (for "select one enemy unit hit by those attacks")
  const key = phaseKey(s);
  if (!A.lastHits || A.lastHits.key !== key) A.lastHits = { key, ids: [], byWeapon: {} };
  if (info.hits > 0 && !A.lastHits.ids.includes(T.id)) A.lastHits.ids.push(T.id);
  if (info.hits > 0) A.lastHits.byWeapon![T.id] = [...new Set([...(A.lastHits.byWeapon![T.id] ?? []), ...info.hitWeapons])];
  const ctx: FireCtx = { targetId: T.id, destroyed: info.destroyed ? [T.id] : [], killedCharacter: info.killedCharacter, modelsKilled: info.modelsKilled };
  if (info.destroyed) { (A.used ??= {}).killedUnit = key; sagaProgress(s, at, A, T); }
  // Strikes of Retribution: melee attacks allocated to this model hurt the attackers
  if (at.kind === 'fight' && at.allocated) retaliate(s, at, A, T);
  const dm = deathMW.get(A.id);
  if (dm) { deathMW.delete(A.id); log(s, `${T.name}: ${dm} of its dying models curse ${A.name} → ${dm} mortal wound(s)`, 'roll', T.owner); if (onBoard(A)) applyMortalWounds(s, A, dm, 'Selfless Demise'); }
  // Specimens for the Spider: enemy CHARACTER models died → Battle-shock nearby (the WARLORD: every enemy unit within range)
  const cks = unitFlags(s, A).charKillShock;
  if (cks && info.killedCharacter && at.kind === 'fight') {
    const near = boardUnits(s, T.owner).filter((e) => unitDistance(A, e) <= cks + 1e-6);
    const all = T.isWarlordUnit && T.models.some((x) => x.dead && x.isCharacter);
    for (const e of all ? near : near.slice().sort((a, b) => unitDistance(A, a) - unitDistance(A, b)).slice(0, 1)) shockTest(s, e, 0, 'Specimens for the Spider');
  }
  if (!at.free) {
    if (at.kind === 'shoot' && s.phase === 'shooting' && A.owner === s.active) fire(s, 'afterShooting', [A], ctx);
    if (at.kind === 'shoot') { scouringDue(s, A, false); unleashHellDue(s, A, false); }
    if (at.kind === 'fight') fire(s, 'afterFighting', [A], ctx);
  }
  if (at.kind !== 'fight' && info.woundsLost > 0 && T.owner !== s.active && onBoard(T)) fire(s, 'shotByEnemy', [T], { targetId: A.id, modelsKilled: info.modelsKilled });
  runDeathQueue(s);
});

// ---------- Space Wolves Sagas ----------

const SAGA_SIZE: Record<string, number> = { incursion: 2, strike: 3, onslaught: 4 };

/** Start of the battle: tallies and targets of the Saga in the player's detachment. */
export function initSagas(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    const spec = activeRules(s, p).map((n) => DET_RULES[n].saga).find(Boolean);
    if (!spec || P.saga) continue;
    const enemyCMV = s.units.filter((u) => u.owner !== p && ['CHARACTER', 'MONSTER', 'VEHICLE'].some((k) => hasKw(u, k))).length;
    const target = spec.kind === 'hunter' ? SAGA_SIZE[P.battleSize ?? 'strike'] ?? 3 : spec.kind === 'beastslayer' ? Math.max(1, Math.ceil(enemyCMV / 2)) : 3;
    P.saga = { kind: spec.kind, tally: 0, target, done: false, boasts: [] };
    log(s, `Saga: target ${target}`, 'info', p);
  }
}

function sagaTick(s: GameState, p: PlayerId, what: string, boast?: string) {
  const g = s.players[p].saga;
  if (!g || g.done) return;
  if (boast) { if (g.boasts.includes(boast)) return; g.boasts.push(boast); g.tally = g.boasts.length; } else g.tally += 1;
  log(s, `Saga: ${what} (${g.tally}/${g.target})`, 'info', p);
  if (g.tally >= g.target) { g.done = true; log(s, 'Saga completed! The Detachment bonus is gained', 'vp', p); }
}

function sagaProgress(s: GameState, at: AttackSession, A: UnitState, T: UnitState) {
  const P = s.players[A.owner];
  // Slayer's Oath: the unit gets the completed-Saga benefits when it destroys a unit with its keyword
  for (const [id, kw] of Object.entries(P.slayer ?? {})) if (id === A.id && hasKw(T, kw) && !A.sagaDone) { A.sagaDone = true; log(s, `Slayer's Oath: ${A.name} gains the completed Saga's benefits`, 'info', A.owner); }
  const g = P.saga;
  if (!g || g.done || !A.factionKeywords.includes('ADEPTUS ASTARTES')) return;
  if (g.kind === 'hunter' && at.kind === 'fight') sagaTick(s, A.owner, `Quarry: ${T.name}`);
  if (g.kind === 'beastslayer' && ['CHARACTER', 'MONSTER', 'VEHICLE'].some((k) => hasKw(T, k))) sagaTick(s, A.owner, `Beastslayer: ${T.name}`);
  if (g.kind === 'bold' && hasKw(A, 'CHARACTER') && A.factionKeywords.includes('SPACE WOLVES') && P.oathTarget === T.id) {
    A.oathKills = (A.oathKills ?? 0) + 1;
    sagaTick(s, A.owner, `Boast: Your Hide as a Trophy (${A.name})`, 'trophy');
    if (A.oathKills >= 2) sagaTick(s, A.owner, `Boast: Slay Them All (${A.name})`, 'slay');
  }
}

/** Saga of the Bold boasts checked at the end of a turn / of the Command phase. */
export function sagaBoasts(s: GameState, at: 'turnEnd' | 'commandEnd') {
  for (const p of [0, 1] as PlayerId[]) {
    const g = s.players[p].saga;
    if (!g || g.kind !== 'bold' || g.done) continue;
    const heroes = boardUnits(s, p).filter((u) => hasKw(u, 'CHARACTER') && u.factionKeywords.includes('SPACE WOLVES'));
    if (at === 'turnEnd' && heroes.some((u) => wholly(s, u, other(p)))) sagaTick(s, p, 'Boast: Overrun Their Position', 'overrun');
    if (at === 'commandEnd' && p === s.active && s.round >= 2 && heroes.some((u) => s.objectives.some((o) => o.controller === p && !(o.type === 'home' && o.owner === p) && alive(u).some((m) => dist(m, o) <= 3 + m.r)))) sagaTick(s, p, 'Boast: Hold the Line', 'hold');
  }
}
let wholly: (s: GameState, u: UnitState, zoneOwner: PlayerId) => boolean = () => false;
export const setZoneCheck = (fn: typeof wholly) => { wholly = fn; };

onAttackStart((s, at) => {
  if (at.free) return;
  const A = unitById(s, at.attackerId);
  const T = unitById(s, at.targetId);
  if (at.kind === 'shoot') fire(s, 'attackStart', [A], { targetId: T.id });
  // the target reacts ("when an enemy unit targets this unit …")
  fire(s, 'attacked', [T], { targetId: A.id, killerId: A.id, melee: at.kind === 'fight' });
  // friendly units nearby react ("when a friendly PHOBOS unit within 6" is selected as the target of an attack")
  if (at.kind !== 'fight' && s.phase === 'shooting' && T.owner !== s.active) {
    for (const f of boardUnits(s, T.owner)) {
      if (f.id === T.id) continue;
      for (const def of actsOfUnit(s, f)) {
        if (def.spec.when !== 'friendlyTargeted' || !def.spec.auto || !limitLeft(s, def) || !unitMatches(T, def.spec.deathUnits)) continue;
        if (!near(def.bearers, T, def.spec.range ?? 6)) continue;
        // "that friendly unit has …" (Adept of the Omnissiah): the act's target is the unit being shot
        useAct(s, def, def.spec.target?.side === 'friendly' ? T.id : undefined, { killerId: A.id, targetId: A.id });
      }
    }
  }
});

/** Set up on the battlefield during the battle: Screaming Descent / Dread Reputation make enemy units nearby test. */
export function arrivalShock(s: GameState, u: UnitState) {
  if (s.round < 1 || !onBoard(u)) return;
  const f = unitFlags(s, u);
  const seen = (e: UnitState) => alive(u).some((m) => unitVisibleTo(s, m, e));
  if (f.arriveShockAll) for (const e of boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= f.arriveShockAll + 1e-6)) shockTest(s, e, 0, `${u.name} arrives`);
  else if (f.arriveShock) {
    const e = boardUnits(s, other(u.owner)).filter((e) => (hasKw(e, 'INFANTRY') || hasKw(e, 'MOUNTED')) && unitDistance(u, e) <= f.arriveShock + 1e-6 && seen(e))
      .sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    if (e) shockTest(s, e, 0, `${u.name} arrives`);
  }
}

// An enemy unit is wiped out: Eye of Abaddon / Weaponised Hatred (your Oath / focus / Vendetta target), Soul Harvester,
// Architect of Ruin (a new hated foe)
// Slaanesh's Chosen: a CHARACTER unit that wipes out an enemy unit becomes the Favoured Champions
onModelKilled((s, u, _m, killerId) => {
  if (!alive(u).length && killerId) favouredOnKill(s, s.units.find((x) => x.id === killerId));
});

// Accomplished Tactician: in the opponent's Shooting phase, a unit near the bearer that was hit can embark within a
// friendly transport it is wholly within 6" of (once per turn). The bot does it when the unit lost wounds.
onAttackFinished((s, at, info) => {
  if (at.kind !== 'shoot' || !info.hits) return;
  const T = unitById(s, at.targetId);
  if (!onBoard(T) || T.owner === s.active || engagedEnemies(s, T).length || hasKw(T, 'TRANSPORT')) return;
  const holder = boardUnits(s, T.owner).find((h) => h.abilities.some((a) => a.name === 'Accomplished Tactician') && unitDistance(h, T) <= 9 + 1e-6 && (h.used ?? {}).tactician !== String(s.turn));
  if (!holder) return;
  const t = boardUnits(s, T.owner).find((x) => x.transport && alive(T).every((m) => alive(x).some((n) => baseDist(m, n) <= 6 + 1e-6)));
  if (!t) return;
  const person = !playsItself(s, T.owner);
  if (person && s.window) return;
  if (!person && !info.woundsLost) return;
  (holder.used ??= {}).tactician = String(s.turn);
  const acts: Action[] = [{ embarkNear: 6 }];
  if (person) s.window = { kind: 'pickUnit', player: T.owner, label: `Accomplished Tactician: ${T.name} embarks within ${t.name}? (pick it, or skip)`, units: [T.id], holderId: holder.id, acts };
  else runActions(s, 'Accomplished Tactician', holder, acts, T);
});

onModelKilled((s, u) => {
  if (alive(u).length) return;
  const p = other(u.owner);
  const P = s.players[p];
  const mine = boardUnits(s, p);
  const isMark = P.oathTarget === u.id;
  for (const f of mine) {
    const fl = unitFlags(s, f);
    if (isMark && fl.cpOnOathKill <= 6) { const r = d6(s); log(s, `${f.name}: focus of hatred destroyed, rolled ${r} (${fl.cpOnOathKill}+)${r >= fl.cpOnOathKill ? ' → +1CP' : ''}`, 'roll', p); if (r >= fl.cpOnOathKill) P.cp += 1; }
    if (fl.cpOnKillNear && unitDistance(f, u) <= fl.cpOnKillNear.range + 1e-6) { const r = d6(s); log(s, `${f.name}: enemy unit destroyed nearby, rolled ${r} (${fl.cpOnKillNear.on}+)${r >= fl.cpOnKillNear.on ? ' → +1CP' : ''}`, 'roll', p); if (r >= fl.cpOnKillNear.on) P.cp += 1; }
    if (f.quarry === u.id && f.abilities.some((a) => a.name === 'Architect of Ruin' || a.name === 'Monarch of the Hunt')) {
      const next = boardUnits(s, u.owner).sort((a, b) => b.pts - a.pts)[0];
      if (next) { f.quarry = next.id; log(s, `${f.name}: new hated foe → ${next.name}`, 'info', p); }
    }
  }
  if (isMark) {
    const hunter = mine.find((f) => unitFlags(s, f).retargetOath && (f.used ??= {}).retarget !== String(s.round));
    const next = hunter && boardUnits(s, u.owner).filter((e) => alive(hunter).some((m) => unitVisibleTo(s, m, e))).sort((a, b) => unitDistance(hunter, a) - unitDistance(hunter, b))[0];
    if (hunter && next) { hunter.used!.retarget = String(s.round); P.oathTarget = next.id; log(s, `${hunter.name}: new Vendetta target → ${next.name}`, 'info', p); }
  }
});

// World Eaters: Bloodshed points (Icon of Khorne) and Blood Tithe points (Khorne Daemonkin) when a unit is wiped out
onModelKilled((s, u, m, killerId) => {
  // Blood-forged Armour: the bearer dying gives a Blood Tithe point
  if (u.enhancements.some((e) => e.name === 'Blood-forged Armour' && (e.model === m.source)) && activeRules(s, u.owner).includes('Khorne Daemonkin')) {
    s.players[u.owner].tithe = (s.players[u.owner].tithe ?? 0) + 1;
    log(s, 'Blood-forged Armour: +1 Blood Tithe point', 'info', u.owner);
  }
  if (alive(u).length || !killerId) return;
  const k = unitById(s, killerId);
  if (k.owner === u.owner) return;
  const P = s.players[k.owner];
  if (k.abilities.some((a) => a.name === 'Icon of Khorne') && alive(k).some((x) => (x.gear ?? []).some((g) => /icon of khorne/i.test(g)))) {
    P.bloodshed = (P.bloodshed ?? 0) + 1;
    log(s, `${k.name}: Icon of Khorne → +1 Bloodshed point (${P.bloodshed})`, 'info', k.owner);
  }
  if (activeRules(s, k.owner).includes('Khorne Daemonkin') && k.factionKeywords.some((x) => x === 'WORLD EATERS' || x === 'BLOOD LEGIONS')) {
    // Blade of Endless Bloodshed: a melee kill always gives the point
    const sure = s.attack?.kind === 'fight' && k.enhancements.some((e) => e.name === 'Blade of Endless Bloodshed');
    const r = sure ? 6 : d6(s);
    if (r >= 3) P.tithe = (P.tithe ?? 0) + 1;
    log(s, `Blood Tithe: ${k.name} destroyed ${u.name}${sure ? '' : `, rolled ${r} (3+)`}${r >= 3 ? ` → +1 BTP (${P.tithe})` : ''}`, 'roll', k.owner);
  }
});

// Selfless Demise / Glut of Souls: counted while the attack runs, resolved when it is over
const deathMW = new Map<string, number>();
onModelKilled((s, u, m, killerId) => {
  const killer0 = killerId ? unitById(s, killerId) : undefined;
  if (s.attack && killer0 && killer0.owner !== u.owner) {
    (killer0.used ??= {}).killedModel = phaseKey(s);
    const on = unitFlags(s, u).deathRetaliate;
    if (on <= 6 && d6(s) >= on) deathMW.set(killer0.id, (deathMW.get(killer0.id) ?? 0) + 1);
    const h = unitFlags(s, killer0).healOnKill;
    const key = `glut:${phaseKey(s)}`;
    const used = Number((killer0.used ??= {})[key] ?? 0);
    if (h && used < h.max && d6(s) >= h.on) {
      const w = alive(killer0).filter((x) => x.wounds < x.profile.W).sort((a, b) => a.wounds - b.wounds)[0];
      if (w) { w.wounds += 1; killer0.used[key] = String(used + 1); log(s, `${killer0.name} regains 1 wound (a soul devoured)`, 'info', killer0.owner); }
    }
  }
});

onModelKilled((s, u, m, killerId) => {
  const at = s.attack;
  const melee = at?.kind === 'fight';
  const killer = killerId ? unitById(s, killerId) : undefined;
  // fights / shoots on death
  if (at && !at.free && killer && killer.owner !== u.owner) {
    const fod = fightOnDeathFor(s, u, m);
    if (fod.fight && melee && !u.fought && !(s.fight?.fought ?? []).includes(u.id)) {
      const r = d6(s);
      const ok = r >= fod.fight.on;
      log(s, `${fod.fight.label}: ${m.name} rolled ${r} (${fod.fight.on}+) → ${ok ? 'not removed yet: fights after the enemy has fought' : 'failed'}`, 'roll', u.owner);
      if (ok) (s.deathQueue ??= []).push({ unitId: u.id, modelIds: [m.id], targetId: killer.id, kind: 'fight', label: fod.fight.label, regain: fod.fight.regain });
    } else if (fod.shoot) {
      const r = d6(s);
      const ok = r >= fod.shoot.on;
      log(s, `${fod.shoot.label}: ${m.name} rolled ${r} (${fod.shoot.on}+) → ${ok ? 'shoots before being removed' : 'failed'}`, 'roll', u.owner);
      if (ok) {
        const q = (s.deathQueue ??= []).find((x) => x.unitId === u.id && x.kind === 'shoot' && x.targetId === killer.id);
        if (q) q.modelIds.push(m.id); else s.deathQueue.push({ unitId: u.id, modelIds: [m.id], targetId: killer.id, kind: 'shoot', label: fod.shoot.label });
      }
    }
  }
  const ctx: FireCtx = { killerId, deadModelId: m.id, melee };
  fire(s, 'onDeath', [u], ctx);
  // friendly models nearby react (Vengeance of the Omnissiah)
  for (const f of boardUnits(s, u.owner)) {
    if (f.id === u.id) continue;
    for (const def of actsOfUnit(s, f)) {
      if (def.spec.when !== 'friendlyDeath' || !def.spec.auto || !limitLeft(s, def) || !unitMatches(u, def.spec.deathUnits)) continue;
      if (def.spec.needUnitDestroyed && alive(u).length) continue;
      if (def.spec.oppShooting && !(s.phase === 'shooting' && f.owner !== s.active)) continue;
      if (!def.bearers.some((b) => baseDist(b, m) <= (def.spec.range ?? 12) + 1e-6)) continue;
      useAct(s, def, undefined, ctx);
    }
  }
  // Master of Battle: the backup Oath of Moment target takes over; Recalculating: pick a new one
  if (!alive(u).length) {
    for (const p of [0, 1] as PlayerId[]) {
      const P = s.players[p];
      if (P.oathTarget !== u.id) continue;
      if (P.oathBackup && onBoard(unitById(s, P.oathBackup))) {
        P.oathTarget = P.oathBackup;
        P.oathBackup = null;
        log(s, `Master of Battle: new Oath of Moment target → ${unitById(s, P.oathTarget).name}`, 'info', p);
        continue;
      }
      for (const name of activeRules(s, p)) {
        const rt = DET_RULES[name].oathRetarget;
        if (!rt) continue;
        const holder = boardUnits(s, p).find((x) => x.sources.includes(rt.needs) && alive(x).some((n) => n.source === rt.needs));
        const bag = (P.abilityUsed ??= {});
        if (!holder || bag[`retarget:${name}`] === period(s, rt.limit)) continue;
        const eye = alive(holder).filter((n) => n.source === rt.needs);
        const next = boardUnits(s, other(p)).filter((e) => eye.some((n) => unitVisibleTo(s, n, e))).sort((a, b) => b.pts - a.pts)[0];
        if (!next) continue;
        bag[`retarget:${name}`] = period(s, rt.limit);
        P.oathTarget = next.id;
        log(s, `${name}: new Oath of Moment target → ${next.name}`, 'info', p);
      }
    }
  }
});

onMortalWounds((s, u) => { fire(s, 'mortalTaken', [u]); });

/** End of a phase: mortal wounds that were promised for now (Warpmeld Sacrifice). */
function resolvePhaseMortals(s: GameState) {
  const list = s.phaseMortals ?? [];
  s.phaseMortals = [];
  for (const q of list) {
    const u = unitById(s, q.unitId);
    if (!onBoard(u)) continue;
    const n = rollExpr(s, q.expr).total;
    log(s, `${q.label}: ${u.name} suffers ${n} mortal wounds at the end of the phase`, 'roll', u.owner);
    applyMortalWounds(s, u, n, q.label);
  }
}

/** End of a phase: models that roll to come back (Armour of Fate). */
export function resolveRevivals(s: GameState) {
  resolvePhaseMortals(s);
  for (const sp of s.spawns ?? []) {
    const tpl = s.players[sp.owner].spawnTemplate;
    if (!tpl) continue;
    const u: UnitState = structuredClone(tpl);
    u.id = `spawn${s.units.length}`;
    u.models.forEach((m, i) => { m.id = `${u.id}-m${i}`; });
    s.units.push(u);
    if (!setBackUp(s, u, u.models[0], sp)) { s.units.pop(); log(s, `${sp.label}: no room for the Chaos Spawn`, 'info', sp.owner); continue; }
    u.status = 'board'; u.setUpTurn = s.turn;
    pushFx(s, { kind: 'place', unitId: u.id, owner: u.owner });
    log(s, `${sp.label}: a Tzeentch Chaos Spawn is set up`, 'info', sp.owner);
  }
  s.spawns = [];
  const list = s.revivals ?? [];
  if (!list.length) return;
  s.revivals = [];
  for (const r of list) {
    const u = unitById(s, r.unitId);
    const m = u.models.find((x) => x.id === r.modelId);
    if (!m || !m.dead) continue;
    if (r.ld) {
      const t = rollN(s, 2);
      log(s, `${r.label}: ${m.name} Leadership test [${t.join('+')}] = ${t[0] + t[1]} vs ${m.profile.Ld}+`, 'roll', u.owner);
      if (t[0] + t[1] < m.profile.Ld) continue;
    } else {
      const v = d6(s);
      log(s, `${r.label}: ${m.name} rolled ${v} (${r.on}+)`, 'roll', u.owner);
      if (v < r.on) continue;
    }
    m.dead = false;
    m.wounds = Math.min(m.profile.W, r.woundsRoll ? rollExpr(s, r.woundsRoll).total : r.wounds);
    if (!setBackUp(s, u, m, { x: r.x, y: r.y })) { m.dead = true; m.wounds = 0; log(s, `${r.label}: no room to set it up`, 'info', u.owner); continue; }
    if (u.status === 'destroyed') { u.status = 'board'; s.destroyedByTurn = s.destroyedByTurn.filter((d) => d.unitId !== u.id); }
    pushFx(s, { kind: 'place', unitId: u.id, owner: u.owner });
    log(s, `${r.label}: ${m.name} returns with ${m.wounds} wounds!`, 'info', u.owner);
  }
}

/** Start-of-phase helper: automatic abilities of these units. */
export const fireFor = (s: GameState, trigger: Trigger, p: PlayerId | 'both', ctx: FireCtx = {}) =>
  fire(s, trigger, s.units.filter((u) => (p === 'both' || u.owner === p) && onBoard(u)), ctx);

/** Triggers that also cover units in Reserves / not yet deployed (start of the battle or battle round, Declare Battle Formations). */
export const fireAll = (s: GameState, trigger: Trigger, p: PlayerId | 'both') =>
  fire(s, trigger, s.units.filter((u) => (p === 'both' || u.owner === p) && u.status !== 'destroyed' && alive(u).length > 0));

export const rulePresent = (u: UnitState, a: AbilityData) => !!abilityRule(u, a);
