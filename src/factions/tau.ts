// T’au Empire army rule For the Greater Good. Observer units mark one visible enemy unit each as Spotted; units with
// the ability (excluding Observers) are Guided while targeting a Spotted unit: +1 BS, and [IGNORES COVER] when the
// Observer has MARKERLIGHT. The Observer is picked for the player when a Guided shot is made (the best one that can
// see the target), so a shot only becomes Guided when some unit could have spotted it.
// Detachment rules, enhancements, datasheet abilities and stratagems are data.
import { alive, boardUnits, hasKw, log, onBoard, playsItself, pushFx, unitById } from '../engine/state';
import { unitInRange, zonePoly } from '../engine/missions';
import { polyCentroid } from '../engine/geometry';
import type { GameState, PlayerId, UnitState } from '../engine/types';
import { modelVisible } from '../engine/visibility';

type Spot = NonNullable<GameState['ftggPairs']>[number];

export const isTauArmy = (s: GameState, p: PlayerId) => !!s.players[p]?.armyRules?.some((r) => r.name === 'For the Greater Good');
export const hasFtgg = (u: UnitState) => u.abilities.some((a) => a.name === 'For the Greater Good');
export const hasMarkerlight = (u: UnitState) => u.keywords.includes('MARKERLIGHT');
const has = (u: UnitState, n: string) => u.abilities.some((a) => a.name === n);

const spotsNow = (s: GameState) => (s.ftggPairs ?? []).filter((p) => p.turn === s.turn && p.phase === s.phase);
export const spotOf = (s: GameState, T: UnitState): Spot | undefined => spotsNow(s).find((p) => p.spottedId === T.id);
export const isObserver = (s: GameState, u: UnitState) => spotsNow(s).some((p) => p.observerId === u.id);

/** Can this unit still become an Observer this phase (not shot yet, not Battle-shocked, not a FORTIFICATION)? */
export function canBeObserver(s: GameState, u: UnitState): boolean {
  return onBoard(u) && hasFtgg(u) && !u.battleShocked && !hasKw(u, 'FORTIFICATION') && u.shotTurn !== s.turn && !isObserver(s, u);
}

const sees = (s: GameState, o: UnitState, t: UnitState) => alive(o).some((m) => alive(t).some((n) => modelVisible(s, m, t, n)));

/** The Observer that spots T for A's shot: the one already spotting it, else the best free one that can see it
 *  (Pathfinders with Target Uploaded spot for themselves; then Forward Observers, MARKERLIGHT, the cheapest). */
export function observerFor(s: GameState, A: UnitState, T: UnitState): UnitState | undefined {
  if (s.phase !== 'shooting' || s.active !== A.owner || !isTauArmy(s, A.owner)) return undefined;
  const sp = spotOf(s, T);
  if (sp) return unitById(s, sp.observerId);
  if (has(A, 'Target Uploaded') && canBeObserver(s, A) && sees(s, A, T)) return A;
  if (!hasFtgg(A) || isObserver(s, A)) return undefined;
  const score = (u: UnitState) => (has(u, 'Forward Observers') ? 1000 : 0) + (hasMarkerlight(u) ? 500 : 0) - u.pts;
  return boardUnits(s, A.owner).filter((u) => u.id !== A.id && canBeObserver(s, u) && sees(s, u, T)).sort((a, b) => score(b) - score(a))[0];
}

/** A's attacks on T: Guided against a Spotted unit (or its own Spotted unit, for Target Uploaded). */
export function ftggMods(s: GameState, A: UnitState, T: UnitState) {
  const o = observerFor(s, A, T);
  if (!o) return null;
  if (o.id === A.id) return has(A, 'Target Uploaded') ? { skillBonus: 1, ignoresCover: true, notes: ['Target Uploaded: +1 BS, [IGNORES COVER]'] } : null;
  if (!hasFtgg(A) || isObserver(s, A)) return null;
  const fo = has(o, 'Forward Observers');
  return {
    skillBonus: 1, ignoresCover: hasMarkerlight(o), rerollHits1: fo, rerollWounds1: fo,
    notes: [`For the Greater Good (${o.name}): +1 BS${hasMarkerlight(o) ? ', [IGNORES COVER]' : ''}${fo ? ', re-roll 1s' : ''}`],
  };
}

/** Is A Guided against T right now (detachment rules and abilities ask: Kauyon, Mont’ka, Coordinated Strike)? */
export function guidedVs(s: GameState, A: UnitState, T: UnitState): boolean {
  const o = observerFor(s, A, T);
  return !!o && o.id !== A.id && hasFtgg(A) && !isObserver(s, A);
}

/** The shot is made: the Observer marks the target as Spotted for the rest of the phase. */
export function ftggTargetChosen(s: GameState, A: UnitState, T: UnitState) {
  if (spotOf(s, T)) return;
  const o = observerFor(s, A, T);
  if (!o) return;
  (s.ftggPairs ??= []).push({ guidedId: A.id, observerId: o.id, spottedId: T.id, turn: s.turn, phase: s.phase });
  log(s, `[Greater Good] For the Greater Good: ${o.name} marks ${T.name} as Spotted${o.id === A.id ? '' : ` for ${A.name}`}`, 'info', A.owner);
  const m = alive(o)[0];
  if (m) pushFx(s, { kind: 'skill', unitId: o.id, owner: o.owner, at: { x: m.x, y: m.y }, name: 'For the Greater Good', who: `Spotting ${T.name}`, style: 'holy', epic: false });
}

// ---------- Strategic Conqueror (enhancement): before the first turn the army picks one objective marker; friendly T'AU EMPIRE models in range of it have +1 OC while the bearer lives ----------

const bearer = (s: GameState, p: PlayerId) => s.units.some((u) => u.owner === p && u.status !== 'destroyed' && alive(u).length && u.enhancements.some((e) => e.name === 'Strategic Conqueror'));

/** The bot's pick: the objective outside its zone that is closest to its own units (a field objective, not home). */
export function botConqueror(s: GameState, p: PlayerId): string {
  const mine = s.units.filter((u) => u.owner === p && u.status !== 'destroyed' && alive(u).length);
  const c = mine.length ? polyCentroid(mine.flatMap(alive)) : polyCentroid(zonePoly(s, p));
  const field = s.objectives.filter((o) => o.type !== 'home');
  const pool = field.length ? field : s.objectives;
  return pool.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a)).id;
}

export function setConqueror(s: GameState, p: PlayerId, objId: string) {
  if (s.window?.kind === 'conqueror' && s.window.player === p) s.window = null;
  s.players[p].conqueror = objId;
  log(s, `Strategic Conqueror: ${s.players[p].name} picks objective ${s.objectives.findIndex((o) => o.id === objId) + 1}`, 'info', p);
}

/** Start of the battle: each army with the enhancement picks (a person is asked, a bot picks by itself). */
export function conquerorStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!bearer(s, p)) continue;
    if (!playsItself(s, p) && !s.window) { s.window = { kind: 'conqueror', player: p }; continue; }
    setConqueror(s, p, botConqueror(s, p));
  }
}

/** Is this unit in range of the objective its army picked, with the bearer alive? */
export function nearConqueror(s: GameState, u: UnitState): boolean {
  const id = s.players[u.owner].conqueror;
  const o = id ? s.objectives.find((x) => x.id === id) : undefined;
  return !!o && bearer(s, u.owner) && unitInRange(s, u, o);
}
