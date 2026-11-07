import { memo, useEffect, useState } from 'react';
import type { FxEvent, Pt } from '../engine/types';
import type { WeaponFx } from '../engine/weaponFx';
import { energyTex, fireTex, fxTextures, type TexKind } from './fxTextures';

/** How long each kind of effect plays (ms). Most rolls are shown by the screen; charge rolls stay by their unit. */
export const FX_MS: Record<FxEvent['kind'], number> = { move: 700, place: 1300, shock: 1500, heal: 1500, attack: 1900, mortal: 1200, skill: 2800, ritual: 2600, explosion: 2400, roll: 2600, rolloff: 0, cards: 0, primary: 0, extract: 550 };
export function replayFrameDuration(events: FxEvent[]): number {
  const attackReports = events.filter((e) => e.kind === 'attack' && e.report).length;
  return Math.max(700, ...events.map((e, i) => FX_MS[e.kind] + i * 180), attackReports * 1630);
}
export interface ActiveFx { e: FxEvent; t0: number }
const LIVE = new Set<FxEvent['kind']>(['attack', 'mortal', 'skill', 'ritual', 'shock', 'heal', 'explosion', 'roll', 'extract']);

/**
 * The effects layer. It runs its own animation clock, so only these few shapes are redrawn
 * every frame — the battlefield, terrain and units underneath are left alone.
 * No SVG filters: blur / turbulence filters are what made phones stutter; glows are radial gradients instead.
 */
/** How much bigger effects are drawn: the whole table on a phone is ~60" in 400px, where an inch-sized flash is a few
 *  pixels. Zoomed out they grow (up to 2.2x), zoomed in to a fight they are their real size. Set by the layer each frame. */
let VIS = 1;
/** shots, beams and tracers: a little thinner than the rest of the effects */
let TRACE = 0.8;

export const FxLayer = memo(function FxLayer({ fx, viewW = 30, now: parentNow }: { fx: ActiveFx[]; viewW?: number; now?: number }) {
  // zoomed out, effects grow a little so they still read; not as much as the board shrinks, or a shot swamps the models
  VIS = Math.max(1, Math.min(1.6, viewW / 32));
  TRACE = VIS * 0.8;
  const live = fx.filter((a) => LIVE.has(a.e.kind) || (a.e.kind === 'move' && a.e.moveKind === 'charge') || (a.e.kind === 'place' && !!a.e.at));
  const [localNow, setLocalNow] = useState(() => performance.now());
  const now = parentNow ?? localNow;
  useEffect(() => {
    // If parent supplied now (synchronized with Board animation), do NOT run a duplicate RAF loop!
    if (parentNow !== undefined || !live.length) return;
    let raf = 0;
    // ~30 frames a second is smooth for a flash and halves the work on a phone
    let last = 0;
    const tick = (time: number) => {
      if (time - last >= 30) { last = time; setLocalNow(time); }
      if (live.some((a) => time - a.t0 < FX_MS[a.e.kind])) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fx, parentNow, live]);
  if (!live.length) return null;
  return (
    <g pointerEvents="none">
      <FxDefs />
      {live.map((a) => <FxView key={a.e.seq} a={a} now={now} />)}
    </g>
  );
});

const GLOWS: Record<string, string> = { amber: '#fbbf24', orange: '#f97316', red: '#ef4444', blue: '#60a5fa', cyan: '#67e8f9', purple: '#c084fc', green: '#a3e635', white: '#ffffff', molten: '#fde68a', pink: '#f472b6' };
type GlowColor = keyof typeof GLOWS;
/** the glow under a coloured fire (weaponFx flameTint colours) */
const TINT_GLOW: Record<string, GlowColor> = { '#a855f7': 'purple', '#ec4899': 'pink', '#3b82f6': 'blue', '#bfdbfe': 'white', '#facc15': 'amber', '#dc2626': 'red', '#22c55e': 'green', '#65a30d': 'green', '#84cc16': 'green' };

export const FxDefs = memo(function FxDefs() {
  return (
    <defs>
      {Object.entries(GLOWS).map(([k, c]) => (
        <radialGradient key={k} id={`fxg-${k}`}>
          {/* a hot core in a wide soft haze */}
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.25" stopColor={c} stopOpacity="0.65" />
          <stop offset="0.6" stopColor={c} stopOpacity="0.22" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
      ))}
      <radialGradient id="fx-smoke-g"><stop offset="0" stopColor="#4a4540" stopOpacity="0.85" /><stop offset="0.6" stopColor="#5d5852" stopOpacity="0.55" /><stop offset="1" stopColor="#6b665f" stopOpacity="0" /></radialGradient>
      <radialGradient id="fx-scorch"><stop offset="0" stopColor="#120e0a" stopOpacity="0.85" /><stop offset="0.6" stopColor="#2a2118" stopOpacity="0.5" /><stop offset="1" stopColor="#2a2118" stopOpacity="0" /></radialGradient>
      <radialGradient id="fx-blood"><stop offset="0" stopColor="#7f0d0d" stopOpacity="0.9" /><stop offset="0.7" stopColor="#5c0a0a" stopOpacity="0.6" /><stop offset="1" stopColor="#5c0a0a" stopOpacity="0" /></radialGradient>
      <linearGradient id="fx-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#67e8f9" stopOpacity="0" /><stop offset="0.7" stopColor="#a5f3fc" stopOpacity="0.55" /><stop offset="1" stopColor="#ecfeff" stopOpacity="0.9" /></linearGradient>
      <radialGradient id="fx-boom"><stop offset="0" stopColor="#fffbe6" /><stop offset="0.35" stopColor="#fbbf24" /><stop offset="0.7" stopColor="#ea580c" stopOpacity="0.8" /><stop offset="1" stopColor="#7c2d12" stopOpacity="0" /></radialGradient>
    </defs>
  );
});

/** a soft round glow */
function Glow({ at, r, color, op = 1 }: { at: Pt; r: number; color: GlowColor; op?: number }) {
  if (r <= 0 || op <= 0) return null;
  return <circle cx={at.x} cy={at.y} r={r * VIS} fill={`url(#fxg-${color})`} opacity={Math.min(1, op)} />;
}

function FxView({ a, now }: { a: ActiveFx; now: number }) {
  const e = a.e;
  const f = (now - a.t0) / FX_MS[e.kind];
  if (f < 0 || f > 1) return null;
  if (e.kind === 'mortal') {
    return (
      <g>
        {f < 0.2 && <Glow at={e.at} r={0.6 + f * 4} color="white" op={1 - f / 0.2} />}
        <Glow at={e.at} r={1 + f} color="purple" op={0.7 * (1 - f)} />
        <Shockwave at={e.at} r={1.8} k={f / 0.5} color="#c084fc" />
        <text x={e.at.x} y={e.at.y - 1 - f * 1.6} opacity={1 - f} fontSize={1} textAnchor="middle" fill="#e9d5ff" stroke="#000" strokeWidth={0.14} paintOrder="stroke" fontWeight={900}>-{e.n} MW</text>
      </g>
    );
  }
  if (e.kind === 'explosion') return <DeadlyDemiseFx e={e} f={f} />;
  if (e.kind === 'attack') return <AttackFx e={e} f={f} />;
  if (e.kind === 'place' && e.at) return <ArrivalFx at={e.at} f={f} seed={e.seq} deepStrike={e.deepStrike} label={e.label} />;
  if (e.kind === 'shock') return <ShockFx at={e.at} f={f} seed={e.seq} />;
  if (e.kind === 'heal') return <HealFx at={e.at} f={f} seed={e.seq} n={e.n} revive={!!e.revive} />;
  if (e.kind === 'move') return <ChargeFx paths={e.paths} f={f} seed={e.seq} />;
  if (e.kind === 'roll' && e.unitId && e.at) return <ChargeRollFx e={e} f={f} />;
  if (e.kind === 'ritual') return <RitualFx e={e} f={f} />;
  if (e.kind === 'extract') return <ExtractFx e={e} f={f} />;
  if (e.kind === 'skill') return e.grand ? <SkillFx e={e} f={f} /> : <SkillLite e={e} f={(now - a.t0) / SKILL_LITE_MS} />;
  return null;
}

function ChargeRollFx({ e, f }: { e: Extract<FxEvent, { kind: 'roll' }>; f: number }) {
  if (!e.at) return null;
  const fade = f > 0.78 ? (1 - f) / 0.22 : 1;
  const lift = easeOut(Math.min(1, f * 3)) * 0.35;
  return (
    <g transform={`translate(${e.at.x} ${e.at.y - 2.5 - lift})`} opacity={fade}>
      <rect x={-3.55} y={-1.05} width={7.1} height={2.1} rx={0.28} fill="rgba(12,14,17,0.94)" stroke={e.good ? '#86efac' : '#fca5a5'} strokeWidth={0.1} />
      <text x={-3.15} y={-0.35} fontSize={0.55} fill="#cbd5e1" fontWeight={800} letterSpacing={0.06}>CHARGE</text>
      {e.dice.slice(0, 2).map((v, i) => (
        <g key={i} transform={`translate(${-2.65 + i * 0.9} 0.32)`}>
          <rect x={-0.34} y={-0.38} width={0.68} height={0.68} rx={0.1} fill="#f7f4ee" stroke="#1a1a1a" strokeWidth={0.06} />
          <text y={0.2} fontSize={0.48} textAnchor="middle" fill="#171717" fontWeight={900}>{v}</text>
        </g>
      ))}
      <text x={-0.55} y={0.48} fontSize={0.48} fill="#cbd5e1">2D6</text>
      <text x={0.55} y={0.28} fontSize={0.93} fill={e.good ? '#86efac' : '#fca5a5'} fontWeight={900}>{e.result.replace(/^Charge\s*/, '')}</text>
    </g>
  );
}

type RitualEvent = Extract<FxEvent, { kind: 'ritual' }>;

/** The mark of a Ritual: warp energy gathering and turning around the caster. */
/** Crackling arcs of energy thrown out from a point: jagged forks that flicker (redrawn from the noise a few times a
 *  second), a wide faint glow, a coloured body and a white-hot core. Sharp, not a haze. */
function Arcs({ at, r, k, seed, color, n = 6, inward = false }: { at: Pt; r: number; k: number; seed: number; color: string; n?: number; inward?: boolean }) {
  if (k <= 0 || k >= 1) return null;
  const flick = Math.floor(k * 14), R = r * VIS;
  const reach = inward ? 1 - easeOut(k) * 0.7 : 0.35 + easeOut(k) * 0.65;
  // each bolt runs out along its own direction and zigzags across it (never curls back), with a short fork
  const arcs = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * Math.PI * 2 + noise(seed, i + 300) * 0.8, len = R * reach * (0.75 + noise(seed + flick, i + 301) * 0.4);
    const cx = Math.cos(a0), cy = Math.sin(a0), at0 = (d: number, w: number) => `${at.x + cx * d - cy * w},${at.y + cy * d + cx * w}`;
    const pts: string[] = [];
    for (let j = 0; j <= 6; j++) {
      const t = j / 6, d = (inward ? 1 - t * 0.85 : 0.1 + t * 0.9) * len, w = j && j < 6 ? (noise(seed + flick, i * 7 + j) - 0.5) * len * 0.22 : 0;
      pts.push(at0(d, w));
    }
    const fj = 3 + Math.floor(noise(seed, i + 302) * 2), fd = (inward ? 1 - (fj / 6) * 0.85 : 0.1 + (fj / 6) * 0.9) * len;
    const fork = [pts[fj], at0(fd + len * 0.22, (noise(seed + flick, i + 303) - 0.5) * len * 0.5)].join(' ');
    return `${pts.join(' ')}|${fork}`;
  }).flatMap((x) => x.split('|'));
  const op = Math.sin(k * Math.PI) ** 0.5;
  return (
    <g opacity={op}>
      {arcs.map((pts, i) => <polyline key={`w${i}`} points={pts} fill="none" stroke={color} strokeWidth={0.6 * TRACE} strokeLinejoin="round" opacity={0.25} />)}
      {arcs.map((pts, i) => <polyline key={`c${i}`} points={pts} fill="none" stroke={color} strokeWidth={0.18 * TRACE} strokeLinejoin="round" opacity={0.9} />)}
      {arcs.map((pts, i) => <polyline key={`h${i}`} points={pts} fill="none" stroke="#fff" strokeWidth={0.05 * TRACE} strokeLinejoin="round" />)}
    </g>
  );
}

/** a hard shockwave: a bright ring that snaps outwards and thins as it goes, with a white flash at the centre */
function Shockwave({ at, r, k, color }: { at: Pt; r: number; k: number; color: string }) {
  if (k <= 0 || k >= 1) return null;
  const R = r * VIS * (0.15 + easeOut(k) * 0.85), w = (1 - k) * 0.35 * VIS;
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={R} fill="none" stroke={color} strokeWidth={w * 2.4} opacity={0.22 * (1 - k)} />
      <circle cx={at.x} cy={at.y} r={R} fill="none" stroke={color} strokeWidth={w} opacity={0.9 * (1 - k)} />
      <circle cx={at.x} cy={at.y} r={R} fill="none" stroke="#fff" strokeWidth={w * 0.3} opacity={1 - k} />
      {k < 0.25 && <circle cx={at.x} cy={at.y} r={R * 0.7} fill="#fff" opacity={0.7 * (1 - k / 0.25)} />}
    </g>
  );
}

function Sigil({ at, r, rot, color, op }: { at: Pt; r: number; rot: number; color: string; op: number }) {
  // power gathering at the caster: arcs crawling in, flickering, over a bright core
  const k = (rot / 6) % 1;
  return <g opacity={op}><Glow at={at} r={r * 0.5} color="white" op={0.5} /><Arcs at={at} r={r} k={0.05 + k * 0.9} seed={Math.round(at.x * 7 + at.y * 3)} color={color} n={5} inward /></g>;
}

/**
 * A Ritual: a turning sigil under the sorcerer, then the spell reaches its target —
 * Doombolt a crackling warp bolt and a burst, Destiny's Ruin an eye of fate, Twist of Fate a spiral, Temporal Surge an
 * hourglass of blue light on the friendly unit. A failed test just fizzles at the caster.
 */
