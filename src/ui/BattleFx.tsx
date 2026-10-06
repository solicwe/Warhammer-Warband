import { memo, useEffect, useState } from 'react';
import type { FxEvent, Pt } from '../engine/types';
import type { WeaponFx } from '../engine/weaponFx';

/** How long each kind of effect plays (ms). Rolls are shown by the screen, not the board. */
export const FX_MS: Record<FxEvent['kind'], number> = { move: 700, place: 900, attack: 1900, mortal: 1200, skill: 2800, roll: 0, rolloff: 0, cards: 0, primary: 0 };
export interface ActiveFx { e: FxEvent; t0: number }

/**
 * The effects layer. It runs its own animation clock, so only these few shapes are redrawn
 * every frame — the battlefield, terrain and units underneath are left alone.
 * No SVG filters: blur / turbulence filters are what made phones stutter; glows are radial gradients instead.
 */
export const FxLayer = memo(function FxLayer({ fx }: { fx: ActiveFx[] }) {
  const live = fx.filter((a) => a.e.kind === 'attack' || a.e.kind === 'mortal' || a.e.kind === 'skill');
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!live.length) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      setNow(t);
      if (live.some((a) => t - a.t0 < FX_MS[a.e.kind])) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx]);
  if (!live.length) return null;
  return (
    <g pointerEvents="none">
      <FxDefs />
      {live.map((a) => <FxView key={a.e.seq} a={a} now={now} />)}
    </g>
  );
});

const GLOWS: Record<string, string> = { amber: '#fbbf24', orange: '#f97316', red: '#ef4444', blue: '#60a5fa', cyan: '#67e8f9', purple: '#c084fc', green: '#a3e635', white: '#ffffff', molten: '#fde68a' };
type GlowColor = keyof typeof GLOWS;

const FxDefs = memo(function FxDefs() {
  return (
    <defs>
      {Object.entries(GLOWS).map(([k, c]) => (
        <radialGradient key={k} id={`fxg-${k}`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.25" stopColor={c} stopOpacity="0.8" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
      ))}
      <radialGradient id="fx-smoke-g"><stop offset="0" stopColor="#4a4540" stopOpacity="0.85" /><stop offset="0.6" stopColor="#5d5852" stopOpacity="0.55" /><stop offset="1" stopColor="#6b665f" stopOpacity="0" /></radialGradient>
      <radialGradient id="fx-scorch"><stop offset="0" stopColor="#120e0a" stopOpacity="0.85" /><stop offset="0.6" stopColor="#2a2118" stopOpacity="0.5" /><stop offset="1" stopColor="#2a2118" stopOpacity="0" /></radialGradient>
      <radialGradient id="fx-blood"><stop offset="0" stopColor="#7f0d0d" stopOpacity="0.9" /><stop offset="0.7" stopColor="#5c0a0a" stopOpacity="0.6" /><stop offset="1" stopColor="#5c0a0a" stopOpacity="0" /></radialGradient>
      <radialGradient id="fx-boom"><stop offset="0" stopColor="#fffbe6" /><stop offset="0.35" stopColor="#fbbf24" /><stop offset="0.7" stopColor="#ea580c" stopOpacity="0.8" /><stop offset="1" stopColor="#7c2d12" stopOpacity="0" /></radialGradient>
    </defs>
  );
});

/** a soft round glow */
function Glow({ at, r, color, op = 1 }: { at: Pt; r: number; color: GlowColor; op?: number }) {
  if (r <= 0 || op <= 0) return null;
  return <circle cx={at.x} cy={at.y} r={r} fill={`url(#fxg-${color})`} opacity={Math.min(1, op)} />;
}

function FxView({ a, now }: { a: ActiveFx; now: number }) {
  const e = a.e;
  const f = (now - a.t0) / FX_MS[e.kind];
  if (f < 0 || f > 1) return null;
  if (e.kind === 'mortal') {
    return (
      <g opacity={1 - f}>
        <Glow at={e.at} r={1.2 + f * 1.5} color="purple" op={0.7} />
        <circle cx={e.at.x} cy={e.at.y} r={0.8 + f * 2.2} fill="none" stroke="#c084fc" strokeWidth={0.18} />
        <text x={e.at.x} y={e.at.y - 1 - f * 1.6} fontSize={1} textAnchor="middle" fill="#e9d5ff" stroke="#000" strokeWidth={0.14} paintOrder="stroke" fontWeight={900}>-{e.n} MW</text>
      </g>
    );
  }
  if (e.kind === 'attack') return <AttackFx e={e} f={f} />;
  if (e.kind === 'skill') return e.grand ? <SkillFx e={e} f={f} /> : <SkillLite e={e} f={(now - a.t0) / SKILL_LITE_MS} />;
  return null;
}

type AttackEvent = Extract<FxEvent, { kind: 'attack' }>;

/** deterministic 0..1 noise so an effect looks the same on every frame */
const noise = (seed: number, i: number) => { const v = Math.sin(seed * 91.17 + i * 12.9898) * 43758.5453; return v - Math.floor(v); };
const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));


