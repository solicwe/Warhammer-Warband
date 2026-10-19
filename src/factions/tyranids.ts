// Tyranids army rules Synapse and Shadow in the Warp, and the abilities that change Synapse Range or hook into
// Battle-shock tests (Domination of the Hive Mind, Neuroloids, Neurocytes, Psychic Terror, Spirit Leech, Fear of the
// Unseen). Detachment rules, enhancements, the other abilities and stratagems are data.
import { alive, boardUnits, centreOf, hasKw, log, other, pushFx, unitDistance } from '../engine/state';
import { rollExpr } from '../engine/dice';
import { applyMortalWounds } from '../engine/attack';
import { abilityOff, activeRules, unitFlags } from '../rules-engine/effects';
import { heal, shockTest } from '../rules-engine/activations';
import { formationAt, validatePlacement } from '../engine/game';
import type { GameState, PlayerId, UnitState } from '../engine/types';

const isTyr = (u: UnitState) => u.factionKeywords.includes('TYRANIDS');
const hasAb = (u: UnitState, n: string) => u.abilities.some((a) => a.name === n && !abilityOff(u, a));
export const isTyranidArmy = (s: GameState, p: PlayerId) => !!s.players[p]?.armyRules?.some((r) => r.name === 'Synapse');

/** A SYNAPSE unit of the army (Neurogaunts with Neurocytes count while they are within Synapse Range of another one). */
function synapseUnits(s: GameState, p: PlayerId): UnitState[] {
  const base = boardUnits(s, p).filter((f) => hasKw(f, 'SYNAPSE'));
  const near = (u: UnitState) => base.some((f) => f.id !== u.id && !hasKw(f, 'NEUROGAUNTS') && unitDistance(u, f) <= rangeOf(s, f) + 1e-6);
  return [...base, ...boardUnits(s, p).filter((u) => !hasKw(u, 'SYNAPSE') && hasAb(u, 'Neurocytes') && near(u))];
}
// Domination of the Hive Mind (Aura): 9"; enhancements and stratagems can make it longer (synapseRange)
const rangeOf = (s: GameState, f: UnitState) => Math.max(hasAb(f, 'Domination of the Hive Mind (Aura)') ? 9 : 6, unitFlags(s, f).synapseRange);

/** Is the unit within Synapse Range of its army? Neuroloids marks put a unit there until your next Command phase. */
export function inSynapse(s: GameState, u: UnitState): boolean {
  if (!u || u.status === 'destroyed' || !isTyr(u) || !isTyranidArmy(s, u.owner)) return false;
  if ((u.timed ?? []).some((t) => t.mark === 'Neuroloids')) return true;
  return synapseUnits(s, u.owner).some((f) => f.id === u.id || unitDistance(u, f) <= rangeOf(s, f) + 1e-6);
}

/** Shadow in the Warp: every enemy unit takes a Battle-shock test (-1 within 6" of a SYNAPSE unit, -1 more with Psychic Terror). */
export function unleashShadowInTheWarp(s: GameState, p: PlayerId): { tested: number; failed: number } {
  s.players[p].shadowInTheWarpUsed = true;
  log(s, 'Shadow in the Warp! The Hive Mind projects an alien terror across the battlefield.', 'info', p);
  const terror = boardUnits(s, p).some((u) => hasAb(u, 'Psychic Terror (Psychic)'));
  const syn = synapseUnits(s, p);
  let failed = 0;
  const enemies = boardUnits(s, other(p));
  for (const e of enemies) {
    const mod = (syn.some((f) => unitDistance(e, f) <= 6 + 1e-6) ? -1 : 0) + (terror ? -1 : 0);
    if (!shockTest(s, e, mod, 'Shadow in the Warp')) failed++;
  }
  return { tested: enemies.length, failed };
}

