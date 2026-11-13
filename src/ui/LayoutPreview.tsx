// SVG preview of an official terrain layout with tournament-grade physical tabletop measurement overlay.
import type { LayoutDef } from '../engine/config';
import { stripBarricade } from '../engine/game';

const ZONE_ATTACKER = 'rgba(178,34,34,0.45)';
const ZONE_DEFENDER = 'rgba(14,111,164,0.45)';

export interface LayoutPreviewProps {
  layout: LayoutDef;
  width?: number;
  showMeasurements?: boolean;
}

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

function getBoundingBox(poly: number[][]): BoundingBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    w: maxX - minX,
    h: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function LayoutPreview({ layout, width = 120, showMeasurements = false }: LayoutPreviewProps) {
  const pts = (a: number[][]) => a.map(([x, y]) => `${x},${y}`).join(' ');
  const line = layout.territory.attacker;

  // Compact Mode (for list items & cards)
  if (!showMeasurements) {
    return (
      <svg
        viewBox="0 0 44 60"
        width={width}
        height={(width * 60) / 44}
        className="layout-preview"
        aria-label={`Layout ${layout.number}`}
      >
        <rect width="44" height="60" fill="#ece7dc" />
        <polygon points={pts(layout.zones.attacker)} fill={ZONE_ATTACKER} />
        <polygon points={pts(layout.zones.defender)} fill={ZONE_DEFENDER} />
        <polygon points={pts(line)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={0.35} strokeDasharray="1 0.8" />
        {layout.terrain.map((t, i) => (
          <g key={i}>
            <polygon points={pts(t.poly)} fill="#d8d2c4" stroke="#222" strokeWidth={0.3} />
            {t.walls.map((w, k) => (
              <line key={k} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#2f6b4f" strokeWidth={0.7} />
            ))}
            {t.obstacles.map((w, k) => (
              <line key={`o${k}`} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#d98b1f" strokeWidth={0.6} />
            ))}
            {!t.walls.length && !t.obstacles.length && !t.box && stripBarricade(t.poly).map((w, k) => (
              <line key={`b${k}`} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#d98b1f" strokeWidth={0.6} />
            ))}
          </g>
        ))}
        {layout.objectives.map((o, i) => (
          <circle
            key={i}
            cx={o.x}
            cy={o.y}
            r={1.3}
            fill="#fff"
            stroke={o.owner === 'attacker' ? '#b22222' : o.owner === 'defender' ? '#0e6fa4' : o.type === 'central' ? '#111' : '#1f6f75'}
            strokeWidth={0.6}
          />
        ))}
        <rect width="44" height="60" fill="none" stroke="#111" strokeWidth={0.6} />
      </svg>
    );
  }

  // =========================================================================
  // TOURNAMENT COMPANION MEASUREMENT MODE (เหมือนรูปคู่มือจัดโต๊ะแข่งจริง 100%)
  // =========================================================================
  // Canvas expanded to -7.5, -6.5, 59, 73 to display dimension rulers & brackets
  const vbX = -7.5;
  const vbY = -6.5;
  const vbW = 59;
  const vbH = 73;
  const dep = layout.deployment;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      width={width}
      height={(width * vbH) / vbW}
      className="layout-preview tournament-mode"
      aria-label={`Official Layout ${layout.number} with Real-World Measurements`}
      style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))' }}
    >
      <defs>
        {/* Dimension Arrow Markers */}
        <marker id="dim-arrow-start" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto-start-reverse">
          <polygon points="0,5 10,2 10,8" fill="#334155" />
        </marker>
        <marker id="dim-arrow-end" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto">
          <polygon points="0,2 10,5 0,8" fill="#334155" />
        </marker>
        <marker id="dim-arrow-red" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto">
          <polygon points="0,2 10,5 0,8" fill="#b22222" />
        </marker>
        <marker id="dim-arrow-blue" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto">
          <polygon points="0,2 10,5 0,8" fill="#0e6fa4" />
        </marker>
      </defs>

      {/* Board Base Surface */}
      <rect x="0" y="0" width="44" height="60" fill="#f4efe6" stroke="#1f2937" strokeWidth="0.8" />

      {/* Subtle 10" Grid Lines */}
      {[10, 20, 30, 40].map((x) => (
        <line key={`gx${x}`} x1={x} y1="0" x2={x} y2="60" stroke="#000000" strokeWidth="0.15" strokeDasharray="1 3" opacity="0.15" />
      ))}
      {[10, 20, 30, 40, 50].map((y) => (
        <line key={`gy${y}`} x1="0" y1={y} x2="44" y2={y} stroke="#000000" strokeWidth="0.15" strokeDasharray="1 3" opacity="0.15" />
      ))}

      {/* Deployment Zones (Colored fills) */}
      <polygon points={pts(layout.zones.attacker)} fill={ZONE_ATTACKER} stroke="#b22222" strokeWidth="0.4" />
      <polygon points={pts(layout.zones.defender)} fill={ZONE_DEFENDER} stroke="#0e6fa4" strokeWidth="0.4" />

      {/* Territory Boundary Line */}
      <polygon points={pts(line)} fill="none" stroke="#111827" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />

      {/* Deployment-Specific Centerline & Exclusions */}
      {dep === 'hammer-and-anvil' && (
        <g>
          <line x1="0" y1="30" x2="44" y2="30" stroke="#1e293b" strokeWidth="0.45" strokeDasharray="2 1.5" />
          <rect x="14.5" y="28.9" width="15" height="2.2" rx="0.7" fill="#1e293b" opacity="0.9" />
          <text x="22" y="30.5" fill="#ffffff" fontSize="1.1" fontWeight="800" textAnchor="middle">
            CENTER LINE (30")
          </text>
        </g>
      )}

      {dep === 'dawn-of-war' && (
        <g>
          <line x1="22" y1="0" x2="22" y2="60" stroke="#1e293b" strokeWidth="0.45" strokeDasharray="2 1.5" />
          <rect x="14.5" y="28.9" width="15" height="2.2" rx="0.7" fill="#1e293b" opacity="0.9" />
          <text x="22" y="30.5" fill="#ffffff" fontSize="1.1" fontWeight="800" textAnchor="middle">
            CENTER LINE (22")
          </text>
        </g>
      )}

      {dep === 'search-and-destroy' && (
        <g>
          {/* 4 Quarters */}
          <line x1="22" y1="0" x2="22" y2="60" stroke="#1e293b" strokeWidth="0.4" strokeDasharray="2 1.5" opacity="0.7" />
          <line x1="0" y1="30" x2="44" y2="30" stroke="#1e293b" strokeWidth="0.4" strokeDasharray="2 1.5" opacity="0.7" />
          {/* 9" Center Exclusion Circle */}
          <circle cx="22" cy="30" r="9" fill="none" stroke="#b22222" strokeWidth="0.45" strokeDasharray="1.5 1" opacity="0.85" />
          <rect x="13" y="20.1" width="18" height="2.2" rx="0.7" fill="#b22222" opacity="0.9" />
          <text x="22" y="21.7" fill="#ffffff" fontSize="1.05" fontWeight="800" textAnchor="middle">
            9" CENTER EXCLUSION
          </text>
        </g>
      )}

      {dep === 'sweeping-engagement' && (
        <g>
          <line x1="0" y1="30" x2="44" y2="30" stroke="#1e293b" strokeWidth="0.4" strokeDasharray="2 1.5" opacity="0.7" />
          <rect x="15" y="28.9" width="14" height="2.2" rx="0.7" fill="#1e293b" opacity="0.9" />
          <text x="22" y="30.5" fill="#ffffff" fontSize="1.1" fontWeight="800" textAnchor="middle">
            CENTER DIVIDER (30")
          </text>
        </g>
      )}

      {/* Terrain Pieces & Bounding Box Size Badges */}
      {layout.terrain.map((t, i) => {
        const bb = getBoundingBox(t.poly);
        const wInches = Math.round(bb.w);
        const hInches = Math.round(bb.h);
        const showBadge = bb.w >= 3 && bb.h >= 2;

        return (
          <g key={i}>
            {/* Terrain Polygon Footprint */}
            <polygon points={pts(t.poly)} fill="#ded8cb" stroke="#1f2937" strokeWidth="0.35" />

            {/* Ruin Walls (Green) */}
            {t.walls.map((w, k) => (
              <line key={k} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#1b5e20" strokeWidth="0.85" strokeLinecap="round" />
            ))}

            {/* Obstacles & Pipes (Orange) */}
            {t.obstacles.map((w, k) => (
              <line key={`o${k}`} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#d97706" strokeWidth="0.7" strokeLinecap="round" />
            ))}

            {/* Barricade Strips */}
            {!t.walls.length && !t.obstacles.length && !t.box && stripBarricade(t.poly).map((w, k) => (
              <line key={`b${k}`} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#d97706" strokeWidth="0.7" strokeLinecap="round" />
            ))}

            {/* Footprint Dimension Badge (e.g. 12"×8", 10"×4", 6"×4") */}
            {showBadge && (
              <g transform={`translate(${bb.cx}, ${bb.cy})`}>
                <rect x="-3.2" y="-1.1" width="6.4" height="2.2" rx="0.6" fill="#0f172a" stroke="#475569" strokeWidth="0.25" opacity="0.9" />
                <text x="0" y="0.5" fill="#f8fafc" fontSize="1.0" fontWeight="700" textAnchor="middle">
                  {wInches}"×{hInches}"
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Objective Markers (Numbered 1..N with Coordinate Badges) */}
      {layout.objectives.map((o, i) => {
        const objNumber = i + 1;
        const isAttacker = o.owner === 'attacker';
        const isDefender = o.owner === 'defender';
        const ringColor = isAttacker ? '#b22222' : isDefender ? '#0e6fa4' : '#1e293b';
        const badgeYOffset = o.y > 54 ? -2.7 : 2.7;

        return (
          <g key={i}>
            {/* Guide line to nearest side edge */}
            {o.x < 12 && (
              <line x1="0" y1={o.y} x2={o.x} y2={o.y} stroke="#94a3b8" strokeWidth="0.2" strokeDasharray="0.8 0.8" />
            )}
            {o.x > 32 && (
              <line x1="44" y1={o.y} x2={o.x} y2={o.y} stroke="#94a3b8" strokeWidth="0.2" strokeDasharray="0.8 0.8" />
            )}

            {/* 40mm Objective Base Ring (Scale ~1.57" base) */}
            <circle cx={o.x} cy={o.y} r={1.6} fill="#ffffff" stroke="#0f172a" strokeWidth="0.35" />
            <circle cx={o.x} cy={o.y} r={1.25} fill={ringColor} stroke="#ffffff" strokeWidth="0.25" />
            <text x={o.x} y={o.y + 0.45} fill="#ffffff" fontSize="1.2" fontWeight="900" textAnchor="middle">
              {objNumber}
            </text>

            {/* Coordinate Pill: e.g. "23.5", 12.5"" */}
            <g transform={`translate(${o.x}, ${o.y + badgeYOffset})`}>
              <rect x="-4.2" y="-1.0" width="8.4" height="2.0" rx="0.5" fill="#ffffff" stroke="#334155" strokeWidth="0.25" opacity="0.96" />
              <text x="0" y="0.45" fill="#0f172a" fontSize="0.95" fontWeight="800" textAnchor="middle">
                {o.x.toFixed(1)}", {o.y.toFixed(1)}"
              </text>
            </g>
          </g>
        );
      })}

      {/* Board Outer Boundary Frame */}
      <rect x="0" y="0" width="44" height="60" fill="none" stroke="#0f172a" strokeWidth="0.7" />

      {/* Table Ticks (Every 10 inches along all 4 edges) */}
      {[0, 10, 20, 22, 30, 40, 44].map((x) => (
        <g key={`tt${x}`}>
          <line x1={x} y1="0" x2={x} y2="-0.8" stroke="#0f172a" strokeWidth="0.3" />
          <line x1={x} y1="60" x2={x} y2="60.8" stroke="#0f172a" strokeWidth="0.3" />
        </g>
      ))}
      {[0, 10, 18, 20, 30, 40, 42, 50, 60].map((y) => (
        <g key={`ty${y}`}>
          <line x1="0" y1={y} x2="-0.8" y2={y} stroke="#0f172a" strokeWidth="0.3" />
          <line x1="44" y1={y} x2="44.8" y2={y} stroke="#0f172a" strokeWidth="0.3" />
        </g>
      ))}

      {/* ================================================================= */}
      {/* OUTER RULERS & DIMENSION ANNOTATIONS                              */}
      {/* ================================================================= */}

      {/* TOP RULER: 44" TABLE WIDTH */}
      <g>
        <line x1="0" y1="-2.8" x2="44" y2="-2.8" stroke="#334155" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-end)" />
        <line x1="0" y1="-4.2" x2="0" y2="-0.5" stroke="#64748b" strokeWidth="0.25" />
        <line x1="44" y1="-4.2" x2="44" y2="-0.5" stroke="#64748b" strokeWidth="0.25" />
        <rect x="14" y="-3.9" width="16" height="2.2" rx="0.7" fill="#0f172a" />
        <text x="22" y="-2.35" fill="#f8fafc" fontSize="1.15" fontWeight="800" textAnchor="middle">
          44" TABLE WIDTH
        </text>
      </g>

      {/* LEFT RULER: 60" TABLE LENGTH */}
      <g>
        <line x1="-3.4" y1="0" x2="-3.4" y2="60" stroke="#334155" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-end)" />
        <line x1="-5.0" y1="0" x2="-0.5" y2="0" stroke="#64748b" strokeWidth="0.25" />
        <line x1="-5.0" y1="60" x2="-0.5" y2="60" stroke="#64748b" strokeWidth="0.25" />
        <g transform="translate(-3.4, 30) rotate(-90)">
          <rect x="-9" y="-1.1" width="18" height="2.2" rx="0.7" fill="#0f172a" />
          <text x="0" y="0.45" fill="#f8fafc" fontSize="1.15" fontWeight="800" textAnchor="middle">
            60" TABLE LENGTH
          </text>
        </g>
      </g>

      {/* RIGHT SIDE / BOTTOM DEPLOYMENT DEPTH CALLOUTS */}
      {dep === 'hammer-and-anvil' ? (
        <g>
          {/* Guide extensions */}
          <line x1="44" y1="0" x2="49" y2="0" stroke="#94a3b8" strokeWidth="0.2" />
          <line x1="44" y1="18" x2="49" y2="18" stroke="#94a3b8" strokeWidth="0.2" />
          <line x1="44" y1="42" x2="49" y2="42" stroke="#94a3b8" strokeWidth="0.2" />
          <line x1="44" y1="60" x2="49" y2="60" stroke="#94a3b8" strokeWidth="0.2" />

          {/* Attacker Depth: 18" */}
          <line x1="47.2" y1="0.6" x2="47.2" y2="17.4" stroke="#b22222" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-red)" />
          <rect x="45.0" y="7.5" width="4.4" height="3.0" rx="0.6" fill="#b22222" />
          <text x="47.2" y="9.5" fill="#ffffff" fontSize="1.1" fontWeight="800" textAnchor="middle">18"</text>

          {/* No Man's Land: 24" */}
          <line x1="47.2" y1="18.6" x2="47.2" y2="41.4" stroke="#334155" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-end)" />
          <rect x="45.0" y="28.5" width="4.4" height="3.0" rx="0.6" fill="#334155" />
          <text x="47.2" y="30.5" fill="#ffffff" fontSize="1.1" fontWeight="800" textAnchor="middle">24"</text>

          {/* Defender Depth: 18" */}
          <line x1="47.2" y1="42.6" x2="47.2" y2="59.4" stroke="#0e6fa4" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-blue)" />
          <rect x="45.0" y="49.5" width="4.4" height="3.0" rx="0.6" fill="#0e6fa4" />
          <text x="47.2" y="51.5" fill="#ffffff" fontSize="1.1" fontWeight="800" textAnchor="middle">18"</text>
        </g>
      ) : dep === 'dawn-of-war' ? (
        <g>
          {/* Guide extensions along bottom */}
          <line x1="0" y1="60" x2="0" y2="64.5" stroke="#94a3b8" strokeWidth="0.2" />
          <line x1="12" y1="60" x2="12" y2="64.5" stroke="#94a3b8" strokeWidth="0.2" />
          <line x1="32" y1="60" x2="32" y2="64.5" stroke="#94a3b8" strokeWidth="0.2" />
          <line x1="44" y1="60" x2="44" y2="64.5" stroke="#94a3b8" strokeWidth="0.2" />

          {/* Attacker Depth: 12" */}
          <line x1="0.6" y1="63" x2="11.4" y2="63" stroke="#b22222" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-red)" />
          <rect x="4.2" y="61.8" width="3.6" height="2.4" rx="0.5" fill="#b22222" />
          <text x="6" y="63.5" fill="#ffffff" fontSize="1.05" fontWeight="800" textAnchor="middle">12"</text>

          {/* No Man's Land: 20" */}
          <line x1="12.6" y1="63" x2="31.4" y2="63" stroke="#334155" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-end)" />
          <rect x="20.2" y="61.8" width="3.6" height="2.4" rx="0.5" fill="#334155" />
          <text x="22" y="63.5" fill="#ffffff" fontSize="1.05" fontWeight="800" textAnchor="middle">20"</text>

          {/* Defender Depth: 12" */}
          <line x1="32.6" y1="63" x2="43.4" y2="63" stroke="#0e6fa4" strokeWidth="0.35" markerStart="url(#dim-arrow-start)" markerEnd="url(#dim-arrow-blue)" />
          <rect x="36.2" y="61.8" width="3.6" height="2.4" rx="0.5" fill="#0e6fa4" />
          <text x="38" y="63.5" fill="#ffffff" fontSize="1.05" fontWeight="800" textAnchor="middle">12"</text>
        </g>
      ) : dep === 'search-and-destroy' ? (
        <g>
          {/* Halfway markers */}
          <rect x="44.8" y="28.8" width="4.8" height="2.4" rx="0.5" fill="#0f172a" />
          <text x="47.2" y="30.5" fill="#ffffff" fontSize="1.0" fontWeight="700" textAnchor="middle">30"</text>
          <rect x="20" y="61.5" width="4.0" height="2.4" rx="0.5" fill="#0f172a" />
          <text x="22" y="63.2" fill="#ffffff" fontSize="1.0" fontWeight="700" textAnchor="middle">22"</text>
        </g>
      ) : dep === 'sweeping-engagement' ? (
        <g>
          <line x1="44" y1="30" x2="49" y2="30" stroke="#94a3b8" strokeWidth="0.2" />
          <rect x="44.8" y="28.8" width="4.8" height="2.4" rx="0.5" fill="#0f172a" />
          <text x="47.2" y="30.5" fill="#ffffff" fontSize="1.0" fontWeight="700" textAnchor="middle">30"</text>
        </g>
      ) : null}
    </svg>
  );
}
