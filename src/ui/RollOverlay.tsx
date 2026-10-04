// Big centre-screen dice for rolls that matter (roll-offs, advance, charge, battle-shock).
import { useEffect, useRef, useState } from 'react';
import type { FxEvent, GameState } from '../engine/types';
import { dispositionById, MISSIONS, primaryById, secondaryById, type DispositionId } from '../engine/config';
import { Icon } from './Icon';

type RollFx = Extract<FxEvent, { kind: 'roll' | 'rolloff' | 'cards' | 'primary' }>;

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
const SHOW_MS = { roll: 1900, rolloff: 3200, cards: 4600, primary: 15000 };
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

export function RollOverlay({ s, onBusy, quick }: { s: GameState; onBusy?: (busy: boolean) => void; quick?: boolean }) {
  // a brand-new game also shows the roll-off made while creating it
  const fresh = s.phase === 'deploy' && s.units.every((u) => u.status !== 'board');
  const seen = useRef(fresh ? 0 : s.fxSeq ?? 0);
  const [queue, setQueue] = useState<RollFx[]>([]);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if ((s.fxSeq ?? 0) < seen.current) { seen.current = s.fxSeq ?? 0; setQueue([]); return; } // undo
    const add = (s.fx ?? []).filter((e): e is RollFx => e.seq > seen.current && (e.kind === 'roll' || e.kind === 'rolloff' || e.kind === 'cards' || e.kind === 'primary'));
    seen.current = s.fxSeq ?? 0;
    // when only bots play, skip the minor rolls so the overlay does not hide the game
    const shown = quick ? add.filter((e) => e.kind === 'rolloff' || e.kind === 'cards' || e.kind === 'primary' || e.title.startsWith('Charge')) : add;
    if (shown.length) setQueue((q) => [...q, ...shown].slice(-4));
  }, [s.fx, s.fxSeq]);

  const cur = queue[0];
  const landedAt = useRef(0);
  const [hold, setHold] = useState(0); // bumped when the player taps to see the result: restarts the close timer
  useEffect(() => { onBusy?.(!!cur); }, [cur, onBusy]);
  useEffect(() => {
    if (!cur) return;
    setLanded(false);
    setHold(0);
    const a = window.setTimeout(() => setLanded((was) => { if (!was) landedAt.current = Date.now(); return true; }), TUMBLE_MS);
    return () => window.clearTimeout(a);
  }, [cur]);
  useEffect(() => {
    if (!cur || !landed) return;
    // after the first tap the result stays up longer, so it is never missed
    const b = window.setTimeout(() => setQueue((q) => q.slice(1)), hold ? 4000 : quick ? 700 : SHOW_MS[cur.kind] - TUMBLE_MS);
    return () => window.clearTimeout(b);
  }, [cur, landed, hold, quick]);

  if (!cur) return null;
  // first tap: stop the tumble and show the numbers; next tap: close (ignoring an accidental double tap)
  const skip = () => {
    if (!landed) { landedAt.current = Date.now(); setLanded(true); setHold((h) => h + 1); return; }
    if (Date.now() - landedAt.current < 350) return;
    setHold(0);
    setQueue((q) => q.slice(1));
  };
  if (cur.kind === 'cards') {
    return (
      <div className="ro-backdrop" onClick={skip} role="dialog" aria-label="จั่วการ์ด Secondary">
        <div className="ro-card sec-draw">
          <div className="ro-title" style={{ color: COLORS[cur.owner] }}>{s.players[cur.owner].name} จั่ว Secondary</div>
          <div className="sec-hand">
            {cur.ids.map((id, i) => <SecondaryCard key={id} id={id} faceUp={landed} delay={i * 260} owner={cur.owner} />)}
          </div>
          <div className="ro-hint">{landed ? 'แตะเพื่อปิด · ดูการ์ดได้ตลอดที่ปุ่ม การ์ด ด้านบน' : 'แตะเพื่อเปิดการ์ดทันที'}</div>
        </div>
      </div>
    );
  }
  if (cur.kind === 'primary') {
    return (
      <div className="ro-backdrop" onClick={skip} role="dialog" aria-label="Primary Mission">
        <div className="ro-card sec-draw">
          <div className="ro-title">Primary Mission</div>
          <div className="sec-hand">
            {([0, 1] as const).map((p, i) => <PrimaryCard key={p} s={s} owner={p} faceUp={landed} delay={i * 260} />)}
          </div>
          <div className="ro-hint">{landed ? 'แตะเพื่อปิด · ดูได้ตลอดที่ปุ่ม การ์ด ด้านบน' : 'แตะเพื่อเปิดการ์ดทันที'}</div>
        </div>
      </div>
    );
  }
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
          <div className="ro-hint">{landed ? 'แตะเพื่อปิด' : 'แตะเพื่อดูผลทันที'}</div>
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
        <div className="ro-hint">{landed ? 'แตะเพื่อปิด' : 'แตะเพื่อดูผลทันที'}</div>
      </div>
    </div>
  );
}

