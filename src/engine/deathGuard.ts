// Death Guard (Codex + Faction Pack v1.3, 30 Sep 2026): Nurgle's Gift — Contagion Range, Afflicted enemy units (-1 T
// and the army's Plague) — and the detachment rules that keep state of their own (Worldblight, Miasmic Bombardment,
// Deadly Vectors, Numberless Horde, Blighted Land, Signal Pox, Eyestinger Storm …).
import { activeRules, addTimed, type Effect } from './effects';
import { applyMortalWounds } from './attack';
import { rollExpr, rollN } from './dice';
import { baseDist, circleTouchesPoly, dist } from './geometry';
import { unitInRange } from './missions';
import { alive, boardUnits, hasKw, log, onBoard, other, unitDistance } from './state';
import type { GameState, ModelState, PlayerId, Pt, UnitState } from './types';

export const GIFT = 'Nurgle’s Gift (Aura)';
const CHAMPIONS = 'Champions of Contagion';

/** The Plagues of Nurgle's Gift: what an Afflicted unit suffers besides -1 Toughness. Listed in the bot's order of preference. */
export const PLAGUES: Record<string, { name: string; effects: Effect[] }> = {
  rattlejoint: { name: 'Rattlejoint Ague', effects: [{ defend: { save: -1 } }] },
  skullsquirm: { name: 'Skullsquirm Blight', effects: [{ attack: 'ranged', givesCover: true }, { attack: 'melee', hit: -1 }] },
  scabrous: { name: 'Scabrous Soulrot', effects: [{ move: -1, ld: -1, oc: -1, ocMin1: true }] },
};
export const PLAGUE_IDS = Object.keys(PLAGUES);

const dgArmy = (s: GameState, p: PlayerId) => activeRules(s, p).includes(GIFT);
const hasAb = (u: UnitState, name: string) => u.abilities.some((a) => a.name === name);
const timedOn = (u: UnitState, key: 'contagion' | 'contagionArmy') => (u.timed ?? []).reduce((a, t) => a + (t.e[key] ?? 0), 0);
const BATTLE_N: Record<string, number> = { incursion: 1, strike: 2, onslaught: 3 };

/** Units of player p whose models spread Nurgle's Gift: Death Guard units with the ability, and (Tallyband Summoners)
 *  Plague Legions units within 7" of one. */
function giftUnits(s: GameState, p: PlayerId): UnitState[] {
  const own = boardUnits(s, p);
  const dg = own.filter((u) => hasAb(u, GIFT));
  if (!activeRules(s, p).includes('Tallyband Summoners')) return dg;
  return [...dg, ...own.filter((u) => !dg.includes(u) && u.factionKeywords.includes('PLAGUE LEGIONS') && dg.some((d) => unitDistance(u, d) <= 7 + 1e-6))];
}

/** Contagion Range of one model: 3" / 6" / 9" in battle rounds 1 / 2 / 3+, plus its bonuses, at most 12". */
export function contagionRange(s: GameState, u: UnitState, m?: ModelState): number {
  let r = s.round <= 1 ? 3 : s.round === 2 ? 6 : 9;
  const rules = activeRules(s, u.owner);
  // Gift of Poxes: this model only
  if (u.abilities.some((a) => a.name === 'Gift of Poxes' && (!m || (a.sheet ?? u.sources[0]) === m.source))) r += 3;
  // Hypervirulent Strains: Death Guard CHARACTER units
  if (rules.includes('Paragons of Putrescence') && (hasKw(u, 'CHARACTER') || alive(u).some((x) => x.isCharacter))) r += 3;
  // Reverberant Rancidity: Death Guard units within 7" of a Plague Legions unit
  if (rules.includes('Tallyband Summoners') && hasAb(u, GIFT) && boardUnits(s, u.owner).some((f) => f.factionKeywords.includes('PLAGUE LEGIONS') && unitDistance(u, f) <= 7 + 1e-6)) r += 3;
  r += timedOn(u, 'contagion'); // Blooming Pestilence
  r += Math.max(0, ...s.units.filter((f) => f.owner === u.owner).map((f) => timedOn(f, 'contagionArmy'))); // Plaguesurge
  return Math.min(12, r);
}