function RitualFx({ e, f }: { e: RitualEvent; f: number }) {
  const col = e.ritual === 'temporal-surge' ? '#67e8f9' : e.ritual === 'destinys-ruin' ? '#a3e635' : e.ritual === 'twist-of-fate' ? '#f0abfc' : '#c084fc';
  const glow: GlowColor = e.ritual === 'temporal-surge' ? 'cyan' : e.ritual === 'destinys-ruin' ? 'green' : 'purple';
  const cast = clamp01(f / 0.3), travel = clamp01((f - 0.25) / 0.25), land = clamp01((f - 0.45) / 0.55);
  const fade = f > 0.8 ? (1 - f) / 0.2 : 1;
  const seed = e.from.x * 7 + e.to.y * 13;
  if (!e.ok) {
    return (
      <g opacity={1 - f}>
        <Sigil at={e.from} r={1.4} rot={f * 3} color={col} op={0.8} />
        <Sparks at={e.from} seed={seed} k={clamp01(f * 1.4)} color={col} size={1.3} />
        <text x={e.from.x} y={e.from.y - 1.9} fontSize={0.8} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={0.12} paintOrder="stroke" fontWeight={800}>{e.name} — failed</text>
      </g>
    );
  }
  // a jagged bolt from caster to target, redrawn each frame from deterministic noise
  const bolt = () => {
    const n = 9, head = travel;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const k = (i / n) * head;
      const p = lerp(e.from, e.to, k);
      const dx = e.to.y - e.from.y, dy = e.from.x - e.to.x, L = Math.hypot(dx, dy) || 1;
      const j = i === 0 || i === n ? 0 : (noise(seed + Math.floor(f * 30), i) - 0.5) * 0.9;
      pts.push(`${p.x + (dx / L) * j},${p.y + (dy / L) * j}`);
    }
    return pts.join(' ');
  };
  return (
    <g opacity={fade}>
      <Glow at={e.from} r={1.2 + cast} color={glow} op={0.6 * (1 - travel * 0.5)} />
      <Sigil at={e.from} r={1.1 + cast * 0.4} rot={f * 4} color={col} op={0.9 * (1 - land)} />
      {travel > 0 && land < 0.6 && (e.ritual === 'doombolt' || e.ritual === 'twist-of-fate' || e.ritual === 'destinys-ruin') && (
        <g>
          <polyline points={bolt()} fill="none" stroke={col} strokeWidth={1.2} strokeLinejoin="round" opacity={0.12} />
          <polyline points={bolt()} fill="none" stroke={col} strokeWidth={0.32} strokeLinejoin="round" opacity={0.45} />
          <polyline points={bolt()} fill="none" stroke="#fff" strokeWidth={0.1} strokeLinejoin="round" />
        </g>
      )}
      {land > 0 && (
        <g>
          <Glow at={e.to} r={1.5 + land * (e.ritual === 'doombolt' ? 2.6 : 1.4)} color={glow} op={0.8 * (1 - land)} />
          {/* each Ritual lands its own way (.claude/skills/vfx) */}
          {e.ritual === 'doombolt' && <>
            <Shockwave at={e.to} r={3.2} k={clamp01(land / 0.6)} color={col} />
            <Arcs at={e.to} r={2.6} k={clamp01(land / 0.7)} seed={seed + 5} color={col} n={8} />
            <Sparks at={e.to} seed={seed + 3} k={land} color={col} size={2} />
            <DustRing at={e.to} k={land} r={2.6} seed={seed} />
          </>}
          {e.ritual === 'destinys-ruin' && (() => {
            // an eye of fate opens over the target, stares, and closes on it
            const open = land < 0.5 ? Math.sin((land / 0.5) * Math.PI / 2) : Math.cos(((land - 0.5) / 0.5) * Math.PI / 2), w = 2.4 * VIS, h = 1.1 * VIS * open;
            const { x, y } = e.to;
            return <g opacity={1 - land * 0.4}>
              <path d={`M ${x - w} ${y} Q ${x} ${y - h * 2} ${x + w} ${y} Q ${x} ${y + h * 2} ${x - w} ${y} Z`} fill={col} fillOpacity={0.12} stroke={col} strokeWidth={0.12 * VIS} />
              <circle cx={x} cy={y} r={0.55 * VIS * open} fill="none" stroke={col} strokeWidth={0.14 * VIS} />
              <circle cx={x} cy={y} r={0.22 * VIS * open} fill="#fff" />
              <Arcs at={e.to} r={2.2} k={clamp01(land / 0.8)} seed={seed + 5} color={col} n={5} inward />
            </g>;
          })()}
          {e.ritual === 'twist-of-fate' && (() => {
            // a spiral of fate winds in on the target and tightens
            const pts = Array.from({ length: 40 }, (_, i) => { const t = i / 39, a = t * Math.PI * 5 + land * 6, r = (1 - t) * 2.6 * VIS * (1 - land * 0.5); return `${e.to.x + Math.cos(a) * r},${e.to.y + Math.sin(a) * r * 0.8}`; }).join(' ');
            return <g opacity={1 - land}>
              <polyline points={pts} fill="none" stroke={col} strokeWidth={0.22 * VIS} opacity={0.35} />
              <polyline points={pts} fill="none" stroke="#fff" strokeWidth={0.06 * VIS} />
              <Sparks at={e.to} seed={seed + 3} k={land} color={col} size={1.4} />
            </g>;
          })()}
          {e.ritual === 'temporal-surge' && (() => {
            // a clock face over the unit, its hands spinning backwards; sparks of light rise and fall back
            const R = 2 * VIS, back = -land * 900;
            return <g opacity={1 - land * 0.8}>
              <circle cx={e.to.x} cy={e.to.y} r={R} fill={col} fillOpacity={0.08} stroke={col} strokeWidth={0.1 * VIS} />
              {Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <line key={i} {...ray(e.to, a, R * 0.82, R * 0.96)} stroke="#fff" strokeWidth={0.06 * VIS} />; })}
              <line {...ray(e.to, ((back) * Math.PI) / 180, 0, R * 0.75)} stroke="#fff" strokeWidth={0.1 * VIS} strokeLinecap="round" />
              <line {...ray(e.to, ((back / 12) * Math.PI) / 180, 0, R * 0.5)} stroke={col} strokeWidth={0.14 * VIS} strokeLinecap="round" />
              {Array.from({ length: 8 }, (_, i) => <circle key={`m${i}`} cx={e.to.x + (noise(seed, i + 70) - 0.5) * 2.4} cy={e.to.y + 0.8 - Math.sin((land + i / 8) * Math.PI) * 2.2} r={0.09 * VIS} fill={i % 2 ? '#fff' : col} />)}
            </g>;
          })()}
          <text x={e.to.x} y={e.to.y - 2.2 - land * 0.6} fontSize={0.85} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={0.13} paintOrder="stroke" fontWeight={900}>{e.name}{e.text ? ` · ${e.text}` : ''}</text>
        </g>
      )}
    </g>
  );
}

type AttackEvent = Extract<FxEvent, { kind: 'attack' }>;

/** deterministic 0..1 noise so an effect looks the same on every frame */
const noise = (seed: number, i: number) => { const v = Math.sin(seed * 91.17 + i * 12.9898) * 43758.5453; return v - Math.floor(v); };
const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** fast then settling: how a shockwave or a blast actually spreads */
const easeOut = (k: number) => 1 - (1 - k) ** 3;


/** Hot fragments thrown off a hit: uneven streaks that droop as they fly, sprayed back from the surface when the shot's
 *  direction is known, then a few slower embers after the first burst. */
function Sparks({ at, seed, k, color = '#fde68a', size: sz = 0.9, ang }: { at: Pt; seed: number; k: number; color?: string; size?: number; ang?: number }) {
  if (k <= 0 || k >= 1) return null;
  const size = sz * VIS;
  const dirOf = (i: number) => ang === undefined ? noise(seed, i) * Math.PI * 2 : ang + Math.PI + (noise(seed, i) - 0.5) * 2.4;
  const streak = (i: number, kk: number, sp: number, w: number) => {
    if (kk <= 0 || kk >= 1) return null;
    const a = dirOf(i), d = sp * size * (1 - (1 - kk) ** 2), len = (0.15 + noise(seed, i + 13) * 0.35) * size * (1 - kk);
    const x = at.x + Math.cos(a) * d, y = at.y + Math.sin(a) * d + kk * kk * 0.5 * size;
    return <line key={i} x1={x} y1={y} x2={x - Math.cos(a) * len} y2={y - Math.sin(a) * len - kk * 0.12} stroke={kk < 0.3 ? '#fff' : color} strokeWidth={w} strokeLinecap="round" opacity={1 - kk} />;
  };
  return (
    <g>
      {k < 0.15 && <circle cx={at.x} cy={at.y} r={(0.12 + k * 1.2) * size} fill="#fff" opacity={1 - k / 0.15} />}
      {Array.from({ length: 7 }, (_, i) => streak(i, k * 1.3, 0.5 + noise(seed, i + 7) * 1.1, 0.05))}
      {Array.from({ length: 3 }, (_, i) => streak(20 + i, (k - 0.25) * 1.5, 0.3 + noise(seed, i + 27) * 0.5, 0.07))}
    </g>
  );
}

/** a broken ring of dust thrown out along the ground: what a blast's shockwave looks like from above */
function DustRing({ at, k, r, seed, color = 'rgba(120,110,95,0.5)' }: { at: Pt; k: number; r: number; seed: number; color?: string }) {
  if (k <= 0 || k >= 1) return null;
  const R = r * easeOut(k);
  return (
    <g opacity={1 - k}>
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2 + noise(seed, i + 40) * 0.5, rr = R * (0.75 + noise(seed, i + 41) * 0.4);
        const p = { x: at.x + Math.cos(a) * rr, y: at.y + Math.sin(a) * rr }, size = (0.2 + k * 0.6) * (0.6 + noise(seed, i + 42) * 0.8) * r / 3;
        const tex = puffTex(color);
        return (tex && fxTextures()) ? <Sprite key={i} kind={tex} at={p} r={size * 1.6} op={0.9} rot={noise(seed, i + 43) * 360} v={i} /> : <circle key={i} cx={p.x} cy={p.y} r={size} fill={color} />;
      })}
    </g>
  );
}

/** one noise sprite (smoke, fire, flash, dust); null when there is no canvas, and the caller draws a plain shape */
function Sprite({ kind, at, r: r0, op = 1, rot = 0, v = 0, sx = 1, href }: { kind: TexKind; at: Pt; r: number; op?: number; rot?: number; v?: number; sx?: number; href?: string }) {
  const t = fxTextures();
  const r = r0 * VIS;
  if (!t || r <= 0 || op <= 0) return null;
  // sx stretches it along its rotation: a tongue of flame or a streak of smoke, not a round puff
  return <image href={href ?? t[kind][Math.abs(Math.floor(v)) % t[kind].length]} x={at.x - r * sx} y={at.y - r} width={r * 2 * sx} height={r * 2} opacity={Math.min(1, op)} preserveAspectRatio="none" transform={rot ? `rotate(${rot} ${at.x} ${at.y})` : undefined} />;
}

/** a ragged tendril of coloured energy (warp, power fields, sound); a faint disc where there is no canvas */
function Wisp({ at, r: r0, color, op = 1, rot = 0, v = 0 }: { at: Pt; r: number; color: string; op?: number; rot?: number; v?: number }) {
  const r = r0 * VIS;
  if (r <= 0 || op <= 0) return null;
  const t = energyTex(color);
  if (!t.length) return <circle cx={at.x} cy={at.y} r={r * 0.5} fill={color} opacity={Math.min(1, op) * 0.35} />;
  return <image href={t[Math.abs(Math.floor(v)) % t.length]} x={at.x - r * 1.4} y={at.y - r} width={r * 2.8} height={r * 2} opacity={Math.min(1, op)} preserveAspectRatio="none" transform={rot ? `rotate(${rot} ${at.x} ${at.y})` : undefined} />;
}

/** energy gathering and turning around a point: a few wisps that orbit, drift and change size, never a drawn circle */
function Swirl({ at, r, color, k, seed, n = 5, op = 1, inward = 0 }: { at: Pt; r: number; color: string; k: number; seed: number; n?: number; op?: number; inward?: number }) {
  if (op <= 0) return null;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const a = noise(seed, i + 60) * Math.PI * 2 + k * (2.5 + noise(seed, i + 61) * 2) * (i % 2 ? 1 : -1);
        const d = r * (0.35 + noise(seed, i + 62) * 0.65) * (1 - inward * k);
        const p = { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d * 0.8 };
        return <Wisp key={i} at={p} r={r * (0.45 + noise(seed, i + 63) * 0.4)} color={color} op={op * (0.55 + 0.45 * Math.sin((k + noise(seed, i + 64)) * Math.PI * 2) ** 2)} rot={(a * 180) / Math.PI + k * 90} v={i} />;
      })}
    </g>
  );
}

/** grey and brown puffs are drawn as ragged smoke or dust; tinted ones (spores, blood) stay soft discs */
const puffTex = (color: string): TexKind | null => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) return null;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return Math.max(r, g, b) - Math.min(r, g, b) <= 32 ? 'smoke' : r > g && g > b && r - b < 70 ? 'dust' : null;
};

function Puff({ at, k, r = 1, color = 'rgba(120,115,105,0.55)' }: { at: Pt; k: number; r?: number; color?: string }) {
  if (k <= 0 || k >= 1) return null;
  const tex = puffTex(color), id = Math.round(at.x * 10); // drifting puffs move in y, so x keeps their look steady
  const alpha = +(/,\s*([\d.]+)\)\s*$/.exec(color)?.[1] ?? 0.5);
  if (tex && fxTextures()) return <Sprite kind={tex} at={at} r={r * (0.5 + k * 1.2)} sx={1.35 + (id % 3) * 0.15} op={Math.min(1, alpha * 2.4) * (1 - k * k)} rot={(id * 47 + k * 40) % 360} v={id} />;
  return <circle cx={at.x} cy={at.y} r={r * VIS * (0.3 + k * 0.9)} fill={color} opacity={0.8 * (1 - k)} />;
}

/** Bits of dirt, rock or metal thrown out from a point, falling back as they fly. */
function Debris({ at, k, seed, n = 8, color = '#2b241c', size = 1 }: { at: Pt; k: number; seed: number; n?: number; color?: string; size?: number }) {
  if (k <= 0 || k >= 1) return null;
  return (
    <g opacity={1 - k * k}>
      {Array.from({ length: n }, (_, i) => {
        const a = noise(seed, i + 30) * Math.PI * 2, sp = (0.8 + noise(seed, i + 31) * 1.6) * size * VIS;
        const d = sp * (1 - (1 - k) * (1 - k)); // fast then slowing
        return <rect key={i} x={at.x + Math.cos(a) * d - 0.08} y={at.y + Math.sin(a) * d - 0.08 + k * k * 0.6} width={0.16 * size} height={0.12 * size} fill={color} transform={`rotate(${k * 500 + i * 40} ${at.x + Math.cos(a) * d} ${at.y + Math.sin(a) * d})`} />;
      })}
    </g>
  );
}

