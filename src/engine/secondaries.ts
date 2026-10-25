// Chapter Approved 2026-27 secondary missions, scored automatically from the board state.
import { MISSIONS, secondaryById, toPoly, deploymentById, type SecondaryRule } from './config';
import { bodyTouchesPoly, bodyWhollyInPoly, circleTouchesPoly, circleWhollyInPoly, dist, gap, pointInPoly, ptGap } from './geometry';
import { territoryPoly, unitInRange, zonePoly } from './missions';
import { pushFx, alive, boardUnits, hasKw, log, onBoard, other, tableH, tableW, unitById } from './state';
import type { GameState, PlayerId, UnitState } from './types';

const centreOf = (s: GameState) => ({ x: tableW(s) / 2, y: tableH(s) / 2 });

const counts = (u: UnitState) => !u.battleShocked && !hasKw(u, 'AIRCRAFT');
const whollyIn = (u: UnitState, poly: { x: number; y: number }[]) => alive(u).every((m) => bodyWhollyInPoly(m, poly));
const inNML = (s: GameState, u: UnitState) => {
  const za = zonePoly(s, 0), zb = zonePoly(s, 1);
  return alive(u).every((m) => !bodyTouchesPoly(m, 0, za) && !bodyTouchesPoly(m, 0, zb));
};
const objInNML = (s: GameState, o: { x: number; y: number }) => !pointInPoly(o, zonePoly(s, 0)) && !pointInPoly(o, zonePoly(s, 1));

/** Table quarters where the player has a presence (units wholly within a quarter, none within 6" of the centre). */
export function presenceQuarters(s: GameState, p: PlayerId): number {
  const W = tableW(s), H = tableH(s);
  const qs = new Set<number>();
  for (const u of boardUnits(s, p)) {
    if (!counts(u)) continue;
    const ms = alive(u);
    if (ms.some((m) => ptGap(m, centreOf(s)) <= 6)) continue;
    const q = (m: { x: number; y: number }) => (m.x < W / 2 ? 0 : 1) + (m.y < H / 2 ? 0 : 2);
    const q0 = q(ms[0]);
    if (ms.every((m) => q(m) === q0 && Math.abs(m.x - W / 2) >= m.r && Math.abs(m.y - H / 2) >= m.r)) qs.add(q0);
  }
  return qs.size;
}