/** Is enemy unit T within Contagion Range of unit u's models? */
export const inContagionOf = (s: GameState, u: UnitState, T: UnitState) =>
  alive(u).some((m) => alive(T).some((n) => baseDist(m, n) <= contagionRange(s, u, m) + 1e-6));

const marked = (T: UnitState, mark: string, by: PlayerId) => (T.timed ?? []).some((t) => t.mark === mark && t.by === by);

/** Is T Afflicted (by the other player's Death Guard)? */
export function isAfflicted(s: GameState, T: UnitState): boolean {
  if (!onBoard(T)) return false;
  const p = other(T.owner);
  if (marked(T, 'Afflicted', p)) return true;
  if (!dgArmy(s, p)) return false;
  if (giftUnits(s, p).some((u) => inContagionOf(s, u, T))) return true;
  const P = s.players[p];
  for (const b of P.blight ?? []) {
    if (b.untilTurn !== undefined && s.turn >= b.untilTurn) continue;
    if (b.objId) {
      const o = s.objectives.find((x) => x.id === b.objId);
      if (o && (b.untilTurn !== undefined || o.controller === p) && unitInRange(s, T, o)) return true;
    }
    const t = b.terrain !== undefined ? s.terrain[b.terrain] : undefined;
    if (t && alive(T).some((n) => circleTouchesPoly(n, n.r + 3, t.poly))) return true;
  }
  // Avatars of Decay: enemy units within 6" of that Plague Legions unit this phase
  if (boardUnits(s, p).some((f) => marked(f, 'Avatars of Decay', p) && unitDistance(f, T) <= 6 + 1e-6)) return true;
  // Visions of Virulence: units enfeebled by the bearer's Pestilent Fallout
  if (marked(T, 'Enfeebled', p) && boardUnits(s, p).some((f) => f.enhancements.some((e) => e.name === 'Visions of Virulence'))) return true;
  return false;
}

/** The army's chosen Plague (Nurgle's Gift, or Manifold Maladies' newest pick). */
export const chosenPlague = (s: GameState, p: PlayerId) => s.players[p].plague;

/** A second Plague picked by an ability: the first one the army has not chosen. */
const otherPlague = (s: GameState, p: PlayerId) => PLAGUE_IDS.find((k) => k !== chosenPlague(s, p)) ?? PLAGUE_IDS[0];

/** Plagues whose effects T has now. */
export function plaguesOn(s: GameState, T: UnitState): string[] {
  const p = other(T.owner);
  const out = new Set<string>();
  if (marked(T, 'All Plagues', p)) PLAGUE_IDS.forEach((k) => out.add(k)); // Death's Heads
  if (!isAfflicted(s, T)) return [...out];
  const P = s.players[p];
  if (P.plague) out.add(P.plague);
  if (P.extraPlague) out.add(P.extraPlague); // Final Ingredient
  // Cornucophagus / Host of the Hybridised Pox: within Contagion Range of that unit
  for (const u of boardUnits(s, p)) {
    if ((u.enhancements.some((e) => e.name === 'Cornucophagus') || marked(u, 'Hybridised Pox', p)) && inContagionOf(s, u, T)) out.add(u.plagueExtra ?? otherPlague(s, p));
  }
  return [...out];
}

/** What Afflicted and the Plagues do to unit u (effects.ts collects these with the unit's other effects). */
export function dgEffects(s: GameState, u: UnitState): { e: Effect; label: string; holder: UnitState }[] {
  if (!onBoard(u)) return [];
  const p = other(u.owner);
  if (!dgArmy(s, p) && !(u.timed ?? []).some((t) => t.by === p && (t.mark === 'Afflicted' || t.mark === 'All Plagues'))) return [];
  const out: { e: Effect; label: string; holder: UnitState }[] = [];
  if (isAfflicted(s, u)) out.push({ e: { toughness: -1 }, label: 'Afflicted', holder: u });
  for (const k of plaguesOn(s, u)) for (const e of PLAGUES[k].effects) out.push({ e, label: PLAGUES[k].name, holder: u });
  return out;
}