/** A secondary mission card: face down it shows the back, face up its name, when it scores and how. */
export function SecondaryCard({ id, faceUp = true, delay = 0, owner, progress, dead }: { id: string; faceUp?: boolean; delay?: number; owner?: 0 | 1; progress?: string; dead?: boolean }) {
  const def = secondaryById(id);
  return (
    <div className={`sec-card ${faceUp ? 'up' : ''} ${owner === 1 ? 'p1' : 'p0'}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="sec-face sec-back"><Icon name="objective" size={42} /><span>SECONDARY</span></div>
      <div className="sec-face sec-front">
        <div className="sec-name">{def.name}</div>
        <div className="sec-when"><Icon name="wait" size={13} /> {def.when}</div>
        <div className="sec-text">{def.text}</div>
        {progress && <div className={`sec-progress ${dead ? 'dead' : ''}`}>{progress}</div>}
      </div>
    </div>
  );
}

const WHEN_TH: Record<string, string> = { endOfYourTurn: 'จบเทิร์นตัวเอง', endOfYourCommandPhase: 'จบ Command phase (รอบ 5: จบเทิร์น)', endOfBattle: 'จบเกม', endOfAnyTurn: 'จบทุกเทิร์น' };

/** A player's Primary Mission card: its name, their Force Disposition, how and when it scores, its action. */
export function PrimaryCard({ s, owner, faceUp = true, delay = 0 }: { s: GameState; owner: 0 | 1; faceUp?: boolean; delay?: number }) {
  const P = s.players[owner];
  const prim = primaryById(P.primaryId);
  const disp = dispositionById(P.disposition as DispositionId);
  const act = prim.action ? MISSIONS.actions[prim.action] : undefined;
  return (
    <div className={`sec-card prim-card ${faceUp ? 'up' : ''} ${owner === 1 ? 'p1' : 'p0'}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="sec-face sec-back"><Icon name="objective" size={42} /><span>PRIMARY</span></div>
      <div className="sec-face sec-front">
        <div className="prim-who" style={{ color: owner ? 'var(--p1)' : 'var(--p0)' }}>{P.name}</div>
        <div className="sec-name">{prim.name}</div>
        <span className="disp-chip" style={{ background: disp.color }}>{disp.name}</span>
        <div className="sec-text">
          {prim.scoring.map((r) => (
            <div key={r.text + r.rounds} className="prim-rule">
              <div className="sec-when"><Icon name="wait" size={12} /> {r.rounds[0] === r.rounds[1] ? `รอบ ${r.rounds[0]}` : r.rounds[0] === 1 && r.rounds[1] === 5 ? 'ทุกรอบ' : `รอบ ${r.rounds[0]}–${r.rounds[1]}`} · {WHEN_TH[r.when] ?? r.when}</div>
              <div>{r.text} {!r.tiers && <b>{r.vp} VP</b>}{r.bonus ? <span> · {r.bonusText ?? ''} (+{r.bonus.vp})</span> : null}</div>
            </div>
          ))}
          {act && <div className="prim-rule"><b>Action: {act.name}</b> — {act.text}</div>}
        </div>
      </div>
    </div>
  );
}
