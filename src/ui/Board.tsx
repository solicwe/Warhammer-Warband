import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RULES } from '../engine/config';
import { deploymentById, toPoly } from '../engine/config';
import { dist, pointInPoly, polyCentroid } from '../engine/geometry';
import { alive, onBoard } from '../engine/state';
import { levelOfControl, markRuleLabel } from '../engine/game';
import { modelToken } from './Tokens';
import { getModelPortrait, IMAGE_BASE, usePortraitsVersion } from './portraits';
import { loadoutLabels, shortItem } from './loadout';
import { SvgIcon } from './Icon';
import { FX_MS, FxLayer, type ActiveFx } from './BattleFx';
import type { SecondaryGoal } from '../engine/secondaries';
import type { FxEvent, GameState, ModelState, PlayerId, Pt, TerrainPiece, UnitState } from '../engine/types';
import { play, type Sfx } from './sfx';

export type Paths = Map<string, Pt[]>;

export interface Ring { c: Pt; r: number; color: string; dash?: boolean }

export interface BoardProps {
  s: GameState;
  viewer: PlayerId;
  selected?: string | null;
  draftUnit?: string | null;
  draft?: Paths | null;
  /** numbers shared with a unit-selection list, to identify units with duplicate names */
  unitNumbers?: Record<string, number>;
  /** draw an inset guide this many inches from the battlefield edge */
  edgeGuide?: number;
  /** show the keep-out distance around a deployment zone while placing a unit */
  zoneGuide?: { poly: Pt[]; distance: number };
  maxFor?: (modelId: string) => number;
  /** the legal route for a model dragged along [start, wanted end]: around walls it can't cross, stopping where it can't go on */
  walk?: (modelId: string, path: Pt[]) => Pt[];
  /** players whose moves are replayed as an animation (the bot) */
  animateMoves?: PlayerId[];
  bad?: string[];
  targets?: string[];
  picked?: string[];
  rings?: Ring[];
  zones?: boolean;
  badges?: Record<string, string[]>;
  /** temporary buffs / debuffs on a unit ("+1 Hit", "−2\" M"): green good, red bad, under the unit */
  buffTags?: Record<string, [string, boolean][]>;
  /** Ork units riled up (WAAAGH! …): green flames on their models */
  riled?: string[];
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
  /** the enemy's likely attacks next turn (its look ahead): an arrow from each attacker to its target */
  plan?: { from: Pt; to: Pt; melee: boolean; label: string }[];
  /** cards laid on the table beside the battlefield, next to each army's deployment zone (army-wide buffs) */
  side?: { p: PlayerId; at: 'left' | 'right' | 'top' | 'bottom'; cards: React.ReactNode[] }[];
}

/** Width of the table beside the battlefield that holds the side cards, in inches; card text is laid out at PX px per inch. */
const SIDE = 13, PX = 20;

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;
const COLORS = ['#3a9ad9', '#e0453f'];
const SOFT = ['rgba(58,154,217,0.16)', 'rgba(224,69,63,0.16)'];

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

/** A model's base drawn to its real shape: round, oval, or a vehicle hull (rounded rectangle), turned to its facing;
 *  `grow` draws it that much bigger all round (selection rings, Engagement Range). */
function BaseShape({ m, p, grow = 0, ...rest }: { m: ModelState; p: Pt; grow?: number } & React.SVGProps<SVGElement>) {
  const attrs = rest as Record<string, unknown>;
  if (!m.hl) return <circle cx={p.x} cy={p.y} r={m.r + grow} {...attrs} />;
  const hw = (m.hw ?? m.r) + grow, len = m.hl + hw, deg = ((m.rot ?? 0) * 180) / Math.PI;
  const t = `rotate(${deg} ${p.x} ${p.y})`;
  return m.hull
    ? <rect x={p.x - len} y={p.y - hw} width={len * 2} height={hw * 2} rx={hw * 0.45} transform={t} {...attrs} />
    : <ellipse cx={p.x} cy={p.y} rx={len} ry={hw} transform={t} {...attrs} />;
}