/** A blast: white flash, fireball, shockwave ring, flying debris, then a column of smoke over a scorch mark. */
function Explosion({ at, k, seed, big: b0 = 1 }: { at: Pt; k: number; seed: number; big?: number }) {
  if (k <= 0 || k >= 1) return null;
  // a hit's blast stays the size of the thing that made it: it grows with the zoom less than the shots do. `big` sizes
  // what is drawn here; `hb` goes to Glow, Sprite, DustRing and Debris, which scale by the zoom themselves
  const big = b0 * Math.sqrt(VIS) * 0.7, hb = big / VIS;
  const fire = clamp01(k / 0.45), ring = clamp01(k / 0.35), smoke = clamp01((k - 0.1) / 0.9);
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={1.6 * big} fill="url(#fx-scorch)" opacity={Math.min(1, k * 4) * (1 - smoke * 0.3)} />
      {ring < 1 && <circle cx={at.x} cy={at.y} r={(0.5 + easeOut(ring) * 3) * big} fill="none" stroke="#fde68a" strokeWidth={0.12 * (1 - ring) * big} opacity={0.6 * (1 - ring)} />}
      <DustRing at={at} k={ring} r={2 * hb} seed={seed} />
      <g opacity={0.9 * (1 - smoke)}>
        {Array.from({ length: 3 }, (_, i) => {
          const a = noise(seed, i + 70) * Math.PI * 2, d = smoke * (0.6 + noise(seed, i + 71)) * big;
          const p = { x: at.x + Math.cos(a) * d * 0.7, y: at.y + Math.sin(a) * d * 0.7 - smoke * 1.4 * big }, rr = (0.5 + smoke * 1.0) * big * (0.7 + noise(seed, i + 72) * 0.5);
          return fxTextures() ? <Sprite key={i} kind="smoke" at={p} r={(rr / VIS) * 1.2} sx={1.4} rot={noise(seed, i + 73) * 360 + smoke * 30} v={i} /> : <circle key={i} cx={p.x} cy={p.y} r={rr} fill="url(#fx-smoke-g)" />;
        })}
      </g>
      {fire < 1 && (
        <g>
          {/* a lumpy fireball of a few overlapping blobs, not one perfect disc, and only a brief flash */}
          {Array.from({ length: 3 }, (_, i) => {
            const a = noise(seed, i + 80) * Math.PI * 2, d = (0.2 + fire * 0.7) * big * noise(seed, i + 81);
            const p = { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d - fire * 0.4 * big }, rr = (0.4 + fire * 1.3) * big * (0.7 + noise(seed, i + 82) * 0.5);
            return fxTextures() ? <Sprite key={i} kind="fire" at={p} r={(rr / VIS) * 1.2} sx={1.6} op={1 - fire * fire} rot={(Math.atan2(p.y - at.y, p.x - at.x) * 180) / Math.PI} v={i} /> : <circle key={i} cx={p.x} cy={p.y} r={rr} fill="url(#fx-boom)" opacity={1 - fire} />;
          })}
          {fire < 0.15 && <Glow at={at} r={(0.7 + fire * 3) * hb} color="molten" op={1 - fire / 0.15} />}
          <Glow at={at} r={(1.4 + fire * 1.2) * hb} color="orange" op={0.6 * (1 - fire)} />
        </g>
      )}
      <Debris at={at} k={clamp01(k / 0.6)} seed={seed} n={5} size={hb} />
    </g>
  );
}

function DeadlyDemiseFx({ e, f }: { e: Extract<FxEvent, { kind: 'explosion' }>; f: number }) {
  const wave = easeOut(clamp01(f / 0.42));
  const fade = f > 0.84 ? (1 - f) / 0.16 : 1;
  const label = e.title ?? `DEADLY DEMISE · ${e.range}" · ${e.hits} unit${e.hits === 1 ? '' : 's'} hit`;
  const boxW = Math.max(6.6, label.length * 0.3 + 0.8);
  return (
    <g>
      {f < 0.65 && <Explosion at={e.at} k={f / 0.65} seed={e.seq} big={e.range >= 6 ? 1.3 : 0.9} />}
      <circle cx={e.at.x} cy={e.at.y} r={e.radius * wave} fill={e.range >= 6 ? "rgba(234,88,12,0.14)" : "rgba(249,115,22,0.08)"} stroke={e.range >= 6 ? "#ea580c" : "#fdba74"} strokeWidth={0.2} strokeDasharray="0.45 0.25" opacity={fade * 0.85} />
      <g opacity={fade}>
        <rect x={e.at.x - boxW / 2} y={e.at.y - e.radius * wave - 1.05} width={boxW} height={0.9} rx={0.2} fill="rgba(12,14,17,0.92)" stroke={e.range >= 6 ? "#ea580c" : "#fdba74"} strokeWidth={0.07} />
        <text x={e.at.x} y={e.at.y - e.radius * wave - 0.42} textAnchor="middle" fontSize={0.56} fill="#fff7ed" stroke="#111" strokeWidth={0.08} paintOrder="stroke" fontWeight={900}>
          {label}
        </text>
      </g>
    </g>
  );
}


/** per weapon look: how many shots are drawn, over how much of the effect, and how long one shot flies */
const SHOT: Record<WeaponFx, { max: number; span: number; travel: number }> = {
  bolt: { max: 14, span: 0.34, travel: 0.09 },
  heavyBolt: { max: 10, span: 0.36, travel: 0.1 },
  gatling: { max: 26, span: 0.42, travel: 0.07 },
  shoota: { max: 16, span: 0.4, travel: 0.1 },
  shotgun: { max: 4, span: 0.3, travel: 0.06 },
  sniper: { max: 3, span: 0.3, travel: 0.02 },
  pulse: { max: 10, span: 0.34, travel: 0.08 },
  plasma: { max: 6, span: 0.34, travel: 0.2 },
  las: { max: 4, span: 0.3, travel: 0.01 },
  melta: { max: 3, span: 0.26, travel: 0.01 },
  volkite: { max: 5, span: 0.3, travel: 0.01 },
  grav: { max: 4, span: 0.3, travel: 0.22 },
  lightning: { max: 5, span: 0.3, travel: 0.01 },
  psychic: { max: 4, span: 0.3, travel: 0.2 },
  flame: { max: 4, span: 0.2, travel: 0.18 },
  missile: { max: 4, span: 0.3, travel: 0.22 },
  shell: { max: 4, span: 0.3, travel: 0.24 },
  gauss: { max: 6, span: 0.26, travel: 0.1 },
  shuriken: { max: 10, span: 0.32, travel: 0.12 },
  bio: { max: 8, span: 0.3, travel: 0.15 },
  sonic: { max: 4, span: 0.35, travel: 0.18 },
  cryo: { max: 4, span: 0.3, travel: 0.01 },
  arrow: { max: 8, span: 0.35, travel: 0.16 },
  slash: { max: 10, span: 0.42, travel: 0.06 },
  power: { max: 10, span: 0.42, travel: 0.06 },
  chain: { max: 10, span: 0.42, travel: 0.06 },
  claw: { max: 8, span: 0.42, travel: 0.06 },
  crush: { max: 5, span: 0.42, travel: 0.08 },
};
const MELEE = new Set<WeaponFx>(['slash', 'power', 'chain', 'claw', 'crush']);
const LEGACY: Record<string, WeaponFx> = { bullet: 'bolt', beam: 'las', flame: 'flame', blast: 'shell', melee: 'slash' };

/** tracer colours: [glow, core, impact glow] */
const TRACER: Partial<Record<WeaponFx, [string, string, GlowColor]>> = {
  bolt: ['#f59e0b', '#fff7d6', 'orange'],
  heavyBolt: ['#f97316', '#fff1c2', 'orange'],
  gatling: ['#fbbf24', '#fffbe6', 'amber'],
  shoota: ['#facc15', '#fef9c3', 'amber'],
  pulse: ['#22d3ee', '#ecfeff', 'cyan'],
  shotgun: ['#f59e0b', '#fff7d6', 'amber'],
  gauss: ['#22c55e', '#bbf7d0', 'green'],
  shuriken: ['#38bdf8', '#e0f2fe', 'cyan'],
  bio: ['#84cc16', '#d9f99d', 'green'],
  sonic: ['#ec4899', '#fbcfe8', 'pink'],
};

