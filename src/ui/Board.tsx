import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RULES } from '../engine/config';
import { deploymentById, toPoly } from '../engine/config';
import { dist } from '../engine/geometry';
import { alive, onBoard } from '../engine/state';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

export type Paths = Map<string, Pt[]>;

export interface Ring { c: Pt; r: number; color: string; dash?: boolean }

export interface BoardProps {
  s: GameState;
  viewer: PlayerId;
  selected?: string | null;
  draftUnit?: string | null;
  draft?: Paths | null;
  maxFor?: (modelId: string) => number;
  groupDrag?: boolean;
  bad?: string[];
  targets?: string[];
  picked?: string[];
  rings?: Ring[];
  zones?: boolean;
  onTapUnit?: (unitId: string, modelId: string) => void;
  onTapBoard?: (p: Pt) => void;
  onDraft?: (p: Paths) => void;
}

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;
const COLORS = ['#3b82f6', '#ef4444'];
const SOFT = ['rgba(59,130,246,0.16)', 'rgba(239,68,68,0.16)'];
const TERRAIN_FILL: Record<string, string> = { dense: 'rgba(120,98,72,0.55)', light: 'rgba(150,140,80,0.45)', exposed: 'rgba(90,85,78,0.45)' };

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
  const { s, draft, draftUnit, maxFor, groupDrag, onDraft } = props;
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
    const models = groupDrag ? [...draft!.keys()] : [modelId];
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
      if (!dg.moved) props.onTapUnit?.(dg.unitId, dg.modelId);
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
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.03" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="#3d4b3c" />
      <rect x={0} y={0} width={W} height={H} fill="url(#grid)" />
      {props.zones !== false && (
        <>
          <polygon points={toPoly(dep.zones.attacker).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[attacker]} stroke={COLORS[attacker]} strokeWidth={0.08} strokeDasharray="0.4 0.3" />
          <polygon points={toPoly(dep.zones.defender).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[defender]} stroke={COLORS[defender]} strokeWidth={0.08} strokeDasharray="0.4 0.3" />
        </>
      )}
      {/* 6" ruler ticks */}
      {Array.from({ length: Math.floor(H / 6) + 1 }, (_, i) => (
        <text key={`ty${i}`} x={0.2} y={i * 6 + 0.5} fontSize={0.6} fill="rgba(255,255,255,0.35)">{i * 6}"</text>
      ))}
      {s.terrain.map((t) => (
        <g key={t.id}>
          <polygon points={t.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill={TERRAIN_FILL[t.category]} stroke={t.objectiveId ? '#f5b83d' : 'rgba(0,0,0,0.4)'} strokeWidth={t.objectiveId ? 0.12 : 0.06} />
          {t.walls.map((w, i) => (
            <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#2a221a" strokeWidth={0.45} strokeLinecap="square" />
          ))}
        </g>
      ))}
      {s.objectives.map((o) => {
        const ctrl = o.controller;
        return (
          <g key={o.id}>
            <circle cx={o.x} cy={o.y} r={0.8} fill={ctrl === null ? '#e5e7eb' : COLORS[ctrl]} stroke="#111" strokeWidth={0.1} opacity={0.9} />
            <text x={o.x} y={o.y + 0.28} fontSize={0.8} textAnchor="middle" fill="#111" fontWeight={800}>{o.type === 'home' ? 'H' : o.type === 'central' ? 'C' : 'E'}</text>
          </g>
        );
      })}
      {props.rings?.map((r, i) => (
        <circle key={`r${i}`} cx={r.c.x} cy={r.c.y} r={r.r} fill="none" stroke={r.color} strokeWidth={0.08} strokeDasharray={r.dash ? '0.35 0.25' : undefined} />
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
              return (
                <g key={m.id} onPointerDown={(e) => startModelDrag(e, u.id, m.id)} style={{ cursor: isDraft ? 'grab' : 'pointer' }}>
                  <circle cx={p.x} cy={p.y} r={Math.max(m.r, 0.35) + 0.35} fill="transparent" />
                  <circle
                    cx={p.x} cy={p.y} r={m.r}
                    fill={bad ? '#7f1d1d' : col}
                    fillOpacity={isDraft ? 0.95 : 0.85}
                    stroke={bad ? '#fca5a5' : isSel || isDraft ? '#f5b83d' : isPicked ? '#ffffff' : isTarget ? '#fde68a' : '#0b0d10'}
                    strokeWidth={isSel || isDraft || isTarget || isPicked || bad ? 0.14 : 0.07}
                    strokeDasharray={u.battleShocked ? '0.25 0.15' : undefined}
                  />
                  {m.isCharacter && <circle cx={p.x} cy={p.y} r={m.r * 0.55} fill="none" stroke="#f5b83d" strokeWidth={0.1} />}
                  {m.profile.W > 1 && m.wounds < m.profile.W && (
                    <text x={p.x} y={p.y + 0.22} fontSize={0.6} textAnchor="middle" fill="#fff" fontWeight={800} pointerEvents="none">{m.wounds}</text>
                  )}
                </g>
              );
            })}
            {(isSel || isTarget || vb.w < 30) && pts.length > 0 && (
              <text x={cx} y={minY - 0.35} fontSize={fs * 0.85} textAnchor="middle" fill={isTarget ? '#fde68a' : '#fff'} stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={700}>
                {u.name.length > 22 ? u.name.slice(0, 21) + '…' : u.name}{u.battleShocked ? ' ⚠' : ''}
              </text>
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
      <rect x={0} y={0} width={W} height={H} fill="none" stroke="#000" strokeWidth={0.15} />
    </svg>
  );
}

export const Board = memo(BoardImpl);