/** A Plague was picked (Nurgle's Gift at the start, Manifold Maladies each battle round). */
export function setPlague(s: GameState, p: PlayerId, id: string) {
  if (PLAGUES[id]) s.players[p].plague = id;
}

/** The bot's Plague: Rattlejoint Ague against armoured armies, Skullsquirm Blight against hordes and shooting armies. */
export function botPlague(s: GameState, p: PlayerId): string {
  const foes = s.units.filter((u) => u.owner !== p && u.status !== 'destroyed');
  const goodSave = foes.filter((u) => alive(u).some((m) => m.profile.Sv <= 3)).length;
  return goodSave * 2 >= foes.length ? 'rattlejoint' : 'skullsquirm';
}

// ---------- detachment rules on the clock ----------

/** Start of the battle: Cornucophagus picks its Plague; the bot picks the army's Plague. */
export function dgBattleStart(s: GameState) {
  for (const u of s.units) if (u.enhancements.some((e) => e.name === 'Cornucophagus')) u.plagueExtra = otherPlague(s, u.owner);
}

/** Start of each battle round: Miasmic Bombardment (Mortarion's Hammer). */
export function dgRoundStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!activeRules(s, p).includes('Mortarion’s Hammer')) continue;
    const mine = boardUnits(s, p);
    const far = boardUnits(s, other(p)).filter((e) => mine.every((f) => unitDistance(e, f) > 12 + 1e-6)).sort((a, b) => b.pts - a.pts);
    const n = BATTLE_N[s.players[p].battleSize ?? ''] ?? 2;
    for (const e of far.slice(0, n)) addTimed(s, e, { e: {}, label: 'Miasmic Bombardment', until: 'endOfNextTurn', by: p, mark: 'Afflicted' });
    if (far.length) log(s, `Miasmic Bombardment: ${far.slice(0, n).map((e) => e.name).join(', ')} are Afflicted this battle round`, 'info', p);
  }
}

/** Start of the Command phase of the active player: Deadly Vectors (the Death Guard's opponent), Numberless Horde. */
export function dgCommandStart(s: GameState) {
  const a = s.active;
  const dg = other(a);
  if (activeRules(s, dg).includes('Death Lord’s Chosen')) {
    for (const e of boardUnits(s, a).filter((x) => isAfflicted(s, x))) {
      const r = rollN(s, 2);
      const below = alive(e).length * 2 < e.startingStrength;
      const v = r[0] + r[1] - (below ? 1 : 0);
      if (v > 6) { log(s, `Deadly Vectors: ${e.name} rolled [${r.join('+')}]${below ? ' -1' : ''} = ${v}`, 'roll', dg); continue; }
      const n = rollExpr(s, 'D3').total;
      log(s, `Deadly Vectors: ${e.name} rolled [${r.join('+')}]${below ? ' -1' : ''} = ${v} → ${n} mortal wound(s)`, 'roll', dg);
      applyMortalWounds(s, e, n, 'Deadly Vectors');
    }
  }
  const P = s.players[a];
  const rounds: Record<string, number[]> = { incursion: [2, 3], strike: [2, 3, 4], onslaught: [2, 3, 4, 5] };
  if (activeRules(s, a).includes('Shamblerot Vectorium') && P.poxTemplate && (rounds[P.battleSize ?? ''] ?? rounds.strike).includes(s.round)) {
    const u: UnitState = structuredClone(P.poxTemplate);
    u.id = `pox${s.units.length}`;
    u.models.forEach((m, i) => { m.id = `${u.id}-m${i}`; });
    u.status = 'reserves';
    s.units.push(u);
    log(s, 'Numberless Horde: a new Poxwalkers unit (10 models) waits in Strategic Reserves', 'info', a);
  }
}

