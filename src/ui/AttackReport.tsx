// The attack told like a scoring hand in Balatro: the count climbs stage by stage (shots → hits → wounds → through
// the saves), every rule that changed the odds lights up at the stage where it acts, then the result lands with a
// thump that grows with what was destroyed — and how lucky the dice were against the average.
import { useEffect, useRef, useState } from 'react';
import type { AttackReport as Report, FxEvent, GameState, PlayerId } from '../engine/types';
import { play } from './sfx';

type AttackFx = Extract<FxEvent, { kind: 'attack' }> & { report: Report };

interface Props {
  s: GameState;
  /** quicker telling (the bot's attacks, bot-vs-bot) */
  quick: (owner: PlayerId) => boolean;
  /** how hard the board shakes when the result lands (0 none … 3 a unit destroyed) */
  onShake: (level: number) => void;
  /** a report is on screen: the bot waits, so what is told and what happens stay together */
  onBusy: (busy: boolean) => void;
  /** effects level the player chose: 'full', 'short' (result only) or 'off' */
  level: 'full' | 'short' | 'off';
}

const STAGES = ['attacks', 'hit', 'wound', 'save'] as const;

export function AttackReport({ s, quick, onShake, onBusy, level }: Props) {
  const seen = useRef(s.fxSeq ?? 0);
  const [queue, setQueue] = useState<AttackFx[]>([]);
  const [cur, setCur] = useState<{ e: AttackFx; t0: number } | null>(null);
  const [now, setNow] = useState(0);

  // new attacks join the queue (an undo winds the counter back)
  useEffect(() => {
    if (s.fxSeq !== undefined && s.fxSeq < seen.current) { seen.current = s.fxSeq; setQueue([]); setCur(null); return; }
    const fresh = (s.fx ?? []).filter((e): e is AttackFx => e.seq > seen.current && e.kind === 'attack' && !!(e as AttackFx).report);
    const top = Math.max(seen.current, ...(s.fx ?? []).map((e) => e.seq));
    seen.current = top;
    if (fresh.length && level !== 'off') setQueue((q) => [...q, ...fresh]);
  }, [s.fx, s.fxSeq, level]);

  const fast = cur ? quick(cur.e.owner) : false;
  const step = level === 'short' ? 0 : fast ? 110 : 230; // ms per stage
  const stages = level === 'short' ? 0 : STAGES.length;
  const resultAt = stages * step + (level === 'short' ? 0 : 120);
  const hold = fast ? 900 : 1500;
  const total = resultAt + hold;

  // the next report starts when the last one is done
  useEffect(() => {
    if (cur || !queue.length) return;
    const [e, ...rest] = queue;
    setQueue(rest);
    setCur({ e, t0: performance.now() });
  }, [cur, queue]);

  useEffect(() => { onBusy(!!cur); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // the clock: sounds and the shake fire once at the moment their stage is reached
  const fired = useRef(-1);
  useEffect(() => {
    if (!cur) return;
    fired.current = -1;
    let raf = 0;
    const tick = () => {
      const t = performance.now() - cur.t0;
      setNow(t);
      const reached = t >= resultAt ? stages : Math.min(stages - 1, Math.floor(t / Math.max(1, step)));
      while (fired.current < reached) {
        fired.current++;
        const r = cur.e.report;
        if (fired.current < stages) play(fired.current === 0 ? 'dice' : 'tick', fired.current + 1);
        else {
          if (r.destroyed) play('destroy');
          else if (r.killed) play('kill', 0, Math.min(1, r.pts / 200));
          else play('bad');
          onShake(r.destroyed ? 3 : r.pts >= 100 ? 2 : r.killed ? 1 : 0);
        }
      }
      if (t >= total) { setCur(null); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) return null;
  const r = cur.e.report;
  const fight = cur.e.attackKind === 'fight';
  const t = now;
  const at = (i: number) => t >= i * step;
  const shown = (i: number) => Math.min(1, Math.max(0, (t - i * step) / Math.max(1, step * 0.9)));
  const vals = [r.shots, r.hits, r.wounds, r.unsaved];
  const labels = [fight ? 'Attacks' : 'Shots', 'Hits', 'Wounds', 'Through'];
  const landed = t >= resultAt;
  const luck = r.expected >= 0.3 ? (r.killed - r.expected) / r.expected : null;
  const luckTag = luck === null ? null : luck >= 0.25 ? { cls: 'up', text: `Lucky +${Math.round(luck * 100)}%` } : luck <= -0.25 ? { cls: 'down', text: `Unlucky ${Math.round(luck * 100)}%` } : { cls: 'even', text: 'As expected' };
  const out = t > total - 220;
  return (
    <div className={`atk-report o${cur.e.owner} ${out ? 'out' : ''} ${fast ? 'fast' : ''}`} role="status" aria-live="polite" onClick={() => setCur(null)}>
      <div className="atk-head">
        <b className={cur.e.owner ? 'p1' : 'p0'}>{r.attacker}</b>
        <span className="atk-arrow" aria-hidden="true">{fight ? '⚔' : '➜'}</span>
        <b className={cur.e.owner ? 'p0' : 'p1'}>{r.target}</b>
      </div>
      {stages > 0 && (
        <div className="atk-stages">
          {vals.map((v, i) => (
            <div key={labels[i]} className={`atk-stage ${at(i) ? 'on' : ''}`}>
              <span className="atk-n num">{at(i) ? Math.round(v * shown(i)) : '–'}</span>
              <span className="atk-l">{labels[i]}</span>
            </div>
          ))}
        </div>
      )}
      {stages > 0 && r.chips.length > 0 && (
        <div className="atk-chips">
          {r.chips.map((c) => {
            const i = STAGES.indexOf(c.stage);
            return <span key={c.label} className={`atk-chip ${at(i) ? 'lit' : ''} ${at(i) && !at(i + 1) ? 'pop' : ''}`}>{c.label}</span>;
          })}
        </div>
      )}
      <div className={`atk-result ${landed ? 'land' : ''} ${r.destroyed ? 'dead' : r.killed ? 'kill' : 'none'}`}>
        {landed && (r.destroyed ? <>Unit destroyed<small>{r.pts} pts</small></> : r.killed ? <><span className="num">{r.killed}</span> slain<small>{r.pts ? `${r.pts} pts` : `${r.dmg} damage`}</small></> : r.dmg ? <><span className="num">{r.dmg}</span> damage<small>no model slain</small></> : <>No damage</>)}
        {landed && luckTag && <span className={`atk-luck ${luckTag.cls}`}>{luckTag.text}</span>}
      </div>
    </div>
  );
}