function cond(s: GameState, p: PlayerId, c: string): number {
  const W = tableW(s), H = tableH(s);
  const e = other(p);
  const killsThisTurn = s.destroyedByTurn.filter((d) => d.turn === s.turn && d.owner === e);
  const deaths = (s.modelDeaths ?? []).filter((d) => d.turn === s.turn && d.owner === e);
  const snap = s.turnStart && s.turnStart.turn === s.turn ? s.turnStart : null;
  const S = s.players[p].sec;
  switch (c) {
    case 'perEnemyDestroyed': return killsThisTurn.length;
    case 'perEnemyStartedOnObjDestroyed': return killsThisTurn.filter((d) => snap?.inRangeObj.includes(d.unitId)).length;
    case 'plunderedThisTurn': return S.plundered.some((x) => x.turn === s.turn) ? 1 : 0;
    case 'moreUnitsInNML': {
      const n = (q: PlayerId) => boardUnits(s, q).filter((u) => counts(u) && inNML(s, u)).length;
      return n(p) > n(e) ? 1 : 0;
    }
    case 'outflank': {
      const terr = territoryPoly(s, p);
      const near = (u: UnitState) => {
        const ms = alive(u);
        const edges: string[] = [];
        if (ms.some((m) => m.x - m.r <= 6)) edges.push('L');
        if (ms.some((m) => W - m.x - m.r <= 6)) edges.push('R');
        if (ms.some((m) => m.y - m.r <= 6)) edges.push('T');
        if (ms.some((m) => H - m.y - m.r <= 6)) edges.push('B');
        return edges;
      };
      const outside = (u: UnitState) => !alive(u).every((m) => pointInPoly(m, terr));
      const us = boardUnits(s, p).filter(counts);
      const lvl1 = us.some((u) => near(u).length && outside(u));
      let lvl2 = false;
      for (const a of us) for (const b of us) {
        if (a === b) continue;
        const ea = near(a), eb = near(b);
        const opp = (ea.includes('L') && eb.includes('R')) || (ea.includes('T') && eb.includes('B'));
        if (opp && (outside(a) || outside(b))) lvl2 = true;
      }
      return lvl2 ? 2 : lvl1 ? 1 : 0;
    }
    case 'beacon': {
      const u = S.beacon ? s.units.find((x) => x.id === S.beacon) : undefined;
      if (!u || !onBoard(u)) return 0;
      if (!alive(u).some((m) => pointInPoly(m, territoryPoly(s, p)))) return 2;
      if (!alive(u).some((m) => pointInPoly(m, zonePoly(s, p)))) return 1;
      return 0;
    }
    case 'cleansedThisTurn': return S.cleansed.filter((x) => x.turn === s.turn).length;
    case 'perBigUnitDestroyed': return killsThisTurn.filter((d) => (s.units.find((u) => u.id === d.unitId)?.startingStrength ?? 0) >= 13).length;
    case 'bigUnitDestroyed': return cond(s, p, 'perBigUnitDestroyed') ? 1 : 0;
    case 'controlOwnHome': return s.objectives.some((o) => o.type === 'home' && o.owner === p && o.controller === p) ? 1 : 0;
    case 'noEnemyInOwnZone': { const z = zonePoly(s, p); return boardUnits(s, e).some((u) => alive(u).some((m) => pointInPoly(m, z))) ? 0 : 1; }
    case 'quarters': return presenceQuarters(s, p);
    case 'controlNML2': return s.objectives.filter((o) => o.controller === p && !(o.type === 'home' && o.owner === p) && objInNML(s, o)).length >= 2 ? 1 : 0;
    case 'forwardPosition': {
      const home = s.objectives.some((o) => o.type === 'home' && o.owner === e && o.controller === p);
      const exp = s.objectives.filter((o) => o.type === 'expansion');
      return home || (exp.length > 0 && exp.every((o) => o.controller === p)) ? 1 : 0;
    }
    case 'centreGround': {
      const near = (q: PlayerId, r: number) => boardUnits(s, q).some((u) => alive(u).some((m) => ptGap(m, centreOf(s)) <= r));
      const mine = boardUnits(s, p).some((u) => counts(u) && alive(u).some((m) => ptGap(m, centreOf(s)) <= 3));
      if (!mine) return 0;
      return !near(e, 6) ? 2 : !near(e, 3) ? 1 : 0;
    }
    case 'characterKillsVP': return deaths.filter((d) => d.character).reduce((a, d) => a + 3 + (d.W >= 4 ? 1 : 0), 0);
    case 'characterDiedOrAllDead': {
      if (deaths.some((d) => d.character)) return 1;
      const chars = s.units.filter((u) => u.owner === e).flatMap((u) => u.models).filter((m) => m.isCharacter || m.keywords.includes('CHARACTER'));
      return chars.length && chars.every((m) => m.dead) ? 1 : 0;
    }
    case 'controlTemptingTarget': return S.temptingTarget && s.objectives.find((o) => o.id === S.temptingTarget)?.controller === p ? 1 : 0;
    case 'perUnitInEnemyZone': { const z = zonePoly(s, e); return boardUnits(s, p).filter((u) => counts(u) && whollyIn(u, z)).length; }
    case 'perBigModelDestroyed': return deaths.filter((d) => d.W >= 10).length;
    case 'bigModelDestroyed': return deaths.some((d) => d.W >= 10) ? 1 : 0;
    case 'perGuarded': return S.guards.filter((g) => {
      const o = s.objectives.find((x) => x.id === g.objId);
      const u = s.units.find((x) => x.id === g.unitId);
      return o && u && onBoard(u) && o.controller === p && unitInRange(s, u, o);
    }).length;
    default: return 0;
  }
}

function ruleVP(s: GameState, p: PlayerId, r: SecondaryRule): number {
  const n = cond(s, p, r.condition);
  let vp = 0;
  if (r.tiers) { for (const [min, v] of r.tiers) if (n >= min) vp = v; } else vp = n * r.vp;
  if (vp && r.bonus) vp += cond(s, p, r.bonus.condition) * r.bonus.vp;
  if (r.cap) vp = Math.min(vp, r.cap);
  return vp;
}

/** Bank VP from a secondary, respecting the 15 per round / 45 total / 20 per Fixed card caps. Tactical cards are discarded once scored. */
export function bankSecondary(s: GameState, p: PlayerId, id: string, vp: number): number {
  const P = s.players[p];
  const caps = MISSIONS.vpCaps;
  let gain = Math.min(vp, caps.secondaryPerRound - P.secByRound[s.round], caps.secondaryTotal - P.secVp);
  if (P.secMode === 'fixed') gain = Math.min(gain, caps.fixedPerCard - (P.secFixedVp[id] ?? 0));
  gain = Math.max(0, gain);
  P.secVp += gain;
  P.secByRound[s.round] += gain;
  if (P.secMode === 'fixed') P.secFixedVp[id] = (P.secFixedVp[id] ?? 0) + gain;
  else P.secActive = P.secActive.filter((x) => x !== id);
  log(s, `${P.name} +${gain} VP (Secondary: ${secondaryById(id).name})`, 'vp', p);
  return gain;
}

