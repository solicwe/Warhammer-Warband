// Imperial Knights (Faction Pack v1.2): Code Chivalric (Oaths, Honoured), Bondsman, Super-heavy Walker and the Gate
// Warden defensive line. Chaos Knights (Faction Pack v1.2): Harbingers of Dread (Delirium, Dominion, Paragons of Terror,
// Aspect of the Beast), Malefic Surge (Infernal Lance), Marked Prey (Houndpack Lance), Scenting Fear (Hunting Warpack).
// The rest of both armies' rules are data: data/detachment-rules.json, data/abilities/QI.json, QT.json.
import { activeRules, addTimed, bondOf, DET_RULES, type DetChoiceOption, type Effect } from '../rules-engine/effects';
import { applyMortalWounds } from '../engine/attack';
import { rollExpr, rollN } from '../engine/dice';
import { baseDist, girth, polyCentroid, segSegDist } from '../engine/geometry';
import { alive, boardUnits, hasKw, log, notifyAbilityCpGain, onBoard, other, strength, unitDistance } from '../engine/state';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

export const CODE = 'Code Chivalric';
export const DREAD = 'Harbingers of Dread';
const DREADS = ['despair', 'doom', 'darkness', 'dismay', 'delirium', 'dominion'];

const hasAb = (u: UnitState, name: string) => u.abilities.some((a) => a.name === name);
const hasEnh = (u: UnitState, name: string) => u.enhancements.some((e) => e.name === name);
/** Super-heavy Walker: the ability, or Preyslayer's Mantle on a War Dog. */
export const superHeavy = (u: UnitState) => hasAb(u, 'Super-heavy Walker') || hasEnh(u, 'Preyslayer’s Mantle');
const kn = (s: GameState, p: PlayerId) => (s.players[p].knights ??= { deeds: [], qualities: [], fulfilled: 0 });
const marked = (u: UnitState, mark: string) => (u.timed ?? []).some((t) => t.mark === mark);
const enemyDestroyed = (s: GameState, p: PlayerId) => s.units.filter((u) => u.owner !== p && u.status === 'destroyed').length;

// ---------- conditions (effects.ts cond() asks here first) ----------

/** The Knights conditions of effects.ts cond(): quality:X, honoured, dread:X (the holder's army or the holder itself),
 *  onLine / holderOnLine / lineClear / targetOnLine (Gate Warden Lance), bonded / bondedTo / twoBonded / bondQuarry
 *  (Bondsman), fresh:X (Valour's Reward), knightAdvanced, empowered, warlordOnBoard, enemyFly. Undefined: not one of them. */
export function knightsCond(c: string, x: { s: GameState; A: UnitState; T?: UnitState; holder?: UnitState }): boolean | undefined {
  const { s, A, T } = x;
  const h = x.holder ?? A;
  if (c.startsWith('quality:')) return (s.players[h.owner].knights?.qualities ?? []).includes(c.slice(8));
  if (c === 'honoured') return !!s.players[h.owner].knights?.honoured;
  if (c.startsWith('dread:')) return dreadActive(s, h, c.slice(6));
  if (c.startsWith('fresh:')) return !(s.players[h.owner].knights?.expended ?? []).includes(c.slice(6));
  if (c === 'onLine') return onDefensiveLine(s, A);
  if (c === 'holderOnLine') return onDefensiveLine(s, h);
  if (c === 'lineClear') return !!s.players[h.owner].knights?.line && boardUnits(s, other(h.owner)).every((e) => !onDefensiveLine(s, e, h.owner));
  if (c === 'targetOnLine') return !!T && onDefensiveLine(s, T, A.owner);
  if (c === 'bonded') return marked(A, 'Bondsman');
  if (c === 'bondedTo') return marked(A, `bond:${h.id}`);
  if (c === 'twoBonded') return boardUnits(s, h.owner).filter((u) => marked(u, `bond:${h.id}`)).reduce((n, u) => n + alive(u).length, 0) >= 2;
  if (c === 'bondQuarry') return !!T && boardUnits(s, A.owner).some((k) => k.quarry === T.id && marked(A, `bond:${k.id}`));
  if (c === 'knightAdvanced') return boardUnits(s, A.owner).some((u) => u.move === 'advance' && u.factionKeywords.includes('IMPERIAL KNIGHTS'));
  if (c === 'empowered') return marked(A, 'Empowered');
  if (c === 'warlordOnBoard') return boardUnits(s, A.owner).some((u) => u.isWarlordUnit);
  if (c === 'enemyFly') return boardUnits(s, other(A.owner)).some((e) => hasKw(e, 'FLY') && unitDistance(A, e) <= 36);
  return undefined;
}