/** End of the Command phase: Worldblight (Virulent Vectorium) secures objectives Death Guard units hold. */
export function dgCommandEnd(s: GameState) {
  const p = s.active;
  if (!activeRules(s, p).includes('Virulent Vectorium')) return;
  const P = s.players[p];
  for (const o of s.objectives) {
    if (o.controller !== p || !boardUnits(s, p).some((u) => u.factionKeywords.includes('DEATH GUARD') && unitInRange(s, u, o))) continue;
    o.secured = p;
    P.blight = [...(P.blight ?? []).filter((b) => b.objId !== o.id || b.untilTurn !== undefined), { objId: o.id }];
    log(s, `Worldblight: objective ${o.id} is secured; enemy units in range of it are Afflicted`, 'info', p);
  }
}

/** End of each phase: Grotesque Regeneration (Beasts of Nurgle). */
export function dgPhaseEnd(s: GameState) {
  for (const u of boardUnits(s)) {
    if (!hasAb(u, 'Grotesque Regeneration')) continue;
    for (const m of alive(u)) if (m.wounds < m.profile.W && m.source === 'Beasts of Nurgle') { m.wounds = m.profile.W; log(s, `Grotesque Regeneration: ${m.name} regains all lost wounds`, 'info', u.owner); }
  }
}

// ---------- stratagems and abilities that pick a place ----------

/** Signal Pox: the objective within 30" of the Lord of Virulence with the most enemy points in range; Afflicted until your next turn. */
export function signalPox(s: GameState, u: UnitState, label: string) {
  const near = s.objectives.filter((o) => alive(u).some((m) => dist(m, o) <= 30 + 1e-6));
  const score = (o: (typeof near)[number]) => boardUnits(s, other(u.owner)).filter((e) => unitInRange(s, e, o)).reduce((a, e) => a + e.pts, 0);
  const o = near.sort((a, b) => score(b) - score(a))[0];
  if (!o) { log(s, `${label}: no objective within 30"`, 'info', u.owner); return; }
  const P = s.players[u.owner];
  P.blight = [...(P.blight ?? []), { objId: o.id, untilTurn: s.turn + 2 }];
  log(s, `${label}: enemy units within range of objective ${o.id} are Afflicted until your next turn`, 'info', u.owner);
}

/** Blighted Land: the terrain feature within 24" with the most enemy points within 3"; Afflicted until your next turn. */
export function blightedLand(s: GameState, u: UnitState, label: string) {
  const foes = boardUnits(s, other(u.owner));
  const idx = s.terrain.map((t, i) => ({ t, i })).filter(({ t }) => alive(u).some((m) => circleTouchesPoly(m, 24, t.poly)));
  const score = (i: number) => foes.filter((e) => alive(e).some((n) => circleTouchesPoly(n, n.r + 3, s.terrain[i].poly))).reduce((a, e) => a + e.pts, 0);
  const best = idx.sort((a, b) => score(b.i) - score(a.i))[0];
  if (!best) { log(s, `${label}: no terrain feature within 24"`, 'info', u.owner); return; }
  const P = s.players[u.owner];
  P.blight = [...(P.blight ?? []), { terrain: best.i, untilTurn: s.turn + 2 }];
  log(s, `${label}: enemy units within 3" of ${best.t.label ?? 'that terrain feature'} are Afflicted until your next turn`, 'info', u.owner);
}