function Sparks({ at, seed, k, color = '#fde68a', size = 0.9 }: { at: Pt; seed: number; k: number; color?: string; size?: number }) {
  if (k <= 0 || k >= 1) return null;
  return (
    <g opacity={1 - k}>
      <circle cx={at.x} cy={at.y} r={0.25 + k * 0.5 * size} fill="#fff" opacity={0.9 * (1 - k)} />
      {Array.from({ length: 6 }, (_, i) => {
        const a = noise(seed, i) * Math.PI * 2;
        const r0 = 0.2 + k * 0.4 * size, r1 = r0 + (0.35 + noise(seed, i + 7) * 0.5) * size * (1 - k * 0.5);
        return <line key={i} x1={at.x + Math.cos(a) * r0} y1={at.y + Math.sin(a) * r0} x2={at.x + Math.cos(a) * r1} y2={at.y + Math.sin(a) * r1} stroke={color} strokeWidth={0.07} strokeLinecap="round" />;
      })}
    </g>
  );
}

function Puff({ at, k, r = 1, color = 'rgba(120,115,105,0.55)' }: { at: Pt; k: number; r?: number; color?: string }) {
  if (k <= 0 || k >= 1) return null;
  return <circle cx={at.x} cy={at.y} r={r * (0.3 + k * 0.9)} fill={color} opacity={0.8 * (1 - k)} />;
}

/** Bits of dirt, rock or metal thrown out from a point, falling back as they fly. */
function Debris({ at, k, seed, n = 8, color = '#2b241c', size = 1 }: { at: Pt; k: number; seed: number; n?: number; color?: string; size?: number }) {
  if (k <= 0 || k >= 1) return null;
  return (
    <g opacity={1 - k * k}>
      {Array.from({ length: n }, (_, i) => {
        const a = noise(seed, i + 30) * Math.PI * 2, sp = (0.8 + noise(seed, i + 31) * 1.6) * size;
        const d = sp * (1 - (1 - k) * (1 - k)); // fast then slowing
        return <rect key={i} x={at.x + Math.cos(a) * d - 0.08} y={at.y + Math.sin(a) * d - 0.08 + k * k * 0.6} width={0.16 * size} height={0.12 * size} fill={color} transform={`rotate(${k * 500 + i * 40} ${at.x + Math.cos(a) * d} ${at.y + Math.sin(a) * d})`} />;
      })}
    </g>
  );
}

/** A blast: white flash, fireball, shockwave ring, flying debris, then a column of smoke over a scorch mark. */
function Explosion({ at, k, seed, big = 1 }: { at: Pt; k: number; seed: number; big?: number }) {
  if (k <= 0 || k >= 1) return null;
  const fire = clamp01(k / 0.45), ring = clamp01(k / 0.35), smoke = clamp01((k - 0.1) / 0.9);
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={1.6 * big} fill="url(#fx-scorch)" opacity={Math.min(1, k * 4) * (1 - smoke * 0.3)} />
      {ring < 1 && <circle cx={at.x} cy={at.y} r={(0.5 + ring * 3) * big} fill="none" stroke="#fde68a" strokeWidth={0.18 * (1 - ring)} opacity={0.8 * (1 - ring)} />}
      <g opacity={0.9 * (1 - smoke)}>
        {Array.from({ length: 5 }, (_, i) => {
          const a = noise(seed, i + 70) * Math.PI * 2, d = smoke * (0.6 + noise(seed, i + 71)) * big;
          return <circle key={i} cx={at.x + Math.cos(a) * d * 0.7} cy={at.y + Math.sin(a) * d * 0.7 - smoke * 1.4 * big} r={(0.6 + smoke * 1.4) * big * (0.7 + noise(seed, i + 72) * 0.5)} fill="url(#fx-smoke-g)" />;
        })}
      </g>
      {fire < 1 && (
        <g>
          <circle cx={at.x} cy={at.y} r={(0.6 + fire * 1.8) * big} fill="url(#fx-boom)" opacity={1 - fire} />
          {fire < 0.25 && <circle cx={at.x} cy={at.y} r={(0.9 + fire * 3) * big} fill="#fffbe6" opacity={0.9 * (1 - fire * 4)} />}
        </g>
      )}
      <Debris at={at} k={clamp01(k / 0.6)} seed={seed} n={9} size={big} />
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
};