/** Valour's Reward: an Enhancement is expended until the army fulfils an Oath again. */
export function expend(s: GameState, p: PlayerId, name: string) {
  const K = kn(s, p);
  K.expended = [...new Set([...(K.expended ?? []), name])];
}

/** A Dread ability active for unit u: the army's (Harbingers of Dread), or its own (Aspect of the Beast). */
export function dreadActive(s: GameState, u: UnitState, id: string): boolean {
  return (s.players[u.owner].det?.[DREAD]?.active ?? []).includes(id) || marked(u, `dread:${id}`);
}

/** Dominion: +3" to the range of the Aura abilities of a unit with Harbingers of Dread. */
export const auraBonus = (s: GameState, h: UnitState) => (hasAb(h, DREAD) && dreadActive(s, h, 'dominion') ? 3 : 0);

// ---------- the Oath and the Dread abilities (picked with the detachment choices) ----------

/** Why an option can't be picked now (Paragons of Terror's extra Dread ability cannot be rolled). */
export function choiceWhy(s: GameState, p: PlayerId, rule: string, o: DetChoiceOption): string | null {
  if (rule === DREAD && s.players[p].dreadBonus && o.random) return 'Paragons of Terror: select one';
  return null;
}

export function choicePicked(s: GameState, p: PlayerId, rule: string, ids: string[], randomly: boolean) {
  if (rule === CODE) {
    const K = kn(s, p);
    const opts = DET_RULES[CODE].choice!.options;
    const deed = ids.find((id) => opts.find((o) => o.id === id)?.group === 'deed');
    for (const id of ids) if (opts.find((o) => o.id === id)?.group === 'quality') K.qualities.push(id);
    if (deed) K.deeds.push(deed);
    K.random = randomly;
    K.roundBase ??= enemyDestroyed(s, p);
    if (deed === 'tyrant') {
      const t = s.units.filter((u) => u.owner !== p && u.status !== 'destroyed' && (hasKw(u, 'CHARACTER') || u.models.some((m) => m.isCharacter))).sort((a, b) => b.pts - a.pts)[0];
      K.tyrant = t?.id;
      log(s, t ? `We vow to lay low the tyrant: ${t.name}` : 'We vow to lay low the tyrant: the enemy has no CHARACTER', 'info', p);
    }
  }
  if (rule === DREAD) {
    const P = s.players[p];
    if (P.dreadBonus) { P.dreadBonus = false; return; }
    // Paragons of Terror: one more Dread ability in the first battle round, selected (not rolled)
    if (s.round === 1 && activeRules(s, p).includes('Traitoris Lance')) {
      P.dreadBonus = true;
      const st = P.det?.[DREAD];
      if (st) st.round = 0;
      log(s, 'Paragons of Terror: select one more Dread ability', 'info', p);
    }
  }
}

/** The current Oath's Deed is done: Honoured, CP (2, or 3 when rolled; an additional Oath 1), Enhancements back. */
function fulfil(s: GameState, p: PlayerId, why: string) {
  const K = kn(s, p);
  const extra = K.fulfilled > 0;
  K.fulfilled += 1;
  K.honoured = true;
  K.expended = [];
  K.done = true;
  const cp = extra ? 1 : K.random ? 3 : 2;
  s.players[p].cp += cp;
  log(s, `Oath fulfilled (${why}): the army is Honoured, +${cp}CP`, 'cp', p);
  notifyAbilityCpGain(s, p, cp, 'Code Chivalric');
}

