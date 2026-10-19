// Tyranids army rules Synapse and Shadow in the Warp, and the abilities that change Synapse Range or hook into
// Battle-shock tests (Domination of the Hive Mind, Neuroloids, Neurocytes, Psychic Terror, Spirit Leech, Fear of the
// Unseen). Detachment rules, enhancements, the other abilities and stratagems are data.
import { alive, boardUnits, centreOf, hasKw, log, other, pushFx, unitDistance } from '../engine/state';
import { rollExpr } from '../engine/dice';
import { applyMortalWounds } from '../engine/attack';
import { abilityOff, unitFlags } from '../rules-engine/effects';
import { heal, shockTest } from '../rules-engine/activations';
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