/** Called at the end of every turn (after the primary). */
export function scoreSecondaries(s: GameState, lastTurnOfBattle: boolean) {
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    if (P.secMode === 'none') continue;
    const mine = s.active === p;
    for (const id of [...P.secActive]) {
      const def = secondaryById(id);
      let total = 0;
      for (const r of def.auto) {
        if (r.mode !== 'both' && r.mode !== P.secMode) continue;
        if (s.round < r.fromRound) continue;
        const on = r.trigger === 'endOfAnyTurn' || (r.trigger === 'endOfYourTurn' && mine) || (r.trigger === 'endOfOpponentTurn' && (!mine || (r.orEndOfRound5 && lastTurnOfBattle)));
        if (!on) continue;
        total += ruleVP(s, p, r);
      }
      if (total > 0) bankSecondary(s, p, id, total);
    }
  }
}

/** "When drawn" effects and redraws. Returns false if the card should go back into the deck. */
function onDrawn(s: GameState, p: PlayerId, id: string): boolean {
  const def = secondaryById(id);
  const P = s.players[p];
  const e = other(p);
  if (def.round1Redraw && s.round === 1) return false;
  if (def.redrawIf && P.secActive.includes(def.redrawIf)) return false;
  if (def.redrawIfNo === 'ss13' && !boardUnits(s, e).some((u) => u.startingStrength >= 13)) return false;
  if (def.redrawIfNo === 'w10' && !boardUnits(s, e).some((u) => alive(u).some((m) => m.profile.W >= 10))) return false;
  if (def.whenDrawn === 'beacon') {
    const cands = s.units.filter((u) => u.owner === p && (onBoard(u) || u.status === 'embarked'));
    const best = cands.sort((a, b) => (alive(b)[0]?.profile.M ?? 0) - (alive(a)[0]?.profile.M ?? 0))[0];
    if (best) { P.sec.beacon = best.id; log(s, `Beacon: ${best.name}`, 'info', p); }
  }
  if (def.whenDrawn === 'tempting-target') {
    // the opponent picks the No Man's Land objective hardest for us to reach
    const myC = boardUnits(s, p).flatMap(alive);
    const cands = s.objectives.filter((o) => o.type !== 'home' && objInNML(s, o));
    const far = (o: { x: number; y: number }) => myC.length ? Math.min(...myC.map((m) => dist(m, o))) : 0;
    const pick = cands.sort((a, b) => far(b) - far(a))[0];
    if (pick) { P.sec.temptingTarget = pick.id; log(s, `A Tempting Target: ${s.players[e].name} selects objective ${s.objectives.indexOf(pick) + 1}`, 'info', p); }
  }
  if (def.whenDrawn === 'guard') assignGuards(s, p);
  return true;
}

/** Burden of Trust: for each objective, a friendly unit within range guards it. */
export function assignGuards(s: GameState, p: PlayerId) {
  const P = s.players[p];
  const used = new Set<string>();
  P.sec.guards = [];
  for (const o of s.objectives) {
    const u = boardUnits(s, p).find((x) => !used.has(x.id) && unitInRange(s, x, o));
    if (u) { used.add(u.id); P.sec.guards.push({ objId: o.id, unitId: u.id }); }
  }
}

/** Tactical: draw up to two active cards at the start of your Command phase. */
export function drawUpTo(s: GameState, p: PlayerId, n = 2) {
  const P = s.players[p];
  if (P.secMode !== 'tactical') return;
  let guard = 0;
  const drawn: string[] = [];
  while (P.secActive.length < n && P.secDeck.length && guard++ < 40) {
    const id = P.secDeck.shift()!;
    if (!onDrawn(s, p, id)) {
      // shuffle back in (bottom of the deck) and draw again
      P.secDeck.push(id);
      log(s, `${P.name} drew ${secondaryById(id).name} and shuffled it back (When Drawn)`, 'info', p);
      continue;
    }
    P.secActive.push(id);
    drawn.push(id);
    log(s, `${P.name} draws Secondary Mission: ${secondaryById(id).name}`, 'info', p);
  }
  if (drawn.length) pushFx(s, { kind: 'cards', owner: p, ids: drawn });
  if (P.secActive.includes('burden-of-trust')) assignGuards(s, p);
}