/** Shooting / melee effect: every weapon in the attack has its own look; then damage and casualties. */
function AttackFx({ e, f }: { e: AttackEvent; f: number }) {
  const shooters = e.shooters?.length ? e.shooters : [e.from];
  const victims = e.victims?.length ? e.victims : [e.to];
  const seed = e.seq;
  const volleys = e.volleys?.length ? e.volleys
    : [{ fx: LEGACY[e.style ?? (e.attackKind === 'fight' ? 'melee' : 'bullet')] ?? 'bolt', shots: e.shots ?? 6, hits: e.hits ?? e.shots ?? 6, models: shooters.length }];
  const after = clamp01((f - 0.5) / 0.5); // damage numbers and casualties
  const under: React.ReactNode[] = []; // smoke, dirt
  const over: React.ReactNode[] = []; // light
  volleys.forEach((v, vi) => {
    const S = SHOT[v.fx] ?? SHOT.bolt;
    const vStart = volleys.length > 1 ? (vi / volleys.length) * 0.16 : 0;
    // the models that fire this weapon (a heavy weapon is one model, a squad's bolters are many)
    const cnt = Math.max(1, Math.min(shooters.length, v.models || 1));
    const off = (vi * 5) % shooters.length;
    const from = (i: number) => shooters[(off + (i % cnt)) % shooters.length];
    const n = v.fx === 'gatling' ? Math.min(S.max, Math.max(8, v.shots)) : Math.min(S.max, Math.max(1, v.shots));
    const hitShare = v.shots ? v.hits / v.shots : 1;
    for (let i = 0; i < n; i++) {
      const sd = seed * 7 + vi * 101 + i;
      const t0 = vStart + (i / n) * S.span + noise(sd, 40) * 0.03;
      const src = from(i);
      const tgt = victims[Math.floor(noise(sd, 3) * victims.length) % victims.length];
      const hit = noise(sd, 5) < hitShare;
      const spread = v.fx === 'shoota' ? 6 : v.fx === 'gatling' ? 3 : 4;
      const impact = hit ? { x: tgt.x + (noise(sd, 13) - 0.5) * 0.5, y: tgt.y + (noise(sd, 17) - 0.5) * 0.5 }
        : { x: tgt.x + (noise(sd, 9) - 0.5) * spread, y: tgt.y + (noise(sd, 11) - 0.5) * spread };
      const k = (f - t0) / S.travel; // 0..1 while flying
      const ik = (f - t0 - S.travel) / 0.22; // 0..1 after impact
      const ang = Math.atan2(impact.y - src.y, impact.x - src.x);
      if (MELEE.has(v.fx)) { meleeHit(v.fx, `${vi}-${i}`, impact, hit, f - t0, sd, over, under); continue; }
      // muzzle flash (gatlings get one long flickering flash per gun instead)
      if (v.fx !== 'gatling' && v.fx !== 'flame' && v.fx !== 'psychic') {
        const mk = (f - t0) / (v.fx === 'las' || v.fx === 'melta' || v.fx === 'volkite' ? 0.12 : 0.07);
        if (mk > 0 && mk < 1) over.push(<Muzzle key={`m${vi}-${i}`} at={src} ang={ang} k={mk} sd={sd} fx={v.fx} />);
        if (mk > 0 && mk < 1 && v.fx !== 'las' && v.fx !== 'lightning') under.push(<Puff key={`gs${vi}-${i}`} at={{ x: src.x + (noise(sd, 60) - 0.5) * 0.6, y: src.y - mk * 0.4 }} k={mk * 0.5} r={v.fx === 'missile' ? 1.4 : 0.7} color="rgba(190,185,175,0.35)" />);
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
              over.push(<line key={`sg${key}-${j}`} x1={t.x} y1={t.y} x2={h.x} y2={h.y} stroke={core} strokeWidth={0.06} strokeLinecap="round" />);
            }
          } else if (k > 0 && k < 1) {
            const tl = v.fx === 'gatling' ? 0.3 : heavy ? 0.28 : 0.22;
            const head = lerp(src, impact, k), tail = lerp(src, impact, Math.max(0, k - tl));
            const w = heavy ? 1.5 : v.fx === 'gatling' ? 0.7 : 1;
            over.push(
              <g key={`t${key}`}>
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={glow} strokeWidth={0.3 * w} strokeLinecap="round" opacity={0.45} />
                <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={core} strokeWidth={0.1 * w} strokeLinecap="round" />
                {v.fx === 'pulse' && <Glow at={head} r={0.45} color="cyan" />}
              </g>,
            );
          }
          if (hit && ik > 0 && ik < 1) {
            // mass-reactive bolts burst inside the target; others spark
            if (v.fx === 'bolt' || heavy) over.push(<Glow key={`pop${key}`} at={impact} r={(heavy ? 0.9 : 0.6) * (0.5 + ik)} color={ig} op={1 - ik} />);
            over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={ik} color={core} size={heavy ? 1.1 : 0.8} />);
          } else if (!hit) missDirt(key, impact, ik, sd, under);
          break;
        }
        case 'sniper': {
          const lk = (f - t0) / 0.35;
          if (lk > 0 && lk < 1) over.push(
            <g key={`sn${key}`} opacity={1 - lk}>
              <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke="#e0f2fe" strokeWidth={0.18} opacity={0.35} />
              <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke="#fff" strokeWidth={0.05} />
            </g>,
          );
          if (hit && ik > 0 && ik < 1) { over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={ik} color="#fff" size={0.7} />); under.push(<Puff key={`bm${key}`} at={impact} k={ik} r={0.7} color="rgba(127,13,13,0.55)" />); }
          else if (!hit) missDirt(key, impact, ik, sd, under);
          break;
        }
        case 'plasma': {
          if (k > 0 && k < 1) {
            // a ball of plasma with a fading tail
            for (let j = 3; j >= 1; j--) over.push(<Glow key={`pt${key}-${j}`} at={lerp(src, impact, Math.max(0, k - j * 0.06))} r={0.55 - j * 0.1} color="blue" op={0.5 - j * 0.1} />);
            const p = lerp(src, impact, k);
            over.push(<g key={`pb${key}`}><Glow at={p} r={0.9} color="cyan" /><circle cx={p.x} cy={p.y} r={0.2} fill="#f0f9ff" /></g>);
          }
          const xk = (f - t0 - S.travel) / 0.3;
          if (xk > 0 && xk < 1) {
            over.push(
              <g key={`px${key}`}>
                <Glow at={impact} r={0.6 + xk * (hit ? 1.6 : 1)} color="blue" op={1 - xk} />
                <circle cx={impact.x} cy={impact.y} r={0.4 + xk * 1.8} fill="none" stroke="#a5f3fc" strokeWidth={0.12 * (1 - xk)} opacity={1 - xk} />
              </g>,
            );
            over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={xk} color="#bae6fd" size={1.1} />);
            if (!hit) under.push(<circle key={`ps${key}`} cx={impact.x} cy={impact.y} r={0.5} fill="url(#fx-scorch)" opacity={1 - xk} />);
          }
          break;
        }
        case 'las': case 'volkite': {
          const bk = (f - t0) / 0.16;
          const col = v.fx === 'las' ? ['#ef4444', '#fecaca'] : ['#f97316', '#ffedd5'];
          if (bk > 0 && bk < 1) {
            const w = 1 - bk;
            over.push(
              <g key={`b${key}`}>
                <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke={col[0]} strokeWidth={0.6 * w} strokeLinecap="round" opacity={0.35} />
                <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke={col[0]} strokeWidth={0.22 * w} strokeLinecap="round" opacity={0.8} />
                <line x1={src.x} y1={src.y} x2={impact.x} y2={impact.y} stroke="#fff" strokeWidth={0.07 * w} strokeLinecap="round" />
              </g>,
            );
            if (v.fx === 'volkite') for (let j = 0; j < 4; j++) {
              const p = lerp(src, impact, noise(sd, 90 + j + Math.floor(bk * 6)));
              over.push(<circle key={`vk${key}-${j}`} cx={p.x + (noise(sd, 95 + j) - 0.5) * 0.5} cy={p.y + (noise(sd, 99 + j) - 0.5) * 0.5} r={0.08} fill="#fed7aa" />);
            }
          }
          const hk = (f - t0) / 0.4;
          if (hk > 0 && hk < 1) {
            over.push(<Glow key={`bh${key}`} at={impact} r={0.5 + hk * 0.6} color={v.fx === 'las' ? 'red' : 'orange'} op={1 - hk} />);
            if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={hk} color={col[1]} />);
            else under.push(<circle key={`bs${key}`} cx={impact.x} cy={impact.y} r={0.45} fill="url(#fx-scorch)" opacity={1 - hk} />);
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
            const w = 1 - bk * 0.6;
            over.push(
              <g key={`mb${key}`} opacity={bk > 0.8 ? (1 - bk) * 5 : 1}>
                <polyline points={pts} fill="none" stroke="#f97316" strokeWidth={0.9 * w} strokeLinecap="round" opacity={0.3} />
                <polyline points={pts} fill="none" stroke="#fb923c" strokeWidth={0.35 * w} strokeLinecap="round" opacity={0.85} />
                <polyline points={pts} fill="none" stroke="#fffbeb" strokeWidth={0.12 * w} strokeLinecap="round" />
              </g>,
            );
          }
          const hk = (f - t0 - 0.05) / 0.5;
          if (hk > 0 && hk < 1) {
            // molten glow and heat rings where it lands
            over.push(<Glow key={`mh${key}`} at={impact} r={1 + hk * 0.8} color="molten" op={1 - hk} />);
            for (let j = 0; j < 2; j++) {
              const rk = clamp01(hk * 1.6 - j * 0.3);
              if (rk > 0 && rk < 1) over.push(<circle key={`mr${key}-${j}`} cx={impact.x} cy={impact.y} r={0.5 + rk * 2} fill="none" stroke="#fdba74" strokeWidth={0.08} opacity={0.7 * (1 - rk)} />);
            }
            if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={hk} color="#fde68a" size={1.3} />);
            under.push(<circle key={`ms${key}`} cx={impact.x} cy={impact.y} r={0.8} fill="url(#fx-scorch)" opacity={Math.min(1, hk * 3) * (1 - hk)} />);
          }
          break;
        }
        case 'grav': {
          if (k > 0 && k < 1) for (let j = 0; j < 4; j++) {
            const p = lerp(src, impact, Math.max(0, k - j * 0.08));
            over.push(<circle key={`gr${key}-${j}`} cx={p.x} cy={p.y} r={0.25 + j * 0.08} fill="none" stroke="#c084fc" strokeWidth={0.08} opacity={0.9 - j * 0.2} />);
          }
          const xk = (f - t0 - S.travel) / 0.35;
          if (xk > 0 && xk < 1) {
            // gravity crushes inwards
            over.push(<Glow key={`gg${key}`} at={impact} r={0.9} color="purple" op={0.8 * (1 - xk)} />);
            for (let j = 0; j < 3; j++) over.push(<circle key={`gc${key}-${j}`} cx={impact.x} cy={impact.y} r={Math.max(0.05, (1.8 - j * 0.4) * (1 - xk))} fill="none" stroke="#e9d5ff" strokeWidth={0.07} opacity={1 - xk} />);
            if (hit) under.push(<circle key={`gd${key}`} cx={impact.x} cy={impact.y} r={0.6} fill="#1e1b4b" opacity={0.5 * (1 - xk)} />);
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
                <polyline points={pts} fill="none" stroke="#67e8f9" strokeWidth={0.32} strokeLinejoin="round" opacity={0.4} />
                <polyline points={pts} fill="none" stroke="#f0fdff" strokeWidth={0.08} strokeLinejoin="round" />
              </g>,
            );
          }
          const hk = (f - t0) / 0.35;
          if (hk > 0 && hk < 1) { over.push(<Glow key={`lh${key}`} at={impact} r={0.8} color="cyan" op={1 - hk} />); if (hit) over.push(<Sparks key={`k${key}`} at={impact} seed={sd} k={hk} color="#cffafe" />); }
          break;
        }
        case 'psychic': {
          if (k > 0 && k < 1) {
            const nx = -Math.sin(ang), ny = Math.cos(ang);
            for (let j = 2; j >= 0; j--) {
              const kk = Math.max(0, k - j * 0.07), wob = Math.sin(kk * 18) * 0.45;
              const p = lerp(src, impact, kk);
              over.push(<Glow key={`ps${key}-${j}`} at={{ x: p.x + nx * wob, y: p.y + ny * wob }} r={0.75 - j * 0.18} color="purple" op={1 - j * 0.3} />);
            }
          }
          const xk = (f - t0 - S.travel) / 0.35;
          if (xk > 0 && xk < 1) {
            over.push(<Glow key={`px${key}`} at={impact} r={0.6 + xk * 1.8} color="purple" op={1 - xk} />);
            over.push(<circle key={`pr${key}`} cx={impact.x} cy={impact.y} r={0.5 + xk * 2.4} fill="none" stroke="#e9d5ff" strokeWidth={0.1 * (1 - xk)} opacity={1 - xk} />);
          }
          break;
        }
        case 'flame': {
          const fk = (f - t0) / 0.42;
          if (fk > 0 && fk < 1) {
            const len = Math.min(12, Math.hypot(impact.x - src.x, impact.y - src.y));
            const spread = 0.32;
            // tongues of fire rolling out along a cone
            for (let j = 0; j < 9; j++) {
              const life = clamp01(fk * 1.6 - j * 0.07);
              if (life <= 0 || life >= 1) continue;
              const a = ang + (noise(sd, 140 + j) - 0.5) * spread * 2;
              const d = len * life;
              const p = { x: src.x + Math.cos(a) * d, y: src.y + Math.sin(a) * d - life * 0.4 };
              over.push(<Glow key={`fl${key}-${j}`} at={p} r={0.35 + life * 1.3} color={life < 0.35 ? 'molten' : life < 0.7 ? 'orange' : 'red'} op={0.9 * (1 - life * 0.7)} />);
            }
            under.push(<Puff key={`fs${key}`} at={{ x: impact.x, y: impact.y - fk }} k={fk} r={1.3} color="rgba(60,55,50,0.45)" />);
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
              under.push(<circle key={`ms${key}-${j}`} cx={at(kk).x} cy={at(kk).y} r={0.22 + age * 0.45} fill="rgba(170,165,155,0.5)" opacity={0.8 * (1 - age)} />);
            }
            const p = at(k);
            over.push(<g key={`mr${key}`}><Glow at={p} r={0.6} color="orange" /><circle cx={p.x} cy={p.y} r={0.12} fill="#fff" /></g>);
          }
          const xk = (f - t0 - S.travel) / 0.4;
          if (xk > 0 && xk < 1) under.push(<Explosion key={`x${key}`} at={impact} k={xk} seed={sd} big={0.9} />);
          break;
        }
        case 'shell': {
          if (k > 0 && k < 1) {
            const mid = { x: (src.x + impact.x) / 2, y: (src.y + impact.y) / 2 - Math.hypot(impact.x - src.x, impact.y - src.y) * 0.18 };
            const q = (a: Pt, b: Pt, cc: Pt, s: number) => lerp(lerp(a, cc, s), lerp(cc, b, s), s);
            const p = q(src, impact, mid, k), tail = q(src, impact, mid, Math.max(0, k - 0.15));
            under.push(<line key={`tt${key}`} x1={tail.x} y1={tail.y} x2={p.x} y2={p.y} stroke="rgba(150,150,150,0.5)" strokeWidth={0.35} strokeLinecap="round" />);
            over.push(<g key={`t${key}`}><Glow at={p} r={0.5} color="amber" /><circle cx={p.x} cy={p.y} r={0.18} fill="#fff1c2" /></g>);
          }
          const xk = (f - t0 - S.travel) / 0.4;
          if (xk > 0 && xk < 1) under.push(<Explosion key={`x${key}`} at={impact} k={xk} seed={sd} big={1.1} />);
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
            const fade = after < 0.8 ? 1 : (1 - after) * 5;
            const blobs = Array.from({ length: 5 }, (_, j) => {
              const a = noise(seed, i * 7 + j) * Math.PI * 2, rr = 0.3 + noise(seed, i * 7 + j + 3) * 0.6 * (0.6 + after * 0.6);
              return <circle key={j} cx={Math.cos(a) * rr} cy={Math.sin(a) * rr} r={0.25 + noise(seed, i + j) * 0.35} fill="url(#fx-blood)" />;
            });
            return (
              <g key={`d${i}`} transform={`translate(${d.x} ${d.y})`} opacity={fade}>
                <circle r={0.6 + after * 0.35} fill="url(#fx-blood)" />
                {blobs}
                <Puff at={{ x: 0, y: -after * 0.8 }} k={Math.min(0.99, after * 1.2)} r={1.1} color="rgba(80,76,70,0.5)" />
                <path d="M -0.4 -0.4 L 0.4 0.4 M 0.4 -0.4 L -0.4 0.4" stroke="#fecaca" strokeWidth={0.15} strokeLinecap="round" />
              </g>
            );
          })}
          <g opacity={after < 0.75 ? 1 : (1 - after) * 4} transform={`translate(${e.to.x} ${e.to.y - 1.6 - after * 1.6}) scale(${after < 0.15 ? 0.6 + after * 3 : 1.05})`}>
            <text fontSize={1.2} textAnchor="middle" fill={e.dmg ? '#fecaca' : '#e5e7eb'} stroke="#000" strokeWidth={0.18} paintOrder="stroke" fontWeight={900}>
              {e.dmg ? `-${e.dmg}W` : 'no damage'}{e.killed ? ` · ${e.killed} slain` : ''}
            </text>
          </g>
        </g>
      )}
    </g>
  );
}

