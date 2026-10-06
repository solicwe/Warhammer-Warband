import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RULES } from '../engine/config';
import { deploymentById, toPoly } from '../engine/config';
import { dist, pointInPoly, polyCentroid } from '../engine/geometry';
import { alive, onBoard } from '../engine/state';
import { levelOfControl } from '../engine/game';
import { modelToken } from './Tokens';
import { getPortrait, usePortraitsVersion } from './portraits';
import { SvgIcon } from './Icon';
import type { SecondaryGoal } from '../engine/secondaries';
import type { FxEvent, GameState, PlayerId, Pt, TerrainPiece, UnitState } from '../engine/types';

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
  measure?: { a?: Pt; b?: Pt; label?: string; los?: boolean };
  /** what the viewer's secondary mission cards want on the table (drawn in gold) */
  goals?: SecondaryGoal[];
  /** shooting: models of the firing unit that cannot see the chosen target (they don't shoot it) */
  noLos?: string[];
  onTapBoard?: (p: Pt) => void;
  onDraft?: (p: Paths) => void;
  /** a drag of the draft finished (the screen settles models into legal spots) */
  onDragEnd?: (p: Paths) => void;
}

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;
const COLORS = ['#3a9ad9', '#e0453f'];
const SOFT = ['rgba(58,154,217,0.16)', 'rgba(224,69,63,0.16)'];
const TERRAIN_FILL: Record<string, string> = { dense: 'rgba(120,98,72,0.55)', light: 'rgba(150,140,80,0.45)', exposed: 'rgba(90,85,78,0.45)' };