/** Eyestinger Storm: every Afflicted enemy unit within range of the objective the vehicle sees with the most of them tests. */
export function eyestingerStorm(s: GameState, u: UnitState, label: string, test: (e: UnitState) => void) {
  const foes = boardUnits(s, other(u.owner)).filter((e) => isAfflicted(s, e));
  const o = [...s.objectives].sort((a, b) => foes.filter((e) => unitInRange(s, e, b)).length - foes.filter((e) => unitInRange(s, e, a)).length)[0];
  const hit = o ? foes.filter((e) => unitInRange(s, e, o)) : [];
  if (!hit.length) { log(s, `${label}: no Afflicted enemy unit within range of an objective`, 'info', u.owner); return; }
  for (const e of hit) test(e);
}

/** Final Ingredient / Host of the Hybridised Pox: the army gains another Plague. */
export function extraPlague(s: GameState, p: PlayerId, label: string) {
  const P = s.players[p];
  P.extraPlague = otherPlague(s, p);
  log(s, `${label}: Afflicted enemy units also have ${PLAGUES[P.extraPlague].name}`, 'info', p);
}

/** Mobile Vector: a lone CHARACTER joins a friendly unit within 2" it can lead (not Battle-shocked, not already led). */
export function attachNear(s: GameState, u: UnitState, label: string) {
  const f = boardUnits(s, u.owner).find((x) => x.id !== u.id && !x.battleShocked && x.sources.length === 1 && (u.leads ?? []).includes(x.sources[0])
    && alive(u).every((m) => alive(x).some((n) => baseDist(m, n) <= 2 + 1e-6)));
  if (!f) { log(s, `${label}: no unit within 2" ${u.name} can lead`, 'info', u.owner); return; }
  for (const m of u.models) m.isBodyguard = false;
  for (const m of f.models) m.isBodyguard = true;
  f.models.push(...u.models);
  f.sources.push(...u.sources);
  f.abilities.push(...u.abilities.map((a) => ({ ...a, model: a.model ?? u.sources[0] })));
  f.enhancements.push(...u.enhancements);
  f.keywords = [...new Set([...f.keywords, ...u.keywords])];
  f.pts += u.pts;
  f.isWarlordUnit ||= u.isWarlordUnit;
  f.startingStrength += u.models.length;
  f.name = `${u.name} + ${f.name}`;
  s.units = s.units.filter((x) => x.id !== u.id);
  log(s, `${label}: ${u.name} now leads ${f.name}`, 'info', u.owner);
}

/** Putrid Detonation: the units its Deadly Demise hurt are Afflicted until the start of your next turn. */
export function putridHit(s: GameState, u: UnitState, v: UnitState) {
  if (u.putrid && v.owner !== u.owner) addTimed(s, v, { e: {}, label: 'Putrid Detonation', until: 'nextTurnStart', by: u.owner, mark: 'Afflicted' });
}

// ---------- movement and placement ----------

/** Deep Strike distance from enemy unit e for a model of u set up at pt: Death Approaches (6" from Afflicted units in
 *  the Movement phase), Beckoning Blight (Plague Legions wholly within 12" of the bearer: 6"). Null: the usual distance. */
export function dsKeep(s: GameState, u: UnitState, e: UnitState, pt: Pt, m: ModelState): number | null {
  if (hasAb(u, 'Death Approaches') && s.phase === 'movement' && isAfflicted(s, e)) return 6;
  if (u.factionKeywords.includes('PLAGUE LEGIONS') && boardUnits(s, u.owner).some((f) => f.enhancements.some((x) => x.name === 'Beckoning Blight') && alive(f).some((n) => dist(pt, n) + m.r <= 12 + 1e-6))) return 6;
  return null;
}

/** Putrefying Stink: enemy models cannot start or end an Advance move within 9" of a Foul Blightspawn. */
export function stinkBlocks(s: GameState, u: UnitState, m: ModelState, from: Pt, to: Pt): boolean {
  const near = (p: Pt, n: ModelState) => dist(p, n) - m.r - n.r <= 9 + 1e-6;
  return boardUnits(s, other(u.owner)).some((e) => hasAb(e, 'Putrefying Stink') && alive(e).some((n) => n.source === 'Foul Blightspawn' && (near(from, n) || near(to, n))));
}