/** the flash at the end of a barrel */
function Muzzle({ at, ang, k, sd, fx }: { at: Pt; ang: number; k: number; sd: number; fx: WeaponFx }) {
  const big = fx === 'heavyBolt' || fx === 'missile' || fx === 'shell' ? 1.4 : fx === 'gatling' ? 1.1 : fx === 'sniper' || fx === 'pulse' ? 0.8 : 1;
  const col: GlowColor = fx === 'plasma' ? 'cyan' : fx === 'las' ? 'red' : fx === 'melta' || fx === 'volkite' ? 'orange' : fx === 'grav' ? 'purple' : fx === 'lightning' ? 'cyan' : 'amber';
  const core = fx === 'plasma' ? '#e0f7ff' : fx === 'las' ? '#fee2e2' : '#fff7d6';
  const star = Array.from({ length: 10 }, (_, j) => {
    const a = ang + (j / 10) * Math.PI * 2, rr = (j % 2 ? 0.16 : j === 0 ? 1.1 : 0.42 + noise(sd, j) * 0.25) * big;
    return `${at.x + Math.cos(a) * rr},${at.y + Math.sin(a) * rr}`;
  }).join(' ');
  return (
    <g opacity={1 - k}>
      <Glow at={at} r={(0.8 + k * 0.4) * big} color={col} />
      <polygon points={star} fill={core} />
    </g>
  );
}

