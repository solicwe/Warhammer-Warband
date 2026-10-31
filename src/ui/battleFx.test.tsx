import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComponentProps } from 'react';
import type { WeaponFx } from '../engine/weaponFx';
import { AttackFx } from './BattleFx';

const KINDS: WeaponFx[] = ['bolt', 'heavyBolt', 'gatling', 'shoota', 'shotgun', 'sniper', 'pulse', 'plasma', 'las', 'melta', 'volkite', 'grav', 'lightning', 'psychic',
  'flame', 'missile', 'shell', 'gauss', 'shuriken', 'bio', 'sonic', 'cryo', 'slash', 'power', 'chain', 'claw', 'crush'];

describe('every weapon kind draws an effect', () => {
  it.each(KINDS)('%s', (fx) => {
    const e = { kind: 'attack', seq: 3, unitId: 'u', owner: 0, attackKind: 'shoot', from: { x: 2, y: 4 }, to: { x: 10, y: 4 }, dmg: 2, killed: 0, dead: [], deadIds: [],
      shooters: [{ x: 2, y: 4 }], victims: [{ x: 10, y: 4 }], volleys: [{ fx, shots: 3, hits: 2, models: 1, pow: 1, r: 0.6, from: [{ x: 2, y: 4 }] }] } as unknown as ComponentProps<typeof AttackFx>['e'];
    // something is on screen through the shot: while it flies and as it lands
    for (const f of [0.08, 0.2, 0.35]) expect(renderToStaticMarkup(<svg><AttackFx e={e} f={f} /></svg>)).toMatch(/<(circle|line|polyline|polygon|image|path|ellipse)/);
  });
});