const deedOf = (s: GameState, p: PlayerId) => { const K = s.players[p].knights; return K && !K.done ? K.deeds[K.deeds.length - 1] : undefined; };

/** End of a turn: lay low the tyrant (any turn), reclaim the realm (the opponent's turn). */
export function knightsTurnEnd(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    const d = deedOf(s, p);
    if (d === 'tyrant') {
      const t = s.units.find((u) => u.id === s.players[p].knights!.tyrant);
      if (t && (t.status === 'destroyed' || !alive(t).length)) fulfil(s, p, `${t.name} was destroyed`);
    }
    if (d === 'reclaim' && s.active !== p) {
      const mine = s.objectives.filter((o) => o.controller === p).length, theirs = s.objectives.filter((o) => o.controller === other(p)).length;
      if (mine > theirs) fulfil(s, p, `${mine} objectives against ${theirs}`);
    }
  }
}

/** End of a battle round: reap a great tally. */
export function knightsRoundEnd(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    const K = s.players[p].knights;
    if (deedOf(s, p) === 'tally' && K) {
      // shortcut: a destroyed unit that comes back (Reanimation …) is no longer counted; a destruction counter would keep it
      const n = enemyDestroyed(s, p) - (K.roundBase ?? 0);
      if (n > s.round) fulfil(s, p, `${n} enemy units destroyed this battle round`);
    }
  }
}

/** Start of each battle round: the tally starts again; Gate Warden Lance picks its foundations (first round). */
export function knightsRoundStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (s.players[p].knights) s.players[p].knights!.roundBase = enemyDestroyed(s, p);
    if (s.round === 1 && activeRules(s, p).includes('Gate Warden Lance')) pickFoundations(s, p);
  }
}

/** Start of the battle: Houndpack Lance makes three War Dog units CHARACTERS (the Warlord and Enhancement bearers first). */
export function knightsBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!activeRules(s, p).includes('Houndpack Lance')) continue;
    const dogs = s.units.filter((u) => u.owner === p && hasKw(u, 'WAR DOG') && u.status !== 'destroyed')
      .sort((a, b) => Number(b.isWarlordUnit) - Number(a.isWarlordUnit) || b.enhancements.length - a.enhancements.length || b.pts - a.pts).slice(0, 3);
    for (const u of dogs) {
      if (!u.keywords.includes('CHARACTER')) u.keywords.push('CHARACTER');
      for (const m of u.models) { m.isCharacter = true; if (!m.keywords.includes('CHARACTER')) m.keywords.push('CHARACTER'); }
    }
  }
}

// ---------- Gate Warden Lance: the defensive line ----------

/** The two objectives closest to the army's deployment zone become its foundations. */
function pickFoundations(s: GameState, p: PlayerId) {
  const mine = boardUnits(s, p);
  const c = mine.length ? polyCentroid(mine.flatMap(alive)) : { x: 30, y: 22 };
  const two = [...s.objectives].sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y)).slice(0, 2);
  if (two.length < 2) return;
  kn(s, p).line = two.map((o) => o.id);
  log(s, `Dauntless Defenders: objectives ${two.map((o) => o.id).join(' and ')} are the foundations of the defensive line`, 'info', p);
}

/** Is any part of the unit's bases on the line drawn between player p's foundation markers (40mm)? */
export function onDefensiveLine(s: GameState, u: UnitState, p: PlayerId = u.owner): boolean {
  const ids = s.players[p].knights?.line;
  if (!ids || !onBoard(u)) return false;
  const [a, b] = ids.map((id) => s.objectives.find((o) => o.id === id)) as (Pt | undefined)[];
  if (!a || !b) return false;
  const seg = { a, b };
  return alive(u).some((m) => {
    const ax = m.hl ? { a: { x: m.x - Math.cos(m.rot ?? 0) * m.hl, y: m.y - Math.sin(m.rot ?? 0) * m.hl }, b: { x: m.x + Math.cos(m.rot ?? 0) * m.hl, y: m.y + Math.sin(m.rot ?? 0) * m.hl } } : { a: m, b: m };
    return segSegDist(ax, seg) <= girth(m) + 1e-6;
  });
}

