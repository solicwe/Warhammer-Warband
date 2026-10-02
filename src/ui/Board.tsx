import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RULES } from '../engine/config';
import { deploymentById, toPoly } from '../engine/config';
import { dist } from '../engine/geometry';
import { alive, onBoard } from '../engine/state';
import { levelOfControl } from '../engine/game';
import { modelToken } from './Tokens';
import { getPortrait, usePortraitsVersion } from './portraits';
import type { FxEvent, GameState, PlayerId, Pt, UnitState } from '../engine/types';

export type Paths = Map<string, Pt[]>;

export interface Ring { c: Pt; r: number; color: string; dash?: boolean }

export interface BoardProps {
  s: GameState;
  viewer: PlayerId;
  selected?: string | null;
  draftUnit?: string | null;
  draft?: Paths | null;
  maxFor?: (modelId: string) => number;
  /** players whose moves are replayed as an animation (the bot) */
  animateMoves?: PlayerId[];
  bad?: string[];
  targets?: string[];
  picked?: string[];
  rings?: Ring[];
  zones?: boolean;
  badges?: Record<string, string[]>;
  losLines?: { a: Pt; b: Pt; cover: boolean }[];
  onTapUnit?: (unitId: string, modelId: string) => void;
  onTapBoard?: (p: Pt) => void;
  onDraft?: (p: Paths) => void;
}

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;
const COLORS = ['#3a9ad9', '#e0453f'];
const SOFT = ['rgba(58,154,217,0.16)', 'rgba(224,69,63,0.16)'];
const TERRAIN_FILL: Record<string, string> = { dense: 'rgba(120,98,72,0.55)', light: 'rgba(150,140,80,0.45)', exposed: 'rgba(90,85,78,0.45)' };

const FX_MS: Record<FxEvent['kind'], number> = { move: 700, place: 900, attack: 1500, mortal: 1200 };
interface ActiveFx { e: FxEvent; t0: number }
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function alongPath(p: Pt[], f: number): Pt {
  const total = pathLen(p);
  if (total < 1e-6) return p[p.length - 1];
  let want = total * f;
  for (let i = 1; i < p.length; i++) {
    const d = dist(p[i - 1], p[i]);
    if (want <= d) { const k = d ? want / d : 0; return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * k, y: p[i - 1].y + (p[i].y - p[i - 1].y) * k }; }
    want -= d;
  }
  return p[p.length - 1];
}

function pathLen(p: Pt[]) { let d = 0; for (let i = 1; i < p.length; i++) d += dist(p[i - 1], p[i]); return d; }

interface DragState {
  pointerId: number;
  start: Pt;
  models: string[];
  base: Paths; // paths at drag start (with new waypoint appended)
  moved: boolean;
  unitId: string;
  modelId: string;
}