/** a missed shot kicks up dirt */
function missDirt(key: string, at: Pt, ik: number, sd: number, under: React.ReactNode[]) {
  if (ik <= 0 || ik >= 1) return;
  under.push(<Puff key={`p${key}`} at={at} k={ik} r={0.6} color="rgba(120,108,88,0.6)" />);
  under.push(<Debris key={`dd${key}`} at={at} k={ik} seed={sd * 3} n={4} color="#3d352a" size={0.6} />);
}

/** one melee blow: blade arcs, chainsword teeth, crackling power fields, claws, or a crushing hammer */
function meleeHit(fx: WeaponFx, key: string, at: Pt, hit: boolean, t: number, sd: number, over: React.ReactNode[], under: React.ReactNode[]) {
  const sk = t / (fx === 'crush' ? 0.3 : 0.2);
  const a = noise(sd, 21) * 360;
  const arc = (dy: number, w: number, col: string, op: number, dash?: string) => (
    <path d={`M -1 ${-0.6 + sk * 0.3 + dy} Q 0 ${-1.4 + sk + dy} 1 ${-0.6 + sk * 0.3 + dy}`} fill="none" stroke={col} strokeWidth={w} strokeLinecap="round" opacity={op} strokeDasharray={dash} />
  );
  if (sk > 0 && sk < 1) {
    if (fx === 'crush') {
      over.push(
        <g key={`c${key}`}>
          <Glow at={at} r={0.6 + sk * 1.4} color={hit ? 'cyan' : 'white'} op={1 - sk} />
          <circle cx={at.x} cy={at.y} r={0.4 + sk * 2.4} fill="none" stroke="#e0f2fe" strokeWidth={0.2 * (1 - sk)} opacity={1 - sk} />
        </g>,
      );
      under.push(<Debris key={`cd${key}`} at={at} k={sk} seed={sd} n={7} size={0.9} />);
    } else {
      const col = fx === 'power' ? '#60a5fa' : fx === 'chain' ? '#ef4444' : fx === 'claw' ? '#93c5fd' : '#e5e7eb';
      over.push(
        <g key={`s${key}`} transform={`translate(${at.x} ${at.y}) rotate(${a})`} opacity={1 - sk}>
          {fx === 'claw' ? [-0.3, 0, 0.3].map((dy, j) => <g key={j}>{arc(dy, 0.28, col, 0.4)}{arc(dy, 0.08, '#fff', 1)}</g>)
            : <>{arc(0, fx === 'power' ? 0.5 : 0.4, col, fx === 'power' ? 0.55 : 0.45)}{arc(0, 0.14, '#fff', 1, fx === 'chain' ? '0.18 0.1' : undefined)}</>}
        </g>,
      );
      if (fx === 'power') over.push(<Glow key={`pg${key}`} at={at} r={0.9} color="blue" op={0.7 * (1 - sk)} />);
    }
  }
  if (hit) {
    const hk = (t - 0.08) / 0.25;
    over.push(<Sparks key={`k${key}`} at={at} seed={sd} k={hk} color={fx === 'power' ? '#bfdbfe' : fx === 'chain' ? '#fdba74' : '#fecaca'} size={fx === 'chain' ? 1.2 : 0.9} />);
    if (fx === 'chain' && hk > 0 && hk < 1) under.push(<Debris key={`cb${key}`} at={at} k={hk} seed={sd + 5} n={5} color="#7f1d1d" size={0.6} />);
  }
}