// ---------- the Command phase ----------

/** Start of the active player's turn: Heroes of Legend lets an army whose Oath is fulfilled swear another. */
export function knightsTurnStart(s: GameState) {
  const p = s.active;
  const K = s.players[p].knights;
  if (!K?.done || !activeRules(s, p).includes('Questoris Companions')) return;
  const st = s.players[p].det?.[CODE];
  const opts = DET_RULES[CODE].choice!.options.filter((o) => !o.random);
  const left = (g: string) => opts.some((o) => o.group === g && !(st?.used ?? []).includes(o.id));
  if (!st || !left('deed') || !left('quality')) return;
  st.count = 0;
  K.done = false;
  log(s, 'Heroes of Legend: swear an additional Oath', 'info', p);
}

/** Start of the active player's Command phase (after "until your next Command phase" effects ran out). */
export function knightsCommandStart(s: GameState) {
  const p = s.active;
  const rules = activeRules(s, p);
  if (rules.includes('Bondsman') || boardUnits(s, p).some((u) => u.abilities.some((a) => /\(Bondsman\)/.test(a.name)))) bondsman(s, p);
  if (rules.includes('Infernal Lance')) for (const u of boardUnits(s, p).filter((x) => x.factionKeywords.includes('CHAOS KNIGHTS') && hasKw(x, 'WALKER'))) maleficSurge(s, u);
  if (rules.includes('Houndpack Lance')) markedPrey(s, p);
  // Throne Tyrannicus: the closest other CHARACTER Knight within 9" is affected by the bearer's War Dog auras
  for (const u of boardUnits(s, p).filter((x) => hasEnh(x, 'Throne Tyrannicus'))) {
    const c = boardUnits(s, p).filter((x) => x.id !== u.id && hasKw(x, 'CHARACTER') && x.factionKeywords.includes('CHAOS KNIGHTS') && unitDistance(u, x) <= 9 + 1e-6).sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    if (c) { addTimed(s, c, { e: {}, label: 'Throne Tyrannicus', until: 'nextCommand', by: p, mark: `tyrannicus:${u.id}` }); log(s, `Throne Tyrannicus: ${c.name} is affected by ${u.name}’s War Dog auras`, 'info', p); }
  }
  for (const u of boardUnits(s, p).filter((x) => hasEnh(x, 'Aspect of the Beast'))) {
    const id = ['darkness', 'doom', 'despair', 'dominion', 'dismay', 'delirium'].find((d) => !dreadActive(s, u, d));
    if (id) { addTimed(s, u, { e: {}, label: 'Aspect of the Beast', until: 'nextCommand', by: p, mark: `dread:${id}` }); log(s, `Aspect of the Beast: ${u.name} has ${id[0].toUpperCase()}${id.slice(1)}`, 'info', p); }
  }
}

/** Bondsman: each Knight with a Bondsman ability affects the closest friendly ARMIGER model within 12" no other Bondsman
 *  ability affects (Knightly Teachings: up to three, 15" while Honoured, when no other model used that ability). */
function bondsman(s: GameState, p: PlayerId) {
  for (const u of boardUnits(s, p)) bondUnit(s, u, 12);
}

/** Helm Conditioning: this Knight's Bondsman abilities that found no ARMIGER model pick one within `range`. */
export function bondAgain(s: GameState, u: UnitState, range: number) {
  if (!boardUnits(s, u.owner).some((x) => marked(x, `bond:${u.id}`))) bondUnit(s, u, range);
}