/** Shooting / melee effect: every weapon in the attack has its own look; then damage and casualties. */
export function AttackFx({ e, f }: { e: AttackEvent; f: number }) {
  const shooters = e.shooters?.length ? e.shooters : [e.from];
  const victims = e.victims?.length ? e.victims : [e.to];
  const seed = e.seq;
  const volleys = e.volleys?.length ? e.volleys
    : [{ fx: LEGACY[e.style ?? (e.attackKind === 'fight' ? 'melee' : 'bullet')] ?? 'bolt', shots: e.shots ?? 6, hits: e.hits ?? e.shots ?? 6, models: shooters.length }];
  const after = clamp01((f - 0.5) / 0.5); // damage numbers and casualties
  // at most ~20 shots drawn for the whole attack, shared between its weapons: a big unit still reads as one volley
  const want = volleys.map((v) => Math.min((SHOT[v.fx] ?? SHOT.bolt).max, Math.max(v.fx === 'gatling' ? 8 : 1, v.shots)));
  const budget = Math.min(1, 20 / Math.max(1, want.reduce((a, b) => a + b, 0)));
  const under: React.ReactNode[] = []; // smoke, dirt
  const over: React.ReactNode[] = []; // light
  volleys.forEach((v, vi) => {
    const S = SHOT[v.fx] ?? SHOT.bolt;
    // how hard this weapon hits: a lasgun's flash is small, a lascannon's is wide and long (old saves have no pow)
    const P = v.pow ?? 1;
    const vStart = volleys.length > 1 ? (vi / volleys.length) * 0.16 : 0;
    // the models that fire this weapon (a heavy weapon is one model, a squad's bolters are many)
    const cnt = Math.max(1, Math.min(shooters.length, v.models || 1));
    const off = (vi * 5) % shooters.length;
    const from = (i: number) => (v.from?.length ? v.from[i % v.from.length] : shooters[(off + (i % cnt)) % shooters.length]);
    const n = Math.max(1, Math.round(want[vi] * budget));
    const hitShare = v.shots ? v.hits / v.shots : 1;
    for (let i = 0; i < n; i++) {
      const sd = seed * 7 + vi * 101 + i;
      const t0 = vStart + (i / n) * S.span + noise(sd, 40) * 0.03;
      const base = from(i);
      const tgt = victims[Math.floor(noise(sd, 3) * victims.length) % victims.length];
      const hit = noise(sd, 5) < hitShare;
      const spread = v.fx === 'shoota' ? 6 : v.fx === 'gatling' ? 3 : 4;
      const impact = hit ? { x: tgt.x + (noise(sd, 13) - 0.5) * 0.5, y: tgt.y + (noise(sd, 17) - 0.5) * 0.5 }
        : { x: tgt.x + (noise(sd, 9) - 0.5) * spread, y: tgt.y + (noise(sd, 11) - 0.5) * spread };
      const k = (f - t0) / S.travel; // 0..1 while flying
      const ik = (f - t0 - S.travel) / 0.22; // 0..1 after impact
      const ang = Math.atan2(impact.y - base.y, impact.x - base.x);
      // ranged shots leave from the front of the firer's base, not its centre
      const lip = MELEE.has(v.fx) ? 0 : (v.r ?? 0.5) * 0.9;
      const src = { x: base.x + Math.cos(ang) * lip, y: base.y + Math.sin(ang) * lip };
      if (MELEE.has(v.fx)) { meleeHit(v.fx, `${vi}-${i}`, impact, hit, f - t0, sd, over, under, P); continue; }
      // muzzle flash (gatlings get one long flickering flash per gun instead)
      if (v.fx !== 'gatling' && v.fx !== 'flame' && v.fx !== 'psychic' && v.fx !== 'sonic' && v.fx !== 'arrow') {
        const mk = (f - t0) / (v.fx === 'las' || v.fx === 'melta' || v.fx === 'volkite' || v.fx === 'gauss' || v.fx === 'cryo' ? 0.12 : 0.07);
        if (mk > 0 && mk < 1) over.push(<Muzzle key={`m${vi}-${i}`} at={src} ang={ang} k={mk} sd={sd} fx={v.fx} pow={P} />);
      }
      // gun smoke comes just after the flash and hangs a moment, drifting up
      const smk = (f - t0 - 0.03) / 0.55;
      if (smk > 0 && smk < 1 && !['las', 'lightning', 'gauss', 'cryo', 'gatling', 'flame', 'psychic', 'sonic', 'arrow'].includes(v.fx)) {
        under.push(<Puff key={`gs${vi}-${i}`} at={{ x: src.x + Math.cos(ang) * 0.5 + (noise(sd, 60) - 0.5) * 0.5, y: src.y + Math.sin(ang) * 0.5 - smk * 0.7 }} k={smk} r={(v.fx === 'missile' ? 1.4 : 0.7) * Math.sqrt(P)} color="rgba(150,145,138,0.55)" />);
      }
      const key = `${vi}-${i}`;
      switch (v.fx) {
        case 'bolt': case 'heavyBolt': case 'gatling': case 'shoota': case 'pulse': case 'shotgun': {
          const [glow, core, ig] = TRACER[v.fx]!;
          const heavy = v.fx === 'heavyBolt';
          if (v.fx === 'shotgun') {
            if (k > 0 && k < 1) for (let j = 0; j < 5; j++) {
              const a = ang + (noise(sd, 80 + j) - 0.5) * 0.28, L = Math.hypot(impact.x - src.x, impact.y - src.y);
              const h = { x: src.x + Math.cos(a) * L * k, y: src.y + Math.sin(a) * L * k }, t = { x: src.x + Math.cos(a) * L * Math.max(0, k - 0.3), y: src.y + Math.sin(a) * L * Math.max(0, k - 0.3) };
              over.push(<line key={`sg${key}-${j}`} x1={t.x} y1={t.y} x2={h.x} y2={h.y} stroke={core} strokeWidth={(0.06) * TRACE} strokeLinecap="round" />);
            }
          } else if (k > 0 && k < 1) {
            const tl = v.fx === 'gatling' ? 0.3 : heavy ? 0.28 : 0.22;
            const head = lerp(src, impact, k), tail = lerp(src, impact, Math.max(0, k - tl));
            const w = (heavy ? 1.5 : v.fx === 'gatling' ? 0.7 : 1) * P;
            over.push(
              <g key={`t${key}`}>
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={glow} strokeWidth={(1.1 * w) * TRACE} strokeLinecap="round" opacity={0.12} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={glow} strokeWidth={(0.3 * w) * TRACE} strokeLinecap="round" opacity={0.45} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={core} strokeWidth={(0.1 * w) * TRACE} strokeLinecap="round" />
                {v.fx === 'pulse' && <Glow at={head} r={0.45} color="cyan" />}
              </g>,
            );
          }
          if (hit && ik > 0 && ik < 1) {
            // mass-reactive bolts burst inside the target with a puff of smoke; slugs and pulses only spark
            if (v.fx === 'bolt' || heavy) {
              over.push(<Glow key={`pop${key}`} at={impact} r={(heavy ? 0.9 : 0.6) * P * (0.5 + ik)} color={ig} op={1 - ik} />);
              under.push(<Puff key={`bp${key}`} at={impact} k={ik} r={0.5 * P} color="rgba(90,84,76,0.5)" />);
            }
            over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={ik} color={core} size={(heavy ? 1.1 : 0.8) * P} ang={ang} />);
          } else if (!hit) missDirt(key, impact, ik, sd, under);
          break;
        }
        case 'sniper': {
          const lk = (f - t0) / 0.35;
          if (lk > 0 && lk < 1) over.push(
            <g key={`sn${key}`} opacity={1 - lk}>
              <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke="#e0f2fe" strokeWidth={(0.18) * TRACE} opacity={0.35} />
              <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke="#fff" strokeWidth={(0.05) * TRACE} />
            </g>,
          );
          if (hit && ik > 0 && ik < 1) { over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={ik} color="#fff" size={0.7} />); under.push(<Puff key={`bm${key}`} at={impact} k={ik} r={0.7 * P} color="rgba(127,13,13,0.55)" />); }
          else if (!hit) missDirt(key, impact, ik, sd, under);
          break;
        }
        case 'plasma': {
          if (k > 0 && k < 1) {
            // a ball of plasma with a fading tail
            for (let j = 3; j >= 1; j--) over.push(<Glow key={`pt${key}-${j}`} at={lerp(src, impact, Math.max(0, k - j * 0.06))} r={0.45 - j * 0.08} color="blue" op={0.5 - j * 0.1} />);
            const p = lerp(src, impact, k);
            over.push(<g key={`pb${key}`}><Glow at={p} r={0.7 * P} color="cyan" /><circle cx={p.x} cy={p.y} r={0.16 * P * TRACE} fill="#f0f9ff" /></g>);
          }
          const xk = (f - t0 - S.travel) / 0.3;
          if (xk > 0 && xk < 1) {
            over.push(
              <g key={`px${key}`}>
                <Glow at={impact} r={(0.6 + xk * (hit ? 1.6 : 1)) * P} color="blue" op={1 - xk} />
                <Puff at={{ x: impact.x, y: impact.y - xk * 0.6 }} k={xk} r={0.9 * P} color="rgba(200,215,225,0.35)" />
              </g>,
            );
            over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={xk} color="#bae6fd" size={1.1} />);
            if (!hit) under.push(<circle key={`ps${key}`} cx={impact.x} cy={impact.y} r={0.5} fill="url(#fx-scorch)" opacity={1 - xk} />);
          }
          break;
        }
        case 'las': case 'volkite': case 'cryo': {
          const col = v.fx === 'las' ? ['#ef4444', '#fecaca'] : v.fx === 'cryo' ? ['#7dd3fc', '#f0f9ff'] : ['#f97316', '#ffedd5'];
          const glow: GlowColor = v.fx === 'las' ? 'red' : v.fx === 'cryo' ? 'cyan' : 'orange';
          if (v.fx === 'las' && P < 1.2) {
            // a lasgun fires a short searing pulse, not a standing beam
            const lk = (f - t0) / 0.07;
            if (lk > 0 && lk < 1) {
              const head = lerp(src, impact, lk), tail = lerp(src, impact, Math.max(0, lk - 0.35));
              over.push(
                <g key={`lp${key}`}>
                  <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={col[0]} strokeWidth={(0.3) * TRACE} strokeLinecap="round" opacity={0.5} />
                  <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#fff" strokeWidth={(0.07) * TRACE} strokeLinecap="round" />
                </g>,
              );
            }
            const hk = (f - t0 - 0.07) / 0.25;
            if (hk > 0 && hk < 1) {
              over.push(<Glow key={`bh${key}`} at={impact} r={0.4 + hk * 0.4} color="red" op={1 - hk} />);
              if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={hk} color={col[1]} size={0.7} />);
              else under.push(<circle key={`bs${key}`} cx={impact.x} cy={impact.y} r={0.3} fill="url(#fx-scorch)" opacity={1 - hk} />);
            }
            break;
          }
          // a beam: the heavier the weapon, the wider and longer it burns
          const bk = (f - t0) / (0.1 + 0.08 * P);
          if (bk > 0 && bk < 1) {
            const w = (1 - bk) * P;
            over.push(
              <g key={`b${key}`}>
                <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke={col[0]} strokeWidth={(1.8 * w) * TRACE} strokeLinecap="round" opacity={0.1} />
                <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke={col[0]} strokeWidth={(0.6 * w) * TRACE} strokeLinecap="round" opacity={0.35} />
                <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke={col[0]} strokeWidth={(0.22 * w) * TRACE} strokeLinecap="round" opacity={0.8} />
                <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke="#fff" strokeWidth={(0.07 * w) * TRACE} strokeLinecap="round" />
              </g>,
            );
            if (v.fx !== 'las') for (let j = 0; j < 4; j++) {
              const p = lerp(src, impact, noise(sd, 90 + j + Math.floor(bk * 6)));
              over.push(<circle key={`vk${key}-${j}`} cx={p.x + (noise(sd, 95 + j) - 0.5) * 0.5} cy={p.y + (noise(sd, 99 + j) - 0.5) * 0.5} r={0.08} fill={col[1]} />);
            }
          }
          const hk = (f - t0) / 0.4;
          if (hk > 0 && hk < 1) {
            over.push(<Glow key={`bh${key}`} at={impact} r={(0.5 + hk * 0.6) * P * (v.fx === 'cryo' ? 0.6 : 1)} color={glow} op={(1 - hk) * (v.fx === 'cryo' ? 0.6 : 1)} />);
            if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={hk} color={col[1]} size={0.9 * P} />);
            else if (v.fx === 'cryo') under.push(<Puff key={`bs${key}`} at={impact} k={hk} r={0.8 * P} color="rgba(224,242,254,0.6)" />);
            else under.push(<circle key={`bs${key}`} cx={impact.x} cy={impact.y} r={0.45 * P} fill="url(#fx-scorch)" opacity={1 - hk} />);
            // volkite deflagrates: the target bursts into flame; helfrost leaves a ring of frost
            if (hit && v.fx === 'volkite') for (let j = 0; j < 3; j++) {
              const life = clamp01(hk * 1.4 - j * 0.15);
              if (life > 0 && life < 1) over.push(fxTextures() ? <Sprite key={`vf${key}-${j}`} kind="fire" at={{ x: impact.x + (noise(sd, 150 + j) - 0.5) * 0.7, y: impact.y - life * 0.9 }} r={0.5 + life * 0.6} op={1 - life} rot={j * 120 + life * 60} v={j} />
                : <Glow key={`vf${key}-${j}`} at={{ x: impact.x + (noise(sd, 150 + j) - 0.5) * 0.7, y: impact.y - life * 0.9 }} r={0.35 + life * 0.5} color={life < 0.4 ? 'molten' : 'orange'} op={1 - life} />);
            }
            if (v.fx === 'cryo') under.push(<DustRing key={`cr${key}`} at={impact} k={hk} r={1.4 * P} seed={sd} color="rgba(224,242,254,0.55)" />);
          }
          break;
        }
        case 'melta': {
          const bk = (f - t0) / 0.24;
          if (bk > 0 && bk < 1) {
            // a wavering beam of heat
            const L = Math.hypot(impact.x - src.x, impact.y - src.y), nx = -Math.sin(ang), ny = Math.cos(ang);
            const pts = Array.from({ length: 13 }, (_, j) => {
              const s = j / 12, wob = Math.sin(s * 14 + f * 90) * 0.14 * Math.sin(s * Math.PI);
              return `${src.x + Math.cos(ang) * L * s + nx * wob},${src.y + Math.sin(ang) * L * s + ny * wob}`;
            }).join(' ');
            const w = (1 - bk * 0.6) * P;
            over.push(
              <g key={`mb${key}`} opacity={bk > 0.8 ? (1 - bk) * 5 : 1}>
                <polyline points={pts} fill="none" stroke="#f97316" strokeWidth={(2.2 * w) * TRACE} strokeLinecap="round" opacity={0.1} />
                <polyline points={pts} fill="none" stroke="#f97316" strokeWidth={(0.9 * w) * TRACE} strokeLinecap="round" opacity={0.3} />
                <polyline points={pts} fill="none" stroke="#fb923c" strokeWidth={(0.35 * w) * TRACE} strokeLinecap="round" opacity={0.85} />
                <polyline points={pts} fill="none" stroke="#fffbeb" strokeWidth={(0.12 * w) * TRACE} strokeLinecap="round" />
              </g>,
            );
          }
          const hk = (f - t0 - 0.05) / 0.5;
          if (hk > 0 && hk < 1) {
            // molten glow and heat rings where it lands
            over.push(<Glow key={`mh${key}`} at={impact} r={(1 + hk * 0.8) * P} color="molten" op={1 - hk} />);
            // molten metal smokes as it cools
            under.push(<Puff key={`mr${key}`} at={{ x: impact.x, y: impact.y - hk * 1.2 }} k={hk} r={1.1 * P} color="rgba(55,48,42,0.5)" />);
            if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={hk} color="#fde68a" size={1.3} />);
            under.push(<circle key={`ms${key}`} cx={impact.x} cy={impact.y} r={0.8} fill="url(#fx-scorch)" opacity={Math.min(1, hk * 3) * (1 - hk)} />);
          }
          break;
        }
        case 'grav': {
          // a graviton beam is unseen: only a faint shimmer in the air, then the target is crushed into the ground
          if (k > 0 && k < 1) {
            const head = lerp(src, impact, k), tail = lerp(src, impact, Math.max(0, k - 0.4));
            over.push(<line key={`gr${key}`} x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#a78bfa" strokeWidth={(0.35 * P) * TRACE} strokeLinecap="round" opacity={0.18} />);
          }
          const xk = (f - t0 - S.travel) / 0.35;
          if (xk > 0 && xk < 1) {
            over.push(<Glow key={`gg${key}`} at={impact} r={0.6 * P * (1 - xk * 0.5)} color="purple" op={0.6 * (1 - xk)} />);
            // dust pulled inwards, and a dent pressed into the ground
            under.push(<DustRing key={`gd${key}`} at={impact} k={1 - xk * 0.999} r={1.6 * P} seed={sd} color="rgba(90,80,100,0.45)" />);
            if (hit) under.push(<circle key={`gc${key}`} cx={impact.x} cy={impact.y} r={0.55 * P} fill="url(#fx-scorch)" opacity={Math.min(1, xk * 3) * (1 - xk)} />);
          }
          break;
        }
        case 'lightning': {
          const bk = (f - t0) / 0.18;
          if (bk > 0 && bk < 1) {
            const fr = Math.floor(f * 40); // the bolt jumps a few times while it lasts
            const L = Math.hypot(impact.x - src.x, impact.y - src.y), nx = -Math.sin(ang), ny = Math.cos(ang);
            const pts = Array.from({ length: 9 }, (_, j) => {
              const s = j / 8, off = j === 0 || j === 8 ? 0 : (noise(sd + fr, 120 + j) - 0.5) * 1.1;
              return `${src.x + Math.cos(ang) * L * s + nx * off},${src.y + Math.sin(ang) * L * s + ny * off}`;
            }).join(' ');
            over.push(
              <g key={`lt${key}`} opacity={1 - bk * 0.5}>
                <polyline points={pts} fill="none" stroke="#67e8f9" strokeWidth={(1.1) * TRACE} strokeLinejoin="round" opacity={0.1} />
                <polyline points={pts} fill="none" stroke="#67e8f9" strokeWidth={(0.32) * TRACE} strokeLinejoin="round" opacity={0.4} />
                <polyline points={pts} fill="none" stroke="#f0fdff" strokeWidth={(0.08) * TRACE} strokeLinejoin="round" />
              </g>,
            );
          }
          const hk = (f - t0) / 0.35;
          if (hk > 0 && hk < 1) { over.push(<Glow key={`lh${key}`} at={impact} r={0.8 * P} color="cyan" op={1 - hk} />); if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={hk} color="#cffafe" />); }
          // tesla and arc fire leaps on to the next model (one arc on every other hit, to keep it cheap)
          const ck = (f - t0 - 0.06) / 0.14;
          if (hit && i % 2 === 0 && victims.length > 1 && ck > 0 && ck < 1) {
            const nb = victims[(Math.floor(noise(sd, 7) * victims.length) + 1) % victims.length];
            const fr = Math.floor(f * 40), L2 = Math.hypot(nb.x - impact.x, nb.y - impact.y), a2 = Math.atan2(nb.y - impact.y, nb.x - impact.x);
            const pts = Array.from({ length: 5 }, (_, j) => {
              const s2 = j / 4, off = j === 0 || j === 4 ? 0 : (noise(sd + fr, 160 + j) - 0.5) * 0.7;
              return `${impact.x + Math.cos(a2) * L2 * s2 - Math.sin(a2) * off},${impact.y + Math.sin(a2) * L2 * s2 + Math.cos(a2) * off}`;
            }).join(' ');
            over.push(<polyline key={`lc${key}`} points={pts} fill="none" stroke="#a5f3fc" strokeWidth={(0.07) * TRACE} strokeLinejoin="round" opacity={1 - ck} />);
          }
          break;
        }
        case 'psychic': {
          // the psyker gathers the warp (arcs crawl in), hurls a crackling bolt of it, and it bursts hard on the target
          const gk = (f - t0 + 0.12) / 0.3;
          if (gk > 0 && gk < 1) over.push(<g key={`pg${key}`}><Glow at={src} r={0.6 * Math.sqrt(P)} color="purple" op={0.8 * Math.sin(gk * Math.PI)} /><Arcs at={src} r={1.1 * Math.sqrt(P)} k={gk} seed={sd} color="#c084fc" n={4} inward /></g>);
          if (k > 0 && k < 1) {
            // a jagged tail of warp lightning behind a white-hot head
            const tail = Math.max(0, k - 0.25), nx = -Math.sin(ang), ny = Math.cos(ang), flick = Math.floor((f - t0) * 40);
            const pts = Array.from({ length: 6 }, (_, j) => { const kk = tail + ((k - tail) * j) / 5, p = lerp(src, impact, kk), w = j && j < 5 ? (noise(sd + flick, j) - 0.5) * 0.5 : 0; return `${p.x + nx * w},${p.y + ny * w}`; }).join(' ');
            over.push(<g key={`ps${key}`}>
              <polyline points={pts} fill="none" stroke="#a855f7" strokeWidth={0.5 * TRACE * Math.sqrt(P)} strokeLinejoin="round" opacity={0.25} />
              <polyline points={pts} fill="none" stroke="#c084fc" strokeWidth={0.16 * TRACE * Math.sqrt(P)} strokeLinejoin="round" />
              <polyline points={pts} fill="none" stroke="#fff" strokeWidth={0.05 * TRACE} strokeLinejoin="round" />
            </g>);
            const head = lerp(src, impact, k);
            over.push(<g key={`ph${key}`}><Glow at={head} r={0.5 * Math.sqrt(P)} color="purple" /><circle cx={head.x} cy={head.y} r={0.13 * TRACE * Math.sqrt(P)} fill="#faf5ff" /></g>);
          }
          const xk = (f - t0 - S.travel) / 0.45;
          if (xk > 0 && xk < 1) {
            over.push(<g key={`px${key}`}>
              {xk < 0.2 && <Glow at={impact} r={(0.5 + xk * 3) * Math.sqrt(P)} color="white" op={1 - xk / 0.2} />}
              <Glow at={impact} r={(0.5 + xk * 0.8) * P} color="purple" op={1 - xk} />
              <Shockwave at={impact} r={1.4 * Math.sqrt(P)} k={xk / 0.7} color="#c084fc" />
              <Arcs at={impact} r={1.3 * Math.sqrt(P)} k={xk / 0.8} seed={sd + 5} color="#c084fc" n={5} />
              {hit && <Sparks at={impact} seed={sd} k={xk} color="#e9d5ff" size={1.1 * Math.sqrt(P)} ang={ang} />}
            </g>);
          }
          break;
        }
        case 'flame': {
          const fk = (f - t0) / 0.42;
          if (fk > 0 && fk < 1) {
            // a hand flamer licks a few inches, a heavy flamer rolls a wide wall of fire
            // ...and fire is sized to the model holding it: a trooper's flamer must not out-burn a tank's, nor swamp the board when zoomed out
            const len = Math.min(12 * Math.min(1, P * 1.1), Math.hypot(impact.x - src.x, impact.y - src.y));
            const size = (P * Math.max(0.75, Math.min(1.6, (v.r ?? 0.6) / 0.6))) / Math.sqrt(VIS);
            const spread = 0.24 + 0.1 * P;
            const tinted = v.tint ? fireTex(v.tint) : [];
            // a cone of burning fuel: a soft body, then overlapping tongues rolling out along it
            const reach = len * easeOut(clamp01(fk * 1.8)), w = reach * spread * 0.9;
            const cx = Math.cos(ang), cy = Math.sin(ang), nx = -cy, ny = cx;
            if (!fxTextures()) over.push(<polygon key={`fc${key}`} points={`${src.x},${src.y} ${src.x + cx * reach + nx * w},${src.y + cy * reach + ny * w} ${src.x + cx * reach * 1.05},${src.y + cy * reach * 1.05} ${src.x + cx * reach - nx * w},${src.y + cy * reach - ny * w}`} fill="#f97316" opacity={0.22 * (1 - fk)} />);
            for (let j = 0; j < 14; j++) {
              const life = clamp01(fk * 1.6 - j * 0.045);
              if (life <= 0 || life >= 1) continue;
              const a = ang + (noise(sd, 140 + j) - 0.5) * spread * 1.6;
              const d = len * easeOut(life);
              const p = { x: src.x + Math.cos(a) * d, y: src.y + Math.sin(a) * d - life * 0.3 };
              if (fxTextures()) {
                // burning fuel rolls out and turns to black smoke as it dies
                // tongues stretched along the flow and curling as they go, so the jet reads as one licking stream
                const r = (0.55 + life * 1.2) * size, rot = ((a + Math.sin(life * 7 + j) * 0.45) * 180) / Math.PI;
                // a soft heat glow under every other tongue, so the jet is one hazy body and not separate flakes
                if (j % 3 === 0) under.push(<Glow key={`fg${key}-${j}`} at={p} r={r * 1.6} color={TINT_GLOW[v.tint ?? ''] ?? (life < 0.4 ? 'orange' : 'red')} op={0.7 * (1 - life)} />);
                over.push(<Sprite key={`fl${key}-${j}`} kind="fire" href={tinted.length ? tinted[j % tinted.length] : undefined} at={p} r={r} sx={2.1 - life * 0.7} op={0.85 * (1 - life * life)} rot={rot} v={j} />);
                // warpfire burns without smoke; real fire turns to black smoke as it dies
                if (!v.tint && life > 0.55) under.push(<Sprite key={`fk${key}-${j}`} kind="smoke" at={{ x: p.x, y: p.y - life }} r={0.8 + life * 1.4} op={0.7 * (life - 0.55) * 2.2 * (1 - life)} rot={j * 67} v={j} />);
              } else over.push(<Glow key={`fl${key}-${j}`} at={p} r={0.5 + life * 1.5} color={life < 0.3 ? 'molten' : life < 0.65 ? 'orange' : 'red'} op={0.95 * (1 - life * 0.6)} />);
            }
            if (!v.tint) under.push(<Puff key={`fs${key}`} at={{ x: impact.x, y: impact.y - fk }} k={fk} r={1.3 * size} color="rgba(60,55,50,0.45)" />);
            else over.push(<Wisp key={`fw${key}`} at={{ x: impact.x, y: impact.y - fk * 0.6 }} r={1.4 * size} color={v.tint} op={0.6 * (1 - fk)} rot={fk * 120 + sd} />);
          }
          break;
        }
        case 'missile': {
          if (k > 0 && k < 1) {
            const nx = -Math.sin(ang), ny = Math.cos(ang);
            const at = (kk: number) => { const p = lerp(src, impact, kk), w = Math.sin(kk * 9 + sd) * 0.15; return { x: p.x + nx * w, y: p.y + ny * w }; };
            // a smoke trail left behind the rocket
            for (let j = 1; j <= 6; j++) {
              const kk = k - j * 0.06;
              if (kk <= 0) break;
              const age = j / 6;
              under.push(fxTextures() ? <Sprite key={`ms${key}-${j}`} kind="smoke" at={at(kk)} r={0.4 + age * 0.8} op={0.9 * (1 - age)} rot={j * 71 + sd} v={j} />
                : <circle key={`ms${key}-${j}`} cx={at(kk).x} cy={at(kk).y} r={0.22 + age * 0.45} fill="rgba(170,165,155,0.5)" opacity={0.8 * (1 - age)} />);
            }
            const p = at(k);
            over.push(<g key={`mr${key}`}><Glow at={p} r={0.6} color="orange" /><circle cx={p.x} cy={p.y} r={0.12} fill="#fff" /></g>);
          }
          const xk = (f - t0 - S.travel) / 0.4;
          if (xk > 0 && xk < 1) under.push(<Explosion key={`x${key}`} at={impact} k={xk} seed={sd} big={0.6 * P} />);
          break;
        }
        case 'shell': {
          if (k > 0 && k < 1) {
            const mid = { x: (src.x + impact.x) / 2, y: (src.y + impact.y) / 2 - Math.hypot(impact.x - src.x, impact.y - src.y) * 0.18 };
            const q = (a: Pt, b: Pt, cc: Pt, s: number) => lerp(lerp(a, cc, s), lerp(cc, b, s), s);
            const p = q(src, impact, mid, k), tail = q(src, impact, mid, Math.max(0, k - 0.15));
            under.push(<line key={`tt${key}`} x1={tail.x} y1={tail.y} x2={p.x} y2={p.y} stroke="rgba(150,150,150,0.5)" strokeWidth={(0.35) * TRACE} strokeLinecap="round" />);
            over.push(<g key={`t${key}`}><Glow at={p} r={0.5} color="amber" /><circle cx={p.x} cy={p.y} r={0.18} fill="#fff1c2" /></g>);
          }
          const xk = (f - t0 - S.travel) / 0.4;
          if (xk > 0 && xk < 1) under.push(<Explosion key={`x${key}`} at={impact} k={xk} seed={sd} big={0.6 * P} />);
          break;
        }
        case 'gauss': {
          if (k > 0 && k < 1) {
            const head = lerp(src, impact, k), tail = lerp(src, impact, Math.max(0, k - 0.28));
            over.push(
              <g key={`gs${key}`}>
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#22c55e" strokeWidth={(1.3) * TRACE} strokeLinecap="round" opacity={0.12} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#22c55e" strokeWidth={(0.5) * TRACE} strokeLinecap="round" opacity={0.4} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#86efac" strokeWidth={(0.2) * TRACE} strokeLinecap="round" opacity={0.9} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#f0fdf4" strokeWidth={(0.08) * TRACE} strokeLinecap="round" />
                <Glow at={head} r={0.55} color="green" />
              </g>,
            );
          }
          const xk = (f - t0 - S.travel) / 0.35;
          if (xk > 0 && xk < 1) {
            over.push(
              <g key={`gx${key}`}>
                <Glow at={impact} r={(0.7 + xk * (hit ? 1.4 : 0.8)) * P} color="green" op={1 - xk} />
              </g>,
            );
            // a gauss hit flays the target layer by layer: green flecks peel away
            if (hit) { over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={xk} color="#bbf7d0" size={1.1 * P} />); under.push(<Debris key={`gf${key}`} at={impact} k={xk} seed={sd + 9} n={4} color="#4ade80" size={0.45 * P} />); }
            else missDirt(key, impact, xk, sd, under);
          }
          break;
        }
        case 'shuriken': {
          if (k > 0 && k < 1) {
            const p = lerp(src, impact, k);
            const trail = lerp(src, impact, Math.max(0, k - 0.2));
            const spinDeg = ((f - t0) * 1800 + sd * 30) % 360;
            over.push(
              <g key={`sh${key}`}>
                <line x1={trail.x} y1={trail.y} x2={p.x} y2={p.y} stroke="#38bdf8" strokeWidth={(0.16) * TRACE} strokeLinecap="round" opacity={0.55} />
                <g transform={`translate(${p.x} ${p.y}) rotate(${spinDeg})`}>
                  <polygon points="-0.18,-0.05 0,-0.18 0.18,-0.05 0.05,0 0.18,0.05 0,0.18 -0.18,0.05 -0.05,0" fill="#f0f9ff" stroke="#0284c7" strokeWidth={(0.03) * TRACE} />
                  <circle r={0.05} fill="#38bdf8" />
                </g>
                <Glow at={p} r={0.4} color="cyan" op={0.7} />
              </g>,
            );
          }
          if (hit && ik > 0 && ik < 1) {
            over.push(<Glow key={`pop${key}`} at={impact} r={0.5 * (0.6 + ik)} color="cyan" op={1 - ik} />);
            over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={ik} color="#bae6fd" size={0.9} />);
          } else if (!hit) missDirt(key, impact, ik, sd, under);
          break;
        }
        case 'bio': {
          if (k > 0 && k < 1) {
            const p = lerp(src, impact, k);
            const wob = Math.sin(k * 24 + sd) * 0.1;
            const nx = -Math.sin(ang), ny = Math.cos(ang);
            const bp = { x: p.x + nx * wob, y: p.y + ny * wob };
            const trail = lerp(src, impact, Math.max(0, k - 0.16));
            under.push(<Puff key={`bf${key}`} at={trail} k={k * 0.6} r={0.4} color="rgba(132, 204, 22, 0.35)" />);
            over.push(
              <g key={`bp${key}`}>
                <Glow at={bp} r={0.55} color="green" op={0.8} />
                <ellipse cx={bp.x} cy={bp.y} rx={0.18} ry={0.1} transform={`rotate(${(ang * 180) / Math.PI} ${bp.x} ${bp.y})`} fill="#3f6212" opacity={0.9} />
              </g>,
            );
          }
          const xk = (f - t0 - S.travel) / 0.32;
          if (xk > 0 && xk < 1) {
            over.push(<Glow key={`bg${key}`} at={impact} r={(0.6 + xk * (hit ? 1.2 : 0.6)) * P} color="green" op={1 - xk} />);
            if (hit) {
              over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={xk} color="#a3e635" size={1.0} />);
              under.push(<Puff key={`bsp${key}`} at={impact} k={xk} r={0.85} color="rgba(101, 163, 13, 0.55)" />);
            } else missDirt(key, impact, xk, sd, under);
          }
          break;
        }
        case 'sonic': {
          // sound is unseen: a pink-tinged ripple of pressure in the air, dust shaken off the ground under it,
          // and at the target a burst of pressure that throws up dust
          if (k > 0 && k < 1) {
            for (let j = 0; j < 3; j++) {
              const sk = Math.max(0, k - j * 0.1);
              over.push(<Wisp key={`sw${key}-${j}`} at={lerp(src, impact, sk)} r={(0.6 + j * 0.25) * P} color="#f472b6" op={0.55 - j * 0.15} rot={(ang * 180) / Math.PI + j * 40 + k * 200} v={j} />);
            }
            under.push(<Puff key={`sp${key}`} at={lerp(src, impact, Math.max(0, k - 0.2))} k={k} r={0.6} color="rgba(120,110,95,0.4)" />);
          }
          const xk = (f - t0 - S.travel) / 0.35;
          if (xk > 0 && xk < 1) {
            under.push(<DustRing key={`sx${key}`} at={impact} k={xk} r={2.2 * P} seed={sd} />);
            over.push(<Wisp key={`sh${key}`} at={impact} r={(0.8 + xk * 1.2) * P} color="#f472b6" op={0.8 * (1 - xk)} rot={xk * 140 + sd} />);
            if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={xk} color="#fbcfe8" size={1.1} />);
          }
          break;
        }
        case 'arrow': {
          if (k > 0 && k < 1) {
            const head = lerp(src, impact, k);
            const tail = lerp(src, impact, Math.max(0, k - 0.22));
            const rotDeg = (ang * 180) / Math.PI;
            const trail = lerp(src, impact, Math.max(0, k - 0.35));
            over.push(
              <g key={`arr${key}`}>
                <line x1={trail.x} y1={trail.y} x2={tail.x} y2={tail.y} stroke="#38bdf8" strokeWidth={0.12 * TRACE} strokeLinecap="round" opacity={0.35} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#0284c7" strokeWidth={0.18 * TRACE} strokeLinecap="round" opacity={0.6} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#f0f9ff" strokeWidth={0.07 * TRACE} strokeLinecap="round" />
                <g transform={`translate(${head.x} ${head.y}) rotate(${rotDeg})`}>
                  <polygon points="0.16,0 -0.1,-0.08 -0.04,0 -0.1,0.08" fill="#e0f2fe" stroke="#0284c7" strokeWidth={0.02 * TRACE} />
                  <Glow at={{ x: 0, y: 0 }} r={0.35} color="cyan" op={0.6} />
                </g>
                <g transform={`translate(${tail.x} ${tail.y}) rotate(${rotDeg})`}>
                  <line x1="-0.08" y1="-0.06" x2="0.04" y2="0" stroke="#38bdf8" strokeWidth={0.03 * TRACE} />
                  <line x1="-0.08" y1="0.06" x2="0.04" y2="0" stroke="#38bdf8" strokeWidth={0.03 * TRACE} />
                </g>
              </g>,
            );
          }
          if (hit && ik > 0 && ik < 1) {
            over.push(<Glow key={`pop${key}`} at={impact} r={0.5 * (0.6 + ik)} color="cyan" op={1 - ik} />);
            over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={ik} color="#bae6fd" size={0.9 * P} ang={ang} />);
          } else if (!hit) missDirt(key, impact, ik, sd, under);
          break;
        }
      }
    }
    // gatlings: a long flickering muzzle flash on each gun and brass casings flying out
    if (v.fx === 'gatling') {
      const g0 = vStart, g1 = vStart + S.span;
      if (f > g0 && f < g1) for (let j = 0; j < cnt && j < 4; j++) {
        const src = from(j);
        const tgt = victims[0];
        const ang = Math.atan2(tgt.y - src.y, tgt.x - src.x);
        const fl = noise(seed + j, Math.floor(f * 50));
        over.push(<Muzzle key={`gm${vi}-${j}`} at={src} ang={ang + (fl - 0.5) * 0.3} k={0.2 + fl * 0.5} sd={seed + j + Math.floor(f * 50)} fx="gatling" />);
        for (let c = 0; c < 3; c++) {
          const ck = ((f - g0) * 9 + c / 3) % 1;
          const side = ang + Math.PI / 2;
          under.push(<rect key={`gc${vi}-${j}-${c}`} x={src.x + Math.cos(side) * (0.5 + ck * 1.2) - 0.06} y={src.y + Math.sin(side) * (0.5 + ck * 1.2) + ck * ck * 0.6 - 0.03} width={0.14} height={0.07} fill="#d4a017" opacity={1 - ck} />);
        }
      }
    }
  });
  return (
    <g>
      {under}
      {over}
      {after > 0 && (
        <g>
          {e.dead.map((d, i) => {
            const fade = after < 0.7 ? 1 : (1 - after) / 0.3;
            return (
              <g key={`d${i}`} transform={`translate(${d.x} ${d.y})`} opacity={fade}>
                <circle r={0.45 + easeOut(Math.min(1, after * 2)) * 0.35} fill="url(#fx-blood)" opacity={0.75} />
                {[0, 1].map((j) => {
                  const a = noise(seed, i * 7 + j) * Math.PI * 2, rr = 0.35 + noise(seed, i * 7 + j + 3) * 0.3;
                  return <circle key={j} cx={Math.cos(a) * rr} cy={Math.sin(a) * rr} r={0.18 + noise(seed, i + j) * 0.15} fill="url(#fx-blood)" opacity={0.6} />;
                })}
                <Puff at={{ x: 0, y: -after * 0.6 }} k={Math.min(0.99, after * 1.2)} r={0.8} color="rgba(80,76,70,0.4)" />
              </g>
            );
          })}
          <g opacity={after < 0.75 ? 1 : (1 - after) * 4} transform={`translate(${e.to.x} ${e.to.y - 1.6 - after * 1.6}) scale(${after < 0.15 ? 0.6 + after * 3 : 1.05})`}>
            <text fontSize={1.05} textAnchor="middle" fill={e.dmg ? '#fecaca' : '#e5e7eb'} stroke="#000" strokeWidth={(0.16) * TRACE} paintOrder="stroke" fontWeight={900}>
              {e.dmg ? `-${e.dmg}W` : 'no damage'}{e.killed ? ` · ${e.killed} slain` : ''}
            </text>
          </g>
        </g>
      )}
    </g>
  );
}

