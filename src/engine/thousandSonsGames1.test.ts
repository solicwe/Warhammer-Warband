// Thousand Sons: every detachment plays a whole game with the bot (split over two files so they run in parallel).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from './bot';
import { buildUnits } from './army';
import { createGame } from './game';
import { PRESETS } from '../ui/presets';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const TS = load('TS');
const ORK = load('ORK');

describe('Thousand Sons detachments in a game', () => {
  for (const det of ['Grand Coven', 'Changehost of Deceit', 'Warpmeld Pact', 'Rubricae Phalanx']) {
    it(`${det} plays to the end`, () => {
      const units: ArmyList['units'] = [
        { uid: 'd1', datasheet: 'Rubric Marines', models: 10, pts: 190 },
        { uid: 'd2', datasheet: 'Exalted Sorcerer', models: 1, pts: 95, attachTo: 'd1', warlord: true },
        { uid: 'd3', datasheet: 'Tzaangors', models: 10, pts: 75 },
        { uid: 'd4', datasheet: det === 'Sekhetar Cohort' ? 'Sekhetar Robots' : 'Chaos Predator Destructor', models: det === 'Sekhetar Cohort' ? 2 : 1, pts: 140 },
        { uid: 'd5', datasheet: 'Infernal Master', models: 1, pts: 100 },
        ...(det === 'Changehost of Deceit' ? [{ uid: 'd6', datasheet: 'Pink Horrors', models: 10, pts: 115 }, { uid: 'd7', datasheet: 'Flamers', models: 3, pts: 65 }] : [{ uid: 'd6', datasheet: 'Scarab Occult Terminators', models: 5, pts: 180 }]),
      ];
      const ts: ArmyList = { name: 'ts', factionId: 'TS', battleSize: 'incursion', detachments: [det], units };
      const s = createGame({ lists: [ts, PRESETS.ORK], factions: [TS, ORK], names: ['A', 'B'], seed: 5, secondaryMode: 'tactical' });
      s.bots = [0, 1];
      let steps = 0;
      while (s.phase !== 'gameover' && steps < 15000) { botAct(s); steps++; }
      expect(s.phase).toBe('gameover');
      expect(buildUnits(ts, TS, 0).length).toBeGreaterThan(0);
    });
  }
});