function BoardImpl(props: BoardProps) {
  usePortraitsVersion();
  const { s, draft, draftUnit, maxFor, onDraft, walk } = props;
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
    const keep = fresh.filter((e) => (e.kind !== 'roll' || (!!e.unitId && !!e.at)) && e.kind !== 'rolloff' && e.kind !== 'cards' && (e.kind !== 'move' || props.animateMoves?.includes(e.owner)));
    // the new kinds of moment get their sound here (attacks are voiced by the attack report)
    const voice: Partial<Record<FxEvent['kind'], Sfx>> = { shock: 'shock', heal: 'heal', place: 'arrive' };
    for (const k of new Set(keep.map((e) => (e.kind === 'move' && e.moveKind === 'charge' ? 'charge' : voice[e.kind])).filter((x): x is Sfx => !!x))) play(k);
    if (keep.some((e) => e.kind === 'roll' && !!e.unitId)) play('dice', 2);
    // stagger events from the same step a little so they read in order
    setFx((cur) => [...cur.filter((a) => t0 - a.t0 < FX_MS[a.e.kind]), ...keep.map((e, i) => ({ e, t0: t0 + i * 180 }))]);
  }, [s.fx, s.fxSeq, props.animateMoves]);
  // drop finished effects (one re-render when each ends; the effects themselves animate in FxLayer)
  useEffect(() => {
    if (!fx.length) return;
    const end = Math.min(...fx.map((a) => a.t0 + FX_MS[a.e.kind]));
    const id = setTimeout(() => { const t = performance.now(); setFx((cur) => cur.filter((a) => t - a.t0 < FX_MS[a.e.kind])); }, Math.max(16, end - performance.now() + 20));
    return () => clearTimeout(id);
  }, [fx]);
  // only unit moves need the whole board redrawn every frame, and only while they glide
  const moving = fx.some((a) => a.e.kind === 'move');
  useEffect(() => {
    if (!moving) return;
    let raf = 0;
    const tick = () => { setNow(performance.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [moving]);
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
      if (a.e.kind === 'move' || a.e.kind === 'place') ids.add(a.e.unitId);
      if (a.e.kind === 'attack') ids.add(a.e.attackerId);
      if (a.e.kind === 'skill') ids.add(a.e.unitId);
    }
    return ids;
  }, [fx]);
  // an objective changing hands: a ring in the new controller's colour sweeps out from it
  const ctrlPrev = useRef(s.objectives.map((o) => o.controller));
  const [caps, setCaps] = useState<{ id: string; x: number; y: number; p: PlayerId; k: number }[]>([]);
  useEffect(() => {
    const prev = ctrlPrev.current;
    ctrlPrev.current = s.objectives.map((o) => o.controller);
    const fresh = s.objectives.flatMap((o, i) => (o.controller !== null && prev[i] !== undefined && o.controller !== prev[i] ? [{ id: o.id, x: o.x, y: o.y, p: o.controller, k: Date.now() + i }] : []));
    if (!fresh.length) return;
    setCaps((c) => [...c, ...fresh]);
    const tm = setTimeout(() => setCaps((c) => c.filter((x) => !fresh.includes(x))), 1400);
    return () => clearTimeout(tm);
  }, [s.objectives]);
  const svgRef = useRef<SVGSVGElement>(null);
  // the whole table: the battlefield plus the strips the side cards lie on
  const sides = (props.side ?? []).filter((x) => x.cards.length);
  const padL = sides.some((x) => x.at !== 'right') ? SIDE : 0, padR = sides.some((x) => x.at === 'right') ? SIDE : 0;
  const home = useMemo(() => ({ x: -1 - padL, y: -1, w: W + 2 + padL + padR, h: H + 2 }), [padL, padR]);
  const [vb, setVb] = useState(home);
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
    setVb(home);
  }, [home]);

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
        next.set(id, path.length < 2 ? [end] : walk ? walk(id, [origin, end]) : [origin, end]);
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
        next.set(id, path.length < 2 ? [end] : walk ? walk(id, [path[0], end]) : [path[0], end]);
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
  // terrain never changes during a battle: build it once, so redrawing moving units does not rebuild every wall
  const terrainKey = s.terrain.map((t) => t.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ground + footprint art painted once into one picture (dozens of clipped images would be redrawn on every frame)
  const backdrop = useBackdrop(s.terrain, terrainKey, ground);
  const backdropReady = !!backdrop;
  const terrainEls = useMemo(() => s.terrain.map((t) => {
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
        const plate = plateFor(t);
        return (
          <g key={t.id} pointerEvents="none">
            {/* with footprint art the plate itself is drawn on the still layer underneath (see plateEls) */}
            <polygon points={pts} fill={plate && backdropReady ? 'none' : t.category === 'dense' ? 'url(#tiles)' : 'rgba(170,158,128,0.55)'} stroke="#1c1712" strokeWidth={0.14} />
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
            {!(plate && backdropReady) && Array.from({ length: Math.min(9, Math.round(w * h / 6)) }, (_, i) => {
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
      }), [terrainKey, backdropReady]);
  return (
    <>
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
        <marker id="plan-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#f87171" /></marker>
        {ground && <pattern id="ground" width="11" height="11" patternUnits="userSpaceOnUse"><image href={ground} width="11" height="11" preserveAspectRatio="none" /></pattern>}
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
        <linearGradient id="fx-flame" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff3c4" /><stop offset="0.4" stopColor="#fb923c" /><stop offset="1" stopColor="#b91c1c" stopOpacity="0.2" /></linearGradient>
        <radialGradient id="objdisc"><stop offset="0" stopColor="#f1f2f4" /><stop offset="1" stopColor="#8d939c" /></radialGradient>
      </defs>
      {backdrop
        ? <image href={backdrop} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
        : <rect x={0} y={0} width={W} height={H} fill={ground ? 'url(#ground)' : 'url(#ash)'} />}
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
      {terrainEls}
      {props.edgeGuide !== undefined && props.edgeGuide > 0 && props.edgeGuide * 2 < Math.min(W, H) && (
        <g pointerEvents="none">
          <rect x={props.edgeGuide} y={props.edgeGuide} width={W - props.edgeGuide * 2} height={H - props.edgeGuide * 2}
            fill="none" stroke="#f5d48a" strokeWidth={0.16} strokeDasharray="0.65 0.35" />
          <text x={props.edgeGuide + 0.35} y={props.edgeGuide + 0.95} fontSize={0.72} fill="#f5d48a" stroke="#111" strokeWidth={0.12} paintOrder="stroke" fontWeight={900}>
            {props.edgeGuide}" FROM EDGE
          </text>
        </g>
      )}
      {props.zoneGuide && (
        <g pointerEvents="none">
          <polygon points={props.zoneGuide.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="none"
            stroke="rgba(239,68,68,0.18)" strokeWidth={props.zoneGuide.distance * 2} strokeLinejoin="round" />
          <polygon points={props.zoneGuide.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="none"
            stroke="rgba(252,165,165,0.8)" strokeWidth={0.13} strokeDasharray="0.55 0.3" />
          <text x={props.zoneGuide.poly[0].x + 0.35} y={props.zoneGuide.poly[0].y + 0.95} fontSize={0.72}
            fill="#fecaca" stroke="#111" strokeWidth={0.12} paintOrder="stroke" fontWeight={900}>
            {props.zoneGuide.distance}" FROM ENEMY DEPLOYMENT ZONE
          </text>
        </g>
      )}
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
            {o.warded != null && <g><circle cx={o.x + 1.15} cy={o.y + 0.75} r={0.55} fill="rgba(12,13,16,0.9)" stroke={COLORS[o.warded]} strokeWidth={0.08} /><text x={o.x + 1.15} y={o.y + 0.95} fontSize={0.62} textAnchor="middle" fill={COLORS[o.warded]} fontWeight={900}>W</text></g>}
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
        <BaseShape key={`e${m.id}`} m={m} p={m} grow={RULES.engagementRange} fill="rgba(255,80,80,0.06)" stroke="rgba(255,80,80,0.25)" strokeWidth={0.04} />
      )))}
      {units.map((u) => {
        const isDraft = draft && draftUnit === u.id;
        const isSel = props.selected === u.id;
        const isTarget = props.targets?.includes(u.id);
        const isPicked = props.picked?.includes(u.id);
        const col = COLORS[u.owner];
        const ms = alive(u);
        const labels = loadoutLabels(u); // which model carries what, in a squad with mixed wargear
        const pts = ms.map((m) => posOf(u, m.id, m));
        const cx = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
        const minY = Math.min(...pts.map((p, i) => p.y - ms[i].r));
        const unitNumber = props.unitNumbers?.[u.id];
        const riled = props.riled?.includes(u.id);
        const tags = props.buffTags?.[u.id];
        return (
          <g key={u.id}>
            {isDraft && ms.map((m) => {
              const p = draft!.get(m.id);
              if (!p || p.length < 2) return null;
              return (
                <g key={`g${m.id}`} pointerEvents="none">
                  <BaseShape m={m} p={p[0]} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.06} strokeDasharray="0.2 0.15" />
                  <polyline points={p.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.07} />
                  {ms.length <= 6 && maxFor && <circle cx={p[0].x} cy={p[0].y} r={maxFor(m.id) + m.r} fill="none" stroke="rgba(245,184,61,0.35)" strokeWidth={0.06} />}
                </g>
              );
            })}
            {ms.map((m, i) => {
              const p = pts[i];
              const bad = props.bad?.includes(m.id);
              // the photo fits the narrow side of an oval or hull base
              const pr = m.hl ? (m.hw ?? m.r) : m.r;
              const isSolo = isDraft && solo.includes(m.id);
              return (
                <g key={m.id} data-unit={u.id} onPointerDown={(e) => startModelDrag(e, u.id, m.id)} style={{ cursor: isDraft ? 'grab' : 'pointer' }}>
                  <BaseShape m={m} p={p} grow={Math.max(0, 0.35 - m.r) + 0.35} fill="transparent" />
                  {acting.has(u.id) && <BaseShape m={m} p={p} grow={0.35} fill="none" stroke={col} strokeWidth={0.22} opacity={0.75} className="fx-glow" pointerEvents="none" />}
                  {(isSel || isPicked) && !isDraft && <BaseShape m={m} p={p} grow={0.3} fill="none" stroke={isSel ? '#f5b83d' : '#ffffff'} strokeWidth={0.18} className="sel-ring" pointerEvents="none" />}
                  {isTarget && !isPicked && !isSel && <BaseShape m={m} p={p} grow={0.28} fill="none" stroke="#fde68a" strokeWidth={0.1} strokeDasharray="0.3 0.2" pointerEvents="none" />}
                  {isSolo && <BaseShape m={m} p={p} grow={0.3} fill="none" stroke="#fff" strokeWidth={0.12} strokeDasharray="0.25 0.15" pointerEvents="none" />}
                  {riled && (
                    <g pointerEvents="none">
                      <path className="ork-flame" d={`M ${p.x - m.r * 0.95} ${p.y} Q ${p.x - m.r * 1.25} ${p.y - m.r * 1.2} ${p.x - m.r * 0.45} ${p.y - m.r * 1.95} Q ${p.x - m.r * 0.35} ${p.y - m.r * 1.3} ${p.x} ${p.y - m.r * 2.5} Q ${p.x + m.r * 0.3} ${p.y - m.r * 1.35} ${p.x + m.r * 0.5} ${p.y - m.r * 1.95} Q ${p.x + m.r * 1.25} ${p.y - m.r * 1.2} ${p.x + m.r * 0.95} ${p.y} Z`} fill="url(#ork-flame)" />
                      <BaseShape m={m} p={p} grow={0.12} fill="none" stroke="#4ade80" strokeWidth={0.16} opacity={0.85} className="fx-glow" />
                    </g>
                  )}
                  <BaseShape
                    m={m} p={p}
                    fill={bad ? '#7f1d1d' : getModelPortrait(m) ? '#ffffff' : '#1d2129'}
                    fillOpacity={1}
                    stroke={bad ? '#fca5a5' : isSel || isDraft ? '#f5b83d' : isPicked ? '#ffffff' : isTarget ? '#fde68a' : col}
                    strokeWidth={isSel || isDraft || isTarget || isPicked || bad ? 0.16 : 0.12}
                    strokeDasharray={u.battleShocked ? '0.25 0.15' : undefined}
                  />
                  {getModelPortrait(m)
                    ? <image href={getModelPortrait(m)} x={p.x - pr * 0.9} y={p.y - pr * 0.9} width={pr * 1.8} height={pr * 1.8} clipPath="url(#clip-round)" preserveAspectRatio="xMidYMid slice" pointerEvents="none" />
                    : <use href={`#tok-${modelToken(m)}`} x={p.x - pr * 0.82} y={p.y - pr * 0.82} width={pr * 1.64} height={pr * 1.64} pointerEvents="none" />}
                  {m.isCharacter && <use href="#tok-crown" x={p.x - m.r * 0.55} y={p.y - m.r * 1.35} width={m.r * 1.1} height={m.r * 0.66} pointerEvents="none" />}
                  {m.profile.W > 1 && m.wounds < m.profile.W && (() => {
                    // wounds left on a small badge sitting on the base's rim, so the photo stays visible
                    const fsz = Math.max(0.5, Math.min(0.9, m.r * 0.55));
                    const low = m.wounds * 2 <= m.profile.W;
                    const by = p.y + m.r * 0.98;
                    return (
                      <g pointerEvents="none">
                        <rect x={p.x - fsz * 0.62} y={by - fsz * 0.72} width={fsz * 1.24} height={fsz * 0.98} rx={fsz * 0.3} fill="rgba(0,0,0,0.78)" stroke={low ? '#f87171' : '#fde68a'} strokeWidth={0.06} />
                        <text x={p.x} y={by + fsz * 0.1} fontSize={fsz} textAnchor="middle" fill={low ? '#fca5a5' : '#fff7d6'} stroke="#000" strokeWidth={fsz * 0.22} paintOrder="stroke" fontWeight={900}>{m.wounds}</text>
                      </g>
                    );
                  })()}
                  {labels.has(m.id) && vb.w >= 30 && (
                    // zoomed out: words don't fit, a letter badge tells the kits apart (C = Claws, H = Hammer…)
                    <g pointerEvents="none">
                      <circle cx={p.x + m.r * 0.72} cy={p.y + m.r * 0.72} r={Math.max(0.32, m.r * 0.42)} fill="#fff7d6" stroke="#000" strokeWidth={0.07} />
                      <text x={p.x + m.r * 0.72} y={p.y + m.r * 0.72 + Math.max(0.32, m.r * 0.42) * 0.42} fontSize={Math.max(0.32, m.r * 0.42) * 1.25} textAnchor="middle" fill="#111" fontWeight={900}>{labels.get(m.id)!.charAt(0).toUpperCase()}</text>
                    </g>
                  )}
                  {labels.has(m.id) && vb.w < 30 && (isSel || isDraft) && (() => {
                    // only the unit in hand: everyone's kit at once buries the board in words
                    // shown once zoomed in; one item per line ("Hammer" / "Shield"), shrunk to the base's width so
                    // neighbours' labels don't run into each other
                    const raw = labels.get(m.id)!;
                    // whole words, never cut: a long name breaks at its space / hyphen ("Kombi-" / "skorcha")
                    const lines = raw.replace(/ \+$/, '').split('+').flatMap((x) => {
                      const w = shortItem(x, 24);
                      const cut = w.length > 8 ? Math.max(w.lastIndexOf(' ', Math.ceil(w.length / 2) + 2), w.indexOf('-') + 1) : 0;
                      return cut > 1 && cut < w.length - 1 ? [w.slice(0, cut).trim(), w.slice(cut).trim()] : [w];
                    });
                    if (raw.endsWith(' +')) lines[lines.length - 1] += '+';
                    const longest = Math.max(...lines.map((x) => x.length));
                    const fsz = Math.max(0.2, Math.min(Math.max(0.36, Math.min(0.6, vb.w * 0.022)), (m.r * 2 + 0.35) / (0.58 * longest)));
                    return (
                      <text x={p.x} y={p.y + m.r + fsz * 1.0} fontSize={fsz} textAnchor="middle" fill="#fff7d6" stroke="#000" strokeWidth={fsz * 0.26} paintOrder="stroke" fontWeight={800} pointerEvents="none">
                        {lines.map((x, k) => <tspan key={k} x={p.x} dy={k ? fsz * 1.05 : 0}>{x}</tspan>)}
                      </text>
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
            {(isSel || isPicked || isDraft || vb.w < 30) && pts.length > 0 && (
              <text x={cx} y={minY - 0.35} fontSize={fs * 0.85} textAnchor="middle" fill={isTarget ? '#fde68a' : '#fff'} stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={700}>
                {u.name.length > 22 ? u.name.slice(0, 21) + '…' : u.name}{u.battleShocked ? ' !' : ''}
              </text>
            )}
            {props.badges?.[u.id]?.length ? (
              <text x={cx} y={minY - 1.2} fontSize={0.75} textAnchor="middle" fill="#fde68a" stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={800}>
                {props.badges[u.id].join('  ')}
              </text>
            ) : null}
            {unitNumber !== undefined && pts.length > 0 && (
              <g transform={`translate(${cx} ${minY - 0.65})`} pointerEvents="none">
                <circle r={0.55} fill="#f5d48a" stroke="#111" strokeWidth={0.12} />
                <text y={0.2} fontSize={0.62} textAnchor="middle" fill="#111" fontWeight={900}>{unitNumber}</text>
              </g>
            )}
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
            {tags?.length && pts.length > 0 ? (() => {
              // under the unit (below the transport chip): what is boosting or hampering it right now
              const maxY = Math.max(...pts.map((p, i) => p.y + ms[i].r)) + (u.transport && s.units.some((x) => x.embarkedIn === u.id && x.status === 'embarked') ? 1.9 : 0.75);
              return (
                <text x={cx} y={maxY} fontSize={Math.max(0.8, fs * 0.75)} textAnchor="middle" stroke="#000" strokeWidth={0.14} paintOrder="stroke" pointerEvents="none" fontWeight={800}>
                  {/* two tags under a unit, four under the selected one; the rest are counted */}
                  {tags.slice(0, isSel ? 4 : 2).map(([t, good], k) => <tspan key={k} fill={good ? '#86efac' : '#fca5a5'}>{k ? '  ' : ''}{t}</tspan>)}
                  {tags.length > (isSel ? 4 : 2) && <tspan fill="#fff">  +{tags.length - (isSel ? 4 : 2)}</tspan>}
                </text>
              );
            })() : null}
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
                <text x={0.35} y={0.27} fontSize={0.75} textAnchor="middle" fill="#f5d48a" fontWeight={800} letterSpacing={0.06}>{markRuleLabel(s, u.owner === 0 ? 1 : 0)}</text>
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
      {caps.map((c) => (
        <g key={c.k} pointerEvents="none">
          <circle cx={c.x} cy={c.y} r={0.8} fill="none" stroke={COLORS[c.p]} strokeWidth={0.35}>
            <animate attributeName="r" from="0.8" to="5.5" dur="1.2s" fill="freeze" />
            <animate attributeName="opacity" from="1" to="0" dur="1.2s" fill="freeze" />
          </circle>
          <circle cx={c.x} cy={c.y} r={1.2} fill={COLORS[c.p]} opacity={0.5}>
            <animate attributeName="opacity" from="0.6" to="0" dur="0.9s" fill="freeze" />
          </circle>
        </g>
      ))}
      {props.plan?.map((a, i) => {
        // stop the arrow short of the target's centre, and bend it a little so two arrows at one target stay apart
        const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, L = Math.hypot(dx, dy) || 1;
        const end = { x: a.to.x - (dx / L) * 1.4, y: a.to.y - (dy / L) * 1.4 };
        const mid = { x: (a.from.x + end.x) / 2 - (dy / L) * (1 + (i % 3)), y: (a.from.y + end.y) / 2 + (dx / L) * (1 + (i % 3)) };
        return (
          <g key={`plan${i}`} className="plan-arrow" pointerEvents="none">
            <path d={`M${a.from.x},${a.from.y} Q${mid.x},${mid.y} ${end.x},${end.y}`} fill="none" stroke="#f87171" strokeWidth={a.melee ? 0.32 : 0.22} strokeDasharray={a.melee ? undefined : '0.7 0.4'} markerEnd="url(#plan-head)" opacity={0.9} />
            <text x={mid.x} y={mid.y} fontSize={0.75} textAnchor="middle" fill="#fecaca" stroke="#000" strokeWidth={0.14} paintOrder="stroke" fontWeight={800}>{a.label}</text>
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
      <rect x={0} y={0} width={W} height={H} fill="none" stroke="#000" strokeWidth={0.15} pointerEvents="none" />
      {sides.map(({ p, at, cards }) => {
        const x = at === 'right' ? W + 1 : -SIDE - 0.5, y = at === 'bottom' ? H / 2 + 0.5 : 0, h = at === 'top' || at === 'bottom' ? H / 2 - 0.5 : H;
        return (
          <g key={p}>
            <rect x={x - 0.3} y={y - 0.3} width={SIDE - 0.1} height={h + 0.6} rx={0.6} fill="rgba(255,255,255,0.04)" stroke={p ? 'var(--p1)' : 'var(--p0)'} strokeOpacity={0.5} strokeWidth={0.08} />
            <foreignObject x={x} y={y} width={SIDE - 0.5} height={h}>
              <div className={`table-cards ${at}`} style={{ width: (SIDE - 0.5) * PX, height: h * PX, transform: `scale(${1 / PX})` }}>
                <div className={`table-head p${p}`}>{s.players[p].name} · army buffs</div>
                {cards}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
    <svg className="fx-overlay" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <FxLayer fx={fx} />
    </svg>
    </>
  );
}

/** Is this wall one of the edges of the piece's solid block (drawn as the block itself)? */
const onBoxEdge = (t: TerrainPiece, w: { a: Pt; b: Pt }) => !!t.box && [w.a, w.b].every((p) => t.box!.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.01));

/** The official footprint art (11e Battlezone punchboard) laid on a terrain piece: which plate, and the piece's
 *  oriented frame (along its longest edge) so the art lines up with the piece and is cropped, never stretched. */
const PLATES = { large: [682, 408], medium: [358, 235], stripShort: [355, 115], stripLong: [595, 143] } as const;
const PLATE_FILE: Record<keyof typeof PLATES, string> = { large: 'plate-large', medium: 'plate-medium', stripShort: 'strip-short', stripLong: 'strip-long' };
function plateFor(t: TerrainPiece): { href: string; ax: number; ay: number; ang: number; x: number; y: number; w: number; h: number } | null {
  const P = t.poly;
  if (P.length < 3) return null;
  let k = 0, best = 0;
  P.forEach((p, i) => { const d = dist(p, P[(i + 1) % P.length]); if (d > best) { best = d; k = i; } });
  const a = P[k], b = P[(k + 1) % P.length];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const us = P.map((p) => (p.x - a.x) * ux + (p.y - a.y) * uy), vs = P.map((p) => -(p.x - a.x) * uy + (p.y - a.y) * ux);
  const u0 = Math.min(...us), v0 = Math.min(...vs), L = Math.max(...us) - u0, Wd = Math.max(...vs) - v0;
  if (L < 0.5 || Wd < 0.3) return null;
  const strip = Wd < 1.8 && L / Wd > 2.2;
  const kind: keyof typeof PLATES = strip ? (P.length > 4 || L > 5 ? 'stripLong' : 'stripShort') : t.category === 'dense' ? 'large' : 'medium';
  return { href: `${IMAGE_BASE}terrain/${PLATE_FILE[kind]}.webp`, ax: a.x, ay: a.y, ang, x: u0, y: v0, w: L, h: Wd };
}

const PPI = 40; // backdrop pixels per inch (sharp enough when zoomed in on a phone)
const plateImgs = new Map<string, Promise<HTMLImageElement>>();
const loadImg = (href: string) => {
  let p = plateImgs.get(href);
  if (!p) {
    p = new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = href; });
    plateImgs.set(href, p);
  }
  return p;
};
/** The battlefield's ground and every terrain plate's footprint art, drawn once on a canvas: one picture under the
 *  board instead of dozens of clipped images that would be redrawn whenever a unit moves. Null until it is ready (or
 *  if the art can't be loaded — the plain plates are drawn then). */
function useBackdrop(terrain: TerrainPiece[], key: string, ground: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false, made: string | null = null;
    setUrl(null);
    (async () => {
      try {
        const c = document.createElement('canvas');
        c.width = Math.round(W * PPI); c.height = Math.round(H * PPI);
        const g = c.getContext('2d');
        if (!g) return;
        g.scale(PPI, PPI);
        g.fillStyle = '#5d5648'; g.fillRect(0, 0, W, H);
        if (ground) {
          const tile = await loadImg(ground);
          const pat = g.createPattern(tile, 'repeat');
          if (pat) { pat.setTransform(new DOMMatrix().scale(11 / tile.width, 11 / tile.height)); g.fillStyle = pat; g.fillRect(0, 0, W, H); }
        }
        for (const t of terrain) {
          if (t.kind === 'crater' || t.kind === 'barricade' || t.kind === 'container' || t.kind === 'objective-area') continue;
          const plate = plateFor(t);
          if (!plate) continue;
          const im = await loadImg(plate.href);
          g.save();
          g.beginPath(); t.poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
          g.fillStyle = t.category === 'dense' ? '#5a4a3a' : '#8a7d62'; g.fill();
          g.clip();
          g.translate(plate.ax, plate.ay); g.rotate(plate.ang);
          // cover the piece's frame, keeping the art's proportions (cropped, never stretched)
          const k = Math.max(plate.w / im.width, plate.h / im.height), dw = im.width * k, dh = im.height * k;
          g.drawImage(im, plate.x + (plate.w - dw) / 2, plate.y + (plate.h - dh) / 2, dw, dh);
          g.restore();
          if (t.category !== 'dense') {
            // light terrain reads a little paler than ruins
            g.save(); g.beginPath(); t.poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
            g.fillStyle = 'rgba(235,225,200,0.12)'; g.fill(); g.restore();
          }
        }
        const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
        if (!blob || dead) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      } catch { /* keep the plain plates */ }
    })();
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ground]);
  return url;
}

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

export const Board = memo(BoardImpl);