/** the flash at the end of a barrel */
function Muzzle({ at, ang, k, sd, fx, pow = 1 }: { at: Pt; ang: number; k: number; sd: number; fx: WeaponFx; pow?: number }) {
  const big = (fx === 'heavyBolt' || fx === 'missile' || fx === 'shell' || fx === 'sonic' ? 1.3 : fx === 'gatling' ? 1 : fx === 'sniper' || fx === 'pulse' || fx === 'shuriken' ? 0.75 : 0.9) * 0.85 * Math.sqrt(pow);
  const col: GlowColor = fx === 'plasma' ? 'cyan' : fx === 'las' ? 'red' : fx === 'cryo' ? 'cyan' : fx === 'melta' || fx === 'volkite' ? 'orange' : fx === 'grav' ? 'purple' : fx === 'lightning' ? 'cyan' : fx === 'gauss' || fx === 'bio' ? 'green' : fx === 'sonic' ? 'pink' : fx === 'shuriken' ? 'cyan' : 'amber';
  const core = fx === 'plasma' ? '#e0f7ff' : fx === 'las' ? '#fee2e2' : fx === 'gauss' ? '#f0fdf4' : fx === 'shuriken' ? '#f0f9ff' : fx === 'bio' ? '#ecfccb' : fx === 'sonic' ? '#fdf2f8' : '#fff7d6';
  const star = Array.from({ length: 10 }, (_, j) => {
    // the flash goes forwards: long ahead, short to the sides, almost nothing behind
    const a = ang + (j / 10) * Math.PI * 2, fwd = Math.max(0, Math.cos((j / 10) * Math.PI * 2));
    const rr = (j % 2 ? 0.12 : 0.18 + fwd * fwd * (0.9 + noise(sd, j) * 0.3)) * big * VIS; // Glow and Sprite scale by VIS themselves
    return `${at.x + Math.cos(a) * rr},${at.y + Math.sin(a) * rr}`;
  }).join(' ');
  // chemical guns get a ragged flame-coloured flash; energy weapons keep a clean coloured flare
  const chem = col === 'amber' || col === 'orange';
  return (
    <g opacity={1 - k}>
      <Glow at={at} r={(1 + k * 0.4) * big} color={col} op={0.55} />
      <Glow at={at} r={(0.45 + k * 0.2) * big} color={col} op={0.9} />
      {chem && fxTextures() ? <Sprite kind="flash" at={at} r={1.1 * big} rot={(ang * 180) / Math.PI} v={sd} /> : <polygon points={star} fill={core} opacity={0.9} />}
    </g>
  );
}

