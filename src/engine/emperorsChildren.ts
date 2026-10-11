// Emperor's Children rules that keep state of their own: the targeting restrictions of Thrill Seekers (army rule) and
// Sensational Performance (Court of the Phoenician): not a unit it was engaged with at the start of the turn, and not a
// unit another unit already charged or attacked this phase; Daemonic Poisons; the Pledges to the Dark Prince (Coterie
// of the Conceited) and the Favoured Champions (Slaanesh's Chosen).
import { activeRules, unitFlags } from './effects';
import { applyMortalWounds } from './attack';
import { d6, rollExpr } from './dice';
import { alive, engagedEnemies, log, onBoard, other, phaseKey, playsItself, unitDistance } from './state';
import type { GameState, PlayerId, UnitState } from './types';

/** Start of each turn: who every unit is engaged with. */
export function snapshotEngaged(s: GameState) {
  for (const u of s.units) if (onBoard(u)) u.startEngaged = { turn: s.turn, ids: engagedEnemies(s, u).map((e) => e.id) };
}

/** A unit charged or attacked another this phase. */
export function noteTarget(s: GameState, by: string, target: string) {
  const key = phaseKey(s);
  if (s.phaseTargets?.key !== key) s.phaseTargets = { key, list: [] };
  s.phaseTargets.list.push([by, target]);
}

/** Why A may not target T under these restrictions (null: it may). */
export function restrictedTarget(s: GameState, A: UnitState, T: UnitState, rule: string): string | null {
  if (A.startEngaged?.turn === s.turn && A.startEngaged.ids.includes(T.id)) return `${rule}: cannot target a unit it was engaged with at the start of the turn`;
  if (s.phaseTargets?.key === phaseKey(s) && s.phaseTargets.list.some(([b, t]) => t === T.id && b !== A.id)) return `${rule}: cannot target a unit another unit already charged or attacked this phase`;
  return null;
}

/** Thrill Seekers: only when the unit Advanced or Fell Back this turn. */
export const thrillBlock = (s: GameState, A: UnitState, T: UnitState): string | null =>
  unitFlags(s, A).thrill && (A.move === 'advance' || A.move === 'fallback') ? restrictedTarget(s, A, T, 'Thrill Seekers') : null;

/** Daemonic Poisons: at the start of each Command phase, each poisoned enemy unit on the battlefield rolls: 4+ D3 mortal wounds. */
export function poisonTick(s: GameState) {
  for (const u of s.units.filter((x) => onBoard(x) && unitFlags(s, x).poisoned)) {
    const r = d6(s);
    if (r < 4) { log(s, `Daemonic Poisons: ${u.name} rolled ${r}`, 'roll', other(u.owner)); continue; }
    const n = rollExpr(s, 'D3').total;
    log(s, `Daemonic Poisons: ${u.name} rolled ${r} → ${n} mortal wound(s)`, 'roll', other(u.owner));
    applyMortalWounds(s, u, n, 'Daemonic Poisons');
  }
}

const warlordOnBoard = (s: GameState, p: PlayerId) => s.units.find((u) => u.owner === p && u.isWarlordUnit && onBoard(u) && alive(u).some((m) => (u.warlordSource ? m.source === u.warlordSource : m.isCharacter)));

// ---------- Coterie of the Conceited: Pledges to the Dark Prince ----------

/** Enemy units destroyed in this battle round (a turn number is the round's first or second turn). */
export const destroyedThisRound = (s: GameState, p: PlayerId) => s.destroyedByTurn.filter((d) => d.owner !== p && Math.floor(d.turn / 2) + 1 === s.round).length;

/** The bot's pledge: how many enemy units it can expect to finish this round (at least 1). */
export function botPledge(s: GameState, p: PlayerId): number {
  const mine = s.units.filter((u) => u.owner === p && onBoard(u));
  const weak = s.units.filter((e) => e.owner !== p && onBoard(e) && mine.some((m) => unitDistance(m, e) <= 18)
    && alive(e).reduce((a, m) => a + m.wounds, 0) <= 8);
  return Math.max(1, Math.min(s.round === 1 ? 1 : 3, Math.floor(weak.length / 2)));
}