function BoardImpl(props: BoardProps) {
  usePortraitsVersion();
  const { s, draft, draftUnit, maxFor, onDraft } = props;
  // models picked for single-model adjustment (tap a model of the moving unit); otherwise a drag moves the whole unit
  const [solo, setSolo] = useState<string[]>([]);
  useEffect(() => setSolo([]), [draftUnit]);
  // --- effects: replay new engine events as short animations ---
  const seen = useRef(s.fxSeq ?? 0);
  const [fx, setFx] = useState<ActiveFx[]>([]);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const fresh = (s.fx ?? []).filter((e) => e.seq > seen.current);
    if (s.fxSeq !== undefined && s.fxSeq < seen.current) seen.current = s.fxSeq; // undo
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.seq));
    const t0 = performance.now();
    const keep = fresh.filter((e) => e.kind !== 'move' || props.animateMoves?.includes(e.owner));
    // stagger events from the same step a little so they read in order
    setFx((cur) => [...cur.filter((a) => t0 - a.t0 < FX_MS[a.e.kind]), ...keep.map((e, i) => ({ e, t0: t0 + i * 180 }))]);
  }, [s.fx, s.fxSeq, props.animateMoves]);
  useEffect(() => {
    if (!fx.length) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      setNow(t);
      if (fx.some((a) => t - a.t0 < FX_MS[a.e.kind])) raf = requestAnimationFrame(tick);
      else setFx([]);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fx]);
  const animPos = useMemo(() => {
    const m = new Map<string, Pt>();
    for (const a of fx) {
      if (a.e.kind !== 'move') continue;
      const f = Math.min(1, Math.max(0, (now - a.t0) / FX_MS.move));
      if (f >= 1) continue;
      for (const [id, p] of a.e.paths) m.set(id, alongPath(p, ease(f)));
    }
    return m;
  }, [fx, now]);
  const acting = useMemo(() => {
    const ids = new Set<string>();
    for (const a of fx) {
      if (now - a.t0 > FX_MS[a.e.kind] || now < a.t0) continue;
      if (a.e.kind === 'move' || a.e.kind === 'place') ids.add(a.e.unitId);
      if (a.e.kind === 'attack') ids.add(a.e.attackerId);
    }
    return ids;
  }, [fx, now]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: -1, y: -1, w: W + 2, h: H + 2 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ id: number; sx: number; sy: number; vb: typeof vb; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; vb: typeof vb; mid: Pt } | null>(null);
  const drag = useRef<DragState | null>(null);

  const toBoard = useCallback((cx: number, cy: number): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const r = pt.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  }, []);

  // keep aspect when the element resizes
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const fit = () => setVb({ x: -1, y: -1, w: W + 2, h: H + 2 });
    fit();
    const ro = new ResizeObserver(() => {});
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomAt = (factor: number, c: Pt, base = vb) => {
    const w = Math.min(W * 2.5, Math.max(8, base.w * factor));
    const h = (w / base.w) * base.h;
    setVb({ x: c.x - ((c.x - base.x) * w) / base.w, y: c.y - ((c.y - base.y) * h) / base.h, w, h });
  };

  const onWheel = (e: React.WheelEvent) => {
    zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, toBoard(e.clientX, e.clientY));
  };

  const startModelDrag = (e: React.PointerEvent, unitId: string, modelId: string) => {
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    const canDrag = draft && draftUnit === unitId && draft.has(modelId);
    if (!canDrag) {
      drag.current = { pointerId: e.pointerId, start: toBoard(e.clientX, e.clientY), models: [], base: new Map(), moved: false, unitId, modelId };
      return;
    }
    const models = solo.includes(modelId) ? solo.filter((id) => draft!.has(id)) : [...draft!.keys()];
    const base: Paths = new Map();
    for (const [id, p] of draft!) {
      if (models.includes(id) && p.length > 1) {
        const last = p[p.length - 1];
        const prev = p[p.length - 2];
        // continue the last segment if it is the one we are still adjusting, else add a waypoint
        base.set(id, dist(last, prev) < 0.01 ? [...p] : [...p, { ...last }]);
      } else base.set(id, [...p]);
    }
    drag.current = { pointerId: e.pointerId, start: toBoard(e.clientX, e.clientY), models, base, moved: false, unitId, modelId };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), vb, mid: toBoard((a.x + b.x) / 2, (a.y + b.y) / 2) };
      pan.current = null;
      drag.current = null;
      return;
    }
    pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vb, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(pinch.current.d / Math.max(d, 1), pinch.current.mid, pinch.current.vb);
      return;
    }
    const dg = drag.current;
    if (dg && dg.pointerId === e.pointerId) {
      const p = toBoard(e.clientX, e.clientY);
      let dx = p.x - dg.start.x, dy = p.y - dg.start.y;
      if (!dg.moved && Math.hypot(dx, dy) < 0.25) return;
      dg.moved = true;
      if (!dg.models.length || !onDraft) return;
      // clamp so no model exceeds its maximum distance
      let k = 1;
      for (const id of dg.models) {
        const path = dg.base.get(id)!;
        if (path.length < 2) continue; // placement: unlimited
        const used = pathLen(path.slice(0, -1));
        const allow = Math.max(0, (maxFor?.(id) ?? Infinity) - used);
        const len = Math.hypot(dx, dy);
        if (len > allow) k = Math.min(k, allow / len);
      }
      dx *= k; dy *= k;
      const next: Paths = new Map(draft!);
      for (const id of dg.models) {
        const path = [...dg.base.get(id)!];
        const anchor = path.length < 2 ? path[0] : path[path.length - 2];
        const end = { x: anchor.x + dx, y: anchor.y + dy };
        if (path.length < 2) { path[0] = end; } else path[path.length - 1] = end;
        next.set(id, path);
      }
      onDraft(next);
      return;
    }
    const pn = pan.current;
    if (pn && pn.id === e.pointerId) {
      const dx = e.clientX - pn.sx, dy = e.clientY - pn.sy;
      if (!pn.moved && Math.hypot(dx, dy) < 6) return;
      pn.moved = true;
      const rect = svgRef.current!.getBoundingClientRect();
      const scale = Math.max(pn.vb.w / rect.width, pn.vb.h / rect.height);
      setVb({ ...pn.vb, x: pn.vb.x - dx * scale, y: pn.vb.y - dy * scale });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const dg = drag.current;
    if (dg && dg.pointerId === e.pointerId) {
      drag.current = null;
      if (!dg.moved) {
        // tapping a model of the unit being moved picks it for single-model adjustment
        if (dg.models.length && draftUnit === dg.unitId) setSolo((cur) => (cur.includes(dg.modelId) ? cur.filter((x) => x !== dg.modelId) : [...cur, dg.modelId]));
        else props.onTapUnit?.(dg.unitId, dg.modelId);
      } else if (!solo.includes(dg.modelId)) setSolo([]);
      return;
    }
    const pn = pan.current;
    if (pn && pn.id === e.pointerId) {
      pan.current = null;
      if (!pn.moved) props.onTapBoard?.(toBoard(e.clientX, e.clientY));
    }
  };

  const dep = deploymentById(s.deploymentId);
  const attacker = s.attackerPlayer;
  const defender = (1 - attacker) as PlayerId;
  const fs = Math.max(0.55, vb.w / 45);

  const units = useMemo(() => s.units.filter((u) => onBoard(u) || u.id === draftUnit), [s.units, draftUnit]);
  const enemyOfDraft = draftUnit ? s.units.find((u) => u.id === draftUnit)?.owner : undefined;

  const posOf = (u: UnitState, id: string, m: Pt): Pt => {
    const ap = animPos.get(id);
    if (ap) return ap;
    if (draft && draftUnit === u.id) {
      const p = draft.get(id);
      if (p) return p[p.length - 1];
    }
    return m;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <defs>
        <pattern id="grid" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.04" />
        </pattern>
        <pattern id="ash" width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="#5d5648" />
          <circle cx="1.2" cy="1.5" r="0.9" fill="#655d4e" /><circle cx="4.8" cy="3.9" r="1.3" fill="#544d40" />
          <circle cx="2.6" cy="5.6" r="0.6" fill="#6b6352" /><circle cx="6.1" cy="0.8" r="0.5" fill="#4f483c" />
          <circle cx="3.5" cy="2.6" r="0.2" fill="#7a705c" /><circle cx="5.9" cy="6.3" r="0.3" fill="#7a705c" />
        </pattern>
        <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
          <stop offset="60%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity="0.35" />
        </radialGradient>
        <pattern id="tiles" width="1" height="1" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#6e6658" /><path d="M1 0 L0 0 0 1" fill="none" stroke="#585043" strokeWidth="0.06" />
        </pattern>
        <pattern id="sandbags" width="1" height="0.7" patternUnits="userSpaceOnUse">
          <rect width="1" height="0.7" fill="#7d7350" /><rect x="0.05" y="0.08" width="0.9" height="0.55" rx="0.25" fill="#9a8f63" stroke="#5c5338" strokeWidth="0.05" />
        </pattern>
        <pattern id="ribs" width="0.8" height="0.8" patternUnits="userSpaceOnUse">
          <rect width="0.8" height="0.8" fill="#7a4b2e" /><rect width="0.25" height="0.8" fill="#8d5a38" />
        </pattern>
        <radialGradient id="crater"><stop offset="0" stopColor="#2f2a22" /><stop offset="0.7" stopColor="#4a4336" /><stop offset="1" stopColor="#6d6452" /></radialGradient>
        <radialGradient id="objdisc"><stop offset="0" stopColor="#f1f2f4" /><stop offset="1" stopColor="#8d939c" /></radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#ash)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#grid)" />
      {props.zones !== false && (
        <>
          <polygon points={toPoly(dep.zones.attacker).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[attacker]} stroke={COLORS[attacker]} strokeWidth={0.1} strokeDasharray="0.5 0.3" />
          <polygon points={toPoly(dep.zones.defender).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[defender]} stroke={COLORS[defender]} strokeWidth={0.1} strokeDasharray="0.5 0.3" />
        </>
      )}
      <polygon points={toPoly(dep.territory.attacker).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={0.06} strokeDasharray="0.15 0.35" pointerEvents="none" />
      {Array.from({ length: Math.floor(H / 6) + 1 }, (_, i) => (
        <text key={`ty${i}`} x={0.2} y={i * 6 + 0.5} fontSize={0.6} fill="rgba(255,255,255,0.4)">{i * 6}"</text>
      ))}
      {Array.from({ length: Math.floor(W / 6) + 1 }, (_, i) => (
        <text key={`tx${i}`} x={i * 6 + 0.15} y={H - 0.25} fontSize={0.6} fill="rgba(255,255,255,0.4)">{i * 6}"</text>
      ))}
      {s.terrain.map((t) => {
        const pts = t.poly.map((p) => `${p.x},${p.y}`).join(' ');
        const xs = t.poly.map((p) => p.x), ys = t.poly.map((p) => p.y);
        const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
        const seed = [...t.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
        const rnd = (i: number) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
        if (t.kind === 'crater') {
          return (
            <g key={t.id} pointerEvents="none">
              <ellipse cx={x0 + w / 2} cy={y0 + h / 2} rx={w / 2} ry={h / 2} fill="url(#crater)" stroke="#2a251d" strokeWidth={0.08} />
              <ellipse cx={x0 + w * 0.6} cy={y0 + h * 0.4} rx={w * 0.18} ry={h * 0.14} fill="#2a251d" opacity={0.6} />
            </g>
          );
        }
        if (t.kind === 'barricade') {
          return (
            <g key={t.id} pointerEvents="none">
              <polygon points={pts} fill="rgba(160,150,95,0.25)" stroke="rgba(0,0,0,0.35)" strokeWidth={0.06} strokeDasharray="0.3 0.2" />
              <rect x={x0 + 0.25} y={y0 + 0.25} width={Math.max(0.5, w - 0.5)} height={Math.max(0.5, h - 0.5)} rx={0.3} fill="url(#sandbags)" stroke="#4a4128" strokeWidth={0.08} />
            </g>
          );
        }
        if (t.kind === 'container') {
          return (
            <g key={t.id} pointerEvents="none">
              <rect x={x0} y={y0} width={w} height={h} fill="url(#ribs)" stroke="#2b1a10" strokeWidth={0.25} />
              <rect x={x0 + 0.25} y={y0 + 0.25} width={w - 0.5} height={h - 0.5} fill="none" stroke="#a36b43" strokeWidth={0.08} />
              <text x={x0 + w / 2} y={y0 + h / 2 + 0.25} fontSize={0.7} textAnchor="middle" fill="#f3d9a4" opacity={0.8}>⚠</text>
            </g>
          );
        }
        // ruins (dense): tiled floor, upper floor slab, thick walls with windows, rubble
        return (
          <g key={t.id} pointerEvents="none">
            <polygon points={pts} fill="url(#tiles)" stroke={t.objectiveId ? 'none' : 'rgba(0,0,0,0.45)'} strokeWidth={0.08} />
            <rect x={x0 + w * 0.08} y={y0 + h * 0.08} width={w * 0.45} height={h * 0.45} fill="rgba(140,130,110,0.55)" stroke="rgba(40,34,26,0.6)" strokeWidth={0.06} transform={t.walls[0] && (t.walls[0].a.x > x0 + w / 2 || t.walls[0].a.y > y0 + h / 2) ? `rotate(180 ${x0 + w / 2} ${y0 + h / 2})` : undefined} />
            {Array.from({ length: 6 }, (_, i) => (
              <circle key={i} cx={x0 + 0.5 + rnd(i) * (w - 1)} cy={y0 + 0.5 + rnd(i + 9) * (h - 1)} r={0.12 + rnd(i + 3) * 0.2} fill="#4b4335" />
            ))}
            {t.walls.map((wl, i) => {
              const len = dist(wl.a, wl.b);
              const n = Math.max(1, Math.floor(len / 2));
              return (
                <g key={i}>
                  <line x1={wl.a.x} y1={wl.a.y} x2={wl.b.x} y2={wl.b.y} stroke="#2a221a" strokeWidth={0.55} strokeLinecap="square" />
                  <line x1={wl.a.x} y1={wl.a.y} x2={wl.b.x} y2={wl.b.y} stroke="#8a7e69" strokeWidth={0.22} strokeLinecap="square" />
                  {Array.from({ length: n }, (_, k) => {
                    const f = (k + 0.5) / n;
                    return <circle key={k} cx={wl.a.x + (wl.b.x - wl.a.x) * f} cy={wl.a.y + (wl.b.y - wl.a.y) * f} r={0.16} fill="#1c1712" />;
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
      {s.objectives.map((o, i) => {
        const t = s.terrain.find((x) => x.id === o.terrainId)!;
        const [a, b] = levelOfControl(s, o);
        const ctrl = o.controller;
        const xs = t.poly.map((p) => p.x), ys = t.poly.map((p) => p.y);
        const top = Math.min(...ys);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const label = o.type === 'home' ? 'HOME' : o.type === 'central' ? 'CENTRE' : 'OBJ';
        return (
          <g key={o.id} pointerEvents="none">
            <polygon points={t.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill={ctrl === null ? 'rgba(245,184,61,0.08)' : SOFT[ctrl]} stroke={ctrl === null ? '#f5b83d' : COLORS[ctrl]} strokeWidth={0.16} strokeDasharray="0.6 0.25" />
            <circle cx={o.x} cy={o.y} r={0.79} fill="url(#objdisc)" stroke="#111" strokeWidth={0.08} />
            <circle cx={o.x} cy={o.y} r={0.55} fill="none" stroke={ctrl === null ? '#555' : COLORS[ctrl]} strokeWidth={0.18} />
            <text x={o.x} y={o.y + 0.27} fontSize={0.75} textAnchor="middle" fill="#111" fontWeight={900}>{i + 1}</text>
            <g transform={`translate(${cx} ${top - 0.55})`}>
              <rect x={-2.1} y={-0.5} width={4.2} height={0.95} rx={0.45} fill="rgba(12,13,16,0.85)" stroke={ctrl === null ? '#f5b83d' : COLORS[ctrl]} strokeWidth={0.06} />
              <text x={-1.85} y={0.2} fontSize={0.55} fill="#f5b83d" fontWeight={800}>{label}</text>
              <text x={1.95} y={0.2} fontSize={0.55} textAnchor="end" fontWeight={800}>
                <tspan fill={COLORS[0]}>{a}</tspan><tspan fill="#aaa"> : </tspan><tspan fill={COLORS[1]}>{b}</tspan>
              </text>
            </g>
          </g>
        );
      })}
      {props.rings?.map((r, i) => (
        <circle key={`r${i}`} cx={r.c.x} cy={r.c.y} r={r.r} fill="none" stroke={r.color} strokeWidth={0.08} strokeDasharray={r.dash ? '0.35 0.25' : undefined} />
      ))}
      {props.losLines?.map((l, i) => (
        <line key={`los${i}`} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={l.cover ? '#fbbf24' : '#86efac'} strokeWidth={0.07} strokeDasharray="0.3 0.2" opacity={0.85} pointerEvents="none" />
      ))}
      {/* engagement range of enemies while moving */}
      {draftUnit && enemyOfDraft !== undefined && s.units.filter((u) => u.owner !== enemyOfDraft && onBoard(u)).flatMap((u) => alive(u).map((m) => (
        <circle key={`e${m.id}`} cx={m.x} cy={m.y} r={m.r + RULES.engagementRange} fill="rgba(255,80,80,0.06)" stroke="rgba(255,80,80,0.25)" strokeWidth={0.04} />
      )))}
      {units.map((u) => {
        const isDraft = draft && draftUnit === u.id;
        const isSel = props.selected === u.id;
        const isTarget = props.targets?.includes(u.id);
        const isPicked = props.picked?.includes(u.id);
        const col = COLORS[u.owner];
        const ms = alive(u);
        const pts = ms.map((m) => posOf(u, m.id, m));
        const cx = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
        const minY = Math.min(...pts.map((p, i) => p.y - ms[i].r));
        return (
          <g key={u.id}>
            {isDraft && ms.map((m) => {
              const p = draft!.get(m.id);
              if (!p || p.length < 2) return null;
              return (
                <g key={`g${m.id}`} pointerEvents="none">
                  <circle cx={p[0].x} cy={p[0].y} r={m.r} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.06} strokeDasharray="0.2 0.15" />
                  <polyline points={p.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.07} />
                  {ms.length <= 6 && maxFor && <circle cx={p[0].x} cy={p[0].y} r={maxFor(m.id) + m.r} fill="none" stroke="rgba(245,184,61,0.35)" strokeWidth={0.06} />}
                </g>
              );
            })}
            {ms.map((m, i) => {
              const p = pts[i];
              const bad = props.bad?.includes(m.id);
              const isSolo = isDraft && solo.includes(m.id);
              return (
                <g key={m.id} onPointerDown={(e) => startModelDrag(e, u.id, m.id)} style={{ cursor: isDraft ? 'grab' : 'pointer' }}>
                  <circle cx={p.x} cy={p.y} r={Math.max(m.r, 0.35) + 0.35} fill="transparent" />
                  {acting.has(u.id) && <circle cx={p.x} cy={p.y} r={m.r + 0.35} fill="none" stroke={col} strokeWidth={0.22} opacity={0.75} className="fx-glow" pointerEvents="none" />}
                  {isSolo && <circle cx={p.x} cy={p.y} r={m.r + 0.3} fill="none" stroke="#fff" strokeWidth={0.12} strokeDasharray="0.25 0.15" pointerEvents="none" />}
                  <circle
                    cx={p.x} cy={p.y} r={m.r}
                    fill={bad ? '#7f1d1d' : '#1d2129'}
                    fillOpacity={1}
                    stroke={bad ? '#fca5a5' : isSel || isDraft ? '#f5b83d' : isPicked ? '#ffffff' : isTarget ? '#fde68a' : col}
                    strokeWidth={isSel || isDraft || isTarget || isPicked || bad ? 0.16 : 0.12}
                    strokeDasharray={u.battleShocked ? '0.25 0.15' : undefined}
                  />
                  {getPortrait(m.source)
                    ? <image href={getPortrait(m.source)} x={p.x - m.r * 0.9} y={p.y - m.r * 0.9} width={m.r * 1.8} height={m.r * 1.8} clipPath="url(#clip-round)" preserveAspectRatio="xMidYMid slice" pointerEvents="none" />
                    : <use href={`#tok-${modelToken(m)}`} x={p.x - m.r * 0.82} y={p.y - m.r * 0.82} width={m.r * 1.64} height={m.r * 1.64} pointerEvents="none" />}
                  {m.isCharacter && <use href="#tok-crown" x={p.x - m.r * 0.55} y={p.y - m.r * 1.35} width={m.r * 1.1} height={m.r * 0.66} pointerEvents="none" />}
                  {m.profile.W > 1 && m.wounds < m.profile.W && (
                    <text x={p.x} y={p.y + 0.22} fontSize={0.6} textAnchor="middle" fill="#fff" fontWeight={800} pointerEvents="none">{m.wounds}</text>
                  )}
                </g>
              );
            })}
            {(isSel || isPicked || isDraft || vb.w < 24) && pts.length > 0 && (
              <text x={cx} y={minY - 0.35} fontSize={fs * 0.85} textAnchor="middle" fill={isTarget ? '#fde68a' : '#fff'} stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={700}>
                {u.name.length > 22 ? u.name.slice(0, 21) + '…' : u.name}{u.battleShocked ? ' ⚠' : ''}
              </text>
            )}
            {props.badges?.[u.id]?.length ? (
              <text x={cx} y={minY - 1.2} fontSize={0.75} textAnchor="middle" fill="#fde68a" stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={800}>
                {props.badges[u.id].join('  ')}
              </text>
            ) : null}
            {s.players[1 - u.owner].oathTarget === u.id && pts.length > 0 && (
              <g transform={`translate(${cx} ${minY - (props.badges?.[u.id]?.length ? 3.1 : 2.2)})`} pointerEvents="none">
                <rect x={-2.3} y={-0.62} width={4.6} height={1.24} rx={0.25} fill="#7a0c0c" stroke="#f5d48a" strokeWidth={0.1} />
                <path d="M -1.85 0.32 L -1.4 -0.32 L -0.95 0.32 Z" fill="#f5d48a" />
                <text x={0.35} y={0.27} fontSize={0.75} textAnchor="middle" fill="#f5d48a" fontWeight={800} letterSpacing={0.06}>OATH</text>
              </g>
            )}
            {isDraft && maxFor && ms.map((m) => {
              const p = draft!.get(m.id);
              if (!p || p.length < 2) return null;
              const used = pathLen(p);
              if (used < 0.05) return null;
              const e = p[p.length - 1];
              return <text key={`d${m.id}`} x={e.x} y={e.y - m.r - 0.2} fontSize={0.55} textAnchor="middle" fill="#fde68a" stroke="#000" strokeWidth={0.08} paintOrder="stroke" pointerEvents="none">{used.toFixed(1)}/{maxFor(m.id).toFixed(0)}"</text>;
            })}
          </g>
        );
      })}
      {fx.map((a) => <FxView key={a.e.seq} a={a} now={now} />)}
      <rect x={0} y={0} width={W} height={H} fill="none" stroke="#000" strokeWidth={0.15} pointerEvents="none" />
    </svg>
  );
}

function FxView({ a, now }: { a: ActiveFx; now: number }) {
  const e = a.e;
  const f = (now - a.t0) / FX_MS[e.kind];
  if (f < 0 || f > 1) return null;
  if (e.kind === 'mortal') {
    return (
      <g pointerEvents="none" opacity={1 - f}>
        <circle cx={e.at.x} cy={e.at.y} r={0.8 + f * 2.2} fill="none" stroke="#c084fc" strokeWidth={0.18} />
        <text x={e.at.x} y={e.at.y - 1 - f * 1.6} fontSize={1} textAnchor="middle" fill="#e9d5ff" stroke="#000" strokeWidth={0.14} paintOrder="stroke" fontWeight={900}>-{e.n} MW</text>
      </g>
    );
  }
  if (e.kind === 'attack') {
    const col = COLORS[e.owner];
    const melee = e.attackKind === 'fight';
    const shot = Math.min(1, f / 0.35); // projectile travel
    const hitF = Math.max(0, (f - 0.3) / 0.7); // impact
    const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
    const head = { x: e.from.x + dx * shot, y: e.from.y + dy * shot };
    const tail = { x: e.from.x + dx * Math.max(0, shot - 0.25), y: e.from.y + dy * Math.max(0, shot - 0.25) };
    return (
      <g pointerEvents="none">
        {!melee && f < 0.5 && (
          <>
            <line x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y} stroke={col} strokeWidth={0.08} strokeDasharray="0.4 0.3" opacity={0.5 * (1 - f * 2)} />
            <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke="#fde68a" strokeWidth={0.28} strokeLinecap="round" />
          </>
        )}
        {melee && f < 0.6 && (
          <g transform={`translate(${e.to.x} ${e.to.y}) rotate(${f * 90}) scale(${0.6 + f})`} opacity={1 - f / 0.6}>
            <path d="M -1.2 -1.2 L 1.2 1.2 M 1.2 -1.2 L -1.2 1.2" stroke="#fca5a5" strokeWidth={0.25} strokeLinecap="round" />
          </g>
        )}
        {hitF > 0 && (
          <g opacity={1 - hitF}>
            <circle cx={e.to.x} cy={e.to.y} r={0.6 + hitF * 2.6} fill="none" stroke={e.dmg ? '#ef4444' : '#9ca3af'} strokeWidth={0.2} />
            {e.dead.map((d, i) => (
              <g key={i} transform={`translate(${d.x} ${d.y})`}>
                <circle r={0.7} fill="rgba(0,0,0,0.55)" stroke="#ef4444" strokeWidth={0.1} />
                <path d="M -0.4 -0.4 L 0.4 0.4 M 0.4 -0.4 L -0.4 0.4" stroke="#ef4444" strokeWidth={0.16} strokeLinecap="round" />
              </g>
            ))}
            <text x={e.to.x} y={e.to.y - 1.4 - hitF * 2} fontSize={1.15} textAnchor="middle" fill={e.dmg ? '#fecaca' : '#e5e7eb'} stroke="#000" strokeWidth={0.16} paintOrder="stroke" fontWeight={900}>
              {e.dmg ? `-${e.dmg}W` : 'ไม่เข้า'}{e.killed ? ` · ตาย ${e.killed}` : ''}
            </text>
          </g>
        )}
      </g>
    );
  }
  return null;
}

export const Board = memo(BoardImpl);
