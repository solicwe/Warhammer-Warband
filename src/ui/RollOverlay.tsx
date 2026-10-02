// Big centre-screen dice for rolls that matter (roll-offs, advance, charge, battle-shock).
import { useEffect, useRef, useState } from 'react';
import type { FxEvent, GameState } from '../engine/types';

type RollFx = Extract<FxEvent, { kind: 'roll' | 'rolloff' }>;

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

export function Die({ v, color, size = 76 }: { v: number; color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label={`ลูกเต๋า ${v}`}>
      <rect x="5" y="5" width="90" height="90" rx="18" fill="#f7f4ee" stroke={color ?? '#1a1a1a'} strokeWidth="6" />
      {(PIPS[v] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={v === 1 ? 11 : 8.5} fill={v === 1 ? '#b22222' : '#1a1a1a'} />)}
    </svg>
  );
}

const TUMBLE_MS = 650;
const SHOW_MS = { roll: 1900, rolloff: 3200 };
const COLORS = ['var(--p0)', 'var(--p1)'];

/** Tumbling dice that settle on the real values. */
function Dice({ values, color, landed, winner }: { values: number[]; color?: string; landed: boolean; winner?: boolean }) {
  const [faces, setFaces] = useState(values.map(() => 1 + Math.floor(Math.random() * 6)));
  useEffect(() => {
    if (landed) { setFaces(values); return; }
    const t = window.setInterval(() => setFaces(values.map(() => 1 + Math.floor(Math.random() * 6))), 70);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed, values.join(',')]);
  return (
    <div className={`ro-dice ${landed ? 'land' : 'tumble'} ${winner ? 'win' : ''}`}>
      {faces.map((v, i) => <span key={i} className="ro-die" style={{ animationDelay: `${i * 60}ms` }}><Die v={v} color={color} /></span>)}
    </div>
  );
}

export function RollOverlay({ s, onBusy }: { s: GameState; onBusy?: (busy: boolean) => void }) {
  // a brand-new game also shows the roll-off made while creating it
  const fresh = s.phase === 'deploy' && s.units.every((u) => u.status !== 'board');
  const seen = useRef(fresh ? 0 : s.fxSeq ?? 0);
  const [queue, setQueue] = useState<RollFx[]>([]);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if ((s.fxSeq ?? 0) < seen.current) { seen.current = s.fxSeq ?? 0; setQueue([]); return; } // undo
    const add = (s.fx ?? []).filter((e): e is RollFx => e.seq > seen.current && (e.kind === 'roll' || e.kind === 'rolloff'));
    seen.current = s.fxSeq ?? 0;
    if (add.length) setQueue((q) => [...q, ...add].slice(-4));
  }, [s.fx, s.fxSeq]);

  const cur = queue[0];
  useEffect(() => { onBusy?.(!!cur); }, [cur, onBusy]);
  useEffect(() => {
    if (!cur) return;
    setLanded(false);
    const a = window.setTimeout(() => setLanded(true), TUMBLE_MS);
    const b = window.setTimeout(() => setQueue((q) => q.slice(1)), SHOW_MS[cur.kind]);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [cur]);

  if (!cur) return null;
  const skip = () => setQueue((q) => q.slice(1));
  if (cur.kind === 'rolloff') {
    return (
      <div className="ro-backdrop" onClick={skip} role="dialog" aria-label={cur.title}>
        <div className={`ro-card ${landed ? 'hit' : ''}`}>
          <div className="ro-title">{cur.title}</div>
          <div className="ro-versus">
            {[0, 1].map((p) => (
              <div key={p} className={`ro-side ${landed && cur.winner === p ? 'won' : ''} ${landed && cur.winner !== p ? 'lost' : ''}`}>
                <div className="ro-name" style={{ color: COLORS[p] }}>{s.players[p].name}</div>
                <Dice values={[p === 0 ? cur.a : cur.b]} color={COLORS[p]} landed={landed} winner={landed && cur.winner === p} />
              </div>
            ))}
          </div>
          <div className={`ro-result ${landed ? 'show' : ''}`}>{cur.result}</div>
        </div>
      </div>
    );
  }
  const color = cur.owner === null ? undefined : COLORS[cur.owner];
  return (
    <div className="ro-backdrop light" onClick={skip} role="dialog" aria-label={cur.title}>
      <div className={`ro-card ${landed ? 'hit' : ''}`}>
        <div className="ro-title">{cur.title}</div>
        <Dice values={cur.dice} color={color} landed={landed} />
        <div className={`ro-result ${landed ? 'show' : ''} ${cur.good === false ? 'bad' : cur.good ? 'good' : ''}`}>
          {cur.dice.length > 1 && <span className="ro-sum">{cur.dice.join(' + ')} = {cur.dice.reduce((a, b) => a + b, 0)} · </span>}{cur.result}
        </div>
      </div>
    </div>
  );
}
