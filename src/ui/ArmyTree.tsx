// The army tree in the campaign roster: the graph to scroll around, and a card for the node you tap with what it does,
// which of your units it reaches, and Allocate (1 Renown) or Refund (Scrap, at an armory or medicae tent).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Run } from '../engine/campaign';
import {
  allocate, atRespecSpot, branchName, canAllocate, canRefund, refund, refundCost, slotGuide, taken, treeFor, unitsReached, type TreeNode,
} from '../engine/campaignTree';
import type { FactionData } from '../engine/types';
import type { Effect } from '../rules-engine/effects';
import { Icon, SvgIcon, type IconName } from './Icon';

const RADIUS: Record<TreeNode['kind'], number> = { start: 16, small: 11, notable: 15, keystone: 18 };
const ICON_SIZE: Record<TreeNode['kind'], number> = { start: 20, small: 14, notable: 18, keystone: 20 };
const ZOOMS = [0.35, 0.5, 0.65, 0.8, 1, 1.25];
const MIN_ZOOM = 0.3, MAX_ZOOM = 1.5;

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
const PAD = 40;

export function ArmyTree({ run, fac, onRun, onInfo }: { run: Run; fac: FactionData; onRun: (r: Run) => void; onInfo: (t: string) => void }) {
  const nodes = treeFor(run.factionId);
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.65);
  const prevZoom = useRef(zoom);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const got = taken(run);
  const node = nodes.find((n) => n.id === sel);
  const guide = slotGuide(run.factionId);
  const ext = Math.max(...[...nodes, ...guide].map((n) => Math.max(Math.abs(n.x), Math.abs(n.y)))) + PAD;
  const size = ext * 2;
  const counts = useMemo(() => nodes.filter((n) => got.has(n.id)).reduce<Record<string, number>>((a, n) => ({ ...a, [n.slot]: (a[n.slot] ?? 0) + 1 }), {}), [run.tree]);

  // open on the centre of the tree
  useEffect(() => {
    const el = box.current;
    if (el) { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; }
  }, []);
  // zooming keeps the same spot in the middle of the view
  useLayoutEffect(() => {
    const el = box.current;
    const k = zoom / prevZoom.current;
    prevZoom.current = zoom;
    if (!el || k === 1) return;
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * k - el.clientWidth / 2;
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * k - el.clientHeight / 2;
  }, [zoom]);
  // two fingers on the map (or on the card over it) zoom it
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let start: { d: number; z: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const down = (e: TouchEvent) => { if (e.touches.length === 2) start = { d: dist(e.touches), z: prevZoom.current }; };
    const move = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.z * (dist(e.touches) / start.d))));
    };
    const up = (e: TouchEvent) => { if (e.touches.length < 2) start = null; };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    return () => { el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', up); };
  }, []);
  const zoomOut = ZOOMS.filter((z) => z < zoom - 0.01).pop();
  const zoomIn = ZOOMS.find((z) => z > zoom + 0.01);

  const edges = nodes.flatMap((n) => n.links.filter((l) => l > n.id).map((l) => [n, nodes.find((m) => m.id === l)!] as const));
  const state = (n: TreeNode) => (got.has(n.id) ? 'taken' : n.links.some((l) => got.has(l)) ? 'open' : 'locked');
  const slotOf = (n: TreeNode) => guide.find((g) => g.id === n.slot);
  const slotName = (n: TreeNode) => slotOf(n)?.name ?? (n.slot === 'ring' ? 'Ring' : 'Start');
  const reached = node ? unitsReached(run, fac.datasheets, node) : [];
  const affects = !!node && (!!node.e || !!node.bonus?.e);

  return (
    <div className="tree">
      <div className="cmp-armory-hint">
        <b>Army tree</b> · {branchName(run.factionId)}: each Renown point takes one node next to one you have. Nodes reach units by keyword. Win battles for Renown (battle 3, elite 5, boss 6, a loss 1).
      </div>
      <div className="tree-bar">
        <span><b className="num">{run.renown ?? 0}</b> Renown</span>
        <span><b className="num">{got.size - 1}</b> / {nodes.length - 1} nodes</span>
        <span className="tree-legend"><i className="taken" /> taken <i className="open" /> can take</span>
      </div>
      <div className="tree-zoom">
        <button type="button" className="btn small" aria-label="Zoom out" disabled={!zoomOut} onClick={() => zoomOut && setZoom(zoomOut)}>-</button>
        <span className="num">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn small" aria-label="Zoom in" disabled={!zoomIn} onClick={() => zoomIn && setZoom(zoomIn)}><Icon name="plus" size={14} /></button>
      </div>
      <div className="tree-stage" ref={stage}>
      <div className="tree-map" ref={box}>
        <svg width={size * zoom} height={size * zoom} viewBox={`${-ext} ${-ext} ${size} ${size}`} role="img" aria-label="Army tree">
          {edges.map(([a, b]) => (
            <line key={`${a.id}-${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`tree-edge ${got.has(a.id) && got.has(b.id) ? 'taken' : got.has(a.id) || got.has(b.id) ? 'open' : ''}`} />
          ))}
          {nodes.map((n) => (
            <g key={n.id} className={`tree-node ${n.kind} ${state(n)} ${sel === n.id ? 'sel' : ''}`} onClick={() => setSel(n.id)} role="button" aria-label={n.name}>
              {n.kind === 'keystone'
                ? <rect x={n.x - RADIUS.keystone} y={n.y - RADIUS.keystone} width={RADIUS.keystone * 2} height={RADIUS.keystone * 2} rx={4} transform={`rotate(45 ${n.x} ${n.y})`} />
                : <circle cx={n.x} cy={n.y} r={RADIUS[n.kind]} />}
              <g className="tree-ico"><SvgIcon name={iconOf(n)} x={n.x} y={n.y} size={ICON_SIZE[n.kind]} /></g>
              {n.kind !== 'small' && <text x={n.x} y={n.y + RADIUS[n.kind] + 13} textAnchor="middle">{n.name}</text>}
            </g>
          ))}
          {guide.map((g) => <text key={g.id} x={g.x} y={g.y} textAnchor="middle" dominantBaseline="middle" className="tree-slot-label">{g.name}</text>)}
        </svg>
      </div>
      {node && (
        // the tapped node's card floats over the top of the map, so it shows up where you tapped, its button first
        <div className={`tree-card ${node.kind}`}>
          <div className="tree-card-head">
            <b><Icon name={iconOf(node)} size={16} /> {node.name}</b>
            <span className="tree-chip">{KIND_LABEL[node.kind]} · {slotName(node)}</span>
            <button type="button" className="tree-card-x" aria-label="Close" onClick={() => setSel(null)}><Icon name="close" size={16} /></button>
          </div>
          <div className="tree-text">{node.text}</div>
          {node.kind !== 'start' && (got.has(node.id) ? (
            <button type="button" className="btn small" disabled={!canRefund(run, node.id)} onClick={() => { onRun(refund(run, node.id)); onInfo(`Refunded ${node.name}`); }}>
              {!atRespecSpot(run) ? 'Refund at an armory or medicae tent' : canRefund(run, node.id) ? `Refund (${refundCost(run)} Scrap)` : run.scrap < refundCost(run) ? `Refund needs ${refundCost(run)} Scrap` : 'Other nodes depend on it'}
            </button>
          ) : (
            <button type="button" className="btn small primary" disabled={!canAllocate(run, node.id)} onClick={() => { onRun(allocate(run, node.id)); onInfo(`${node.name} taken`); }}>
              {canAllocate(run, node.id) ? 'Allocate (1 Renown)' : !node.links.some((l) => got.has(l)) ? 'Take a linked node first' : 'Needs 1 Renown'}
            </button>
          ))}
          {slotOf(node) && <div className="tree-reach">{slotOf(node)!.name}: {slotOf(node)!.about}</div>}
          {node.slot === 'ring' && <div className="tree-reach">{node.kind === 'keystone' ? 'Outer ring: a keystone between two spokes that makes one keyword count as another for tree nodes.' : 'Inner ring: a bridge between two spokes, so a build can cross over halfway out.'}</div>}
          {node.bonus && (
            <div className={`tree-bonus ${(counts[node.slot] ?? 0) >= node.bonus.count && got.has(node.id) ? 'on' : ''}`}>
              {node.bonus.text} <span className="num">({Math.min(counts[node.slot] ?? 0, node.bonus.count)}/{node.bonus.count})</span>
            </div>
          )}
          {affects && (
            <div className="tree-reach">
              {reached.length ? `Applies to ${reached.length} ${reached.length === 1 ? 'unit' : 'units'}: ${[...new Set(reached.map((u) => u.datasheet))].join(', ')}` : 'Applies to none of your units right now.'}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