/** Bot: from battle round 2, or when enemy units hold objectives. */
export function shouldUnleashShadow(s: GameState, p: PlayerId): boolean {
  if (s.players[p].shadowInTheWarpUsed || s.round < 2) return false;
  const enemies = boardUnits(s, other(p));
  return s.round >= 3 || enemies.length >= 3 || enemies.some((e) => s.objectives.some((o) => alive(e).some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= 4)));
}

/** Spirit Leech (Aura): an enemy unit within 6" of Zoanthropes with a Neurothrope fails a Battle-shock test: D3 mortal wounds,
 *  and the Zoanthropes regain up to D3 wounds. */
export function tyranidsShockResult(s: GameState, u: UnitState, passed: boolean) {
  if (passed) return;
  for (const z of boardUnits(s, other(u.owner)).filter((f) => hasAb(f, 'Spirit Leech (Aura, Psychic)') && alive(f).some((m) => /neurothrope/i.test(m.name)))) {
    if (unitDistance(z, u) > 6 + 1e-6) continue;
    applyMortalWounds(s, u, rollExpr(s, 'D3').total, 'Spirit Leech');
    heal(s, z, rollExpr(s, 'D3').total);
    pushFx(s, { kind: 'skill', unitId: z.id, owner: z.owner, at: centreOf(z), name: 'Spirit Leech', who: z.name, style: 'psychic', epic: false });
  }
}

/** Fear of the Unseen (Aura): in the opponent's Command phase, enemy units within 6" of Deathleaper that are below their
 *  Starting Strength take a Battle-shock test. */
export function tyranidsCommandStart(s: GameState) {
  const p = s.active;
  for (const d of boardUnits(s, other(p)).filter((f) => hasAb(f, 'Fear of the Unseen (Aura)'))) {
    for (const e of boardUnits(s, p)) {
      if (unitDistance(d, e) > 6 + 1e-6 || alive(e).length >= e.startingStrength || e.battleShocked || s.shockTests.some((x) => x.unitId === e.id)) continue;
      log(s, `Fear of the Unseen: ${e.name} must take a Battle-shock test`, 'info', d.owner);
      s.shockTests.push({ unitId: e.id, mod: 0, passed: null, result: null });
    }
  }
}

/** A new Spore Mines / Mucolid Spores unit of n models set up within `range` of `near` and more than 9" from enemy units
 *  (as close to the nearest enemy as that allows). shortcut: Deep Strike placement rules (9") stand in for the card's 8". */
