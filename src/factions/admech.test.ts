import { describe, expect, it } from 'vitest';
import { admechImperativePicked, onAcquisition, pickAcquisition } from './admech';
import type { GameState, UnitState } from '../engine/types';

const unit = (owner: 0 | 1, x: number, y: number) => ({ id: `u${owner}${x}`, owner, status: 'board', models: [{ id: 'm', x, y, r: 0.5, dead: false, wounds: 1, profile: { W: 1, OC: 2 } }] }) as unknown as UnitState;

describe('Adeptus Mechanicus', () => {
  it('Acquisition At Any Cost: the closest objective not controlled becomes the Acquisition objective', () => {
    const u = unit(0, 10, 10);
    const s = {
      players: [{ name: 'A', detachments: [{ name: 'Explorator Maniple' }] }, { name: 'B', detachments: [] }],
      units: [u],
      objectives: [{ id: 'a', x: 11, y: 10, controller: 0 }, { id: 'b', x: 20, y: 10, controller: 1 }, { id: 'c', x: 40, y: 10, controller: null }],
      log: [],
      terrain: [],
    } as unknown as GameState;
    pickAcquisition(s, 0);
    expect(s.players[0].acquisitionId).toBe('b');
    expect(onAcquisition(s, 0, unit(1, 20, 11))).toBe(true);
    expect(onAcquisition(s, 0, u)).toBe(false);
  });

  it('keeps the chosen Doctrina Imperative for the HUD', () => {
    const s = { players: [{}, {}] } as unknown as GameState;
    admechImperativePicked(s, 0, 'Doctrina Imperatives', ['conqueror']);
    expect(s.players[0].admechImperative).toBe('Conqueror Imperative');
  });
});
