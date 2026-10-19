// Genestealer Cults army rule Cult Ambush: Resurgence points, destroyed units coming back into Cult Ambush,
// Cult Ambush markers and the units arriving at them (Faction Pack). Datasheet abilities and detachment rules
// are data (data/abilities/GC.json, data/detachment-rules.json).
import { setBackUp } from '../rules-engine/activations';
import { addTimed } from '../rules-engine/effects';
import { RULES } from '../engine/config';
import { dist } from '../engine/geometry';
import { rollN } from '../engine/dice';
import { alive, boardUnits, canUseStratagem, hasKw, log, other, pushFx, spendStratagem } from '../engine/state';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

export function isCultArmy(s: GameState, p: PlayerId): boolean {
  return !!s.players[p]?.armyRules?.some((r) => r.name === 'Cult Ambush');
}

const POINTS: Record<string, number> = { incursion: 6, 'strike-force': 10, strike: 10, onslaught: 14 };

/** Resurgence points to bring a destroyed unit back: by datasheet and Starting Strength (without attached characters). */
const COST: [RegExp, Record<number, number>][] = [
  [/aberrant/i, { 5: 4, 10: 8 }],
  [/acolyte hybrid|hybrid metamorph/i, { 5: 2, 10: 4 }],
  [/atalan jackal/i, { 5: 2, 10: 6 }],
  [/neophyte hybrid/i, { 10: 3, 20: 6 }],
  [/purestrain genestealer/i, { 5: 2, 10: 6 }],
];
export function cultAmbushCost(u: UnitState): number | null {
  const body = u.models.filter((m) => !m.isCharacter);
  const row = COST.find(([re]) => re.test(u.sources[0] ?? u.name));
  if (!row) return null;
  const n = body.length;
  const sizes = Object.keys(row[1]).map(Number).sort((a, b) => a - b);
  return row[1][sizes.find((k) => n <= k) ?? sizes[sizes.length - 1]];
}

export function cultBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    if (!isCultArmy(s, p) || P.resurgencePoints !== undefined) continue;
    P.resurgencePoints = POINTS[P.battleSize ?? ''] ?? 10;
    if (s.units.some((u) => u.owner === p && u.enhancements?.some((e) => e.name === 'Deeds That Speak to the Masses'))) P.resurgencePoints += 2;
    P.cultAmbushMarkers = [];
    log(s, `Cult Ambush: ${P.name} starts with ${P.resurgencePoints} Resurgence points`, 'info', p);
  }
}

/** A place for a Cult Ambush marker more than 9" from every enemy unit: the one closest to the enemy's objectives. */
function markerSpot(s: GameState, p: PlayerId, near?: UnitState): Pt | null {
  const foes = boardUnits(s, other(p)).flatMap(alive);
  const W = RULES.battlefield.width, H = RULES.battlefield.height;
  let best: { at: Pt; score: number } | null = null;
  for (let x = 2; x <= W - 2; x += 2) for (let y = 2; y <= H - 2; y += 2) {
    const at = { x, y };
    if (foes.some((m) => dist(m, at) - m.r <= 9 + 1e-6)) continue;
    if (near && !alive(near).some((m) => dist(m, at) + m.r <= 6)) continue;
    const obj = Math.min(...s.objectives.filter((o) => o.controller !== p).map((o) => dist(o, at)), 99);
    const foe = foes.length ? Math.min(...foes.map((m) => dist(m, at))) : 99;
    const score = obj + foe * 0.25;
    if (!best || score < best.score) best = { at, score };
  }
  return best?.at ?? null;
}

/** A unit destroyed: if it has Cult Ambush and the points are there, an identical unit waits in Cult Ambush and a marker is placed. */
export function cultAmbushUnitDestroyed(s: GameState, u: UnitState) {
  const P = s.players[u.owner];
  if (!isCultArmy(s, u.owner) || !u.abilities.some((a) => a.name === 'Cult Ambush')) return;
  const cost = cultAmbushCost(u);
  if (cost === null || (P.resurgencePoints ?? 0) < cost) return;
  P.resurgencePoints = (P.resurgencePoints ?? 0) - cost;
  toCultAmbush(s, u, `spends ${cost} Resurgence points (${P.resurgencePoints} left)`);
}

/** The destroyed unit comes back as a new one in Cult Ambush (Starting Strength, without its attached characters) and a marker is placed. */
export function toCultAmbush(s: GameState, u: UnitState, why: string) {
  const P = s.players[u.owner];
  u.models = u.models.filter((m) => !m.isCharacter);
  u.sources = [u.sources[0]];
  for (const m of u.models) { m.dead = false; m.wounds = m.profile.W; }
  u.weaponsFired = [];
  u.oneShotUsed = [];
  u.status = 'reserves';
  u.cultAmbush = true;
  u.battleShocked = false;
  s.destroyedByTurn = (s.destroyedByTurn ?? []).filter((d) => d.unitId !== u.id || d.turn !== s.turn);
  const at = markerSpot(s, u.owner);
  if (at) (P.cultAmbushMarkers ??= []).push(at);
  log(s, `Cult Ambush: ${P.name} ${why} — ${u.name} waits in Cult Ambush${at ? `, marker at (${at.x.toFixed(0)}, ${at.y.toFixed(0)})` : ' (no room for a marker)'}`, 'info', u.owner);
}