export function seedSpores(s: GameState, near: UnitState, name: string, n: number, range: number, label: string): boolean {
  const tpl = s.players[near.owner].sporeTemplates?.[name];
  const c = alive(near)[0];
  if (!tpl || !c || n < 1) return false;
  const u: UnitState = structuredClone(tpl);
  u.id = `spore${s.units.length}-${s.turn}`;
  u.models = u.models.slice(0, n);
  u.models.forEach((m, i) => { m.id = `${u.id}-m${i}`; });
  u.startingStrength = u.models.length;
  const foe = boardUnits(s, other(near.owner)).flatMap(alive).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
  let best: { pos: Map<string, { x: number; y: number }>; d: number } | null = null;
  for (let ring = 1; ring <= 8; ring++) for (let a = 0; a < 16; a++) {
    const r = (range * ring) / 8, ang = (a / 16) * Math.PI * 2;
    const pos = formationAt(u, { x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
    if (!validatePlacement(s, u, pos, 'deepStrike').ok) continue;
    const mid = [...pos.values()][0];
    const d = foe ? Math.hypot(mid.x - foe.x, mid.y - foe.y) : ring;
    if (!best || d < best.d) best = { pos, d };
  }
  if (!best) return false;
  for (const m of u.models) { const p = best.pos.get(m.id)!; m.x = p.x; m.y = p.y; }
  u.status = 'board'; u.setUpTurn = s.turn;
  s.units.push(u);
  log(s, `${label}: a new ${name} unit (${u.models.length} model${u.models.length > 1 ? 's' : ''}) is set up`, 'info', near.owner);
  return true;
}

// ---------- Subterranean Assault: Tunnel Markers ----------
const isBurrower = (u: UnitState) => /^(Mawloc|Trygon)/.test(u.sources[0] ?? u.name);
const centre = (u: UnitState) => { const ms = alive(u); return { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length }; };

/** A BURROWER set up from Reserves places a Tunnel Marker where it arrived. */
export function tunnelArrived(s: GameState, u: UnitState) {
  if (!isBurrower(u) || !activeRules(s, u.owner).includes('Subterranean Assault') || !alive(u).length) return;
  (s.players[u.owner].tunnels ??= []).push(centre(u));
  log(s, `Subterranean Assault: ${u.name} leaves a Tunnel Marker`, 'info', u.owner);
}

/** An enemy model (not AIRCRAFT) ending a move within 3" of a Tunnel Marker removes it. */
export function tunnelEnemyMoved(s: GameState, u: UnitState) {
  if (hasKw(u, 'AIRCRAFT')) return;
  const P = s.players[other(u.owner)];
  const before = P.tunnels?.length ?? 0;
  P.tunnels = (P.tunnels ?? []).filter((t) => !alive(u).some((m) => Math.hypot(m.x - t.x, m.y - t.y) - m.r <= 3 + 1e-6));
  if (P.tunnels.length < before) log(s, `${u.name} collapses a Tunnel Marker`, 'info', u.owner);
}

/** Every model of the unit wholly within X" of one of its army's Tunnel Markers (the marker index, or -1). */
export function nearTunnel(s: GameState, u: UnitState, r: number): number {
  return (s.players[u.owner].tunnels ?? []).findIndex((t) => alive(u).length > 0 && alive(u).every((m) => Math.hypot(m.x - t.x, m.y - t.y) + m.r <= r + 1e-6));
}

/** Deep Strike near a Tunnel Marker: more than 6" from enemy units is enough. */
export function tunnelDeepStrike(s: GameState, u: UnitState, at: { x: number; y: number }): number | null {
  return (s.players[u.owner].tunnels ?? []).some((t) => Math.hypot(at.x - t.x, at.y - t.y) <= 9) ? 6 : null;
}

/** TUNNEL NETWORK: the unit is set up again wholly within 9" of another Tunnel Marker, more than 6" from enemy units. */
export function tunnelNetwork(s: GameState, u: UnitState) {
  const ts = s.players[u.owner].tunnels ?? [];
  const from = nearTunnel(s, u, 9);
  const foe = boardUnits(s, other(u.owner)).flatMap(alive);
  const order = ts.map((t, i) => ({ t, i })).filter(({ i }) => i !== from)
    .sort((a, b) => Math.min(...foe.map((e) => Math.hypot(e.x - a.t.x, e.y - a.t.y))) - Math.min(...foe.map((e) => Math.hypot(e.x - b.t.x, e.y - b.t.y))));
  for (const { t } of order) {
    for (let ring = 0; ring <= 3; ring++) for (let a = 0; a < 12; a++) {
      const r = ring * 2, ang = (a / 12) * Math.PI * 2;
      const pos = formationAt(u, { x: t.x + Math.cos(ang) * r, y: t.y + Math.sin(ang) * r });
      const ok = [...pos.values()].every((p) => Math.hypot(p.x - t.x, p.y - t.y) <= 9 - 1) && foe.every((e) => [...pos.values()].every((p) => Math.hypot(p.x - e.x, p.y - e.y) - e.r > 6 + 1));
      if (!ok || !validatePlacement(s, u, pos, 'deepStrike').ok) continue;
      for (const m of alive(u)) { const p = pos.get(m.id); if (p) { m.x = p.x; m.y = p.y; } }
      u.setUpTurn = s.turn;
      log(s, `TUNNEL NETWORK: ${u.name} emerges from another tunnel`, 'info', u.owner);
      return;
    }
  }
  log(s, `TUNNEL NETWORK: no room near another Tunnel Marker for ${u.name}`, 'info', u.owner);
}

