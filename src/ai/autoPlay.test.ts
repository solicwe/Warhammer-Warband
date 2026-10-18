// Auto rules: a player who only moves and picks shooting targets plays a whole game against the bot; the app takes
// all their other decisions (Command phase, stratagems, fights, reactions) without ever waiting on them.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoCharges, autoDue, autoSelectToShoot, autoShoot, autoStep } from './autoPlay';
import { botDeploy, botMoveOne, botShouldAct, botStep } from './bot';
import { buildShootPools, shootingModes } from '../engine/attack';
import { createGame, endPhase, endScouts } from '../engine/game';
import { boardUnits, other } from '../engine/state';
import { PRESETS } from '../ui/presets';
import type { GameState } from '../engine/types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));

/** What the person does: deploy, move (here with the bot's mover), pick a shooting target, end the phase. */
function personStep(s: GameState) {
  if (s.phase === 'deploy') { botDeploy(s); return; }
  if (s.phase === 'scouts') { endScouts(s); return; }
  if (s.phase === 'movement') { if (!botMoveOne(s)) endPhase(s); return; }
  if (s.phase === 'shooting') {
    const u = boardUnits(s, 0).find((x) => !x.selectedToShoot && shootingModes(s, x).length);
    if (!u) { endPhase(s); return; }
    autoSelectToShoot(s, u);
    const mode = shootingModes(s, u)[0];
    const t = boardUnits(s, other(0)).find((e) => { const r = buildShootPools(s, u.id, e.id, { mode }); return !r.error && r.pools.length > 0; });
    if (!t || !autoShoot(s, u.id, t.id, { mode })) u.selectedToShoot = true;
    return;
  }
  if (s.phase === 'charge') { autoCharges(s); endPhase(s); return; }
  endPhase(s);
}

describe('auto rules', () => {
  for (const seed of [3, 11]) {
    it(`the player only moves and shoots; a whole game still plays to the end (seed ${seed})`, () => {
      const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed, secondaryMode: 'tactical' });
      s.bots = [1];
      s.autoRules = [0];
      let steps = 0, autos = 0, attacksLeftOpen = 0;
      while (s.phase !== 'gameover' && steps < 8000) {
        steps++;
        if (s.attack) { attacksLeftOpen++; break; } // an attack waiting on the player would be a dice tray to tap through
        if (autoDue(s, 0)) { autoStep(s, 0); autos++; continue; }
        if (botShouldAct(s, 1)) { botStep(s, 1); continue; }
        if (s.window) { expect(s.window.player).not.toBe(0); break; }
        const mine = s.phase === 'deploy' || s.phase === 'scouts' ? s.deployTurn === 0 : s.active === 0;
        if (mine) personStep(s); else endPhase(s);
      }
      expect(attacksLeftOpen).toBe(0);
      expect(s.phase).toBe('gameover');
      expect(autos).toBeGreaterThan(5);
      // the Command phase and the fights were played for the player
      expect(s.log.some((l) => l.player === 0 && /doctrine/i.test(l.text))).toBe(true);
    });
  }
});

describe('the player decides', () => {
  it('prompts, the Command phase and the fights wait for a player who decides; the app still pilots the rest', async () => {
    const { decides } = await import('./autoPlay');
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 3 });
    s.bots = [1]; s.autoRules = [0]; s.decides = [0];
    expect(decides(s, 0)).toBe(true);
    s.phase = 'command'; s.active = 0;
    expect(autoDue(s, 0)).toBe(false);
    s.window = { kind: 'fireOverwatch', player: 0 };
    expect(autoDue(s, 0)).toBe(false);
    s.decides = [];
    expect(autoDue(s, 0)).toBe(true); // "Automatic": the app answers for them again
  });
});