function bondUnit(s: GameState, u: UnitState, baseRange: number) {
  const p = u.owner;
  const armigers = boardUnits(s, p).filter((x) => hasKw(x, 'ARMIGER'));
  const teachings = activeRules(s, p).includes('Spearhead-At-Arms');
  // Knightly Teachings: only when no other model used that Bondsman ability this turn
  const usedNames = new Set(boardUnits(s, p).flatMap((x) => (x.timed ?? []).filter((t) => t.mark === 'Bondsman' && t.turn === s.turn).map((t) => t.label)));
  for (const a of u.abilities.filter((x) => /\(Bondsman\)/.test(x.name))) {
    const bond = bondEffects(u, a.name);
    if (!bond) continue;
    const many = teachings && !usedNames.has(a.name);
    const range = Math.max(baseRange, many && s.players[p].knights?.honoured ? 15 : 12);
    const free = armigers.filter((x) => x.id !== u.id && !marked(x, 'Bondsman') && alive(u).some((m) => alive(x).some((n) => baseDist(m, n) <= range + 1e-6)))
      .sort((x, y) => unitDistance(u, x) - unitDistance(u, y)).slice(0, many ? 3 : 1);
    for (const x of free) {
      for (const e of bond) addTimed(s, x, { e, label: a.name, until: 'nextCommand', by: p });
      addTimed(s, x, { e: {}, label: a.name, until: 'nextCommand', by: p, mark: 'Bondsman' });
      addTimed(s, x, { e: {}, label: a.name, until: 'nextCommand', by: p, mark: `bond:${u.id}` });
    }
    if (free.length) log(s, `${a.name}: ${free.map((x) => x.name).join(', ')}`, 'info', p);
  }
}

/** What a Bondsman ability does to the ARMIGER it affects (abilities JSON: "bond"). */
const bondEffects = (u: UnitState, name: string) => bondOf(u, name);

/** Malefic Surge: a Leadership test (failed: D3 mortal wounds; Blasphemous Engine re-rolls it), then Empowered. */
export function maleficSurge(s: GameState, u: UnitState) {
  const ld = Math.min(...alive(u).map((m) => m.profile.Ld));
  let r = rollN(s, 2);
  if (r[0] + r[1] < ld && hasEnh(u, 'Blasphemous Engine')) r = rollN(s, 2);
  if (r[0] + r[1] < ld) {
    const n = rollExpr(s, 'D3').total;
    log(s, `Malefic Surge: ${u.name} Leadership [${r.join('+')}] vs ${ld}+ failed → ${n} mortal wound(s)`, 'roll', u.owner);
    applyMortalWounds(s, u, n, 'Malefic Surge');
  } else log(s, `Malefic Surge: ${u.name} Leadership [${r.join('+')}] vs ${ld}+ passed`, 'roll', u.owner);
  if (onBoard(u) && alive(u).length) addTimed(s, u, { e: {}, label: 'Malefic Surge', until: 'nextCommand', by: u.owner, mark: 'Empowered' });
}

/** Marked Prey: the most valuable enemy unit on the battlefield. */
function markedPrey(s: GameState, p: PlayerId) {
  const t = boardUnits(s, other(p)).sort((a, b) => b.pts - a.pts)[0];
  if (!t) return;
  addTimed(s, t, { e: {}, label: 'Marked Prey', until: 'nextCommand', by: p, mark: 'Marked Prey' });
  log(s, `Marked Prey: ${t.name}`, 'info', p);
}

/** Start of the active player's Shooting phase: Scenting Fear (once per battle round). */
export function knightsShootingStart(s: GameState) {
  const p = s.active;
  const P = s.players[p];
  if (!activeRules(s, p).includes('Hunting Warpack') || (P.abilityUsed ??= {})['Scenting Fear'] === `r${s.round}`) return;
  const dogs = boardUnits(s, p).filter((u) => hasKw(u, 'WAR DOG'));
  const t = boardUnits(s, other(p)).filter((e) => dogs.some((d) => unitDistance(d, e) <= 12 + 1e-6)).sort((a, b) => b.pts - a.pts)[0];
  if (!t) return;
  P.abilityUsed['Scenting Fear'] = `r${s.round}`;
  addTimed(s, t, { e: { detection: 6 }, label: 'Scenting Fear', until: 'phase', by: p });
  log(s, `Scenting Fear: ${t.name} has +6" detection range`, 'info', p);
}

// ---------- effects worked out here (Malefic Surge) ----------

