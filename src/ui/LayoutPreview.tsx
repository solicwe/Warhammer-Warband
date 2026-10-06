// Small SVG preview of an official terrain layout (zones, territory line, terrain, objectives).
import type { LayoutDef } from '../engine/config';
import { stripBarricade } from '../engine/game';

const ZONE = ['rgba(178,34,34,0.55)', 'rgba(14,111,164,0.55)'];

export function LayoutPreview({ layout, width = 120 }: { layout: LayoutDef; width?: number }) {
  const pts = (a: number[][]) => a.map(([x, y]) => `${x},${y}`).join(' ');
  const line = layout.territory.attacker;
  return (
    <svg viewBox="0 0 44 60" width={width} height={(width * 60) / 44} className="layout-preview" aria-label={`Layout ${layout.number}`}>
      <rect width="44" height="60" fill="#ece7dc" />
      <polygon points={pts(layout.zones.attacker)} fill={ZONE[0]} />
      <polygon points={pts(layout.zones.defender)} fill={ZONE[1]} />
      <polygon points={pts(line)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={0.35} strokeDasharray="1 0.8" />
      {layout.terrain.map((t, i) => (
        <g key={i}>
          <polygon points={pts(t.poly)} fill="#d8d2c4" stroke="#222" strokeWidth={0.3} />
          {t.walls.map((w, k) => <line key={k} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#2f6b4f" strokeWidth={0.7} />)}
          {t.obstacles.map((w, k) => <line key={`o${k}`} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#d98b1f" strokeWidth={0.6} />)}
          {!t.walls.length && !t.obstacles.length && !t.box && stripBarricade(t.poly).map((w, k) => <line key={`b${k}`} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#d98b1f" strokeWidth={0.6} />)}
        </g>
      ))}
      {layout.objectives.map((o, i) => (
        <circle key={i} cx={o.x} cy={o.y} r={1.3} fill="#fff" stroke={o.owner === 'attacker' ? '#b22222' : o.owner === 'defender' ? '#0e6fa4' : o.type === 'central' ? '#111' : '#1f6f75'} strokeWidth={0.6} />
      ))}
      <rect width="44" height="60" fill="none" stroke="#111" strokeWidth={0.6} />
    </svg>
  );
}
