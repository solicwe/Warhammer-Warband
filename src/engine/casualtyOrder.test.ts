import { describe, expect, it } from 'vitest';
import { pickCasualty, weaponValue } from './attack';
import type { ModelState, UnitState, WeaponData } from './types';

const gun = (A: string, S: number, AP: number, D: string): WeaponData => ({
  name: 'g', profiles: [{ name: 'g', range: 24, A, skill: 3, S, AP, D, abilities: [] }],
});
const model = (id: string, x: number, weapons: WeaponData[]): ModelState => ({
  id, x, y: 0, r: 0.5, wounds: 1, dead: false, weapons, isCharacter: false,
  profile: { W: 1, Sv: 3, InSv: null },
} as unknown as ModelState);

describe('casualty order', () => {
  it('removes models with weak or no weapons before the one holding the big gun', () => {
    const heavy = model('h', 0, [gun('1', 12, -3, 'D6+1')]);
    const bolter = model('b', 1, [gun('2', 4, 0, '1')]);
    const none = model('n', 2, []);
    const u = { models: [heavy, bolter, none] } as unknown as UnitState;
    expect(weaponValue(heavy)).toBeGreaterThan(weaponValue(bolter));
    expect(weaponValue(none)).toBe(0);
    expect(pickCasualty(u, u.models)?.id).toBe('n');
    none.dead = true;
    expect(pickCasualty(u, u.models)?.id).toBe('b');
  });
});

describe('Precision picks a CHARACTER', () => {
  it('with two CHARACTERS in the target, the attacker chooses which one takes the Precision attacks', async () => {
    const fs = await import('node:fs');
    const { createGame, formationAt, placeUnit } = await import('./game');
    const { buildShootPools, startAttack, resolveAll, precisionOptions, setPrecisionTarget } = await import('./attack');
    const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
    const row = (d: string, n: number, pts: number, attachTo?: string) => ({ uid: d, datasheet: d, models: n, pts, attachTo });
    const mk = (f: string, units: ReturnType<typeof row>[]) => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units });
    const s = createGame({
      lists: [mk('SM', [row('Intercessor Squad', 10, 150)]), mk('ORK', [row('Boyz', 10, 90), row('Painboy', 1, 45, 'Boyz')])] as never,
      factions: [load('SM'), load('ORK')], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    s.terrain = s.terrain.filter((t) => t.objectiveId);
    s.terrain.forEach((t) => (t.walls = []));
    s.round = 2; s.turn = 2; s.phase = 'shooting'; s.active = 0;
    const place = (id: string, x: number, y: number) => { const u = s.units.find((q) => q.id === id)!; placeUnit(s, u, formationAt(u, { x, y })); u.setUpTurn = -10; return u; };
    const A = place('p0-Intercessor Squad', 20, 10);
    const T = place('p1-Boyz', 20, 22);
    T.models.find((m) => m.source !== 'Painboy' && !m.dead)!.isCharacter = true; // a second CHARACTER
    const pools = buildShootPools(s, A.id, T.id, { mode: 'normal' }).pools;
    for (const p of pools) p.precision = true;
    startAttack(s, 'shoot', A.id, T.id, pools);
    const opts = precisionOptions(s, s.attack!, T);
    expect(opts.length).toBe(2);
    const last = opts[1].models[0];
    setPrecisionTarget(s, last.id);
    resolveAll(s);
    const first = s.attack!.pools[0];
    expect(first.saveTargets[0].startsWith(last.name)).toBe(true);
  });
});

describe('bestMark', () => {
  it('picks a god from the datasheet', async () => {
    const { bestMark } = await import('./army');
    const sheet = (kw: string[], melee: number, ranged: number, T = 4, W = 2) => ({
      keywords: kw, models: [{ T, W }],
      weapons: [...Array(melee).fill({ profiles: [{ range: 'Melee' }] }), ...Array(ranged).fill({ profiles: [{ range: 24 }] })],
    }) as never;
    expect(bestMark(sheet(['PSYKER'], 1, 1))).toBe('TZEENTCH');
    expect(bestMark(sheet([], 3, 1))).toBe('KHORNE');
    expect(bestMark(sheet([], 1, 2, 5))).toBe('NURGLE');
    expect(bestMark(sheet([], 1, 2))).toBe('SLAANESH');
  });
});

describe('casualties keep the models holding an objective', () => {
  it('the models furthest from the objective are removed first', () => {
    const at = (id: string, x: number) => ({ ...model(id, x, []), y: 0, r: 0.5 });
    const near = at('near', 1), mid = at('mid', 5), far = at('far', 9);
    const u = { models: [near, mid, far] } as unknown as UnitState;
    const objective = [{ x: 0, y: 0 }];
    expect(pickCasualty(u, u.models, objective)?.id).toBe('far');
    far.dead = true;
    expect(pickCasualty(u, u.models, objective)?.id).toBe('mid');
    mid.dead = true;
    expect(pickCasualty(u, u.models, objective)?.id).toBe('near');
  });
});
