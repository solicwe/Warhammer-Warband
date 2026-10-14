import { alive, boardUnits, hasKw, log, other, pushFx, unitDistance } from './state';
import { rollN } from './dice';
import { unitFlags } from './effects';
import type { GameState, PlayerId, UnitState } from './types';

/**
 * Checks if a unit is within Synapse Range of its army:
 * - The unit itself has the SYNAPSE keyword, OR
 * - It is within 6" (or enhanced range) of a friendly on-board unit with SYNAPSE.
 */
export function inSynapse(s: GameState, u: UnitState): boolean {
  if (!u || u.owner === undefined || u.status === 'destroyed') return false;
  const isTyr = u.factionKeywords?.includes('TYRANIDS') || u.keywords?.includes('TYRANIDS') || s.players[u.owner]?.factionId === 'TYR';
  if (!isTyr) return false;
  if (hasKw(u, 'SYNAPSE')) return true;
  return boardUnits(s, u.owner).some((f) => {
    if (!hasKw(f, 'SYNAPSE')) return false;
    const range = (unitFlags(s, f) as { synapseRange?: number }).synapseRange ?? 6;
    return unitDistance(u, f) <= range + 1e-6;
  });
}

/**
 * Unleashes Shadow in the Warp for player p:
 * Once per battle in either player's Command phase.
 * Every enemy unit on the battlefield must take a Battle-shock test.
 * If within 6" of a friendly Synapse unit, or if the Tyranid player has a Neurotyrant, subtract 1.
 */
export function unleashShadowInTheWarp(s: GameState, p: PlayerId): { tested: number; failed: number } {
  s.players[p].shadowInTheWarpUsed = true;
  const opp = other(p);
  const enemies = boardUnits(s, opp);
  const hasNeurotyrant = boardUnits(s, p).some((u) => u.name === 'Neurotyrant');
  log(s, `Shadow in the Warp! The Hive Mind projects an alien terror across the battlefield.`, 'info', p);

  let failed = 0;
  for (const e of enemies) {
    const nearSynapse = boardUnits(s, p).some((u) => hasKw(u, 'SYNAPSE') && unitDistance(e, u) <= 6 + 1e-6);
    let mod = 0;
    if (nearSynapse) mod -= 1;
    if (hasNeurotyrant) mod -= 1;

    const ld = Math.min(...alive(e).map((m) => m.profile.Ld));
    const r = rollN(s, 2);
    const sum = r[0] + r[1] + mod;
    const passed = sum >= ld;
    if (!passed) {
      e.battleShocked = true;
      failed += 1;
    }
    pushFx(s, {
      kind: 'roll',
      owner: opp,
      title: `Shadow in the Warp · ${e.name}`,
      dice: r,
      result: `${sum} vs Ld ${ld}+ → ${passed ? 'passed' : 'failed!'}`,
      good: passed
    });
    log(s, `Shadow in the Warp vs ${e.name}: 2D6 [${r.join('+')}]${mod ? ` ${mod}` : ''} = ${sum} vs Ld ${ld}+ → ${passed ? 'passed' : 'failed (Battle-shocked)'}`, 'roll', opp);
  }
  return { tested: enemies.length, failed };
}

/**
 * Bot heuristic for when to unleash Shadow in the Warp:
 * Best in Battle Round 2 or 3 when multiple enemies are on objectives or can be disrupted.
 */
export function shouldUnleashShadow(s: GameState, p: PlayerId): boolean {
  if (s.players[p].shadowInTheWarpUsed) return false;
  if (s.round < 2) return false;
  const opp = other(p);
  const enemies = boardUnits(s, opp);
  const enemiesOnObjs = enemies.filter((e) =>
    s.objectives.some((o) => alive(e).some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= 4))
  );
  if (enemiesOnObjs.length >= 1 || s.round >= 3 || enemies.length >= 3) {
    return true;
  }
  return false;
}
