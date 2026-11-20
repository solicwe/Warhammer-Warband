import { expect, it } from 'vitest';
import { buildTerrain } from './game';
import { LAYOUTS } from './config';

// The official layouts are point-symmetric about the centre of the 44" x 60" table: every wall has its mirror.
it('every wall of the 45 layouts has a mirror wall of the same length', () => {
  const bad: string[] = [];
  for (const L of LAYOUTS) {
    const segs = buildTerrain(L.id).terrain.flatMap((t) => t.walls);
    const len = (s: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y);
    for (const s of segs) {
      const m = { a: { x: 44 - s.a.x, y: 60 - s.a.y }, b: { x: 44 - s.b.x, y: 60 - s.b.y } };
      const hit = segs.find((t) => (Math.hypot(t.a.x - m.a.x, t.a.y - m.a.y) < 0.8 && Math.hypot(t.b.x - m.b.x, t.b.y - m.b.y) < 0.8) || (Math.hypot(t.a.x - m.b.x, t.a.y - m.b.y) < 0.8 && Math.hypot(t.b.x - m.a.x, t.b.y - m.a.y) < 0.8));
      if (!hit) bad.push(`${L.id}: a wall without a mirror`);
      else if (Math.abs(len(hit) - len(s)) > 0.35) bad.push(`${L.id}: mirror walls ${len(s).toFixed(1)} and ${len(hit).toFixed(1)}`);
    }
  }
  // Open (docs/05-tech-debt.md): in these layouts a wall's mirror position holds another wall after the clean-up (a traced
  // tangle), so it cannot be added without overlapping it. Fixing one means taking it off this list.
  const known = ['disruption-mirror-1', 'reconnaissance-mirror-2', 'take-and-hold-mirror-3', 'take-and-hold-vs-disruption-2', 'take-and-hold-vs-priority-assets-1'];
  expect([...new Set(bad.map((b) => b.split(':')[0]))].sort()).toEqual(known);
});
