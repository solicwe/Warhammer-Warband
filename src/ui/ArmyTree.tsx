// The army tree in the campaign roster: the graph to scroll around, and a card for the node you tap with what it does,
// which of your units it reaches, and Allocate (1 Renown) or Refund (Scrap, at an armory or medicae tent).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Run } from '../engine/campaign';
import {
  allocate, atRespecSpot, branchName, canAllocate, canRefund, refund, refundCost, slotGuide, taken, treeFor, unitsReached, type TreeNode,
} from '../engine/campaignTree';
import type { FactionData } from '../engine/types';

const RADIUS: Record<TreeNode['kind'], number> = { start: 15, small: 9, notable: 13, keystone: 17 };
const KIND_LABEL: Record<TreeNode['kind'], string> = { start: 'Start', small: 'Node', notable: 'Notable', keystone: 'Keystone' };
const PAD = 40;

export function ArmyTree({ run, fac, onRun, onInfo }: { run: Run; fac: FactionData; onRun: (r: Run) => void; onInfo: (t: string) => void }) {
  const nodes = treeFor(run.factionId);
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
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
      <div className="tree-map" ref={box}>
        <svg width={size} height={size} viewBox={`${-ext} ${-ext} ${size} ${size}`} role="img" aria-label="Army tree">
          {edges.map(([a, b]) => (
            <line key={`${a.id}-${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`tree-edge ${got.has(a.id) && got.has(b.id) ? 'taken' : got.has(a.id) || got.has(b.id) ? 'open' : ''}`} />
          ))}
          {nodes.map((n) => (
            <g key={n.id} className={`tree-node ${n.kind} ${state(n)} ${sel === n.id ? 'sel' : ''}`} onClick={() => setSel(n.id)} role="button" aria-label={n.name}>
              {n.kind === 'keystone'
                ? <rect x={n.x - RADIUS.keystone} y={n.y - RADIUS.keystone} width={RADIUS.keystone * 2} height={RADIUS.keystone * 2} rx={4} transform={`rotate(45 ${n.x} ${n.y})`} />
                : <circle cx={n.x} cy={n.y} r={RADIUS[n.kind]} />}
              {n.kind !== 'small' && <text x={n.x} y={n.y + RADIUS[n.kind] + 13} textAnchor="middle">{n.name}</text>}
            </g>
          ))}
          {guide.map((g) => <text key={g.id} x={g.x} y={g.y} textAnchor="middle" dominantBaseline="middle" className="tree-slot-label">{g.name}</text>)}
        </svg>
      </div>
      {node && (
        <div className={`tree-card ${node.kind}`}>
          <div className="tree-card-head">
            <b>{node.name}</b>
            <span className="tree-chip">{KIND_LABEL[node.kind]} · {slotName(node)}</span>
          </div>
          <div className="tree-text">{node.text}</div>
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
          {node.kind !== 'start' && (got.has(node.id) ? (
            <button type="button" className="btn small" disabled={!canRefund(run, node.id)} onClick={() => { onRun(refund(run, node.id)); onInfo(`Refunded ${node.name}`); }}>
              {!atRespecSpot(run) ? 'Refund at an armory or medicae tent' : canRefund(run, node.id) ? `Refund (${refundCost(run)} Scrap)` : run.scrap < refundCost(run) ? `Refund needs ${refundCost(run)} Scrap` : 'Other nodes depend on it'}
            </button>
          ) : (
            <button type="button" className="btn small primary" disabled={!canAllocate(run, node.id)} onClick={() => { onRun(allocate(run, node.id)); onInfo(`${node.name} taken`); }}>
              {canAllocate(run, node.id) ? 'Allocate (1 Renown)' : !node.links.some((l) => got.has(l)) ? 'Take a linked node first' : 'Needs 1 Renown'}
            </button>
          ))}
        </div>
      )}
      <div className="tree-guide">
        <div className="cmp-kicker">What each spoke does</div>
        {guide.map((g) => (
          <button key={g.id} type="button" className={`tree-guide-row ${node?.slot === g.id ? 'on' : ''}`} onClick={() => setSel(`${g.id}-1`)}>
            <span className="tree-guide-head"><b>{g.name}</b><span className="num">{counts[g.id] ?? 0}/{nodes.filter((n) => n.slot === g.id).length}</span></span>
            <span className="tree-guide-about">{g.id === 'army' ? 'Your army\'s own branch. ' : ''}{g.about}</span>
          </button>
        ))}
        <div className="tree-guide-row static">
          <span className="tree-guide-head"><b>Rings</b></span>
          <span className="tree-guide-about">The inner ring links neighbouring spokes halfway out. The outer ring holds keystones that make one keyword count as another (INFANTRY as VEHICLE and so on). Circles are small nodes, big circles notables, diamonds keystones.</span>
        </div>
      </div>
    </div>
  );
}