/** Start of the battle round: an army with the Coterie of the Conceited pledges (the warlord must be on the battlefield). */
export function pledgeRoundStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!activeRules(s, p).includes('Coterie of the Conceited') || !warlordOnBoard(s, p)) continue;
    if (!playsItself(s, p) && !s.window) { s.window = { kind: 'pledge', player: p, max: 6 }; continue; }
    setPledge(s, p, botPledge(s, p));
  }
}

export function setPledge(s: GameState, p: PlayerId, n: number) {
  if (s.window?.kind === 'pledge' && s.window.player === p) s.window = null;
  const k = Math.max(0, Math.min(6, Math.round(n)));
  s.players[p].pledge = { round: s.round, n: k };
  log(s, `Pledges to the Dark Prince: ${s.players[p].name} pledges ${k} enemy unit(s) destroyed this battle round`, 'info', p);
}

/** Unbound Arrogance: the pledge goes up by 1. */
export function raisePledge(s: GameState, p: PlayerId) {
  const P = s.players[p];
  P.pledge = { round: s.round, n: (P.pledge?.round === s.round ? P.pledge.n : 0) + 1, boosted: true };
  log(s, `Unbound Arrogance: the pledge is now ${P.pledge.n}`, 'info', p);
}

/** End of the battle round: the pledge is kept (Pact points) or broken (the WARLORD suffers D3 mortal wounds). */
export function pledgeRoundEnd(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    if (!P.pledge || P.pledge.round !== s.round) continue;
    const got = destroyedThisRound(s, p);
    if (got >= P.pledge.n) {
      P.pactPoints = (P.pactPoints ?? 0) + P.pledge.n;
      log(s, `Pledges to the Dark Prince: ${got} destroyed ≥ ${P.pledge.n} pledged → +${P.pledge.n} Pact points (${P.pactPoints})`, 'info', p);
    } else {
      const w = warlordOnBoard(s, p);
      const n = rollExpr(s, 'D3').total;
      log(s, `Pledges to the Dark Prince: only ${got} of ${P.pledge.n} destroyed → the Warlord suffers ${n} mortal wound(s)`, 'info', p);
      if (w) applyMortalWounds(s, w, n, 'Pledges to the Dark Prince', undefined, true);
    }
  }
}

// ---------- Slaanesh's Chosen: Favoured Champions ----------

/** Start of the battle: the WARLORD's unit is the army's Favoured Champions. */
export function initFavoured(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!activeRules(s, p).includes('Slaanesh’s Chosen')) continue;
    const w = s.units.find((u) => u.owner === p && u.isWarlordUnit);
    if (w) { s.players[p].favoured = w.id; log(s, `Internal Rivalries: ${w.name} are the Favoured Champions`, 'info', p); }
  }
}

/** An enemy unit was destroyed: the first time in each turn an EC CHARACTER unit does it, it becomes the Favoured Champions. */
export function favouredOnKill(s: GameState, killer: UnitState | undefined) {
  if (!killer || !onBoard(killer)) return;
  const P = s.players[killer.owner];
  if (!activeRules(s, killer.owner).includes('Slaanesh’s Chosen') || P.favouredTurn === s.turn) return;
  if (!killer.factionKeywords.includes('EMPEROR’S CHILDREN') || !alive(killer).some((m) => m.isCharacter)) return;
  P.favouredTurn = s.turn;
  if (P.favoured === killer.id) return;
  P.favoured = killer.id;
  log(s, `Internal Rivalries: ${killer.name} become the Favoured Champions`, 'info', killer.owner);
}

// ---------- Court of the Phoenician: Sensational Performance ----------

/** The unit used Sensational Performance this phase: these targets are off limits. */
export const sensationalBlock = (s: GameState, A: UnitState, T: UnitState): string | null =>
  unitFlags(s, A).sensational ? restrictedTarget(s, A, T, 'Sensational Performance') : null;

/** Worth using Sensational Performance: an engaged enemy unit it may still attack. */
export const sensationalOk = (s: GameState, A: UnitState) => engagedEnemies(s, A).some((e) => !restrictedTarget(s, A, e, ''));