// ---------- a hero's ability: charge-up, flash, shockwave, a turning rune circle, rays, embers and the name ----------

type SkillEvent = Extract<FxEvent, { kind: 'skill' }>;
const SKILL_COLORS: Record<SkillEvent['style'], { core: string; glow: string; deep: string; text: string }> = {
  holy: { core: '#fffbeb', glow: '#fcd34d', deep: '#b45309', text: '#fde68a' },
  psychic: { core: '#faf5ff', glow: '#c084fc', deep: '#6d28d9', text: '#e9d5ff' },
  fury: { core: '#fff1f2', glow: '#f87171', deep: '#991b1b', text: '#fecaca' },
  waaagh: { core: '#f7fee7', glow: '#a3e635', deep: '#3f6212', text: '#d9f99d' },
  tech: { core: '#ecfeff', glow: '#67e8f9', deep: '#0e7490', text: '#a5f3fc' },
  shield: { core: '#eff6ff', glow: '#93c5fd', deep: '#1d4ed8', text: '#bfdbfe' },
};

function SkillFx({ e, f }: { e: SkillEvent; f: number }) {
  const c = SKILL_COLORS[e.style];
  const { x, y } = e.at;
  const big = e.epic ? 1.45 : 1;
  const seed = e.seq;
  const R = 2.3 * big; // rune circle
  const charge = Math.min(1, f / 0.16); // energy pulled in
  const burst = Math.max(0, (f - 0.14) / 0.86); // after the flash
  const fadeOut = f > 0.82 ? 1 - (f - 0.82) / 0.18 : 1;
  const circleIn = Math.min(1, Math.max(0, (f - 0.08) / 0.15));
  const spin = f * 140;
  const shake = e.style === 'waaagh' && f > 0.14 && f < 0.5 ? (noise(seed, Math.floor(f * 60)) - 0.5) * 0.35 : 0;
  const rays = e.epic ? 12 : 8;
  return (
    <g pointerEvents="none" transform={`translate(${shake} 0)`}>
      {/* the battlefield darkens a little and takes the colour of the power */}
      {e.epic && <rect x={x - 40} y={y - 40} width={80} height={80} fill={c.deep} opacity={0.16 * Math.sin(Math.min(1, f * 1.3) * Math.PI)} />}
      {/* charge-up: sparks spiral in */}
      {charge < 1 && Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + charge * 2.5;
        const d = (1 - charge) * R * 2.2 + 0.3;
        return <circle key={`c${i}`} cx={x + Math.cos(a) * d} cy={y + Math.sin(a) * d} r={0.12 * big} fill={c.glow} opacity={0.4 + charge * 0.6} />;
      })}
      <g>
        {/* flash */}
        {f > 0.12 && f < 0.4 && <circle cx={x} cy={y} r={(0.6 + (f - 0.12) * 9) * big} fill={c.core} opacity={Math.max(0, 1 - (f - 0.12) / 0.28)} />}
        {/* shockwaves */}
        {[0, 0.12].map((d, i) => {
          const k = Math.max(0, burst - d);
          if (k <= 0 || k >= 0.7) return null;
          return <circle key={`w${i}`} cx={x} cy={y} r={(0.8 + k * 9) * big} fill="none" stroke={c.glow} strokeWidth={(0.45 - k * 0.5) * big} opacity={1 - k / 0.7} />;
        })}
        {/* rays */}
        <g transform={`translate(${x} ${y}) rotate(${spin * 0.3})`} opacity={Math.sin(Math.min(1, burst * 1.6) * Math.PI) * 0.75 * fadeOut}>
          {Array.from({ length: rays }, (_, i) => {
            const a = (i / rays) * 360;
            const L = (R * 1.9 + noise(seed, i) * R) * (0.6 + burst * 0.6);
            return <polygon key={`r${i}`} transform={`rotate(${a})`} points={`0,-0.18 ${L},0 0,0.18`} fill={c.glow} opacity={0.55} />;
          })}
        </g>
        {/* core glow */}
        <circle cx={x} cy={y} r={0.9 * big} fill={c.glow} opacity={0.5 * fadeOut * circleIn} />
      </g>
      {/* rune circle: two rings turning against each other, with marks */}
      <g transform={`translate(${x} ${y})`} opacity={circleIn * fadeOut}>
        <circle r={R} fill="none" stroke={c.glow} strokeWidth={0.12} opacity={0.9} />
        <circle r={R * 0.78} fill="none" stroke={c.glow} strokeWidth={0.07} strokeDasharray="0.5 0.25" transform={`rotate(${-spin})`} />
        <g transform={`rotate(${spin})`}>
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={`t${i}`} transform={`rotate(${i * 30}) translate(${R - 0.05} -0.09)`} width={0.36 * big} height={0.18} fill={c.glow} />
          ))}
          {e.epic && Array.from({ length: 6 }, (_, i) => (
            <polygon key={`s${i}`} transform={`rotate(${i * 60})`} points={`${R + 0.3},-0.3 ${R + 1.1},0 ${R + 0.3},0.3`} fill={c.glow} opacity={0.85} />
          ))}
        </g>
        <circle r={R * 1.04} fill="none" stroke={c.deep} strokeWidth={0.05} opacity={0.8} />
      </g>
      {/* embers drifting up and out */}
      {burst > 0 && Array.from({ length: e.epic ? 26 : 16 }, (_, i) => {
        const a = noise(seed, i + 7) * Math.PI * 2;
        const sp = 0.5 + noise(seed, i + 30) * 0.8;
        const d = burst * R * 2.2 * sp;
        return <circle key={`e${i}`} cx={x + Math.cos(a) * d} cy={y + Math.sin(a) * d - burst * 2.2 * sp} r={(0.07 + noise(seed, i + 50) * 0.12) * big}
          fill={i % 3 ? c.glow : c.core} opacity={(1 - burst) * 0.95} />;
      })}
      {/* the name */}
      {f > 0.1 && (() => {
        const pop = Math.min(1, (f - 0.1) / 0.12);
        const scale = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) + (pop < 1 ? 0 : 0.03 * Math.sin(f * 20));
        const ty = y - R - 1.4 * big - f * 0.6;
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

// ---------- an ability used often: a short soft glow, one ring and the name, nothing more ----------

const SKILL_LITE_MS = 1300;

function SkillLite({ e, f }: { e: SkillEvent; f: number }) {
  if (f < 0 || f > 1) return null;
  const c = SKILL_COLORS[e.style];
  const { x, y } = e.at;
  const fade = f < 0.15 ? f / 0.15 : f > 0.7 ? (1 - f) / 0.3 : 1;
  return (
    <g opacity={fade}>
      <circle cx={x} cy={y} r={1.2 + f * 0.8} fill={c.glow} opacity={0.18} />
      <circle cx={x} cy={y} r={1.1 + f * 1.4} fill="none" stroke={c.glow} strokeWidth={0.1} opacity={0.8 * (1 - f)} />
      <text x={x} y={y - 2.1 - f * 0.5} fontSize={0.8} textAnchor="middle" fontWeight={800} fill={c.text} stroke="#000" strokeWidth={0.16} paintOrder="stroke">{e.name}</text>
    </g>
  );
}