/** Effects for unit u that depend on state (effects.ts collects them with its other effects). */
export function knightsEffects(s: GameState, u: UnitState): { e: Effect; label: string; holder: UnitState }[] {
  if (!marked(u, 'Empowered')) return [];
  const out: { e: Effect; label: string; holder: UnitState }[] = [];
  // Diabolic Power the first time it shoots or fights in its own turn, Unnatural Fortitude the first time it is attacked in the opponent's
  if (s.active === u.owner && (s.phase === 'shooting' || s.phase === 'fight')) {
    out.push({ e: { abilities: ['lethal hits'] }, label: 'Diabolic Power', holder: u });
    if (hasEnh(u, 'Knight Diabolus')) out.push({ e: { attack: 'melee', abilities: ['lance'] }, label: 'Knight Diabolus', holder: u });
  }
  if (s.active !== u.owner) {
    out.push({ e: { defend: { inv: 5 } }, label: 'Unnatural Fortitude', holder: u });
    if (hasEnh(u, 'Fleshmetal Fusion')) out.push({ e: { defend: { saveBonusD1: 1 } }, label: 'Fleshmetal Fusion', holder: u });
  }
  return out;
}

/** An attack is over: an Empowered unit has used its Malefic Surge ability (the effect stays for the rest of the phase). */
export function knightsAttackDone(s: GameState, attacker: UnitState, target: UnitState | undefined) {
  for (const u of [attacker, target]) {
    if (!u || !marked(u, 'Empowered')) continue;
    const used = u === attacker ? s.active === u.owner : s.active !== u.owner;
    if (!used) continue;
    const fx = knightsEffects(s, u);
    u.timed = (u.timed ?? []).filter((t) => t.mark !== 'Empowered');
    for (const a of fx) addTimed(s, u, { e: a.e, label: a.label, until: 'phase', by: u.owner });
  }
}

// ---------- Battle-shock, movement ----------

/** A unit failed a Battle-shock test: Delirium (Below Half-strength, within 9" of a Chaos Knight: D3 mortal wounds). */
export function knightsShockFailed(s: GameState, u: UnitState) {
  if (!onBoard(u) || strength(u) !== 'belowHalf') return;
  const src = boardUnits(s, other(u.owner)).find((h) => hasAb(h, DREAD) && dreadActive(s, h, 'delirium') && unitDistance(h, u) <= 9 + auraBonus(s, h) + 1e-6);
  if (!src) return;
  const n = rollExpr(s, 'D3').total;
  log(s, `Delirium: ${u.name} failed a Battle-shock test → ${n} mortal wound(s)`, 'roll', src.owner);
  applyMortalWounds(s, u, n, 'Delirium');
}

/** Super-heavy Walker: moving through terrain taller than 4" — one D6 per model that did, on a 1 the unit is Battle-shocked. */
export function knightsMoved(s: GameState, u: UnitState, paths: Map<string, Pt[]>) {
  if (!superHeavy(u) || u.battleShocked) return;
  const tall = s.terrain.filter((t) => t.height > 4);
  for (const m of alive(u)) {
    const p = paths.get(m.id);
    if (!p || p.length < 2) continue;
    const crossed = tall.some((t) => t.walls.some((w) => p.slice(1).some((q, i) => segSegDist({ a: p[i], b: q }, w) < 1e-6)));
    if (!crossed) continue;
    const r = rollN(s, 1)[0];
    log(s, `Super-heavy Walker: ${u.name} moved through tall terrain, rolled ${r}${r === 1 ? ' → Battle-shocked' : ''}`, 'roll', u.owner);
    if (r === 1) { u.battleShocked = true; return; }
  }
}

/** A Long Leash: up to two War Dog units count as within range of this ABHORRENT unit's auras until your next Command phase. */
export function longLeash(s: GameState, u: UnitState) {
  const dogs = boardUnits(s, u.owner).filter((x) => hasKw(x, 'WAR DOG')).sort((a, b) => unitDistance(u, a) - unitDistance(u, b)).slice(0, 2);
  for (const d of dogs) addTimed(s, d, { e: {}, label: 'A Long Leash', until: 'nextCommand', by: u.owner, mark: `leash:${u.id}` });
  if (dogs.length) log(s, `A Long Leash: ${dogs.map((d) => d.name).join(', ')} are within range of ${u.name}’s auras`, 'info', u.owner);
}
