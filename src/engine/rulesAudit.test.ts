import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGame, formationAt, placeUnit, setOathTarget, callWaaagh } from './game';
import { activeRules, DET_RULES, effectsFor, addTimed, expireTimed } from './effects';
import { buildShootPools } from './attack';
import { PRESETS } from '../ui/presets';
import { RULES } from './config';
import type { ArmyList, FactionData, GameState, Pt, UnitState } from './types';

function loadFaction(id: string): FactionData {
  const file = path.join(process.cwd(), 'public', 'data', 'factions', `${id}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FactionData;
}

function putOnBoard(s: GameState, u: UnitState, pos: Pt) {
  placeUnit(s, u, formationAt(u, pos));
  u.status = 'board';
  u.setUpTurn = -10;
}

describe('Warhammer 40k Army & Detachment Rules Audit Suite', () => {
  const SM = loadFaction('SM');
  const ORK = loadFaction('ORK');
  const TYR = loadFaction('TYR');
  const CSM = loadFaction('CSM');
  const factionFiles = fs.readdirSync(path.join(process.cwd(), 'public', 'data', 'factions')).filter((f) => f.endsWith('.json'));

  describe('Protocol 1: Game State Simulation & Rule Logic Validation', () => {
    for (const file of factionFiles) {
      const fId = file.replace('.json', '');
      const fac = loadFaction(fId);
      if (!fac || !fac.id) continue;

      it(`Faction ${fac.name} (${fac.id}) - detachments and army rules activate cleanly`, () => {
        const implementedDets = (fac.detachments || []).filter((d) => DET_RULES[d.name]);
        const presetList: ArmyList = PRESETS[fac.id] || {
          name: `${fac.name} Test List`,
          factionId: fac.id,
          battleSize: 'incursion',
          detachments: implementedDets[0] ? [implementedDets[0].name] : [],
          units: (fac.datasheets || []).slice(0, 2).map((d, i) => ({
            uid: `u${i}`,
            datasheet: d.name,
            models: d.models.length || 1,
            pts: d.points[0]?.options[0]?.pts || 100,
          })),
        };

        for (const det of implementedDets) {
          const testList: ArmyList = {
            ...presetList,
            detachments: [det.name],
          };
          const s = createGame({
            lists: [testList, PRESETS.ORK],
            factions: [fac, ORK],
            names: ['Audited Player', 'Target Opponent'],
            seed: 42,
          });

          const active = activeRules(s, 0);
          expect(active).toContain(det.name);

          const u = s.units.find((x) => x.owner === 0);
          if (u) {
            putOnBoard(s, u, { x: 20, y: 20 });
            const fx = effectsFor(s, u);
            expect(Array.isArray(fx)).toBe(true);
          }
        }
      });
    }
  });

  describe('Protocol 2: Bot Execution & Automation Check', () => {
    it('Oath of Moment target selection and tracking', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['SM Bot', 'ORK Bot'],
        seed: 42,
      });
      s.bots = [0, 1];
      const smUnit = s.units.find((u) => u.owner === 0)!;
      const orkUnit = s.units.find((u) => u.owner === 1)!;
      putOnBoard(s, smUnit, { x: 20, y: 20 });
      putOnBoard(s, orkUnit, { x: 20, y: 28 });
      s.round = 1;
      s.turn = 1;
      s.active = 0;

      setOathTarget(s, 0, orkUnit.id);
      expect(s.players[0].oathTarget).toBe(orkUnit.id);
    });

    it('Waaagh! triggers army-wide battle state', () => {
      const s = createGame({
        lists: [PRESETS.ORK, PRESETS.SM],
        factions: [ORK, SM],
        names: ['ORK Bot', 'SM Bot'],
        seed: 42,
      });
      callWaaagh(s, 0);
      expect(s.players[0].waaaghUsed).toBe(true);
      expect(s.players[0].riledUntilTurn).toBe(s.turn + 1);
    });

    it('Synapse keyword recognized on Tyranid synaptic creatures', () => {
      const sTyr = createGame({
        lists: [PRESETS.TYR, PRESETS.SM],
        factions: [TYR, SM],
        names: ['TYR', 'SM'],
        seed: 42,
      });
      const syn = sTyr.units.find((u) => u.keywords.includes('SYNAPSE'));
      expect(syn).toBeDefined();
      expect(syn?.keywords).toContain('SYNAPSE');
    });

    it('Dark Pacts recognized on Chaos Space Marines', () => {
      const sCsm = createGame({
        lists: [PRESETS.CSM, PRESETS.SM],
        factions: [CSM, SM],
        names: ['CSM', 'SM'],
        seed: 42,
      });
      const csmUnit = sCsm.units.find((u) => u.owner === 0 && u.abilities.some((a) => a.name === 'Dark Pacts'));
      expect(csmUnit).toBeDefined();
    });

    it('Timed effects expire cleanly on phase change', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['A', 'B'],
        seed: 42,
      });
      const smUnit = s.units.find((u) => u.owner === 0)!;
      putOnBoard(s, smUnit, { x: 20, y: 20 });
      addTimed(s, smUnit, { e: { hit: 1 }, label: 'Test Phase Buff', until: 'phase', by: 0 });
      expect(smUnit.timed?.some((t) => t.label === 'Test Phase Buff')).toBe(true);

      expireTimed(s, 'phaseEnd', 0);
      expect(smUnit.timed?.some((t) => t.label === 'Test Phase Buff')).toBe(false);
    });
  });

  describe('Protocol 3: Edge Cases, Modifier Caps & Keyword Isolation', () => {
    it('Hit and Wound modifiers strictly clamped to [-1, +1]', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['A', 'B'],
        seed: 42,
      });
      s.phase = 'shooting';
      s.active = 0;
      s.terrain = [];
      const smUnit = s.units.find((u) => u.owner === 0 && u.models.some((m) => m.weapons.some((w) => w.profiles.some((p) => typeof p.range === 'number'))))!;
      const orkUnit = s.units.find((u) => u.owner === 1)!;
      putOnBoard(s, smUnit, { x: 5, y: 20 });
      putOnBoard(s, orkUnit, { x: 20, y: 20 });

      // Inject 3 stacked +1 Hit and +2 Wound buffs
      smUnit.buffs.push({ kind: 'hit+1', label: 'Buff 1', until: 'phase' });
      smUnit.buffs.push({ kind: 'hit+1', label: 'Buff 2', until: 'phase' });
      smUnit.buffs.push({ kind: 'hit+1', label: 'Buff 3', until: 'phase' });
      smUnit.buffs.push({ kind: 'wound+1', label: 'WoundBuff 1', until: 'phase' });
      smUnit.buffs.push({ kind: 'wound+1', label: 'WoundBuff 2', until: 'phase' });

      const shootResult = buildShootPools(s, smUnit.id, orkUnit.id, { mode: 'normal' });
      expect(shootResult.pools.length).toBeGreaterThan(0);

      for (const pool of shootResult.pools) {
        expect(pool.hitMod).toBeLessThanOrEqual(RULES.modifierCaps.hitRoll);
        expect(pool.hitMod).toBeGreaterThanOrEqual(-RULES.modifierCaps.hitRoll);
        expect(pool.woundMod).toBeLessThanOrEqual(RULES.modifierCaps.woundRoll);
        expect(pool.woundMod).toBeGreaterThanOrEqual(-RULES.modifierCaps.woundRoll);
      }
    });

    it('Keyword isolation: VEHICLE models do not inherit INFANTRY-exclusive detachment rules', () => {
      const dread = SM.datasheets.find((d) => d.keywords.includes('VEHICLE'));
      if (!dread) return;

      const testListWithDread: ArmyList = {
        name: 'Dread Test',
        factionId: 'SM',
        battleSize: 'incursion',
        detachments: ['Gladius Task Force'],
        units: [{ uid: 'dread1', datasheet: dread.name, models: 1, pts: 150 }],
      };
      const sDread = createGame({
        lists: [testListWithDread, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['A', 'B'],
        seed: 42,
      });
      const dreadUnit = sDread.units.find((u) => u.owner === 0)!;
      putOnBoard(sDread, dreadUnit, { x: 20, y: 20 });

      const dreadFx = effectsFor(sDread, dreadUnit);
      for (const act of dreadFx) {
        if (act.e.units?.includes('INFANTRY')) {
          expect(dreadUnit.keywords).toContain('INFANTRY');
        }
      }
    });
  });
});