/** Stratagems that move a marker an enemy unit came near instead of losing it (the last one needs an ASTRA MILITARUM VEHICLE). */
const MARKER_STRATS: { id: string; name: string; vehicle?: boolean }[] = [
  { id: '000009076002', name: 'Evasive Vanguard' }, { id: '000009080002', name: 'Along Shadowed Trails' }, { id: '000009085002', name: 'In the Shadow of Iron', vehicle: true },
];
function saveMarker(s: GameState, p: PlayerId): Pt | null {
  const P = s.players[p];
  for (const st of MARKER_STRATS) {
    if (!P.detachments?.some((d) => d.stratagems?.some((x) => x.id === st.id)) || canUseStratagem(s, p, st.id, undefined, 1)) continue;
    const anchor = st.vehicle ? boardUnits(s, p).find((u) => u.factionKeywords.includes('ASTRA MILITARUM') && hasKw(u, 'VEHICLE')) : undefined;
    if (st.vehicle && !anchor) continue;
    const spot = markerSpot(s, p, anchor);
    if (!spot) continue;
    spendStratagem(s, p, st.id, undefined, 1);
    log(s, `${st.name} (−1CP): the Cult Ambush marker is moved to (${spot.x.toFixed(0)}, ${spot.y.toFixed(0)})`, 'cp', p);
    return spot;
  }
  return null;
}

/** An enemy model (not AIRCRAFT) ends a move within 8" of a marker: it is removed (Summon the Cult: moved instead, once). */
export function cultAmbushCheckEnemyMoved(s: GameState, mover: UnitState) {
  const p = other(mover.owner);
  const P = s.players[p];
  if (!P?.cultAmbushMarkers?.length || hasKw(mover, 'AIRCRAFT')) return;
  const kept: Pt[] = [];
  for (const mk of P.cultAmbushMarkers) {
    if (!alive(mover).some((m) => dist(m, mk) - m.r <= 8 + 1e-6)) { kept.push(mk); continue; }
    const ward = boardUnits(s, p).find((u) => u.abilities.some((a) => a.name === 'Summon the Cult'));
    if (ward && !P.summonedCult) {
      const foes = boardUnits(s, mover.owner).flatMap(alive);
      const spot = markerSpot(s, p);
      if (spot && alive(ward).some((m) => dist(m, spot) <= 12) && !foes.some((m) => dist(m, spot) - m.r <= 8)) {
        P.summonedCult = true;
        kept.push(spot);
        log(s, `Summon the Cult: the Cult Ambush marker is moved to (${spot.x.toFixed(0)}, ${spot.y.toFixed(0)})`, 'info', p);
        continue;
      }
    }
    const saved = saveMarker(s, p);
    if (saved) { kept.push(saved); continue; }
    log(s, `${mover.name} ended a move within 8" of a Cult Ambush marker: it is removed`, 'info', p);
  }
  P.cultAmbushMarkers = kept;
}

/** Sets the unit up around a point, every model within `radius` of it. */
function placeAround(s: GameState, u: UnitState, at: Pt, radius: number): boolean {
  return alive(u).every((m, i) => {
    const ring = 1.5 * Math.ceil(i / 6), a = i * 1.05;
    return setBackUp(s, u, m, i === 0 ? at : { x: at.x + Math.cos(a) * ring, y: at.y + Math.sin(a) * ring }) && dist(m, at) <= radius + m.r;
  });
}

function arrive(s: GameState, u: UnitState, where: string) {
  u.status = 'board';
  u.setUpTurn = s.turn;
  u.cultAmbush = false;
  pushFx(s, { kind: 'place', unitId: u.id, owner: u.owner });
  log(s, `Cult Ambush: ${u.name} emerges ${where}`, 'info', u.owner);
}

const LYING_IN_WAIT = '000009068005', DOWNTRODDEN = '000009072006';

