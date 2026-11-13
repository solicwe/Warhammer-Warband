// SVG preview of an official terrain layout with tournament-grade physical tabletop measurement overlay
// Styled to 100% match official Chapter Approved & WTC Tournament Companion diagrams.
import type { LayoutDef } from '../engine/config';
import { stripBarricade } from '../engine/game';

// Official Tournament Companion Zone Colors
const ZONE_ATTACKER = '#8f1a1d'; // Crimson Red
const ZONE_DEFENDER = '#1b4971'; // Steel Blue
const TABLE_BG = '#ede7d8'; // Official Parchment / Light Sand Table Surface

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
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
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

function fmtDim(val: number): string {
  const rounded = Math.round(val * 4) / 4;
  if (Math.abs(rounded - Math.round(rounded)) < 0.01) {
    return `${Math.round(rounded)}"`;
  }
  return `${rounded * 2 === Math.round(rounded * 2) ? rounded.toFixed(1) : rounded.toFixed(2)}"`;
}

interface DimLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  tickLen?: number;
  color?: string;
  textSide?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  textOffset?: number;
}

function DimensionLine({
  x1,
  y1,
  x2,
  y2,
  label,
  tickLen = 1.0,
  color = '#ffffff',
  textSide = 'center',
  textOffset = 0,
}: DimLineProps) {
  const isHoriz = Math.abs(y1 - y2) < 0.001;
  const isVert = Math.abs(x1 - x2) < 0.001;

  let tx = (x1 + x2) / 2;
  let ty = (y1 + y2) / 2;

  if (isHoriz) {
    if (textSide === 'top') ty -= 0.8 + textOffset;
    else if (textSide === 'bottom') ty += 1.3 + textOffset;
    else ty += 0.4 + textOffset;
  } else if (isVert) {
    if (textSide === 'left') tx -= 1.4 + textOffset;
    else if (textSide === 'right') tx += 1.4 + textOffset;
    ty += 0.4;
  }

  return (
    <g className="dim-line">
      {/* Main dimension line */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={0.32} strokeLinecap="round" />
      {/* Perpendicular end ticks */}
      {isHoriz && (
        <>
          <line x1={x1} y1={y1 - tickLen / 2} x2={x1} y2={y1 + tickLen / 2} stroke={color} strokeWidth={0.32} strokeLinecap="round" />
          <line x1={x2} y1={y2 - tickLen / 2} x2={x2} y2={y2 + tickLen / 2} stroke={color} strokeWidth={0.32} strokeLinecap="round" />
        </>
      )}
      {isVert && (
        <>
          <line x1={x1 - tickLen / 2} y1={y1} x2={x1 + tickLen / 2} y2={y1} stroke={color} strokeWidth={0.32} strokeLinecap="round" />
          <line x1={x2 - tickLen / 2} y1={y2} x2={x2 + tickLen / 2} y2={y2} stroke={color} strokeWidth={0.32} strokeLinecap="round" />
        </>
      )}
      {/* Bold high-contrast white text with crisp dark outline */}
      <text
        x={tx}
        y={ty}
        fill={color}
        fontSize="1.15"
        fontWeight="800"
        fontFamily="Oswald, sans-serif"
        textAnchor="middle"
        style={{
          paintOrder: 'stroke fill',
          stroke: '#000000',
          strokeWidth: '0.42px',
          strokeLinejoin: 'round',
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </text>
    </g>
  );
}

export function LayoutPreview({ layout, width = 120, showMeasurements = false }: LayoutPreviewProps) {
  const pts = (a: number[][]) => a.map(([x, y]) => `${x},${y}`).join(' ');
  const line = layout.territory.attacker;

  // =========================================================================
  // COMPACT MODE (Cards, Carousels, Dropdowns)
  // =========================================================================
  if (!showMeasurements) {
    return (
      <svg
        viewBox="0 0 44 60"
        width={width}
        height={(width * 60) / 44}
        className="layout-preview"
        aria-label={`Layout ${layout.number}`}
      >
        <rect width="44" height="60" fill={TABLE_BG} />
        <polygon points={pts(layout.zones.attacker)} fill={ZONE_ATTACKER} opacity={0.88} />
        <polygon points={pts(layout.zones.defender)} fill={ZONE_DEFENDER} opacity={0.88} />
        <polygon points={pts(line)} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth={0.35} strokeDasharray="1 0.8" />
        {layout.terrain.map((t, i) => (
          <g key={i}>
            <polygon points={pts(t.poly)} fill="#d4d8dd" stroke="#222" strokeWidth={0.28} />
            {t.walls.map((w, k) => (
              <line key={k} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#15803d" strokeWidth={0.75} strokeLinecap="round" />
            ))}
            {t.obstacles.map((w, k) => (
              <line key={`o${k}`} x1={w[0]} y1={w[1]} x2={w[2]} y2={w[3]} stroke="#d97706" strokeWidth={0.65} strokeLinecap="round" />
            ))}
            {!t.walls.length && !t.obstacles.length && !t.box && stripBarricade(t.poly).map((w, k) => (
              <line key={`b${k}`} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#d97706" strokeWidth={0.65} strokeLinecap="round" />
            ))}
          </g>
        ))}
        {layout.objectives.map((o, i) => (
          <circle
            key={i}
            cx={o.x}
            cy={o.y}
            r={1.3}
            fill="#ffffff"
            stroke={o.owner === 'attacker' ? '#8f1a1d' : o.owner === 'defender' ? '#1b4971' : o.type === 'central' ? '#1e293b' : '#0e7490'}
            strokeWidth={0.6}
          />
        ))}
        <rect width="44" height="60" fill="none" stroke="#111" strokeWidth={0.6} />
      </svg>
    );
  }

  // =========================================================================
  // TOURNAMENT COMPANION INSPECT & MEASUREMENT MODE (Official WTC / GW Style)
  // =========================================================================
  const dep = layout.deployment;

  // Bounding boxes of all terrain pieces
  const terrainBoxes = layout.terrain.map((t, idx) => ({
    idx,
    terrain: t,
    bb: getBoundingBox(t.poly),
  }));

  // Identify key quadrant ruins for CAD measurements
  const majorRuins = terrainBoxes.filter((item) => item.bb.w >= 3 || item.bb.h >= 2);

  // Bottom-Left Ruin (cx < 20 && cy > 30)
  const botLeftRuin = majorRuins
    .filter((r) => r.bb.cx < 20 && r.bb.cy > 30)
    .sort((a, b) => b.bb.w * b.bb.h - a.bb.w * a.bb.h)[0];

  // Bottom-Right Ruin (cx > 24 && cy > 30)
  const botRightRuin = majorRuins
    .filter((r) => r.bb.cx > 24 && r.bb.cy > 30)
    .sort((a, b) => b.bb.w * b.bb.h - a.bb.w * a.bb.h)[0];

  // Center Ruin (nearest to center 22, 30)
  const centerRuin = majorRuins
    .filter((r) => r.bb.cy >= 20 && r.bb.cy <= 40 && r.bb.cx >= 14 && r.bb.cx <= 30)
    .sort((a, b) => Math.hypot(a.bb.cx - 22, a.bb.cy - 30) - Math.hypot(b.bb.cx - 22, b.bb.cy - 30))[0];

  // Top-Left Ruin (cx < 20 && cy <= 30)
  const topLeftRuin = majorRuins
    .filter((r) => r.bb.cx < 20 && r.bb.cy <= 30)
    .sort((a, b) => b.bb.w * b.bb.h - a.bb.w * a.bb.h)[0];

  // Top-Right Ruin (cx > 24 && cy <= 30)
  const topRightRuin = majorRuins
    .filter((r) => r.bb.cx > 24 && r.bb.cy <= 30)
    .sort((a, b) => b.bb.w * b.bb.h - a.bb.w * a.bb.h)[0];

  // ViewBox with padding around table to allow depth callout lines
  const vbX = -3.5;
  const vbY = -2.5;
  const vbW = 51;
  const vbH = 65;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      width={width}
      height={(width * vbH) / vbW}
      className="layout-preview tournament-mode"
      aria-label={`Official Layout ${layout.number} with Physical Tape Measurements`}
      style={{ filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.22))' }}
    >
      <defs>
        {/* Subtle 1" Table Grid Pattern */}
        <pattern id="table-grid-1" width="1" height="1" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="1" y2="0" stroke="#d6cfbe" strokeWidth="0.08" />
          <line x1="0" y1="0" x2="0" y2="1" stroke="#d6cfbe" strokeWidth="0.08" />
        </pattern>
        <pattern id="table-grid-5" width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="url(#table-grid-1)" />
          <line x1="0" y1="0" x2="5" y2="0" stroke="#bfb7a3" strokeWidth="0.16" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#bfb7a3" strokeWidth="0.16" />
        </pattern>

        {/* Castle / Fortress Gate Icon (for Home Objectives) */}
        <g id="icon-castle">
          <path
            d="M-0.85,-0.75 H0.85 V-0.35 H0.5 V-0.1 H0.2 V-0.35 H-0.2 V-0.1 H-0.5 V-0.35 H-0.85 Z M-0.75,-0.1 H0.75 V0.85 H-0.75 Z M-0.25,0.85 V0.4 C-0.25,0.2 0.25,0.2 0.25,0.4 V0.85 Z"
            fill="currentColor"
          />
        </g>

        {/* Skull Icon (for Expansion Objectives) */}
        <g id="icon-skull">
          <path
            d="M-0.65,-0.4 C-0.65,-0.85 0.65,-0.85 0.65,-0.4 C0.65,-0.1 0.42,0.18 0.35,0.32 V0.7 H-0.35 V0.32 C-0.42,0.18 -0.65,-0.1 -0.65,-0.4 Z"
            fill="currentColor"
          />
          <circle cx="-0.26" cy="-0.28" r="0.13" fill="#0e7490" />
          <circle cx="0.26" cy="-0.28" r="0.13" fill="#0e7490" />
          <path d="M-0.15,0.45 H-0.08 V0.65 H-0.15 Z M0.08,0.45 H0.15 V0.65 H0.08 Z" fill="#0e7490" />
        </g>

        {/* Eye Icon (for Center Objectives) */}
        <g id="icon-eye">
          <path d="M-0.85,0 C-0.5,-0.48 0.5,-0.48 0.85,0 C0.5,0.48 -0.5,0.48 -0.85,0 Z" fill="currentColor" />
          <circle cx="0" cy="0" r="0.26" fill="#1e293b" />
        </g>

        {/* Obscuring Ruin Icon (Eye with diagonal slash) */}
        <g id="icon-obscuring">
          <circle cx="0" cy="0" r="1.15" fill="#ffffff" stroke="#1e293b" strokeWidth="0.25" />
          <path d="M-0.7,0 C-0.45,-0.4 0.45,-0.4 0.7,0 C0.45,0.4 -0.45,0.4 -0.7,0 Z" fill="none" stroke="#1e293b" strokeWidth="0.2" />
          <circle cx="0" cy="0" r="0.22" fill="#1e293b" />
          <line x1="-0.85" y1="-0.85" x2="0.85" y2="0.85" stroke="#1e293b" strokeWidth="0.25" strokeLinecap="round" />
        </g>

        {/* Crossed Swords Watermark (Attacker Zone) */}
        <g id="watermark-swords" opacity="0.11">
          <g transform="rotate(45)">
            <rect x="-0.7" y="-8.5" width="1.4" height="17" rx="0.4" fill="#ffffff" />
            <rect x="-2.6" y="2.2" width="5.2" height="0.85" rx="0.25" fill="#ffffff" />
            <circle cx="0" cy="6.2" r="0.9" fill="#ffffff" />
          </g>
          <g transform="rotate(-45)">
            <rect x="-0.7" y="-8.5" width="1.4" height="17" rx="0.4" fill="#ffffff" />
            <rect x="-2.6" y="2.2" width="5.2" height="0.85" rx="0.25" fill="#ffffff" />
            <circle cx="0" cy="6.2" r="0.9" fill="#ffffff" />
          </g>
        </g>

        {/* Knight Shield Watermark (Defender Zone) */}
        <g id="watermark-shield" opacity="0.11">
          <path d="M-5.5,-7 H5.5 V-0.8 C5.5,5 0,9.5 0,9.5 C0,9.5 -5.5,5 -5.5,-0.8 Z" fill="#ffffff" />
        </g>
      </defs>

      {/* 1. Table Base Surface with 1" Tournament Grid */}
      <rect x="0" y="0" width="44" height="60" fill={TABLE_BG} />
      <rect x="0" y="0" width="44" height="60" fill="url(#table-grid-5)" />

      {/* 2. Attacker Deployment Zone (Crimson Red with Crossed Swords Watermark) */}
      <polygon points={pts(layout.zones.attacker)} fill={ZONE_ATTACKER} stroke="#6b1315" strokeWidth={0.4} />
      <g transform="translate(22, 10)">
        <use href="#watermark-swords" />
      </g>

      {/* 3. Defender Deployment Zone (Steel Blue with Shield Watermark) */}
      <polygon points={pts(layout.zones.defender)} fill={ZONE_DEFENDER} stroke="#12334f" strokeWidth={0.4} />
      <g transform="translate(22, 50)">
        <use href="#watermark-shield" />
      </g>

      {/* 4. Territory Boundary Line */}
      <polygon points={pts(line)} fill="none" stroke="#0f172a" strokeWidth={0.4} strokeDasharray="1.5 1" opacity="0.75" />

      {/* 5. Center Lines & Quadrants */}
      {/* Horizontal Center Line (Y = 30") */}
      <line x1="0" y1="30" x2="44" y2="30" stroke="#1e293b" strokeWidth={0.4} strokeDasharray="1.5 1" opacity="0.65" />
      {/* Vertical Center Line (X = 22") */}
      <line x1="22" y1="0" x2="22" y2="60" stroke="#1e293b" strokeWidth={0.4} strokeDasharray="1.5 1" opacity="0.65" />

      {/* Center Table Crosshair Marker (X=22", Y=30") */}
      <circle cx="22" cy="30" r="0.75" fill="none" stroke="#1e293b" strokeWidth="0.25" opacity="0.8" />
      <line x1="20.5" y1="30" x2="23.5" y2="30" stroke="#1e293b" strokeWidth="0.25" opacity="0.8" />
      <line x1="22" y1="28.5" x2="22" y2="31.5" stroke="#1e293b" strokeWidth="0.25" opacity="0.8" />

      {/* Table Side Edge Division Markers at Y=30" */}
      {/* Left Edge Marker */}
      <g transform="translate(0, 30)">
        <polygon points="0,-1.4 1.8,0 0,1.4" fill="#8f1a1d" />
        <circle cx="0.8" cy="1.6" r="0.8" fill="#1b4971" />
      </g>
      {/* Right Edge Marker */}
      <g transform="translate(44, 30)">
        <polygon points="0,-1.4 -1.8,0 0,1.4" fill="#8f1a1d" />
        <circle cx="-0.8" cy="1.6" r="0.8" fill="#1b4971" />
      </g>

      {/* Search and Destroy 9" Center Exclusion Bubble */}
      {dep === 'search-and-destroy' && (
        <g>
          <circle cx="22" cy="30" r="9" fill="none" stroke="#b22222" strokeWidth={0.4} strokeDasharray="1.5 1" opacity="0.85" />
          <rect x="13.5" y="20.1" width="17" height="2.0" rx="0.5" fill="#8f1a1d" />
          <text x="22" y="21.5" fill="#ffffff" fontSize="1.0" fontWeight="800" textAnchor="middle">
            9" CENTER EXCLUSION
          </text>
        </g>
      )}

      {/* 6. Terrain Pieces & Ruins */}
      {layout.terrain.map((t, i) => {
        const bb = getBoundingBox(t.poly);
        const isMajorRuin = bb.w >= 3.5 || bb.h >= 2.5;

        // Determine Obscuring icon placement at a corner facing toward center line
        const obscuringX = bb.cx < 22 ? bb.minX : bb.maxX;
        const obscuringY = bb.cy < 30 ? bb.maxY : bb.minY;

        return (
          <g key={i}>
            {/* Ruin Baseplate Footprint Polygon */}
            <polygon points={pts(t.poly)} fill="#d4d8dd" stroke="#334155" strokeWidth={0.32} />

            {/* Solid Forest Green Ruin Walls (100% WTC/GW style) */}
            {t.walls.map((w, k) => (
              <line
                key={k}
                x1={w[0]}
                y1={w[1]}
                x2={w[2]}
                y2={w[3]}
                stroke="#15803d"
                strokeWidth={0.95}
                strokeLinecap="round"
              />
            ))}

            {/* Orange/Ochre Barricades and Pipes */}
            {t.obstacles.map((w, k) => (
              <line
                key={`o${k}`}
                x1={w[0]}
                y1={w[1]}
                x2={w[2]}
                y2={w[3]}
                stroke="#d97706"
                strokeWidth={0.75}
                strokeLinecap="round"
              />
            ))}

            {!t.walls.length && !t.obstacles.length && !t.box && stripBarricade(t.poly).map((w, k) => (
              <line
                key={`b${k}`}
                x1={w.a.x}
                y1={w.a.y}
                x2={w.b.x}
                y2={w.b.y}
                stroke="#d97706"
                strokeWidth={0.75}
                strokeLinecap="round"
              />
            ))}

            {/* Obscuring (Line of Sight Blocking) Icon on corner of ruin footprint */}
            {isMajorRuin && (
              <g transform={`translate(${obscuringX}, ${obscuringY})`}>
                <use href="#icon-obscuring" />
              </g>
            )}
          </g>
        );
      })}

      {/* 7. Thematic Objective Markers (40mm Bases with Castle, Skull Diamond, and Eye Icons) */}
      {layout.objectives.map((o, i) => {
        const isAttacker = o.owner === 'attacker';
        const isDefender = o.owner === 'defender';
        const isExpansion = o.type === 'expansion';
        const isCentral = o.type === 'central';

        const badgeYOffset = o.y > 54 ? -2.6 : 2.6;

        return (
          <g key={i} className="objective-marker">
            {/* ATTACKER HOME OBJECTIVE: Red Circle with White Castle Gate */}
            {isAttacker && (
              <g transform={`translate(${o.x}, ${o.y})`}>
                <circle cx="0" cy="0" r="1.85" fill="#ffffff" stroke="#8f1a1d" strokeWidth={0.5} />
                <circle cx="0" cy="0" r="1.45" fill="#8f1a1d" />
                <g color="#ffffff">
                  <use href="#icon-castle" />
                </g>
              </g>
            )}

            {/* DEFENDER HOME OBJECTIVE: Blue Circle with White Castle Gate */}
            {isDefender && (
              <g transform={`translate(${o.x}, ${o.y})`}>
                <circle cx="0" cy="0" r="1.85" fill="#ffffff" stroke="#1b4971" strokeWidth={0.5} />
                <circle cx="0" cy="0" r="1.45" fill="#1b4971" />
                <g color="#ffffff">
                  <use href="#icon-castle" />
                </g>
              </g>
            )}

            {/* EXPANSION OBJECTIVE: Cyan/Teal Diamond with White Skull */}
            {isExpansion && (
              <g transform={`translate(${o.x}, ${o.y})`}>
                <polygon
                  points="0,-1.95 1.95,0 0,1.95 -1.95,0"
                  fill="#0e7490"
                  stroke="#ffffff"
                  strokeWidth={0.4}
                />
                <g color="#ffffff">
                  <use href="#icon-skull" />
                </g>
              </g>
            )}

            {/* CENTRAL OBJECTIVE: Slate / Teal Disc with Eye or Skull */}
            {isCentral && (
              <g transform={`translate(${o.x}, ${o.y})`}>
                <circle cx="0" cy="0" r="1.75" fill="#334155" stroke="#ffffff" strokeWidth={0.4} />
                <g color="#ffffff">
                  {i % 2 === 0 ? <use href="#icon-eye" /> : <use href="#icon-skull" />}
                </g>
              </g>
            )}

            {/* Objective Coordinates Pill: e.g. "10.5", 10.5"" */}
            <g transform={`translate(${o.x}, ${o.y + badgeYOffset})`}>
              <rect
                x="-3.8"
                y="-0.9"
                width="7.6"
                height="1.8"
                rx="0.45"
                fill="#ffffff"
                stroke="#1e293b"
                strokeWidth={0.25}
                opacity={0.96}
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))' }}
              />
              <text
                x="0"
                y="0.4"
                fill="#0f172a"
                fontSize="0.9"
                fontWeight="800"
                fontFamily="Oswald, sans-serif"
                textAnchor="middle"
              >
                {o.x.toFixed(1)}", {o.y.toFixed(1)}"
              </text>
            </g>
          </g>
        );
      })}

      {/* 8. Table Outer Frame & Edge Ticks */}
      <rect x="0" y="0" width="44" height="60" fill="none" stroke="#0f172a" strokeWidth={0.7} />
      {[0, 10, 20, 22, 30, 40, 44].map((x) => (
        <g key={`tt${x}`}>
          <line x1={x} y1="0" x2={x} y2="-0.6" stroke="#0f172a" strokeWidth={0.3} />
          <line x1={x} y1="60" x2={x} y2="60.6" stroke="#0f172a" strokeWidth={0.3} />
        </g>
      ))}
      {[0, 10, 20, 30, 40, 50, 60].map((y) => (
        <g key={`ty${y}`}>
          <line x1="0" y1={y} x2="-0.6" y2={y} stroke="#0f172a" strokeWidth={0.3} />
          <line x1="44" y1={y} x2="44.6" y2={y} stroke="#0f172a" strokeWidth={0.3} />
        </g>
      ))}

      {/* ===================================================================== */}
      {/* 9. CAD PHYSICAL TABLE MEASUREMENT LINES ("การวางระยะ")                 */}
      {/* Exactly matches real-world tape measuring setup seen in WTC diagrams! */}
      {/* ===================================================================== */}

      {/* A. Bottom-Left Ruin Measurements */}
      {botLeftRuin && (
        <g className="measurements-bot-left">
          {/* Horizontal distance from Left Table Edge (X = 0) to Left Wall/Edge */}
          <DimensionLine
            x1={0}
            y1={Math.min(58, botLeftRuin.bb.maxY + 0.4)}
            x2={botLeftRuin.bb.minX}
            y2={Math.min(58, botLeftRuin.bb.maxY + 0.4)}
            label={fmtDim(botLeftRuin.bb.minX)}
            textSide="top"
          />
          {/* Vertical distance from Bottom Table Edge (Y = 60) to Ruin Bottom */}
          <DimensionLine
            x1={Math.max(2, botLeftRuin.bb.minX - 0.4)}
            y1={botLeftRuin.bb.maxY}
            x2={Math.max(2, botLeftRuin.bb.minX - 0.4)}
            y2={60}
            label={fmtDim(60 - botLeftRuin.bb.maxY)}
            textSide="left"
          />
        </g>
      )}

      {/* B. Bottom-Right Ruin Measurements */}
      {botRightRuin && (
        <g className="measurements-bot-right">
          {/* Vertical distance from Bottom Table Edge (Y = 60) to Ruin */}
          <DimensionLine
            x1={Math.min(42, botRightRuin.bb.maxX + 0.4)}
            y1={botRightRuin.bb.maxY}
            x2={Math.min(42, botRightRuin.bb.maxX + 0.4)}
            y2={60}
            label={fmtDim(60 - botRightRuin.bb.maxY)}
            textSide="right"
          />
          {/* Horizontal distance from Right Table Edge (X = 44) to Outer Edge */}
          <DimensionLine
            x1={botRightRuin.bb.maxX}
            y1={Math.max(42, botRightRuin.bb.minY + 1.2)}
            x2={44}
            y2={Math.max(42, botRightRuin.bb.minY + 1.2)}
            label={fmtDim(44 - botRightRuin.bb.maxX)}
            textSide="top"
          />
          {/* Horizontal distance from Right Edge to Inner Wall */}
          {botRightRuin.bb.w >= 4.5 && (
            <DimensionLine
              x1={botRightRuin.bb.minX}
              y1={Math.min(56, botRightRuin.bb.maxY - 1.2)}
              x2={44}
              y2={Math.min(56, botRightRuin.bb.maxY - 1.2)}
              label={fmtDim(44 - botRightRuin.bb.minX)}
              textSide="bottom"
            />
          )}
        </g>
      )}

      {/* C. Center Ruins Measurements */}
      {centerRuin && (
        <g className="measurements-center">
          {/* Vertical distance from Top Table Edge (Y = 0) to Center Ruin */}
          <DimensionLine
            x1={centerRuin.bb.cx}
            y1={0}
            x2={centerRuin.bb.cx}
            y2={centerRuin.bb.minY}
            label={fmtDim(centerRuin.bb.minY)}
            textSide="left"
          />
          {/* Horizontal distance from Left Table Edge (X = 0) to Center Ruin */}
          <DimensionLine
            x1={0}
            y1={centerRuin.bb.cy}
            x2={centerRuin.bb.minX}
            y2={centerRuin.bb.cy}
            label={fmtDim(centerRuin.bb.minX)}
            textSide="top"
          />
        </g>
      )}

      {/* D. Top-Left / Top-Right Ruins (if applicable and non-conflicting) */}
      {topRightRuin && (
        <g className="measurements-top-right">
          <DimensionLine
            x1={topRightRuin.bb.maxX}
            y1={Math.max(4, topRightRuin.bb.minY)}
            x2={44}
            y2={Math.max(4, topRightRuin.bb.minY)}
            label={fmtDim(44 - topRightRuin.bb.maxX)}
            textSide="bottom"
          />
        </g>
      )}

      {topLeftRuin && (
        <g className="measurements-top-left">
          <DimensionLine
            x1={0}
            y1={Math.max(4, topLeftRuin.bb.minY)}
            x2={topLeftRuin.bb.minX}
            y2={Math.max(4, topLeftRuin.bb.minY)}
            label={fmtDim(topLeftRuin.bb.minX)}
            textSide="bottom"
          />
        </g>
      )}

      {/* E. Deployment Depth Callouts Along Boundaries */}
      {dep === 'hammer-and-anvil' && (
        <g className="deployment-depths">
          {/* Attacker Depth: 18" along right edge */}
          <DimensionLine
            x1={43}
            y1={0}
            x2={43}
            y2={18}
            label="18&quot;"
            textSide="left"
          />
          {/* Defender Depth: 18.5" along left edge */}
          <DimensionLine
            x1={-1.8}
            y1={41.5}
            x2={-1.8}
            y2={60}
            label="18.5&quot;"
            textSide="left"
          />
          {/* Defender Depth: 19.5" along right edge */}
          <DimensionLine
            x1={45.8}
            y1={40.5}
            x2={45.8}
            y2={60}
            label="19.5&quot;"
            textSide="right"
          />
        </g>
      )}

      {dep === 'dawn-of-war' && (
        <g className="deployment-depths">
          <DimensionLine x1={0} y1={61.5} x2={12} y2={61.5} label="12&quot;" textSide="bottom" />
          <DimensionLine x1={12} y1={61.5} x2={32} y2={61.5} label="20&quot;" textSide="bottom" />
          <DimensionLine x1={32} y1={61.5} x2={44} y2={61.5} label="12&quot;" textSide="bottom" />
        </g>
      )}

      {dep === 'sweeping-engagement' && (
        <g className="deployment-depths">
          <DimensionLine x1={-1.8} y1={0} x2={-1.8} y2={30} label="30&quot;" textSide="left" />
          <DimensionLine x1={45.8} y1={30} x2={45.8} y2={60} label="30&quot;" textSide="right" />
        </g>
      )}

      {dep === 'tipping-point' && (
        <g className="deployment-depths">
          <DimensionLine x1={0} y1={-1.5} x2={22} y2={-1.5} label="20&quot; Deep" textSide="top" />
          <DimensionLine x1={22} y1={-1.5} x2={44} y2={-1.5} label="12&quot; Deep" textSide="top" />
        </g>
      )}
    </svg>
  );
}