/** a missed shot kicks up dirt */
function missDirt(key: string, at: Pt, ik: number, sd: number, under: React.ReactNode[]) {
  if (ik <= 0 || ik >= 1) return;
  under.push(<Puff key={`p${key}`} at={at} k={ik} r={0.45} color="rgba(120,108,88,0.45)" />);
  under.push(<Debris key={`dd${key}`} at={at} k={ik} seed={sd * 3} n={2} color="#3d352a" size={0.5} />);
}

/** one melee blow: blade arcs, chainsword teeth, crackling power fields, claws, or a crushing hammer */
function meleeHit(fx: WeaponFx, key: string, at: Pt, hit: boolean, t: number, sd: number, over: React.ReactNode[], under: React.ReactNode[], P = 1) {
  const sk = t / (fx === 'crush' ? 0.3 : 0.22);
  const a = noise(sd, 21) * 360;
  const col = fx === 'power' ? '#60a5fa' : fx === 'chain' ? '#ef4444' : fx === 'claw' ? '#93c5fd' : fx === 'crush' ? '#fbbf24' : '#f1f5f9';
  const glow: GlowColor = fx === 'power' ? 'blue' : fx === 'chain' ? 'red' : fx === 'claw' ? 'cyan' : 'amber';
  // a swing reads as a motion smear: a crescent thick in the middle and thinning to points, fading behind the blade
  const smear = (dy: number, thick: number, c: string, op: number) => (
    <path d={`M -1.1 ${-0.45 + dy} Q 0 ${-1.55 - thick + dy} 1.1 ${-0.45 + dy} Q 0 ${-1.55 + thick * 0.4 + dy} -1.1 ${-0.45 + dy} Z`} fill={c} opacity={op} />
  );
  if (sk > 0 && sk < 1) {
    if (fx === 'crush') {
      // a hammer comes down: the ground cracks, a ring of force and dust, rubble thrown out
      over.push(<Glow key={`c${key}`} at={at} r={(0.5 + sk * 0.9) * P} color={hit ? 'amber' : 'white'} op={(1 - sk) * 0.9} />);
      over.push(<Shockwave key={`cw${key}`} at={at} r={1.6 * Math.sqrt(P)} k={sk / 0.7} color="#fde68a" />);
      under.push(<Debris key={`cd${key}`} at={at} k={sk} seed={sd} n={7} size={0.9 * P} />);
      under.push(<DustRing key={`cr${key}`} at={at} k={sk} r={2 * P} seed={sd} />);
    } else {
      // the blade sweeps across the target: the smear turns as it goes, in three layers (a glow, the colour, a white edge)
      const sw = a - 40 + easeOut(clamp01(sk * 1.6)) * 80, sc = Math.sqrt(P) * VIS * 1.25;
      over.push(
        <g key={`s${key}`} transform={`translate(${at.x} ${at.y}) rotate(${sw}) scale(${sc})`} opacity={1 - sk * sk}>
          {fx === 'claw' ? [-0.32, 0, 0.32].map((dy, j) => <g key={j}>{smear(dy, 0.22, col, 0.3)}{smear(dy, 0.1, col, 0.75)}{smear(dy, 0.04, '#fff', 0.9)}</g>)
            : <>{smear(0, fx === 'power' ? 0.5 : 0.42, col, 0.3)}{smear(0, 0.2, col, 0.8)}{smear(0, 0.07, '#fff', 0.95)}</>}
        </g>,
      );
    }
  }
  if (hit) {
    const hk = (t - 0.08) / 0.28;
    if (hk > 0 && hk < 1) {
      // the blow lands: a white flash, a burst in the weapon's colour and a small shockwave
      if (hk < 0.25) over.push(<Glow key={`hf${key}`} at={at} r={(0.4 + hk * 2.4) * Math.sqrt(P)} color="white" op={1 - hk / 0.25} />);
      over.push(<Glow key={`hg${key}`} at={at} r={(0.6 + hk * 0.8) * Math.sqrt(P)} color={glow} op={0.8 * (1 - hk)} />);
      if (fx !== 'crush') over.push(<Shockwave key={`hw${key}`} at={at} r={1.1 * Math.sqrt(P)} k={hk / 0.6} color={col} />);
      // a power field crackles where it bites
      if (fx === 'power') over.push(<Arcs key={`pa${key}`} at={at} r={1.1 * Math.sqrt(P)} k={hk / 0.7} seed={sd} color="#93c5fd" n={4} />);
    }
    over.push(<Sparks key={`k${key}`} at={at} seed={sd} k={hk} color={fx === 'power' ? '#bfdbfe' : fx === 'chain' ? '#fdba74' : fx === 'crush' ? '#fde68a' : '#fecaca'} size={(fx === 'chain' ? 1.5 : 1.2) * Math.sqrt(P)} />);
    // blades and teeth throw out a spray of blood and gore
    if (fx !== 'power' && fx !== 'crush' && hk > 0 && hk < 1) under.push(<Debris key={`cb${key}`} at={at} k={hk} seed={sd + 5} n={fx === 'chain' ? 7 : 4} color="#7f1d1d" size={0.6} />);
  } else {
    // parried or dodged: a dull clang of grey sparks
    const mk = (t - 0.08) / 0.2;
    if (mk > 0 && mk < 1) over.push(<Sparks key={`km${key}`} at={at} seed={sd} k={mk} color="#cbd5e1" size={0.6} />);
  }
}

// ---------- a hero's ability: charge-up, flash, shockwave, a turning rune circle, rays, embers and the name ----------

type SkillEvent = Extract<FxEvent, { kind: 'skill' }>;
const SKILL_COLORS: Record<SkillEvent['style'], { core: string; glow: string; deep: string; text: string }> = {
  holy: { core: '#fffbeb', glow: '#fcd34d', deep: '#b45309', text: '#fde68a' },
  command: { core: '#ffffff', glow: '#fbbf24', deep: '#78350f', text: '#fef3c7' },
  psychic: { core: '#faf5ff', glow: '#c084fc', deep: '#6d28d9', text: '#e9d5ff' },
  chaos: { core: '#fff1f2', glow: '#f43f5e', deep: '#4c0519', text: '#fecdd3' },
  fury: { core: '#fff1f2', glow: '#dc2626', deep: '#7f1d1d', text: '#fecaca' },
  waaagh: { core: '#f7fee7', glow: '#84cc16', deep: '#3f6212', text: '#d9f99d' },
  tech: { core: '#ecfeff', glow: '#22d3ee', deep: '#0e7490', text: '#a5f3fc' },
  shield: { core: '#eff6ff', glow: '#60a5fa', deep: '#1d4ed8', text: '#bfdbfe' },
  plague: { core: '#f7fee7', glow: '#a3a635', deep: '#3f3f12', text: '#ecfccb' },
  necron: { core: '#f0fdf4', glow: '#4ade80', deep: '#14532d', text: '#bbf7d0' },
};
const STYLE_GLOW: Record<SkillEvent['style'], GlowColor> = { holy: 'amber', command: 'amber', psychic: 'purple', chaos: 'red', fury: 'red', waaagh: 'green', tech: 'cyan', shield: 'blue', plague: 'green', necron: 'green' };

/** a straight line out from a point at an angle, from r0 to r1 */
const ray = (at: Pt, a: number, r0: number, r1: number) => ({ x1: at.x + Math.cos(a) * r0, y1: at.y + Math.sin(a) * r0, x2: at.x + Math.cos(a) * r1, y2: at.y + Math.sin(a) * r1 });

/**
 * An ability's own look (.claude/skills/vfx): each style has a wind-up, a release and an aftermath of its own, so two
 * abilities of different kinds never look alike. R is the effect's reach on the board, k01 the effect's time 0..1.
 */
