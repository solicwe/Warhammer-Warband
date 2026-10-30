// The army tree in the campaign roster: the whole tree in one view to drag and zoom (fingers, mouse or wheel), and a
// card for the node you tap with what it does and Allocate (1 Renown) or Refund (Scrap, at an armory or medicae tent).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Run } from '../engine/campaign';
import {
  allocate, atRespecSpot, canAllocate, canRefund, refund, refundCost, slotGuide, taken, treeFor, type TreeNode,
} from '../engine/campaignTree';
import type { Effect } from '../rules-engine/effects';
import { Icon, SvgIcon, type IconName } from './Icon';

const RADIUS: Record<TreeNode['kind'], number> = { start: 16, small: 11, notable: 15, keystone: 18 };
const ICON_SIZE: Record<TreeNode['kind'], number> = { start: 20, small: 14, notable: 18, keystone: 20 };
const PAD = 40;
/** zoom limits, as multiples of the zoom that fits the whole tree */
const MIN_K = 0.8, MAX_K = 6;
/** a press that moves less than this is a tap */
const TAP = 8;

/** What a node is about at a glance: shooting, melee, defence, movement, OC, CP, Scrap ... */
function iconOf(n: TreeNode): IconName {
  if (n.kind === 'start') return 'leader';
  if (n.titan) return 'trophy';
  if (n.as) return 'duplicate';
  if (n.cp) return 'strat';
  if (n.scrap && !n.e) return 'shop';
  const e: Effect = (Array.isArray(n.e) ? n.e[0] : n.e) ?? {};
  if (e.defend || e.toughness) return 'shield';
  if (e.attack === 'ranged' || e.rangeBonus) return 'shoot';
  if (e.attack === 'melee') return 'fight';
  if (e.chargeBonus || e.rerollCharge) return 'charge';
  if (e.move || e.advanceBonus || e.rerollAdvance) return 'move';
  if (e.oc) return 'objective';
  if (e.rerollShock) return 'shock';
  if (e.critHitOn) return 'zap';
  return 'crosshair';
}
const KIND_LABEL: Record<TreeNode['kind'], string> = { start: 'Start', small: 'Node', notable: 'Notable', keystone: 'Keystone' };

/** The view: tree point (cx, cy) at the middle of the box, k screen pixels per tree unit. */
interface View { cx: number; cy: number; k: number }