/** VP the card would give if the turn ended now (its scoring checked against the board as it stands). */
export function secondaryPreview(s: GameState, p: PlayerId, id: string): number {
  const P = s.players[p];
  let total = 0;
  for (const r of secondaryById(id).auto) {
    if (r.mode !== 'both' && r.mode !== P.secMode) continue;
    if (s.round < r.fromRound) continue;
    total += ruleVP(s, p, r);
  }
  return total;
}

/** What a card wants on the table, for the board to show: objectives, units, areas and a short "what to do". */
export interface SecondaryGoal {
  id: string;
  name: string;
  todo: string;
  objectives: string[];
  units: string[];
  areas: { x: number; y: number }[][];
  circles: { x: number; y: number; r: number }[];
}

export function secondaryGoal(s: GameState, p: PlayerId, id: string): SecondaryGoal {
  const W = tableW(s), H = tableH(s);
  const def = secondaryById(id);
  const e = other(p);
  const S = s.players[p].sec;
  const g: SecondaryGoal = { id, name: def.name, todo: def.text, objectives: [], units: [], areas: [], circles: [] };
  const nml = s.objectives.filter((o) => objInNML(s, o));
  const foes = boardUnits(s, e);
  switch (id) {
    case 'no-prisoners': g.todo = 'Destroy enemy units'; g.units = foes.map((u) => u.id); break;
    case 'overwhelming-force': g.todo = 'Destroy enemy units within range of objectives'; g.units = foes.filter((u) => s.objectives.some((o) => unitInRange(s, u, o))).map((u) => u.id); break;
    case 'plunder': case 'cleanse': g.todo = id === 'plunder' ? 'Perform the Plunder action on objectives' : 'Perform the Cleanse action on objectives'; g.objectives = s.objectives.map((o) => o.id); break;
    case 'display-of-might': g.todo = 'Have more units than your opponent in No Man\'s Land'; g.objectives = nml.map((o) => o.id); break;
    case 'outflank': g.todo = 'Have units within 6" of a battlefield edge outside your deployment zone'; g.areas = [[{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: H }, { x: 0, y: H }], [{ x: W - 6, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: W - 6, y: H }]]; break;
    case 'beacon': g.todo = 'Get the Beacon unit out of your deployment zone'; if (S.beacon) g.units = [S.beacon]; g.areas = [zonePoly(s, p)]; break;
    case 'a-grievous-blow': g.todo = 'Destroy an enemy unit with a Starting Strength of 13+'; g.units = foes.filter((u) => u.startingStrength >= 13).map((u) => u.id); break;
    case 'defend-stronghold': g.todo = 'Control your home objective'; g.objectives = s.objectives.filter((o) => o.type === 'home' && o.owner === p).map((o) => o.id); break;
    case 'engage-on-all-fronts': g.todo = 'Have units in 3–4 table quarters (more than 6" from the centre)'; g.circles = [{ ...centreOf(s), r: 6 }]; break;
    case 'secure-no-mans-land': g.todo = 'Control 2 objectives in No Man\'s Land'; g.objectives = nml.filter((o) => !(o.type === 'home' && o.owner === p)).map((o) => o.id); break;
    case 'forward-position': g.todo = 'Control the enemy home objective or all expansion objectives'; g.objectives = s.objectives.filter((o) => (o.type === 'home' && o.owner === e) || o.type === 'expansion').map((o) => o.id); break;
    case 'centre-ground': g.todo = 'Have a unit within 3" of the centre (no enemy within 6")'; g.circles = [{ ...centreOf(s), r: 3 }, { ...centreOf(s), r: 6 }]; break;
    case 'assassination': g.todo = 'Destroy enemy CHARACTER models'; g.units = foes.filter((u) => alive(u).some((m) => m.isCharacter)).map((u) => u.id); break;
    case 'a-tempting-target': g.todo = 'Control the objective your opponent selected'; if (S.temptingTarget) g.objectives = [S.temptingTarget]; break;
    case 'behind-enemy-lines': g.todo = 'Get units wholly within the enemy deployment zone'; g.areas = [zonePoly(s, e)]; break;
    case 'bring-it-down': g.todo = 'Destroy enemy models with 10+ Wounds'; g.units = foes.filter((u) => alive(u).some((m) => m.profile.W >= 10)).map((u) => u.id); break;
    case 'burden-of-trust': g.todo = "Guarding units stay on their objectives until the end of your opponent's turn"; g.objectives = S.guards.map((x) => x.objId); g.units = S.guards.map((x) => x.unitId); break;
  }
  return g;
}

/**
 * A tactical card that cannot score any more: nothing left to kill for it, or no unit near enough to get where it
 * wants. Worth discarding (+1CP in your turn) or swapping.
 */
