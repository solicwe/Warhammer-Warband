// The attack told like a scoring hand in Balatro: the count climbs stage by stage (shots → hits → wounds → through
// the saves), every rule that changed the odds lights up at the stage where it acts, then the result lands with a
// thump that grows with what was destroyed.
import { memo, useEffect, useRef, useState } from 'react';
import type { AttackReport as Report, FxEvent, GameState, PlayerId, UnitState } from '../engine/types';
import { Icon } from './Icon';
import { modelPortraitKey } from './portraits';
import { play } from './sfx';
import { Portrait, unitToken } from './Tokens';

/** A unit's face: its leader's picture (the unit's own when the leader has none); a red cross when it is wiped out. */
const UnitFace = memo(function UnitFace({ u, dead }: { u: UnitState | undefined; dead?: boolean }) {
  if (!u) return <span className="atk-face" />;
  const lead = u.models.find((m) => m.isCharacter) ?? u.models[0];
  return (
    <span className={`atk-face s${u.owner} ${dead ? 'dead' : ''}`}>
      <Portrait kind={unitToken(u)} owner={u.owner} character={u.models.some((m) => m.isCharacter)} size={24}
        datasheet={lead?.name && lead?.name !== lead?.source ? modelPortraitKey(lead.source, lead.name) : lead?.source} fallback={lead?.source} />
      {dead && <span className="atk-x" aria-label="destroyed" />}
    </span>
  );
});

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

export const AttackReport = memo(function AttackReport({ s, quick, onShake, onBusy, level }: Props) {
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
  const step = level === 'short' ? 0 : fast ? 85 : 150; // ms per stage
  const stages = level === 'short' ? 0 : STAGES.length;
  const resultAt = stages * step + (level === 'short' ? 0 : 80);
  const hold = fast ? 600 : 950;
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
        if (fired.current < stages) play(fired.current === 0 ? 'dice' : 'tick', fired.current === 0 ? Math.min(8, Math.ceil(cur.e.report.shots / 4)) : fired.current + 1);
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
  const A = s.units.find((u) => u.id === cur.e.attackerId);
  const T = s.units.find((u) => u.id === cur.e.targetId);
  const fight = cur.e.attackKind === 'fight';
  const t = now;
  const at = (i: number) => t >= i * step;
  const shown = (i: number) => Math.min(1, Math.max(0, (t - i * step) / Math.max(1, step * 0.9)));
  const vals = [r.shots, r.hits, r.wounds, r.unsaved];
  const labels = [fight ? 'Atk' : 'Shot', 'Hit', 'Wnd', 'Thru'];
  const landed = t >= resultAt;
  const out = t > total - 200;

  return (
    <div className={`atk-report slate o${cur.e.owner} ${out ? 'out' : ''} ${fast ? 'fast' : ''}`} role="status" aria-live="polite" onClick={() => setCur(null)}>
      <div className="slate-in">
        <div className="atk-vs">
          <UnitFace u={A} />
          <span className={`atk-who ${cur.e.owner ? 'p1' : 'p0'}`}>{r.attacker}</span>
          <Icon name={fight ? 'fight' : 'target'} size={13} className="atk-arrow" />
          <span className={`atk-who right ${cur.e.owner ? 'p0' : 'p1'}`}>{r.target}</span>
          <UnitFace u={T} dead={landed && r.destroyed} />
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
        <div className="atk-foot">
          <div className={`atk-result ${landed ? 'land' : ''} ${r.destroyed ? 'dead' : r.killed ? 'kill' : r.dmg ? 'hit' : 'none'}`}>
            {landed && (
              r.destroyed ? <>Destroyed <small>{r.pts} pts</small></>
              : r.killed ? <><span className="num">{r.killed}</span> slain <small>{r.pts ? `${r.pts} pts` : `${r.dmg} dmg`}</small></>
              : r.dmg ? <><span className="num">{r.dmg}</span> damage</>
              : <>No damage</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