const FX_MS: Record<FxEvent['kind'], number> = { move: 700, place: 900, attack: 1900, mortal: 1200, skill: 2800, roll: 0, rolloff: 0, cards: 0, primary: 0 }; // rolls are shown by the screen, not the board
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
  solo?: boolean; // single picked model: re-aim its move from where it started
  grab?: Pt; // that model's position when the drag began
  last?: Paths; // the draft as last sent
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
    const keep = fresh.filter((e) => e.kind !== 'roll' && e.kind !== 'rolloff' && e.kind !== 'cards' && (e.kind !== 'move' || props.animateMoves?.includes(e.owner)));
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
      if (a.e.kind === 'skill') ids.add(a.e.unitId);
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
    if (solo.includes(modelId)) {
      const p = draft!.get(modelId)!;
      drag.current = { pointerId: e.pointerId, start: toBoard(e.clientX, e.clientY), models: [modelId], base: new Map([[modelId, [...p]]]), moved: false, unitId, modelId, solo: true, grab: { ...p[p.length - 1] } };
      return;
    }
    // whole unit: every model keeps a straight line from where it started this move, so dragging again re-aims it
    // (no hidden waypoints eating the move distance); walls and enemy models are routed around when the drag ends
    const models = [...draft!.keys()];
    const base: Paths = new Map([...draft!].map(([id, p]) => [id, [...p]]));
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
      const dx = p.x - dg.start.x, dy = p.y - dg.start.y;
      if (!dg.moved && Math.hypot(dx, dy) < 0.25) return;
      dg.moved = true;
      if (!dg.models.length || !onDraft) return;
      if (dg.solo && dg.grab) {
        // one model: straight line from where it started this move, clamped to its own maximum
        const id = dg.models[0];
        const path = dg.base.get(id)!;
        const origin = path[0];
        let end = { x: dg.grab.x + dx, y: dg.grab.y + dy };
        if (path.length >= 2) {
          const max = maxFor?.(id) ?? Infinity;
          const d = dist(origin, end);
          if (d > max) end = { x: origin.x + ((end.x - origin.x) * max) / d, y: origin.y + ((end.y - origin.y) * max) / d };
        }
        const next: Paths = new Map(draft!);
        next.set(id, path.length < 2 ? [end] : [origin, end]);
        dg.last = next;
        onDraft(next);
        return;
      }
      // each model ends at most its maximum from where it started this move: one at its limit slides along that
      // circle instead of freezing the whole unit, so the unit can always be dragged on in any direction
      const next: Paths = new Map(draft!);
      for (const id of dg.models) {
        const path = dg.base.get(id)!;
        const last = path[path.length - 1];
        let end = { x: last.x + dx, y: last.y + dy };
        if (path.length >= 2) {
          const o = path[0];
          const max = maxFor?.(id) ?? Infinity;
          const d = dist(o, end);
          if (d > max) end = { x: o.x + ((end.x - o.x) * max) / d, y: o.y + ((end.y - o.y) * max) / d };
        }
        next.set(id, path.length < 2 ? [end] : [path[0], end]);
      }
      dg.last = next;
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
        if (dg.models.length && draftUnit === dg.unitId) setSolo((cur) => (cur[0] === dg.modelId ? [] : [dg.modelId]));
        else props.onTapUnit?.(dg.unitId, dg.modelId);
      } else {
        if (!solo.includes(dg.modelId)) setSolo([]);
        if (dg.last) props.onDragEnd?.(dg.last);
      }
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

  const ground = useMemo(() => groundTexture(), []);
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
        {ground && <pattern id="ground" width="11" height="11" patternUnits="userSpaceOnUse"><image href={ground} width="11" height="11" preserveAspectRatio="none" /></pattern>}
        {/* a soft glow around shots, flashes and fire */}
        <filter id="fx-bloom" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.22" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* ragged smoke */}
        <filter id="fx-smoke" x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.18" />
        </filter>
        <radialGradient id="fx-smoke-g"><stop offset="0" stopColor="#4a4540" stopOpacity="0.85" /><stop offset="0.6" stopColor="#5d5852" stopOpacity="0.55" /><stop offset="1" stopColor="#6b665f" stopOpacity="0" /></radialGradient>
        <radialGradient id="fx-scorch"><stop offset="0" stopColor="#120e0a" stopOpacity="0.85" /><stop offset="0.6" stopColor="#2a2118" stopOpacity="0.5" /><stop offset="1" stopColor="#2a2118" stopOpacity="0" /></radialGradient>
        <radialGradient id="fx-blood"><stop offset="0" stopColor="#7f0d0d" stopOpacity="0.9" /><stop offset="0.7" stopColor="#5c0a0a" stopOpacity="0.6" /><stop offset="1" stopColor="#5c0a0a" stopOpacity="0" /></radialGradient>
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
        <radialGradient id="fx-boom"><stop offset="0" stopColor="#fffbe6" /><stop offset="0.35" stopColor="#fbbf24" /><stop offset="0.7" stopColor="#ea580c" stopOpacity="0.8" /><stop offset="1" stopColor="#7c2d12" stopOpacity="0" /></radialGradient>
        <linearGradient id="fx-flame" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff3c4" /><stop offset="0.4" stopColor="#fb923c" /><stop offset="1" stopColor="#b91c1c" stopOpacity="0.2" /></linearGradient>
        <radialGradient id="objdisc"><stop offset="0" stopColor="#f1f2f4" /><stop offset="1" stopColor="#8d939c" /></radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={ground ? 'url(#ground)' : 'url(#ash)'} />
      <rect x={0} y={0} width={W} height={H} fill="url(#grid)" />
      {props.zones !== false && (
        <>
          <polygon points={toPoly(dep.zones.attacker).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[attacker]} stroke={COLORS[attacker]} strokeWidth={0.1} strokeDasharray="0.5 0.3" />
          <polygon points={toPoly(dep.zones.defender).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[defender]} stroke={COLORS[defender]} strokeWidth={0.1} strokeDasharray="0.5 0.3" />
        </>
      )}
      <polygon points={toPoly(dep.territory.attacker).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.1} strokeDasharray="0.5 0.4" pointerEvents="none" />
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
              <g opacity={0.8}><SvgIcon name="shock" x={x0 + w / 2} y={y0 + h / 2} size={0.8} color="#f3d9a4" /></g>
            </g>
          );
        }
        if (t.kind === 'objective-area') {
          return <polygon key={t.id} points={pts} fill="rgba(245,184,61,0.05)" stroke="none" pointerEvents="none" />;
        }
        // terrain area: baseplate, rubble, ruin walls (block sight) and obstacles (low, cover only)
        const cxp = t.poly.reduce((a, p) => a + p.x, 0) / t.poly.length, cyp = t.poly.reduce((a, p) => a + p.y, 0) / t.poly.length;
        const inner = t.poly.map((p) => `${cxp + (p.x - cxp) * 0.86},${cyp + (p.y - cyp) * 0.86}`).join(' ');
        return (
          <g key={t.id} pointerEvents="none">
            <polygon points={pts} fill={t.category === 'dense' ? 'url(#tiles)' : 'rgba(170,158,128,0.55)'} stroke="#1c1712" strokeWidth={0.14} />
            <polygon points={inner} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.06} />
            {t.box && (() => {
              // a solid block (container / bunker) standing on the plate: shadow, metal top with ribs, lit rim
              const bp = t.box.map((p) => `${p.x},${p.y}`).join(' ');
              const sp = t.box.map((p) => `${p.x + 0.3},${p.y + 0.42}`).join(' ');
              const bc = polyCentroid(t.box);
              const [a, b] = [t.box[0], t.box[1]];
              const long = dist(t.box[0], t.box[1]) >= dist(t.box[1], t.box[2]);
              const u = long ? { x: b.x - a.x, y: b.y - a.y } : { x: t.box[2].x - b.x, y: t.box[2].y - b.y };
              const L = Math.hypot(u.x, u.y) || 1;
              const ribs = Math.max(2, Math.floor(L / 0.5));
              const across = long ? { x: t.box[2].x - b.x, y: t.box[2].y - b.y } : { x: b.x - a.x, y: b.y - a.y };
              return (
                <g>
                  <polygon points={sp} fill="rgba(0,0,0,0.45)" />
                  <polygon points={bp} fill="#4a3a2a" stroke="#1a130c" strokeWidth={0.14} strokeLinejoin="round" />
                  {Array.from({ length: ribs - 1 }, (_, k) => {
                    const f = (k + 1) / ribs - 0.5;
                    const c0 = { x: bc.x + (u.x * f), y: bc.y + (u.y * f) };
                    return <line key={k} x1={c0.x - across.x * 0.45} y1={c0.y - across.y * 0.45} x2={c0.x + across.x * 0.45} y2={c0.y + across.y * 0.45} stroke="#2e2318" strokeWidth={0.07} />;
                  })}
                  <polygon points={t.box.map((p) => `${bc.x + (p.x - bc.x) * 0.9},${bc.y + (p.y - bc.y) * 0.9}`).join(' ')} fill="none" stroke="rgba(255,220,170,0.25)" strokeWidth={0.06} />
                </g>
              );
            })()}
            {Array.from({ length: Math.min(9, Math.round(w * h / 6)) }, (_, i) => {
              const px = x0 + 0.5 + rnd(i) * Math.max(0, w - 1), py = y0 + 0.5 + rnd(i + 9) * Math.max(0, h - 1);
              return pointInPoly({ x: px, y: py }, t.poly) ? <circle key={i} cx={px} cy={py} r={0.12 + rnd(i + 3) * 0.22} fill="#4b4335" opacity={0.85} /> : null;
            })}
            {(t.obstacles ?? []).map((ob, i) => (
              <g key={`o${i}`}>
                <line x1={ob.a.x} y1={ob.a.y} x2={ob.b.x} y2={ob.b.y} stroke="#3a2a12" strokeWidth={0.5} strokeLinecap="round" />
                <line x1={ob.a.x} y1={ob.a.y} x2={ob.b.x} y2={ob.b.y} stroke="#d98b1f" strokeWidth={0.3} strokeLinecap="round" strokeDasharray="0.45 0.15" />
              </g>
            ))}
            {t.walls.filter((wl) => !onBoxEdge(t, wl)).map((wl, i) => (
              // the wall's shadow: ruins stand 5" tall
              <line key={`sh${i}`} x1={wl.a.x + 0.22} y1={wl.a.y + 0.32} x2={wl.b.x + 0.22} y2={wl.b.y + 0.32} stroke="rgba(0,0,0,0.38)" strokeWidth={0.95} strokeLinecap="square" />
            ))}
            {t.walls.filter((wl) => !onBoxEdge(t, wl)).map((wl, i) => {
              const len = dist(wl.a, wl.b);
              const n = Math.max(1, Math.floor(len / 2));
              return (
                <g key={i}>
                  <line x1={wl.a.x} y1={wl.a.y} x2={wl.b.x} y2={wl.b.y} stroke="#14261c" strokeWidth={0.6} strokeLinecap="square" />
                  <line x1={wl.a.x} y1={wl.a.y} x2={wl.b.x} y2={wl.b.y} stroke="#3e7a58" strokeWidth={0.32} strokeLinecap="square" />
                  {Array.from({ length: n }, (_, k) => {
                    const f = (k + 0.5) / n;
                    return <circle key={k} cx={wl.a.x + (wl.b.x - wl.a.x) * f} cy={wl.a.y + (wl.b.y - wl.a.y) * f} r={0.13} fill="#0d1a12" />;
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
      {s.units.filter((u) => u.homer && u.status === 'reserves').map((u) => (
        <g key={'homer-' + u.id} pointerEvents="none">
          <circle cx={u.homer!.x} cy={u.homer!.y} r={3} fill="none" stroke={u.owner ? 'var(--p1)' : 'var(--p0)'} strokeWidth={0.15} strokeDasharray="0.5 0.3" />
          <circle cx={u.homer!.x} cy={u.homer!.y} r={0.7} fill={u.owner ? 'var(--p1)' : 'var(--p0)'} stroke="#fff" strokeWidth={0.15} />
          <text x={u.homer!.x} y={u.homer!.y - 1.2} textAnchor="middle" fontSize={0.9} fill="#fff" stroke="#000" strokeWidth={0.12} paintOrder="stroke">Homer</text>
        </g>
      ))}
      {props.goals?.map((g) => (
        <g key={'goal-' + g.id} pointerEvents="none" className="goal">
          {g.areas.map((a, i) => <polygon key={i} points={a.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(245,212,138,0.10)" stroke="#f5d48a" strokeWidth={0.18} strokeDasharray="0.9 0.5" />)}
          {g.circles.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={c.r} fill="none" stroke="#f5d48a" strokeWidth={0.16} strokeDasharray="0.7 0.4" />)}
          {g.objectives.map((oid) => {
            const o = s.objectives.find((x) => x.id === oid);
            if (!o) return null;
            return (
              <g key={oid}>
                <circle cx={o.x} cy={o.y} r={3.2} fill="none" stroke="#f5d48a" strokeWidth={0.22} className="goal-ring" />
                <g transform={`translate(${o.x} ${o.y + 4.1})`}>
                  <rect x={-3.6} y={-0.48} width={7.2} height={0.95} rx={0.45} fill="rgba(60,40,0,0.9)" stroke="#f5d48a" strokeWidth={0.06} />
                  <text y={0.2} fontSize={0.55} textAnchor="middle" fill="#f5d48a" fontWeight={800}>{g.name.length > 24 ? g.name.slice(0, 23) + '…' : g.name}</text>
                </g>
              </g>
            );
          })}
        </g>
      ))}
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
            {o.secured != null && <g><circle cx={o.x + 1.15} cy={o.y - 0.75} r={0.62} fill="rgba(12,13,16,0.9)" stroke={COLORS[o.secured]} strokeWidth={0.08} /><SvgIcon name="hold" x={o.x + 1.15} y={o.y - 0.75} size={0.8} color={COLORS[o.secured]} /></g>}
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
      {s.markers.map((m) => (
        <g key={m.id} transform={`translate(${m.x} ${m.y})`} pointerEvents="none">
          <rect x={-0.55} y={-0.55} width={1.1} height={1.1} rx={0.15} transform="rotate(45)" fill={COLORS[m.owner]} stroke="#fff" strokeWidth={0.12} />
          <text y={0.22} fontSize={0.6} textAnchor="middle" fill="#fff" fontWeight={900}>{m.kind === 'trap' ? '!' : m.kind === 'locate' ? 'L' : m.kind === 'consecrate' ? '+' : ''}</text>
        </g>
      ))}
      {s.pendingActions.map((a) => {
        const u = s.units.find((x) => x.id === a.unitId);
        const ms = u ? alive(u) : [];
        if (!ms.length) return null;
        const c = { x: ms.reduce((q, m) => q + m.x, 0) / ms.length, y: Math.min(...ms.map((m) => m.y - m.r)) };
        return <text key={a.unitId + a.action} x={c.x} y={c.y - 0.6} fontSize={0.7} textAnchor="middle" fill="#fde68a" stroke="#000" strokeWidth={0.12} paintOrder="stroke" fontWeight={800} pointerEvents="none">action…</text>;
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
                <g key={m.id} data-unit={u.id} onPointerDown={(e) => startModelDrag(e, u.id, m.id)} style={{ cursor: isDraft ? 'grab' : 'pointer' }}>
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
                  {m.profile.W > 1 && m.wounds < m.profile.W && (() => {
                    // wounds left on a dark badge with an outline, so it reads over any token art
                    const fsz = Math.max(0.62, Math.min(1.1, m.r * 0.7));
                    const low = m.wounds * 2 <= m.profile.W;
                    const by = p.y + m.r * 0.55;
                    return (
                      <g pointerEvents="none">
                        <rect x={p.x - fsz * 0.62} y={by - fsz * 0.72} width={fsz * 1.24} height={fsz * 0.98} rx={fsz * 0.3} fill="rgba(0,0,0,0.78)" stroke={low ? '#f87171' : '#fde68a'} strokeWidth={0.06} />
                        <text x={p.x} y={by + fsz * 0.1} fontSize={fsz} textAnchor="middle" fill={low ? '#fca5a5' : '#fff7d6'} stroke="#000" strokeWidth={fsz * 0.22} paintOrder="stroke" fontWeight={900}>{m.wounds}</text>
                      </g>
                    );
                  })()}
                  {props.noLos?.includes(m.id) && (
                    <g pointerEvents="none" transform={`translate(${p.x + m.r * 0.7} ${p.y - m.r * 0.7})`}>
                      <circle r={0.38} fill="#111" stroke="#f87171" strokeWidth={0.08} />
                      <path d="M -0.22 0 Q 0 -0.2 0.22 0 Q 0 0.2 -0.22 0 Z" fill="none" stroke="#fff" strokeWidth={0.06} />
                      <line x1={-0.26} y1={0.26} x2={0.26} y2={-0.26} stroke="#f87171" strokeWidth={0.09} />
                    </g>
                  )}
                </g>
              );
            })}
            {(isSel || isPicked || isDraft || vb.w < 24) && pts.length > 0 && (
              <text x={cx} y={minY - 0.35} fontSize={fs * 0.85} textAnchor="middle" fill={isTarget ? '#fde68a' : '#fff'} stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={700}>
                {u.name.length > 22 ? u.name.slice(0, 21) + '…' : u.name}{u.battleShocked ? ' !' : ''}
              </text>
            )}
            {props.badges?.[u.id]?.length ? (
              <text x={cx} y={minY - 1.2} fontSize={0.75} textAnchor="middle" fill="#fde68a" stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={800}>
                {props.badges[u.id].join('  ')}
              </text>
            ) : null}
            {u.transport && pts.length > 0 && (() => {
              const pax = s.units.filter((x) => x.embarkedIn === u.id && x.status === 'embarked');
              if (!pax.length) return null;
              const n = pax.reduce((a, x) => a + alive(x).length, 0);
              const maxY = Math.max(...pts.map((p, i) => p.y + ms[i].r));
              return (
                <g transform={`translate(${cx} ${maxY + 0.75})`} pointerEvents="none">
                  <rect x={-2.2} y={-0.5} width={4.4} height={1.0} rx={0.5} fill="rgba(10,12,16,0.88)" stroke={col} strokeWidth={0.08} />
                  <SvgIcon name="transport" x={-1.55} y={0} size={0.7} color="#fff" />
                  <text x={0.35} y={0.24} fontSize={0.62} textAnchor="middle" fill="#fff" fontWeight={800}>{pax.length} units · {n}</text>
                </g>
              );
            })()}
            {u.battleShocked && pts.length > 0 && (
              <g transform={`translate(${cx} ${minY - (props.badges?.[u.id]?.length ? 3.1 : 2.2)})`} pointerEvents="none">
                <rect x={-3.9} y={-0.55} width={7.8} height={1.1} rx={0.55} fill="#4c1d95" stroke="#e9d5ff" strokeWidth={0.09} />
                <SvgIcon name="charge" x={-3.2} y={0} size={0.75} color="#f5f3ff" />
                <text x={0.35} y={0.25} fontSize={0.66} textAnchor="middle" fill="#f5f3ff" fontWeight={900}>BATTLE-SHOCKED</text>
              </g>
            )}
            {s.players[1 - u.owner].oathTarget === u.id && pts.length > 0 && (
              <g transform={`translate(${cx} ${minY - (props.badges?.[u.id]?.length ? 3.1 : 2.2) - (u.battleShocked ? 1.35 : 0)})`} pointerEvents="none">
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
      {props.measure?.a && (
        <g pointerEvents="none">
          <circle cx={props.measure.a.x} cy={props.measure.a.y} r={0.35} fill="#fde68a" stroke="#000" strokeWidth={0.08} />
          {props.measure.b && (() => {
            const a = props.measure.a!, b = props.measure.b!;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const col = props.measure.los === false ? '#f87171' : '#fde68a';
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const n = Math.floor(d);
            const ux = (b.x - a.x) / (d || 1), uy = (b.y - a.y) / (d || 1);
            return (
              <>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={0.2} strokeDasharray={props.measure.los === false ? '0.5 0.3' : undefined} />
                {Array.from({ length: n }, (_, i) => <line key={i} x1={a.x + ux * (i + 1) - uy * 0.35} y1={a.y + uy * (i + 1) + ux * 0.35} x2={a.x + ux * (i + 1) + uy * 0.35} y2={a.y + uy * (i + 1) - ux * 0.35} stroke={col} strokeWidth={(i + 1) % 6 === 0 ? 0.14 : 0.07} />)}
                <circle cx={b.x} cy={b.y} r={0.35} fill={col} stroke="#000" strokeWidth={0.08} />
                <text x={mx} y={my - 0.6} fontSize={1.2} textAnchor="middle" fill={col} stroke="#000" strokeWidth={0.18} paintOrder="stroke" fontWeight={900}>{props.measure.label ?? `${d.toFixed(1)}"`}{props.measure.los === false ? ' (not visible)' : ''}</text>
              </>
            );
          })()}
        </g>
      )}
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
  if (e.kind === 'attack') return <AttackFx e={e} f={f} />;
  if (e.kind === 'skill') return <SkillFx e={e} f={f} />;
  return null;
}

type AttackEvent = Extract<FxEvent, { kind: 'attack' }>;

/** Is this wall one of the edges of the piece's solid block (drawn as the block itself)? */
const onBoxEdge = (t: TerrainPiece, w: { a: Pt; b: Pt }) => !!t.box && [w.a, w.b].every((p) => t.box!.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.01));

/** A grainy battlefield ground (dirt, ash patches, small stones, cracks), drawn once on a canvas. */
let groundTex: string | null | undefined;
function groundTexture(): string | null {
  if (groundTex !== undefined) return groundTex;
  groundTex = null;
  try {
    const N = 256, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    if (!g) return null;
    let r = 12345;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    g.fillStyle = '#5b5446'; g.fillRect(0, 0, N, N);
    // soft patches of darker ash and lighter dust, wrapped so the tile repeats seamlessly
    const blob = (x: number, y: number, rad: number, col: string) => {
      for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    };
    for (let i = 0; i < 26; i++) blob(rnd() * N, rnd() * N, 20 + rnd() * 50, rnd() < 0.5 ? 'rgba(40,36,30,0.35)' : 'rgba(130,120,98,0.22)');
    // grain
    const img = g.getImageData(0, 0, N, N);
    for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9; }
    g.putImageData(img, 0, 0);
    // pebbles with a lit edge and a shadow
    for (let i = 0; i < 70; i++) {
      const x = rnd() * N, y = rnd() * N, rad = 0.8 + rnd() * 2.6;
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x + 0.8, y + 0.9, rad, rad * 0.8, 0, 0, 7); g.fill();
      g.fillStyle = rnd() < 0.5 ? '#7b725f' : '#6a6252'; g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, rnd() * 3, 0, 7); g.fill();
    }
    // hairline cracks
    g.strokeStyle = 'rgba(25,22,18,0.45)'; g.lineWidth = 0.8;
    for (let i = 0; i < 9; i++) {
      let x = rnd() * N, y = rnd() * N, a = rnd() * 6.28;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 7; k++) { a += (rnd() - 0.5) * 1.2; x += Math.cos(a) * 7; y += Math.sin(a) * 7; g.lineTo(x, y); }
      g.stroke();
    }
    groundTex = c.toDataURL('image/png');
  } catch { groundTex = null; }
  return groundTex;
}

/** deterministic 0..1 noise so an effect looks the same on every frame */
const noise = (seed: number, i: number) => { const v = Math.sin(seed * 91.17 + i * 12.9898) * 43758.5453; return v - Math.floor(v); };
const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const SHOT_COLOR: Record<string, { core: string; glow: string }> = {
  bullet: { core: '#fff7d6', glow: '#f59e0b' },
  beam: { core: '#e0f7ff', glow: '#38bdf8' },
  blast: { core: '#fff1c2', glow: '#f97316' },
  flame: { core: '#fff3c4', glow: '#f97316' },
};

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
      <g filter="url(#fx-smoke)" opacity={0.9 * (1 - smoke)}>
        {Array.from({ length: 5 }, (_, i) => {
          const a = noise(seed, i + 70) * Math.PI * 2, d = smoke * (0.6 + noise(seed, i + 71)) * big;
          return <circle key={i} cx={at.x + Math.cos(a) * d * 0.7} cy={at.y + Math.sin(a) * d * 0.7 - smoke * 1.4 * big} r={(0.6 + smoke * 1.4) * big * (0.7 + noise(seed, i + 72) * 0.5)} fill="url(#fx-smoke-g)" />;
        })}
      </g>
      {fire < 1 && (
        <g filter="url(#fx-bloom)">
          <circle cx={at.x} cy={at.y} r={(0.6 + fire * 1.8) * big} fill="url(#fx-boom)" opacity={1 - fire} />
          {fire < 0.25 && <circle cx={at.x} cy={at.y} r={(0.9 + fire * 3) * big} fill="#fffbe6" opacity={0.9 * (1 - fire * 4)} />}
        </g>
      )}
      <Debris at={at} k={clamp01(k / 0.6)} seed={seed} n={9} size={big} />
    </g>
  );
}

/** Shooting / melee effect: muzzle flashes, tracers or beams per model, impacts, smoke, damage and casualties. */
function AttackFx({ e, f }: { e: AttackEvent; f: number }) {
  const style = e.style ?? (e.attackKind === 'fight' ? 'melee' : 'bullet');
  const shooters = e.shooters?.length ? e.shooters : [e.from];
  const victims = e.victims?.length ? e.victims : [e.to];
  const seed = e.seq;
  const shots = e.shots ?? 6, hits = e.hits ?? shots;
  const n = style === 'bullet' ? Math.min(16, Math.max(3, shots)) : style === 'beam' ? Math.min(6, Math.max(1, shooters.length)) : style === 'blast' ? Math.min(4, Math.max(1, shots)) : style === 'flame' ? Math.min(4, shooters.length) : Math.min(8, Math.max(2, shots));
  const hitShare = shots ? hits / shots : 1;
  const travel = style === 'bullet' ? 0.1 : style === 'blast' ? 0.2 : style === 'beam' ? 0.02 : style === 'flame' ? 0.22 : 0.08;
  const span = 0.42; // shots are spread over the first part of the effect
  const after = clamp01((f - 0.5) / 0.5); // damage numbers and casualties
  const c = SHOT_COLOR[style] ?? SHOT_COLOR.bullet;
  const items: React.ReactNode[] = [];
  const glows: React.ReactNode[] = []; // drawn with a bloom filter
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * span + noise(seed, i + 40) * 0.04;
    const from = shooters[Math.floor(noise(seed, i) * shooters.length) % shooters.length];
    const tgt = victims[Math.floor(noise(seed, i + 3) * victims.length) % victims.length];
    const hit = noise(seed, i + 5) < hitShare;
    const miss = { x: tgt.x + (noise(seed, i + 9) - 0.5) * 4, y: tgt.y + (noise(seed, i + 11) - 0.5) * 4 };
    const impact = hit ? { x: tgt.x + (noise(seed, i + 13) - 0.5) * 0.5, y: tgt.y + (noise(seed, i + 17) - 0.5) * 0.5 } : miss;
    const k = (f - t0) / travel; // 0..1 while travelling
    const ik = (f - t0 - travel) / 0.22; // 0..1 after impact
    if (style === 'melee') {
      const sk = (f - t0) / 0.2;
      if (sk > 0 && sk < 1) {
        const a = noise(seed, i + 21) * 360;
        glows.push(
          <g key={`s${i}`} transform={`translate(${impact.x} ${impact.y}) rotate(${a})`} opacity={1 - sk}>
            <path d={`M -1 ${-0.6 + sk * 0.3} Q 0 ${-1.4 + sk} 1 ${-0.6 + sk * 0.3}`} fill="none" stroke="#fff" strokeWidth={0.16} strokeLinecap="round" />
            <path d={`M -1 ${-0.6 + sk * 0.3} Q 0 ${-1.4 + sk} 1 ${-0.6 + sk * 0.3}`} fill="none" stroke="#ef4444" strokeWidth={0.4} strokeLinecap="round" opacity={0.45} />
          </g>,
        );
      }
      if (hit) glows.push(<Sparks key={`k${i}`} at={impact} seed={seed + i} k={(f - t0 - 0.08) / 0.25} color="#fecaca" />);
      continue;
    }
    // muzzle flash
    const mk = (f - t0) / 0.07;
    if (mk > 0 && mk < 1) {
      const ang = Math.atan2(impact.y - from.y, impact.x - from.x);
      const tip = { x: from.x + Math.cos(ang) * 0.9, y: from.y + Math.sin(ang) * 0.9 };
      const star = Array.from({ length: 10 }, (_, j) => {
        const a = ang + (j / 10) * Math.PI * 2, rr = j % 2 ? 0.16 : j === 0 ? 1.1 : 0.42 + noise(seed, i * 10 + j) * 0.25;
        return `${from.x + Math.cos(a) * rr},${from.y + Math.sin(a) * rr}`;
      }).join(' ');
      glows.push(
        <g key={`m${i}`} opacity={1 - mk}>
          <circle cx={from.x} cy={from.y} r={0.5 + mk * 0.3} fill={c.glow} opacity={0.5} />
          <polygon points={star} fill={c.core} />
          <polygon points={`${tip.x},${tip.y} ${from.x + Math.cos(ang + 0.5) * 0.35},${from.y + Math.sin(ang + 0.5) * 0.35} ${from.x + Math.cos(ang - 0.5) * 0.35},${from.y + Math.sin(ang - 0.5) * 0.35}`} fill="#fff" />
        </g>,
      );
      // a wisp of gun smoke drifts off the muzzle
      items.push(<Puff key={`gs${i}`} at={{ x: from.x + (noise(seed, i + 60) - 0.5) * 0.6, y: from.y - mk * 0.4 }} k={mk * 0.5} r={0.7} color="rgba(190,185,175,0.35)" />);
    }
    if (style === 'beam') {
      const bk = (f - t0) / 0.16;
      if (bk > 0 && bk < 1) {
        const w = 0.35 * (1 - bk);
        glows.push(
          <g key={`b${i}`}>
            <line x1={from.x} y1={from.y} x2={impact.x} y2={impact.y} stroke={c.glow} strokeWidth={w * 2.2} strokeLinecap="round" opacity={0.45} />
            <line x1={from.x} y1={from.y} x2={impact.x} y2={impact.y} stroke={c.core} strokeWidth={w * 0.7} strokeLinecap="round" />
          </g>,
        );
      }
    } else if (style === 'flame') {
      const fk = (f - t0) / 0.3;
      if (fk > 0 && fk < 1) {
        const ang = Math.atan2(impact.y - from.y, impact.x - from.x);
        const len = Math.min(12, Math.hypot(impact.x - from.x, impact.y - from.y)) * Math.min(1, fk * 2);
        const spread = 0.35;
        const pts = [from, { x: from.x + Math.cos(ang + spread) * len, y: from.y + Math.sin(ang + spread) * len }, { x: from.x + Math.cos(ang - spread) * len, y: from.y + Math.sin(ang - spread) * len }];
        glows.push(
          <g key={`f${i}`} opacity={0.85 * (1 - fk)}>
            <polygon points={pts.map((q) => `${q.x},${q.y}`).join(' ')} fill="url(#fx-flame)" />
            <polygon points={pts.map((q, j) => (j ? lerp(from, q, 0.6) : q)).map((q) => `${q.x},${q.y}`).join(' ')} fill="#fff3c4" opacity={0.5} />
          </g>,
        );
      }
    } else if (k > 0 && k < 1) {
      // bullet tracer / shell
      if (style === 'blast') {
        const mid = { x: (from.x + impact.x) / 2, y: (from.y + impact.y) / 2 - Math.hypot(impact.x - from.x, impact.y - from.y) * 0.18 };
        const q = (a: Pt, b: Pt, cc: Pt, s: number) => lerp(lerp(a, cc, s), lerp(cc, b, s), s);
        const p = q(from, impact, mid, k), tail = q(from, impact, mid, Math.max(0, k - 0.15));
        items.push(<line key={`tt${i}`} x1={tail.x} y1={tail.y} x2={p.x} y2={p.y} stroke="rgba(150,150,150,0.5)" strokeWidth={0.35} strokeLinecap="round" />);
        glows.push(<circle key={`t${i}`} cx={p.x} cy={p.y} r={0.22} fill={c.core} />);
      } else {
        const head = lerp(from, impact, k), tail = lerp(from, impact, Math.max(0, k - 0.22));
        glows.push(
          <g key={`t${i}`}>
            <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={c.glow} strokeWidth={0.3} strokeLinecap="round" opacity={0.5} />
            <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={c.core} strokeWidth={0.1} strokeLinecap="round" />
          </g>,
        );
      }
    }
    // impact
    if (style === 'blast') {
      const xk = (f - t0 - travel) / 0.35;
      if (xk > 0 && xk < 1) {
        items.push(<Explosion key={`x${i}`} at={impact} k={xk} seed={seed + i} big={1} />);
      }
    } else if (hit) glows.push(<Sparks key={`k${i}`} at={impact} seed={seed + i} k={ik} color={style === 'beam' ? '#bae6fd' : '#fde68a'} />);
    else {
      // a miss kicks up dirt
      items.push(<Puff key={`p${i}`} at={impact} k={ik} r={0.6} color="rgba(120,108,88,0.6)" />);
      if (ik > 0 && ik < 1) items.push(<Debris key={`dd${i}`} at={impact} k={ik} seed={seed + i * 3} n={4} color="#3d352a" size={0.6} />);
    }
  }
  return (
    <g pointerEvents="none">
      {items}
      <g filter="url(#fx-bloom)">{glows}</g>
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

export const Board = memo(BoardImpl);

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
      <g filter="url(#fx-bloom)">
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