export function secondaryDead(s: GameState, p: PlayerId, id: string): boolean {
  const g = secondaryGoal(s, p, id);
  if (['assassination', 'bring-it-down', 'a-grievous-blow'].includes(id)) return g.units.length === 0;
  if (id === 'behind-enemy-lines') {
    const z = zonePoly(s, other(p));
    const reach = (u: UnitState) => (alive(u)[0]?.profile.M ?? 0) + 6;
    return !boardUnits(s, p).some((u) => alive(u).some((m) => pointInPoly(m, z) || z.some((q) => dist(m, q) <= reach(u))));
  }
  if (id === 'a-tempting-target' || id === 'beacon') return g.objectives.length + g.units.length === 0;
  return false;
}

export const unitName = (s: GameState, id?: string) => (id ? unitById(s, id).name : '—');
export { toPoly, deploymentById };

/**
 * A rough chance (0..1) that a tactical card scores at the end of this turn, from where the armies stand: units able
 * to reach the place the card wants, enemy units of the kind it wants destroyed within reach. The bot discards the
 * cards it won't score this turn (+1CP) so a fresh card is drawn instead of holding a dead one.
 */
export function secondaryChance(s: GameState, p: PlayerId, id: string): number {
  const W = tableW(s), H = tableH(s);
  if (secondaryDead(s, p, id)) return 0;
  const e = other(p);
  const mine = boardUnits(s, p).filter(counts);
  const foes = boardUnits(s, e);
  const M = (u: UnitState) => Math.max(0, ...alive(u).map((m) => m.profile.M ?? 0));
  const unitGap = (a: UnitState, b: UnitState) => Math.min(...alive(a).flatMap((m) => alive(b).map((n) => gap(m, n))));
  // within a move plus the unit's longest gun (or a charge for units without guns)
  const range = (u: UnitState) => Math.max(8, ...alive(u).flatMap((m) => m.weapons.flatMap((w) => w.profiles.map((pr) => (typeof pr.range === 'number' ? pr.range : Number(pr.range) || 0)))));
  const reachUnit = (t: UnitState) => mine.some((u) => unitGap(u, t) <= M(u) + range(u));
  const reachPt = (pt: { x: number; y: number }, extra = 3) => mine.some((u) => alive(u).some((m) => dist(m, pt) <= M(u) + extra));
  const g = secondaryGoal(s, p, id);
  switch (id) {
    case 'no-prisoners': return foes.length ? 0.8 : 0;
    case 'overwhelming-force': return g.units.some((x) => reachUnit(unitById(s, x))) ? 0.6 : 0.15;
    case 'assassination': case 'bring-it-down': case 'a-grievous-blow':
      return g.units.some((x) => reachUnit(unitById(s, x))) ? 0.45 : 0.05;
    case 'behind-enemy-lines': { const z = zonePoly(s, e); return mine.some((u) => alive(u).some((m) => pointInPoly(m, z) || z.some((q) => dist(m, q) <= M(u) + 2))) ? 0.45 : 0.1; }
    case 'outflank': { const terr = territoryPoly(s, p); return mine.some((u) => alive(u).some((m) => !pointInPoly(m, terr) && Math.min(m.x, m.y, W - m.x, H - m.y) <= 6 + M(u))) ? 0.6 : 0.15; }
    case 'display-of-might': { const n = (q: PlayerId) => boardUnits(s, q).filter((u) => counts(u) && inNML(s, u)).length; return n(p) + 1 >= n(e) ? 0.6 : 0.2; }
    case 'engage-on-all-fronts': return presenceQuarters(s, p) >= 2 ? 0.6 : 0.25;
    case 'centre-ground': return reachPt(centreOf(s)) && !foes.some((u) => alive(u).some((m) => dist(m, centreOf(s)) <= 6)) ? 0.5 : 0.15;
    case 'secure-no-mans-land': return g.objectives.filter((oid) => { const o = s.objectives.find((x) => x.id === oid)!; return o.controller === p || reachPt(o); }).length >= 2 ? 0.6 : 0.15;
    case 'forward-position': return g.objectives.some((oid) => { const o = s.objectives.find((x) => x.id === oid)!; return o.type === 'home' && (o.controller === p || reachPt(o)); }) ? 0.4 : 0.1;
    case 'plunder': case 'cleanse': return s.objectives.some((o) => reachPt(o, 1)) ? 0.7 : 0.2;
    case 'defend-stronghold': return s.objectives.some((o) => o.type === 'home' && o.owner === p && o.controller === p) ? 0.85 : 0.3;
    default: return 0.5;
  }
}