export function ArmyTree({ run, onRun, onInfo }: { run: Run; onRun: (r: Run) => void; onInfo: (t: string) => void }) {
  const nodes = treeFor(run.factionId);
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const got = taken(run);
  const node = nodes.find((n) => n.id === sel);
  const guide = slotGuide(run.factionId);
  const ext = Math.max(...[...nodes, ...guide].map((n) => Math.max(Math.abs(n.x), Math.abs(n.y)))) + PAD;
  const fitK = dim.w && dim.h ? Math.min(dim.w, dim.h) / (ext * 2) : 1;
  const counts = useMemo(() => nodes.filter((n) => got.has(n.id)).reduce<Record<string, number>>((a, n) => ({ ...a, [n.slot]: (a[n.slot] ?? 0) + 1 }), {}), [run.tree]);

  // the map takes the screen height left under it (above the roster's footer)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const foot = document.querySelector('.cmp-armory-footer')?.getBoundingClientRect().height ?? 0;
      el.style.height = `${Math.max(300, window.innerHeight - el.getBoundingClientRect().top - foot - 12)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  // the box's size, and the whole tree fitted in it to start with
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDim({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (dim.w && !view) setView({ cx: 0, cy: 0, k: fitK }); }, [dim.w, dim.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = view ?? { cx: 0, cy: 0, k: fitK };
  const viewRef = useRef(v);
  viewRef.current = v;
  // several pointer events can come before the next render: each one builds on the last, not on the rendered view
  const apply = (nv: View) => { viewRef.current = nv; setView(nv); };
  const clamp = (nv: View): View => {
    const k = Math.min(fitK * MAX_K, Math.max(fitK * MIN_K, nv.k));
    return { k, cx: Math.max(-ext, Math.min(ext, nv.cx)), cy: Math.max(-ext, Math.min(ext, nv.cy)) };
  };
  /** zoom by `f` keeping the tree point under screen point (px, py) where it is */
  const zoomAt = (cur: View, f: number, px: number, py: number): View => {
    const k = Math.min(fitK * MAX_K, Math.max(fitK * MIN_K, cur.k * f));
    const tx = cur.cx + (px - dim.w / 2) / cur.k, ty = cur.cy + (py - dim.h / 2) / cur.k;
    return clamp({ k, cx: tx - (px - dim.w / 2) / k, cy: ty - (py - dim.h / 2) / k });
  };

  // one finger or the mouse drags, two fingers pinch around their middle, the wheel zooms at the pointer, a still press taps
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let downAt: { x: number; y: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pair = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
    let last: { d: number; m: { x: number; y: number } } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) { moved = 0; downAt = local(e); }
      last = pts.size === 2 ? pair() : null;
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (downAt) moved = Math.max(moved, Math.hypot(p.x - downAt.x, p.y - downAt.y));
      if (pts.size === 1 && moved >= TAP) {
        const cur = viewRef.current;
        apply(clamp({ ...cur, cx: cur.cx - (p.x - prev.x) / cur.k, cy: cur.cy - (p.y - prev.y) / cur.k }));
        el.classList.add('dragging');
      } else if (pts.size === 2 && last) {
        const now = pair();
        moved = TAP;
        // the tree point that was under the fingers' middle follows it, then the zoom happens around it
        const cur = viewRef.current;
        const panned = { ...cur, cx: cur.cx - (now.m.x - last.m.x) / cur.k, cy: cur.cy - (now.m.y - last.m.y) / cur.k };
        apply(zoomAt(panned, now.d / last.d, now.m.x, now.m.y));
        last = now;
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        el.classList.remove('dragging');
        if (moved < TAP && e.type === 'pointerup') {
          const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-node]');
          setSel(hit ? hit.getAttribute('data-node') : null);
        }
        downAt = null;
      }
      last = pts.size === 2 ? pair() : null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      apply(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.0015), p.x, p.y));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel);
    };
  }, [dim.w, dim.h, fitK]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges = nodes.flatMap((n) => n.links.filter((l) => l > n.id).map((l) => [n, nodes.find((m) => m.id === l)!] as const));
  const state = (n: TreeNode) => (got.has(n.id) ? 'taken' : n.links.some((l) => got.has(l)) ? 'open' : 'locked');
  const slotOf = (n: TreeNode) => guide.find((g) => g.id === n.slot);
  const slotName = (n: TreeNode) => slotOf(n)?.name ?? (n.slot === 'ring' ? 'Ring' : 'Start');
  const vw = dim.w / v.k, vh = dim.h / v.k;
  const zoomBy = (f: number) => setView(zoomAt(v, f, dim.w / 2, dim.h / 2));

  return (
    <div className="tree">
      <div className="tree-bar">
        <span><b className="num">{run.renown ?? 0}</b> Renown</span>
        <span><b className="num">{got.size - 1}</b> / {nodes.length - 1} nodes</span>
        <span className="tree-legend"><i className="taken" /> taken <i className="open" /> can take</span>
      </div>
      <div className="tree-stage">
        <div className="tree-map" ref={box}>
          {dim.w > 0 && (
            <svg width={dim.w} height={dim.h} viewBox={`${v.cx - vw / 2} ${v.cy - vh / 2} ${vw} ${vh}`} role="img" aria-label="Army tree">
              {edges.map(([a, b]) => (
                <line key={`${a.id}-${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`tree-edge ${got.has(a.id) && got.has(b.id) ? 'taken' : got.has(a.id) || got.has(b.id) ? 'open' : ''}`} />
              ))}
              {nodes.map((n) => (
                <g key={n.id} data-node={n.id} className={`tree-node ${n.kind} ${state(n)} ${sel === n.id ? 'sel' : ''}`} role="button" aria-label={n.name}>
                  {n.kind === 'keystone'
                    ? <rect x={n.x - RADIUS.keystone} y={n.y - RADIUS.keystone} width={RADIUS.keystone * 2} height={RADIUS.keystone * 2} rx={4} transform={`rotate(45 ${n.x} ${n.y})`} />
                    : <circle cx={n.x} cy={n.y} r={RADIUS[n.kind]} />}
                  <g className="tree-ico"><SvgIcon name={iconOf(n)} x={n.x} y={n.y} size={ICON_SIZE[n.kind]} /></g>
                  {n.kind !== 'small' && <text x={n.x} y={n.y + RADIUS[n.kind] + 13} textAnchor="middle">{n.name}</text>}
                </g>
              ))}
              {guide.map((g) => <text key={g.id} x={g.x} y={g.y} textAnchor="middle" dominantBaseline="middle" className="tree-slot-label">{g.name}</text>)}
            </svg>
          )}
        </div>
        <div className="tree-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.4)}><Icon name="plus" size={18} /></button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}><span aria-hidden="true">-</span></button>
          <button type="button" aria-label="Show the whole tree" onClick={() => setView({ cx: 0, cy: 0, k: fitK })}><Icon name="target" size={18} /></button>
        </div>
        {node && (
          // the tapped node's card sits over the bottom of the map; taking a node closes it
          <div className="tree-card">
            <div className="tree-card-head">
              <b><Icon name={iconOf(node)} size={16} /> {node.name}</b>
              <span className="tree-chip">{KIND_LABEL[node.kind]} · {slotName(node)}</span>
              <button type="button" className="tree-card-x" aria-label="Close" onClick={() => setSel(null)}><Icon name="close" size={16} /></button>
            </div>
            <div className="tree-text">{node.text}</div>
            {node.bonus && (
              <div className={`tree-bonus ${(counts[node.slot] ?? 0) >= node.bonus.count && got.has(node.id) ? 'on' : ''}`}>
                {node.bonus.text} <span className="num">({Math.min(counts[node.slot] ?? 0, node.bonus.count)}/{node.bonus.count})</span>
              </div>
            )}
            {node.kind !== 'start' && (got.has(node.id) ? (
              <button type="button" className="btn small" disabled={!canRefund(run, node.id)} onClick={() => { onRun(refund(run, node.id)); onInfo(`Refunded ${node.name}`); setSel(null); }}>
                {!atRespecSpot(run) ? 'Refund at an armory or medicae tent' : canRefund(run, node.id) ? `Refund (${refundCost(run)} Scrap)` : run.scrap < refundCost(run) ? `Refund needs ${refundCost(run)} Scrap` : 'Other nodes depend on it'}
              </button>
            ) : (
              <button type="button" className="btn small primary" disabled={!canAllocate(run, node.id)} onClick={() => { onRun(allocate(run, node.id)); onInfo(`${node.name} taken`); setSel(null); }}>
                {canAllocate(run, node.id) ? 'Allocate (1 Renown)' : !node.links.some((l) => got.has(l)) ? 'Take a linked node first' : 'Needs 1 Renown'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
