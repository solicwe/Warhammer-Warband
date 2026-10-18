// Auto rules: a player who only moves units and picks shooting targets. Everything else they would decide (Command
// phase, abilities and stratagems, re-rolls, saves, battle-shock, charge rolls, the whole Fight phase, reactions in the
// opponent's turn) is taken by the bot's own logic, at the moment it comes up.
import { buildShootPools, finishAttack, resolveAll, startAttack, type ShootOptions } from '../engine/attack';
import { botChargeOne, botCommand, botDeploy, botFightStep, botPickFixed, botScouts, botWindow } from './bot';
import { botAdvanceChargeStratagem, botAfterShootStratagems, botChargeBonusStratagem, botDoctrineActs, botEndOfMovement, botShootActs, botTeleportActs } from './botPlus';
import { botOffensiveStratagem } from './botStrats';
import { isBrawler, p2d6 } from './botEval';
import { botUseActs, unitSelected } from '../rules-engine/activations';
import { botRituals, ritualsPending } from './botRituals';
import { canDetReroll, chargeTargetOptions, closeWindow, declareCharge, detReroll, fightCandidates, rerollCharge } from '../engine/game';
import { boardUnits, canUseStratagem, other, unitById, unitDistance } from '../engine/state';
import type { GameState, PlayerId, UnitState } from '../engine/types';

export const onAuto = (s: GameState, p: PlayerId) => (s.autoRules ?? []).includes(p) && !(s.bots ?? []).includes(p);
/** The player answers stratagem prompts and reactions, and picks Rituals, themselves. */
export const decides = (s: GameState, p: PlayerId) => (s.decides ?? []).includes(p) && !(s.bots ?? []).includes(p);

const once = (s: GameState, key: string) => {
  if ((s.botTried ?? []).includes(key)) return false;
  s.botTried = [...(s.botTried ?? []), key];
  return true;
};

/** Does player p (on auto rules) have a decision the app should take now? */
export function autoDue(s: GameState, p: PlayerId): boolean {
  if (s.attack || s.phase === 'gameover') return false;
  // "deploy for me": the rest of the army is set up by the bot's placement (Scouts moves are controlled manually)
  if ((s.autoDeploy ?? []).includes(p) && !(s.bots ?? []).includes(p) && s.phase === 'deploy' && !s.window) return s.deployTurn === p;
  if (!onAuto(s, p)) return false;
  if (s.window) return s.window.player === p && !decides(s, p);
  const P = s.players[p];
  if (s.phase === 'deploy') return P.secMode === 'fixed' && P.secActive.length < 2 && !(s.botTried ?? []).includes(`fixed|${p}`);
  // a player who decides plays their Command phase (detachment choices, Oath, battle-shock) and abilities themselves
  if (s.phase === 'command') return s.active === p && !decides(s, p);
  if (s.phase === 'movement') return s.active === p && !decides(s, p) && !(s.botTried ?? []).includes(`${s.turn}|auto-move|${p}`);
  if (s.phase === 'shooting') return ritualsPending(s, p) && !decides(s, p);
  if (s.phase === 'fight' && s.fight) {
    if (s.fight.step !== 'fight') return s.fight.stepPlayer === p;
    return fightCandidates(s).player === p && !decides(s, p); // they pick who fights and use their stratagems
  }
  return false;
}

/** Take one pending decision for player p. True when something was done. */
export function autoStep(s: GameState, p: PlayerId): boolean {
  if (!autoDue(s, p)) return false;
  if ((s.autoDeploy ?? []).includes(p) && s.phase === 'deploy' && !s.window) { botDeploy(s); return true; }
  if (s.window) { botWindow(s); return true; }
  if (s.phase === 'deploy') { once(s, `fixed|${p}`); botPickFixed(s, p); return true; }
  if (s.phase === 'command') { botCommand(s); return true; }
  if (s.phase === 'movement') {
    once(s, `${s.turn}|auto-move|${p}`);
    botUseActs(s, p, ['movement']);
    botTeleportActs(s, p);
    botDoctrineActs(s, p);
    return true;
  }
  if (s.phase === 'shooting') { botRituals(s, p); return true; }
  if (s.phase === 'fight') return botFightStep(s, p);
  return false;
}

/** The player picked a unit to shoot with: abilities and stratagems "when this unit is selected to shoot". */
export function autoSelectToShoot(s: GameState, u: UnitState) {
  unitSelected(s, u, 'shoot');
  if (!onAuto(s, u.owner)) return;
  botShootActs(s, u);
  botUseActs(s, u.owner, ['selectedToShoot', 'shooting'], u.id);
}

/** The player picked the target: the best attack stratagem goes on, the dice are rolled and the saves taken at once. */
export function autoShoot(s: GameState, attackerId: string, targetId: string, opt: ShootOptions, overwatch = false): boolean {
  const u = unitById(s, attackerId);
  // a player who decides their own stratagems uses them from the Stratagems sheet before shooting
  if (!overwatch && !decides(s, u.owner)) botOffensiveStratagem(s, u, 'shoot', [unitById(s, targetId)]);
  const r = buildShootPools(s, attackerId, targetId, opt);
  if (r.error || !r.pools.length) return false;
  startAttack(s, overwatch ? 'overwatch' : 'shoot', attackerId, targetId, r.pools);
  if (!s.attack) return true;
  resolveAll(s);
  finishAttack(s);
  if (overwatch && s.window?.kind === 'fireOverwatch') closeWindow(s);
  if (!overwatch && !s.window && !s.attack && !decides(s, u.owner)) botAfterShootStratagems(s, unitById(s, attackerId));
  return true;
}

/** End of the player's Movement phase: stratagems that act on objectives held now (Secure / Snares …). */
export function autoEndMovement(s: GameState, p: PlayerId) {
  if (onAuto(s, p)) botEndOfMovement(s, p);
}

/** Declare a charge for the player: a bonus stratagem for a long charge first, then a re-roll when it fails and is worth it. */
export function autoDeclareCharge(s: GameState, u: UnitState, fly = false) {
  if (onAuto(s, u.owner) && !decides(s, u.owner)) {
    botAdvanceChargeStratagem(s, u);
    const foes = boardUnits(s, other(u.owner));
    const gap = foes.length ? Math.min(...foes.map((e) => unitDistance(u, e))) : 0;
    botChargeBonusStratagem(s, u, gap);
  }
  declareCharge(s, u, fly);
  if (!onAuto(s, u.owner) || chargeTargetOptions(s, u).length) return;
  if (canDetReroll(s, u, 'charge')) { detReroll(s, u, 'charge'); if (chargeTargetOptions(s, u).length) return; }
  const foes = boardUnits(s, other(u.owner));
  const gap = foes.length ? Math.min(...foes.map((e) => unitDistance(u, e))) : 99;
  if (decides(s, u.owner)) return; // the player re-rolls with Command Re-roll themselves
  if (!canUseStratagem(s, u.owner, 'command-reroll', u) && s.players[u.owner].cp >= 1 && p2d6(gap) >= (isBrawler(s, u) ? 0.27 : 0.5)) rerollCharge(s, u);
}

/** "Charge for me": the bot's charge phase for the player's units that have not charged yet. */
export function autoCharges(s: GameState): number {
  let n = 0;
  while (!s.window && !s.attack && n < 40 && botChargeOne(s, true)) n++;
  return n;
}