/** End of the opponent's Movement phase: one unit in Cult Ambush arrives at each marker. */
export function cultAmbushArrival(s: GameState) {
  const p = other(s.active);
  const P = s.players[p];
  if (!isCultArmy(s, p)) return;
  const left: Pt[] = [];
  for (const mk of P.cultAmbushMarkers ?? []) {
    const edge = Math.min(mk.x, mk.y, RULES.battlefield.width - mk.x, RULES.battlefield.height - mk.y);
    // Outrider Gangs: Atalan Jackals arrive wholly within 9" of a battlefield edge
    const u = s.units.find((x) => x.owner === p && x.status === 'reserves' && x.cultAmbush && (edge <= 6 || !x.abilities.some((a) => a.name === 'Outrider Gangs')));
    if (!u) { left.push(mk); continue; }
    if (placeAround(s, u, mk, 3)) { arrive(s, u, `at the marker (${mk.x.toFixed(0)}, ${mk.y.toFixed(0)})`); continue; }
    // Lying in Wait: a BATTLELINE unit can be set up wholly within 6" of the marker instead
    if (hasKw(u, 'BATTLELINE') && P.detachments?.some((d) => d.stratagems?.some((x) => x.id === LYING_IN_WAIT)) && !canUseStratagem(s, p, LYING_IN_WAIT, u, 1) && placeAround(s, u, mk, 6)) {
      spendStratagem(s, p, LYING_IN_WAIT, u, 1);
      log(s, 'Lying in Wait (−1CP)', 'cp', p);
      arrive(s, u, `within 6" of the marker (${mk.x.toFixed(0)}, ${mk.y.toFixed(0)})`);
      continue;
    }
    left.push(mk);
  }
  P.cultAmbushMarkers = left;
  // The Downtrodden Rise: one ACOLYTE / METAMORPH / NEOPHYTE unit left in Cult Ambush arrives without a marker, more than 6" from enemies
  const u = s.units.find((x) => x.owner === p && x.status === 'reserves' && x.cultAmbush && /acolyte hybrid|hybrid metamorph|neophyte hybrid/i.test(x.sources[0] ?? x.name));
  if (u && P.detachments?.some((d) => d.stratagems?.some((x) => x.id === DOWNTRODDEN)) && !canUseStratagem(s, p, DOWNTRODDEN, u, 2)) {
    const at = markerSpot(s, p);
    if (at && placeAround(s, u, at, 3)) {
      spendStratagem(s, p, DOWNTRODDEN, u, 2);
      log(s, 'The Downtrodden Rise (−2CP)', 'cp', p);
      arrive(s, u, `at (${at.x.toFixed(0)}, ${at.y.toFixed(0)}) without a marker`);
    }
  }
}

/** Cult Infiltration (Nexos): start of each Command phase, one marker moves up to 6" towards the enemy's objectives. */
export function cultInfiltration(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    if (!P.cultAmbushMarkers?.length || !boardUnits(s, p).some((u) => u.abilities.some((a) => a.name === 'Cult Infiltration'))) continue;
    const goal = s.objectives.filter((o) => o.controller !== p).sort((a, b) => dist(a, P.cultAmbushMarkers![0]) - dist(b, P.cultAmbushMarkers![0]))[0];
    if (!goal) continue;
    const mk = P.cultAmbushMarkers[0];
    const d = dist(mk, goal);
    const step = Math.min(6, Math.max(0, d - 3));
    const to = { x: mk.x + ((goal.x - mk.x) / (d || 1)) * step, y: mk.y + ((goal.y - mk.y) / (d || 1)) * step };
    if (boardUnits(s, other(p)).flatMap(alive).some((m) => dist(m, to) - m.r <= 9)) continue;
    P.cultAmbushMarkers[0] = to;
    log(s, `Cult Infiltration: a Cult Ambush marker moves to (${to.x.toFixed(0)}, ${to.y.toFixed(0)})`, 'info', p);
  }
}

/** Psionic Parasitism (Final Day): a GENESTEALER CULTS unit within 9" of the SYNAPSE unit suffers D3+1 mortal wounds,
 *  the TYRANIDS unit (`tyr`) regains that many wounds (Synaptic Auger: twice) and gets +1 to Hit until the next Movement phase. */
export function psionicParasitism(s: GameState, synapse: UnitState, tyr: UnitState, mortals: (u: UnitState, n: number) => void, heal: (u: UnitState, n: number) => void) {
  const near = (u: UnitState) => alive(u).some((m) => alive(synapse).some((n) => dist(m, n) - m.r - n.r <= 9 + 1e-6));
  const gc = boardUnits(s, synapse.owner).filter((u) => u.factionKeywords.includes('GENESTEALER CULTS') && !hasKw(u, 'PURESTRAIN GENESTEALERS') && !hasKw(u, 'PATRIARCH') && near(u))
    .sort((a, b) => a.pts / Math.max(1, alive(a).length) - b.pts / Math.max(1, alive(b).length))[0];
  if (!gc) { log(s, 'Psionic Parasitism: no GENESTEALER CULTS unit within 9"', 'info', synapse.owner); return; }
  const n = 1 + Math.ceil(rollN(s, 1)[0] / 2);
  mortals(gc, n);
  heal(tyr, tyr.enhancements?.some((e) => e.name === 'Synaptic Auger') ? n * 2 : n);
  addTimed(s, tyr, { e: { hit: 1 }, label: 'Psionic Parasitism', until: 'nextMovement', by: synapse.owner });
  log(s, `Psionic Parasitism: ${gc.name} suffers ${n} mortal wounds, ${tyr.name} regains wounds`, 'info', synapse.owner);
}

/** Regimental Reinforcements: the destroyed ASTRA MILITARUM unit comes back in Cult Ambush on a 3+. */
export function regimentalReinforcements(s: GameState, u: UnitState) {
  const r = rollN(s, 1)[0];
  if (r < 3) { log(s, `Regimental Reinforcements: rolled ${r}, no new unit`, 'info', u.owner); return; }
  toCultAmbush(s, u, `rolled ${r} for Regimental Reinforcements`);
}