function styleLayers(style: SkillEvent['style'], at: Pt, f: number, R: number, seed: number, c: (typeof SKILL_COLORS)[SkillEvent['style']]) {
  const up = clamp01(f / 0.15), rel = (f - 0.12) / 0.4, aft = clamp01((f - 0.4) / 0.6), V = VIS, L: React.ReactNode[] = [];
  const line = (key: string, l: ReturnType<typeof ray>, col: string, w: number, op: number) => <line key={key} {...l} stroke={col} strokeWidth={w * V} strokeLinecap="round" opacity={op} />;
  const ring = (key: string, r: number, col: string, w: number, op: number, dash?: string) => <circle key={key} cx={at.x} cy={at.y} r={r} fill="none" stroke={col} strokeWidth={w * V} opacity={op} strokeDasharray={dash} />;
  const flash = rel > 0 && rel < 0.35 ? <Glow key="fl" at={at} r={R * (0.35 + rel * 0.9) / V} color="white" op={1 - rel / 0.35} /> : null;
  switch (style) {
    case 'holy': {
      // a beam narrows down onto the hero, then a halo and a pillar of light; gold motes rise after
      if (up < 1) L.push(line('b', { x1: at.x, y1: at.y - R * 3, x2: at.x, y2: at.y }, c.glow, 0.5 * (1 - up) + 0.08, 0.35 + up * 0.5));
      L.push(flash);
      if (rel > 0 && rel < 1) {
        L.push(<g key="p" opacity={1 - rel}>{[-0.35, 0, 0.35].map((dx, i) => line(`p${i}`, { x1: at.x + dx * R * 0.4, y1: at.y - R * 2.4, x2: at.x + dx * R * 0.4, y2: at.y }, i === 1 ? '#fff' : c.glow, i === 1 ? 0.12 : 0.22, 0.8))}</g>);
        L.push(<g key="h" opacity={1 - rel * 0.6}>{ring('hr', R * (0.5 + easeOut(rel) * 0.4), c.glow, 0.09, 0.9)}{Array.from({ length: 12 }, (_, i) => line(`t${i}`, ray(at, (i / 12) * Math.PI * 2 + f, R * (0.62 + easeOut(rel) * 0.3), R * (0.72 + easeOut(rel) * 0.34)), c.core, 0.07, 0.9))}</g>);
      }
      if (aft > 0) for (let i = 0; i < 10; i++) L.push(<circle key={`m${i}`} cx={at.x + (noise(seed, i) - 0.5) * R * 1.6} cy={at.y - aft * R * (0.8 + noise(seed, i + 9))} r={0.08 * V} fill={i % 2 ? c.core : c.glow} opacity={1 - aft} />);
      break;
    }
    case 'command': {
      // four corner brackets close on the hero and lock; chevrons fly out; a double sonar ping; a dashed ring turns
      const g = R * (1.3 - easeOut(clamp01(f / 0.22)) * 0.6), lock = clamp01((f - 0.18) / 0.1);
      L.push(<g key="br" opacity={f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4}>{[0, 1, 2, 3].map((i) => {
        const sx = i % 2 ? 1 : -1, sy = i < 2 ? -1 : 1, x = at.x + sx * g, y = at.y + sy * g, l = R * 0.28;
        return <polyline key={i} points={`${x - sx * l},${y} ${x},${y} ${x},${y - sy * l}`} fill="none" stroke={lock ? '#fff' : c.glow} strokeWidth={0.12 * V} strokeLinejoin="miter" />;
      })}</g>);
      L.push(flash);
      if (rel > 0 && rel < 1) for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, d = R * (0.5 + easeOut(rel) * 1.2), w = R * 0.16, p = { x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d };
        L.push(<polyline key={`c${i}`} points={`${p.x + Math.cos(a + 2.4) * w},${p.y + Math.sin(a + 2.4) * w} ${p.x},${p.y} ${p.x + Math.cos(a - 2.4) * w},${p.y + Math.sin(a - 2.4) * w}`} fill="none" stroke={c.glow} strokeWidth={0.11 * V} opacity={1 - rel} />);
      }
      L.push(<Shockwave key="s1" at={at} r={R * 1.6 / V} k={rel / 0.6} color={c.glow} />, <Shockwave key="s2" at={at} r={R * 1.6 / V} k={(rel - 0.2) / 0.6} color={c.core} />);
      if (aft > 0) L.push(<g key="dr" transform={`rotate(${f * 120} ${at.x} ${at.y})`}>{ring('d', R * 0.9, c.glow, 0.07, 1 - aft, `${0.5 * V} ${0.35 * V}`)}</g>);
      break;
    }
    case 'psychic': {
      if (f < 0.16) L.push(<Arcs key="in" at={at} r={R * 1.2 / V} k={0.05 + up * 0.9} seed={seed} color={c.glow} n={6} inward />);
      L.push(flash, <Shockwave key="s1" at={at} r={R * 1.5 / V} k={rel / 0.6} color={c.glow} />, <Shockwave key="s2" at={at} r={R / V} k={(rel - 0.15) / 0.5} color={c.core} />,
        <Arcs key="out" at={at} r={R * 1.3 / V} k={rel / 0.75} seed={seed + 1} color={c.glow} n={7} />, <Sparks key="sp" at={at} seed={seed + 2} k={clamp01(rel)} color={c.core} size={1.4} />);
      break;
    }
    case 'chaos': {
      // the eight-pointed star of Chaos grows from the hero, flares, then turns and burns out
      const grow = easeOut(clamp01(f / 0.25)), rot = f * 40;
      L.push(<g key="star" transform={`rotate(${rot} ${at.x} ${at.y})`} opacity={f < 0.55 ? 1 : 1 - (f - 0.55) / 0.45}>
        {Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2, r1 = R * (0.3 + grow * 0.9), tip = { x: at.x + Math.cos(a) * r1, y: at.y + Math.sin(a) * r1 }, w = R * 0.12;
          return <g key={i}>{line(`l${i}`, ray(at, a, R * 0.2, r1), rel > 0 && rel < 0.3 ? '#fff' : c.glow, 0.12, 0.95)}
            <polyline points={`${tip.x + Math.cos(a + 2.5) * w},${tip.y + Math.sin(a + 2.5) * w} ${tip.x},${tip.y} ${tip.x + Math.cos(a - 2.5) * w},${tip.y + Math.sin(a - 2.5) * w}`} fill="none" stroke={c.glow} strokeWidth={0.12 * V} /></g>; })}
        {ring('c', R * 0.2, c.glow, 0.1, 0.9)}</g>);
      L.push(flash, <Shockwave key="s" at={at} r={R * 1.7 / V} k={rel / 0.6} color={c.glow} />);
      if (aft > 0) for (let i = 0; i < 12; i++) { const a = noise(seed, i) * Math.PI * 2, d = R * (0.4 + aft * 1.1 * noise(seed, i + 5)); L.push(<circle key={`e${i}`} cx={at.x + Math.cos(a) * d} cy={at.y + Math.sin(a) * d - aft * R * 0.5} r={0.07 * V} fill={i % 3 ? c.glow : '#fbbf24'} opacity={1 - aft} />); }
      break;
    }
    case 'fury': {
      // red cracks run out across the ground, then five slashes tear across, blood flies, a ring of force
      if (f < 0.4) for (let i = 0; i < 6; i++) {
        const a = noise(seed, i) * Math.PI * 2, len = R * 1.4 * easeOut(clamp01(f / 0.15));
        const pts = Array.from({ length: 5 }, (_, j) => { const d = (j / 4) * len, w = j ? (noise(seed, i * 5 + j) - 0.5) * R * 0.25 : 0; return `${at.x + Math.cos(a) * d - Math.sin(a) * w},${at.y + Math.sin(a) * d + Math.cos(a) * w}`; }).join(' ');
        L.push(<polyline key={`k${i}`} points={pts} fill="none" stroke={c.glow} strokeWidth={0.1 * V} opacity={f < 0.25 ? 0.9 : (0.4 - f) / 0.15 * 0.9} />);
      }
      L.push(flash);
      if (rel > 0 && rel < 1) for (let i = 0; i < 5; i++) {
        const a = -0.6 + i * 0.3 + noise(seed, i + 20) * 0.2, sw = clamp01(rel * 2.2 - i * 0.12), l = R * 1.2;
        if (sw <= 0) continue;
        L.push(<g key={`sl${i}`} transform={`translate(${at.x} ${at.y}) rotate(${(a * 180) / Math.PI + 45})`} opacity={1 - rel}>
          <path d={`M ${-l} ${(i - 2) * R * 0.18} Q 0 ${(i - 2) * R * 0.18 - R * 0.25} ${-l + 2 * l * sw} ${(i - 2) * R * 0.18}`} fill="none" stroke={c.glow} strokeWidth={0.28 * V} strokeLinecap="round" opacity={0.6} />
          <path d={`M ${-l} ${(i - 2) * R * 0.18} Q 0 ${(i - 2) * R * 0.18 - R * 0.25} ${-l + 2 * l * sw} ${(i - 2) * R * 0.18}`} fill="none" stroke="#fff" strokeWidth={0.07 * V} strokeLinecap="round" />
        </g>);
      }
      L.push(<Shockwave key="s" at={at} r={R * 1.4 / V} k={rel / 0.55} color={c.glow} />, <Debris key="bl" at={at} k={clamp01(rel)} seed={seed} n={10} color="#7f1d1d" size={1.1} />);
      break;
    }
    case 'waaagh': {
      // a green glow pumps up, then a stomp: three rings in quick succession, a big ring of dust and rubble thrown out
      if (f < 0.16) L.push(<Glow key="pump" at={at} r={(R * (0.4 + up * 0.6) * (1 + 0.15 * Math.sin(f * 90))) / V} color="green" op={0.5 + up * 0.5} />);
      L.push(flash, <DustRing key="d" at={at} k={clamp01(rel / 0.9)} r={R * 1.8 / V} seed={seed} />);
      for (let i = 0; i < 3; i++) L.push(<Shockwave key={`s${i}`} at={at} r={R * (1.3 + i * 0.3) / V} k={(rel - i * 0.12) / 0.5} color={c.glow} />);
      L.push(<Debris key="rb" at={at} k={clamp01(rel / 0.8)} seed={seed + 3} n={9} size={1.2} />);
      if (aft > 0) L.push(<Sparks key="sp" at={at} seed={seed + 4} k={aft} color={c.glow} size={1.6} />);
      break;
    }
    case 'tech': {
      // a radar sweep turns, then circuit traces run out at right angles and a grid pings; data blinks after
      if (f < 0.5) {
        const a = f * 14;
        L.push(line('sw', ray(at, a, 0, R * 1.1), c.glow, 0.1, 0.9 * (1 - f / 0.5)), line('sw2', ray(at, a - 0.25, 0, R * 1.1), c.glow, 0.05, 0.4 * (1 - f / 0.5)), ring('rr', R * 1.1, c.glow, 0.05, 0.6 * (1 - f / 0.5)));
      }
      L.push(flash);
      if (rel > 0 && rel < 1) for (let i = 0; i < 6; i++) {
        const dir = i % 4, sx = [1, 0, -1, 0][dir], sy = [0, 1, 0, -1][dir], turn = noise(seed, i) > 0.5 ? 1 : -1, l1 = R * (0.5 + noise(seed, i + 3) * 0.5), l2 = R * 0.5 * easeOut(rel);
        const p1 = { x: at.x + sx * l1 * easeOut(clamp01(rel * 2)), y: at.y + sy * l1 * easeOut(clamp01(rel * 2)) }, p2 = { x: p1.x + -sy * turn * l2, y: p1.y + sx * turn * l2 };
        L.push(<polyline key={`ct${i}`} points={`${at.x + sx * R * 0.2},${at.y + sy * R * 0.2} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill="none" stroke={c.glow} strokeWidth={0.08 * V} opacity={1 - rel} />, <rect key={`cn${i}`} x={p2.x - 0.1 * V} y={p2.y - 0.1 * V} width={0.2 * V} height={0.2 * V} fill={c.core} opacity={1 - rel} />);
      }
      L.push(<Shockwave key="s" at={at} r={R * 1.5 / V} k={rel / 0.6} color={c.glow} />);
      if (aft > 0) for (let i = 0; i < 10; i++) if (noise(seed + Math.floor(f * 20), i) > 0.45) L.push(<rect key={`dt${i}`} x={at.x + (noise(seed, i) - 0.5) * R * 2} y={at.y + (noise(seed, i + 7) - 0.5) * R * 2} width={0.16 * V} height={0.16 * V} fill={c.glow} opacity={1 - aft} />);
      break;
    }
    case 'shield': {
      // a ring forms, then a faceted dome flashes over the unit and ripples spread from its edge
      const dome = clamp01((f - 0.1) / 0.2);
      if (f < 0.2) L.push(ring('f', R * (1.4 - up * 0.4), c.glow, 0.08, up));
      if (dome > 0) {
        const op = f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4;
        L.push(<g key="dm" opacity={op}>
          <circle cx={at.x} cy={at.y} r={R} fill={c.glow} opacity={0.12 + (rel > 0 && rel < 0.3 ? 0.25 : 0)} />
          {Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6, b = a + Math.PI / 3, r = R * 0.62;
            return <polygon key={i} points={`${at.x},${at.y} ${at.x + Math.cos(a) * r},${at.y + Math.sin(a) * r} ${at.x + Math.cos(b) * r},${at.y + Math.sin(b) * r}`} fill="none" stroke={c.core} strokeWidth={0.04 * V} opacity={0.6 * dome} />; })}
          {ring('e', R, c.glow, 0.12, dome)}{ring('e2', R, '#fff', 0.04, dome)}
        </g>);
      }
      for (let i = 0; i < 2; i++) L.push(<Shockwave key={`rp${i}`} at={at} r={R * 1.5 / V} k={(aft - i * 0.25) / 0.6} color={c.glow} />);
      break;
    }
    case 'plague': {
      // the ground bubbles, then a burst of bubbles and a buzzing cloud of flies; bubbles rise and pop
      for (let i = 0; i < 12; i++) {
        const t = clamp01((f - noise(seed, i) * 0.35) / 0.55), a = noise(seed, i + 10) * Math.PI * 2, d = R * (0.2 + easeOut(t) * 0.9 * noise(seed, i + 11));
        if (t > 0 && t < 1) L.push(<circle key={`b${i}`} cx={at.x + Math.cos(a) * d} cy={at.y + Math.sin(a) * d - t * R * 0.4} r={(0.12 + t * 0.22) * V * (0.6 + noise(seed, i + 12))} fill={c.glow} fillOpacity={0.25} stroke={c.core} strokeWidth={0.04 * V} opacity={t > 0.85 ? (1 - t) / 0.15 : 1} />);
      }
      L.push(flash);
      if (rel > 0) for (let i = 0; i < 16; i++) {
        const a = noise(seed, i + 30) * Math.PI * 2 + f * (3 + noise(seed, i + 31) * 4), d = R * (0.4 + noise(seed, i + 32) * 0.9) * easeOut(clamp01(rel * 1.5));
        L.push(<circle key={`fl${i}`} cx={at.x + Math.cos(a) * d} cy={at.y + Math.sin(a) * d * 0.7} r={0.06 * V} fill="#1a1a12" opacity={1 - aft} />);
      }
      L.push(<Shockwave key="s" at={at} r={R * 1.2 / V} k={rel / 0.6} color={c.glow} />);
      break;
    }
    case 'necron': {
      // two rings of glyphs turn against each other, then a green flash and beams rise; the glyph ring fades
      const op = f < 0.7 ? Math.min(1, f / 0.1) : 1 - (f - 0.7) / 0.3;
      L.push(<g key="g1" transform={`rotate(${f * 160} ${at.x} ${at.y})`} opacity={op}>{ring('a', R * 0.9, c.glow, 0.08, 0.9, `${0.25 * V} ${0.18 * V} ${0.06 * V} ${0.18 * V}`)}</g>,
        <g key="g2" transform={`rotate(${-f * 220} ${at.x} ${at.y})`} opacity={op}>{ring('b', R * 0.65, c.glow, 0.06, 0.8, `${0.12 * V} ${0.12 * V}`)}</g>);
      L.push(flash);
      if (rel > 0 && rel < 1) for (let i = 0; i < 7; i++) {
        const x = at.x + (noise(seed, i) - 0.5) * R * 1.4, h = R * (1 + noise(seed, i + 4)) * easeOut(rel);
        L.push(line(`bm${i}`, { x1: x, y1: at.y + R * 0.2, x2: x, y2: at.y - h }, c.glow, 0.12, 1 - rel), line(`bc${i}`, { x1: x, y1: at.y + R * 0.2, x2: x, y2: at.y - h }, '#fff', 0.04, 1 - rel));
      }
      L.push(<Shockwave key="s" at={at} r={R * 1.3 / V} k={rel / 0.6} color={c.glow} />);
      break;
    }
  }
  return L;
}

function SkillFx({ e, f }: { e: SkillEvent; f: number }) {
  const c = SKILL_COLORS[e.style] ?? SKILL_COLORS.holy;
  const { x, y } = e.at;
  const big = e.epic ? 1.45 : 1, R = 2.1 * big * VIS;
  const fadeOut = f > 0.82 ? 1 - (f - 0.82) / 0.18 : 1;
  const shake = e.style === 'waaagh' && f > 0.12 && f < 0.4 ? (noise(e.seq, Math.floor(f * 60)) - 0.5) * 0.35 : 0;
  return (
    <g pointerEvents="none" transform={`translate(${shake} 0)`}>
      {/* the battlefield darkens a little and takes the colour of the power */}
      {e.epic && <rect x={x - 40} y={y - 40} width={80} height={80} fill={c.deep} opacity={0.16 * Math.sin(Math.min(1, f * 1.3) * Math.PI)} />}
      <Glow at={e.at} r={(0.8 + Math.min(1, f / 0.15) * 0.6) * big} color={STYLE_GLOW[e.style] ?? 'amber'} op={0.55 * fadeOut} />
      {styleLayers(e.style, e.at, f, R, e.seq, c)}
      {/* the name */}
      {f > 0.1 && (() => {
        const pop = Math.min(1, (f - 0.1) / 0.12);
        const scale = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) + (pop < 1 ? 0 : 0.03 * Math.sin(f * 20));
        const ty = y - R * 0.9 - 1.6 * big - f * 0.6;
        const size = (e.name.length > 22 ? 1.0 : 1.25) * big;
        return (
          <g transform={`translate(${x} ${ty}) scale(${scale})`} opacity={fadeOut}>
            <text y={0} fontSize={size} textAnchor="middle" fontWeight={900} fill={c.text} stroke={c.deep} strokeWidth={0.32} paintOrder="stroke" letterSpacing={0.05}>{e.name}</text>
            <text y={size * 0.85} fontSize={size * 0.55} textAnchor="middle" fontWeight={700} fill="#fff" stroke="#000" strokeWidth={0.16} paintOrder="stroke" opacity={0.9}>{e.who}</text>
          </g>
        );
      })()}
    </g>
  );
}

// ---------- an ability used often: the same look as its style, smaller and shorter, and the name ----------

const SKILL_LITE_MS = 1300;

function SkillLite({ e, f }: { e: SkillEvent; f: number }) {
  if (f < 0 || f > 1) return null;
  const c = SKILL_COLORS[e.style] ?? SKILL_COLORS.holy;
  const { x, y } = e.at;
  const fade = f > 0.75 ? (1 - f) / 0.25 : 1;
  return (
    <g opacity={fade}>
      {styleLayers(e.style, e.at, f, 1.3 * VIS, e.seq, c)}
      <text x={x} y={y - 2.3 - f * 0.5} fontSize={0.8} textAnchor="middle" fontWeight={800} fill={c.text} stroke="#000" strokeWidth={0.16} paintOrder="stroke">{e.name}</text>
    </g>
  );
}

/** a column of light coming down (or going up): stacked tendrils of energy, brightest at the ground */
function LightColumn({ at, w, h, op, seed, color = '#67e8f9' }: { at: Pt; w: number; h: number; op: number; seed: number; color?: string }) {
  if (op <= 0) return null;
  return (
    <g opacity={op}>
      {Array.from({ length: 7 }, (_, i) => {
        const t = i / 6, y = at.y - t * h;
        return <Wisp key={i} at={{ x: at.x + (noise(seed, i + 90) - 0.5) * w * 0.4, y }} r={w * (1.1 - t * 0.5)} color={color} op={(1 - t * 0.75)} rot={90 + (noise(seed, i + 91) - 0.5) * 40} v={i} />;
      })}
    </g>
  );
}

// ---------- a unit arrives from Reserves: a column of light, a shockwave and the dust it throws up ----------

function ArrivalFx({ at, f, seed, deepStrike, label }: { at: Pt; f: number; seed: number; deepStrike?: boolean; label?: string }) {
  const beam = f < 0.5 ? Math.sin((f / 0.5) * Math.PI) : 0;
  const ring = clamp01((f - 0.2) / 0.6);
  const ring2 = clamp01((f - 0.35) / 0.55);
  const dust = clamp01((f - 0.25) / 0.7);
  const bannerOpacity = f < 0.15 ? f / 0.15 : f > 0.8 ? (1 - f) / 0.2 : 1;
  const bannerY = at.y - 2.8 - easeOut(Math.min(1, f * 2.5)) * 0.8;

  return (
    <g>
      {/* Warp Beam */}
      {beam > 0 && (
        <g opacity={beam}>
          <rect x={at.x - (deepStrike ? 1.6 : 0.9)} y={at.y - 18} width={deepStrike ? 3.2 : 1.8} height={18} fill="url(#fx-beam)" />
          <rect x={at.x - (deepStrike ? 0.6 : 0.25)} y={at.y - 18} width={deepStrike ? 1.2 : 0.5} height={18} fill="#fff" opacity={0.85} />
        </g>
      )}
      <Glow at={at} r={deepStrike ? 2.5 + 4 * beam : 1 + 2.2 * beam} color="cyan" op={beam} />

      {/* Primary Shockwave Ring */}
      {ring > 0 && ring < 1 && (
        <g>
          <circle cx={at.x} cy={at.y} r={0.8 + easeOut(ring) * (deepStrike ? 6.5 : 4.2)} fill="none" stroke="#67e8f9" strokeWidth={(deepStrike ? 0.35 : 0.22) * (1 - ring)} opacity={0.95 * (1 - ring)} />
          <circle cx={at.x} cy={at.y} r={0.5 + easeOut(ring) * (deepStrike ? 4.5 : 2.8)} fill="none" stroke="#ffffff" strokeWidth={0.12} opacity={0.85 * (1 - ring)} />
        </g>
      )}

      {/* Secondary Resonant Shockwave Ring for Deep Strike */}
      {deepStrike && ring2 > 0 && ring2 < 1 && (
        <circle cx={at.x} cy={at.y} r={0.4 + easeOut(ring2) * 5.5} fill="none" stroke="#fbcfe8" strokeWidth={0.25 * (1 - ring2)} opacity={0.75 * (1 - ring2)} />
      )}

      {/* Warp Lightning Arcs */}
      {deepStrike && f < 0.7 && (
        <g opacity={1 - f / 0.7}>
          {Array.from({ length: 6 }, (_, i) => {
            const angle = (i / 6) * Math.PI * 2 + noise(seed, i) * 0.4;
            const r1 = 0.8 + noise(seed, i + 10) * 1.5;
            const r2 = r1 + 1.2 + noise(seed, i + 20) * 1.8;
            const mx = at.x + Math.cos(angle + 0.25) * r1;
            const my = at.y + Math.sin(angle + 0.25) * r1;
            const ex = at.x + Math.cos(angle) * r2;
            const ey = at.y + Math.sin(angle) * r2;
            return (
              <polyline
                key={i}
                points={`${at.x},${at.y} ${mx},${my} ${ex},${ey}`}
                fill="none"
                stroke={i % 2 === 0 ? '#67e8f9' : '#ffffff'}
                strokeWidth={0.12}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      )}

      {/* Dust Clouds */}
      {Array.from({ length: deepStrike ? 14 : 10 }, (_, i) => {
        const a = (i / (deepStrike ? 14 : 10)) * Math.PI * 2 + noise(seed, i) * 0.5;
        const d = 1.2 + dust * ((deepStrike ? 3.2 : 2) + noise(seed, i + 9) * 1.4);
        return <Puff key={i} at={{ x: at.x + Math.cos(a) * d, y: at.y + Math.sin(a) * d }} k={dust} r={deepStrike ? 1.2 : 0.9} />;
      })}

      {/* Floating Deep Strike Banner */}
      {(deepStrike || label) && bannerOpacity > 0 && (
        <g transform={`translate(${at.x} ${bannerY})`} opacity={bannerOpacity}>
          <rect
            x={-4.5}
            y={-0.8}
            width={9.0}
            height={1.6}
            rx={0.35}
            fill="rgba(15, 23, 42, 0.92)"
            stroke="#67e8f9"
            strokeWidth={0.12}
          />
          <text
            y={0.25}
            fontSize={0.65}
            textAnchor="middle"
            fill="#a5f3fc"
            fontWeight={900}
            letterSpacing={0.08}
            stroke="#0f172a"
            strokeWidth={0.15}
            paintOrder="stroke"
          >
            {label || 'DEEP STRIKE ARRIVAL'}
          </text>
        </g>
      )}
    </g>
  );
}

// ---------- a unit is extracted to Reserves: warp beam, contracting energy ring, floating ascent, and banner ----------

function ExtractFx({ e, f }: { e: Extract<FxEvent, { kind: 'extract' }>; f: number }) {
  const at = e.at;
  const lift = easeOut(f) * 2.5;
  const modelFade = Math.max(0, 1 - f * 1.5);
  const beamOp = f < 0.65 ? Math.sin((f / 0.65) * Math.PI) : 0;
  const contractRing = Math.max(0.15, (1 - easeOut(f)) * 3.5);
  const bannerFade = f < 0.12 ? f / 0.12 : f > 0.82 ? (1 - f) / 0.18 : 1;

  return (
    <g>
      {/* Upward Warp Beam into the sky */}
      {beamOp > 0 && (
        <g opacity={beamOp}>
          <LightColumn at={at} w={2.2} h={16} op={1} seed={Math.round(at.x * 7 + at.y * 3)} color="#38bdf8" />
          <Glow at={at} r={2.8} color="cyan" op={beamOp * 0.85} />
        </g>
      )}

      {/* Contracting Energy Rings towards centre */}
      {f < 0.9 && (
        <g opacity={1 - f * 0.85}>
          <Swirl at={at} r={contractRing} color="#38bdf8" k={f} seed={Math.round(at.x * 7 + at.y * 3)} n={5} />
        </g>
      )}

      {/* Model Silhouettes Lifting and Fading */}
      {modelFade > 0 && e.models && e.models.map((m, idx) => (
        <g key={idx} transform={`translate(${m.x} ${m.y - lift})`} opacity={modelFade}>
          <circle cx={0} cy={0} r={m.r} fill="rgba(56, 189, 248, 0.3)" stroke="#38bdf8" strokeWidth={0.08} />
          <circle cx={0} cy={0} r={m.r * 0.45} fill="rgba(255, 255, 255, 0.5)" />
        </g>
      ))}

      {/* EXTRACTED TO RESERVES Banner */}
      {bannerFade > 0 && (
        <g transform={`translate(${at.x} ${at.y - 2.8 - lift * 0.3})`} opacity={bannerFade}>
          <rect x={-3.5} y={-0.65} width={7.0} height={1.3} rx={0.32} fill="rgba(8, 14, 26, 0.94)" stroke="#38bdf8" strokeWidth={0.09} />
          <text y={0.16} fontSize={0.36} textAnchor="middle" fill="#e0f2fe" fontWeight={900} letterSpacing={0.06}>
            {e.label || 'EXTRACTED TO RESERVES'}
          </text>
        </g>
      )}
    </g>
  );
}

// ---------- a unit breaks: red wisps of panic that shudder, and the word over it ----------

function ShockFx({ at, f, seed }: { at: Pt; f: number; seed: number }) {
  const inK = clamp01(f / 0.2), out = f > 0.75 ? (1 - f) / 0.25 : 1;
  const shake = f < 0.35 ? (noise(seed, Math.floor(f * 60)) - 0.5) * 0.25 : 0;
  const R = 2.1 + (1 - inK) * 1.2;
  return (
    <g opacity={inK * out}>
      <Glow at={at} r={2.6} color="red" op={0.35} />
      <Swirl at={{ x: at.x + shake, y: at.y }} r={R * 0.8} color="#f87171" k={f} seed={seed} n={4} op={0.7} />
      <text x={at.x + shake} y={at.y - R - 0.6 - f * 0.4} fontSize={0.85} textAnchor="middle" fontWeight={900} letterSpacing={0.08} fill="#fecaca" stroke="#000" strokeWidth={0.16} paintOrder="stroke">BATTLE-SHOCKED</text>
    </g>
  );
}

// ---------- wounds regained or models returned: green motes rising and the count ----------

function HealFx({ at, f, seed, n, revive }: { at: Pt; f: number; seed: number; n: number; revive: boolean }) {
  const fade = f < 0.15 ? f / 0.15 : f > 0.7 ? (1 - f) / 0.3 : 1;
  return (
    <g opacity={fade}>
      <Glow at={at} r={1.6 + f} color="green" op={0.4} />
      {revive && <Swirl at={at} r={0.8 + f * 1.6} color="#bef264" k={f} seed={seed} n={4} op={1 - f} />}
      {Array.from({ length: 9 }, (_, i) => {
        const k = (f + noise(seed, i)) % 1, x = at.x + (noise(seed, i + 9) - 0.5) * 2.6 + Math.sin(k * 6 + i) * 0.2;
        return <circle key={i} cx={x} cy={at.y + 0.8 - k * 3} r={0.09 + noise(seed, i + 18) * 0.08} fill="#d9f99d" opacity={1 - k} />;
      })}
      <text x={at.x} y={at.y - 1.9 - f * 0.8} fontSize={0.9} textAnchor="middle" fontWeight={900} fill="#d9f99d" stroke="#000" strokeWidth={0.16} paintOrder="stroke">{revive ? `+${n} model${n > 1 ? 's' : ''} return` : `+${n} W`}</text>
    </g>
  );
}

// ---------- a charge: speed lines behind the models and a dust burst where they slam in ----------

function ChargeFx({ paths, f, seed }: { paths: [string, Pt[]][]; f: number; seed: number }) {
  const ends = paths.map(([, p]) => p[p.length - 1]).filter(Boolean);
  if (!ends.length) return null;
  const c = { x: ends.reduce((a, p) => a + p.x, 0) / ends.length, y: ends.reduce((a, p) => a + p.y, 0) / ends.length };
  const lines = f < 0.85 ? (f < 0.7 ? 1 : (0.85 - f) / 0.15) : 0;
  const hit = clamp01((f - 0.78) / 0.22);
  return (
    <g>
      {lines > 0 && paths.slice(0, 12).map(([id, p]) => {
        if (p.length < 2) return null;
        const a = p[0], b = p[p.length - 1], k = clamp01(f / 0.8);
        const head = lerp(a, b, k), tail = lerp(a, b, Math.max(0, k - 0.35));
        return <line key={id} x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#fde68a" strokeWidth={0.12} strokeLinecap="round" opacity={0.55 * lines} />;
      })}
      <DustRing at={c} k={hit} r={3.2} seed={seed} />
      {hit > 0 && ends.slice(0, 8).map((p, i) => <Puff key={i} at={p} k={hit} r={0.7 + noise(seed, i) * 0.4} />)}
    </g>
  );
}
