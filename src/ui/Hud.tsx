// What sits round the board and tells the player how the battle stands, at a glance and as it changes:
// each side's VP (a "+5 VP" rises when they score) and CP as gems (a gem pops in when gained, shatters when spent),
// who has the upper hand (the advantage bar), the bot's commander speaking, and the summaries between rounds.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameState, PlayerId } from '../engine/types';
import { lastRound } from '../engine/state';
import { Emblem } from './ArmyBuilder';
import { Icon } from './Icon';
import { play } from './sfx';
import { voiceOf } from './voice';

/** A number that counts up to its new value instead of jumping. */
function useCount(value: number, ms = 450): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current, t0 = performance.now();
    if (a === value) return;
    let raf = 0;
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / ms);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - f, 3))));
      if (f < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return shown;
}

/** One side's score: label, VP (counting up, with a rising "+N VP"), and CP as gems. Tapping opens their cards. */
export function SideScore({ s, p, label, onOpen }: { s: GameState; p: PlayerId; label: string; onOpen: () => void }) {
  const P = s.players[p];
  const vp = P.vp + P.secVp;
  const shown = useCount(vp);
  const [gain, setGain] = useState<{ n: number; k: number } | null>(null);
  const prevVp = useRef(vp);
  useEffect(() => {
    const d = vp - prevVp.current;
    prevVp.current = vp;
    if (d > 0) { setGain({ n: d, k: Date.now() }); play('vp'); }
  }, [vp]);
  useEffect(() => { if (!gain) return; const t = setTimeout(() => setGain(null), 1600); return () => clearTimeout(t); }, [gain]);
  return (
    <button className={`side-score s${p}`} onClick={onOpen} aria-label={`${label}: ${vp} VP, ${P.cp} CP — open mission cards`}>
      <span className="ss-label">{label}</span>
      <span className="ss-vp num">{shown}<small>VP</small></span>
      <CpGems cp={P.cp} />
      {gain && <span key={gain.k} className="ss-gain">+{gain.n} VP</span>}
    </button>
  );
}

/** Command points as gems: a new one pops in with a glint, a spent one shatters. */
export function CpGems({ cp }: { cp: number }) {
  const prev = useRef(cp);
  const [burst, setBurst] = useState<{ kind: 'gain' | 'spend'; n: number; k: number } | null>(null);
  useEffect(() => {
    const d = cp - prev.current;
    prev.current = cp;
    if (!d) return;
    setBurst({ kind: d > 0 ? 'gain' : 'spend', n: Math.abs(d), k: Date.now() });
    play(d > 0 ? 'gem' : 'spend');
  }, [cp]);
  useEffect(() => { if (!burst) return; const t = setTimeout(() => setBurst(null), 700); return () => clearTimeout(t); }, [burst]);
  const shown = Math.min(cp, 6);
  return (
    <span className="cp-gems" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => <i key={i} className={`gem ${burst?.kind === 'gain' && i >= shown - burst.n ? 'new' : ''}`} />)}
      {burst?.kind === 'spend' && Array.from({ length: Math.min(burst.n, 3) }, (_, i) => <i key={`x${burst.k}${i}`} className="gem gone" />)}
      {cp > 6 && <b className="gem-more">+{cp - 6}</b>}
      {cp === 0 && !burst && <b className="gem-zero">0 CP</b>}
    </span>
  );
}

/** Who has the upper hand, as the bot weighs it (VP, objectives held, army left): player 0's share, 0..1. */
export function AdvantageBar({ share, names }: { share: number; names: [string, string] }) {
  const pct = Math.round(share * 100);
  const lead = pct >= 50 ? 0 : 1;
  const by = Math.abs(pct - 50) * 2;
  const text = by < 8 ? 'Even battle' : `${names[lead]} ahead`;
  return (
    <div className="adv" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Advantage: ${text}`} title={`Advantage (VP, objectives held, army left): ${text}`}>
      <i className="adv-0" style={{ width: `${pct}%` }} />
      <i className="adv-1" style={{ width: `${100 - pct}%` }} />
    </div>
  );
}

export interface ThinkView { values: Record<string, number>; done: number; total: number }

const STYLE_NAME: Record<string, string> = { steady: 'As planned', aggressive: 'Aggressive', careful: 'Careful', objectives: 'Objectives', hunt: 'Hunt' };

/**
 * The bot's commander: its army's emblem, a title, and what it says. While it thinks, the ways of playing the turn it
 * is weighing fill in as each is played out on copies of the game (the best one leads).
 */
export function Commander({ s, p, says, think, planning, quiet }: { s: GameState; p: PlayerId; says: string | null; think: ThinkView | null; planning?: { done: number; total: number } | null; quiet?: boolean }) {
  const P = s.players[p];
  const v = voiceOf(P.factionId);
  const entries = think ? Object.entries(think.values) : [];
  const lo = Math.min(...entries.map(([, x]) => x), 0), hi = Math.max(...entries.map(([, x]) => x), 1);
  const best = entries.length ? entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
  return (
    <div className={`commander s${p} ${quiet ? 'quiet' : ''}`} aria-live="polite">
      <span className="cmd-emblem"><Emblem factionId={P.factionId} sub={P.subfaction} /></span>
      <div className="cmd-body">
        <div className="cmd-name">
          <b>{v.title}</b> <span className="muted">· {P.name}</span>
          {think && <span className="cmd-thinking"><Icon name="wait" size={13} /> thinking{think.total ? ` ${think.done}/${think.total}` : '…'}</span>}
          {!think && planning && <span className="cmd-thinking quiet" title="The bot works out its next turn while you play yours"><Icon name="wait" size={13} /> planning its turn {planning.done}/{planning.total}</span>}
        </div>
        {says && <div key={says} className="cmd-says">“{says}”</div>}
        {think && entries.length > 0 && (
          <div className="cmd-styles">
            {entries.map(([name, x]) => (
              <span key={name} className={`cmd-style ${name === best ? 'best' : ''}`}>
                <span className="cmd-style-l">{STYLE_NAME[name] ?? name}</span>
                <span className="cmd-style-bar"><i style={{ width: `${8 + ((x - lo) / Math.max(1, hi - lo)) * 92}%` }} /></span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface RoundTally { round: number; vp: [number, number]; pts: [number, number]; units: [number, number]; mvp: { name: string; owner: PlayerId; pts: number } | null; luck: [number | null, number | null] }

/** The battle round just finished (or the whole battle): VP scored, what each side destroyed, the best unit, the dice. */
export function tally(s: GameState, round: number | null, vpAtStart: [number, number] = [0, 0]): RoundTally {
  const kills = (s.stats?.kills ?? []).filter((k) => round === null || k.round === round);
  const vp = ([0, 1] as PlayerId[]).map((p) => s.players[p].vp + s.players[p].secVp - vpAtStart[p]) as [number, number];
  const pts = ([0, 1] as PlayerId[]).map((p) => kills.filter((k) => k.by === p).reduce((a, k) => a + k.pts, 0)) as [number, number];
  const units = ([0, 1] as PlayerId[]).map((p) => kills.filter((k) => k.by === p && k.destroyed).length) as [number, number];
  const byUnit = new Map<string, number>();
  for (const k of kills) byUnit.set(k.attackerId, (byUnit.get(k.attackerId) ?? 0) + k.pts);
  let mvp: RoundTally['mvp'] = null;
  for (const [id, n] of byUnit) {
    const u = s.units.find((x) => x.id === id);
    if (u && n > (mvp?.pts ?? 0)) mvp = { name: u.name, owner: u.owner, pts: n };
  }
  const luck = ([0, 1] as PlayerId[]).map((p) => { const [a, e] = s.stats?.luck[p] ?? [0, 0]; return e >= 1 ? (a - e) / e : null; }) as [number | null, number | null];
  return { round: round ?? s.round, vp, pts, units, mvp, luck };
}

const luckText = (x: number | null) => (x === null ? '—' : x >= 0.1 ? `+${Math.round(x * 100)}% lucky` : x <= -0.1 ? `${Math.round(x * 100)}% unlucky` : 'average');

/** Between battle rounds (and at the end): the round in numbers. Tap anywhere to go on. */
export function RoundSummary({ s, t, final, onClose, actions }: { s: GameState; t: RoundTally; final?: boolean; onClose: () => void; actions?: ReactNode }) {
  const names = [s.players[0].name, s.players[1].name];
  const win = s.winner;
  return (
    <div className="tray-backdrop center" onClick={final ? undefined : onClose}>
      <div className={`round-card slate ${final ? 'final' : ''}`} role="dialog" aria-label={final ? 'Battle result' : `Round ${t.round} summary`} onClick={final ? undefined : onClose}>
       <div className="slate-in">
        <div className="rc-kicker">{final ? 'Battle over' : `Round ${t.round} of ${lastRound(s)} complete`}</div>
        {final && <div className={`rc-title ${win === 0 ? 'p0' : win === 1 ? 'p1' : ''}`}><Icon name="trophy" size={26} /> {win === 'draw' ? 'Draw' : `${names[win as number]} wins`}</div>}
        <div className="rc-grid">
          <span />
          <b className="p0">{names[0]}</b>
          <b className="p1">{names[1]}</b>
          <span className="rc-l">{final ? 'Final score' : 'VP this round'}</span>
          <span className="num rc-v">{final ? s.players[0].vp + s.players[0].secVp : `+${t.vp[0]}`}</span>
          <span className="num rc-v">{final ? s.players[1].vp + s.players[1].secVp : `+${t.vp[1]}`}</span>
          <span className="rc-l">Destroyed</span>
          <span className="num">{t.pts[0]} pts{t.units[0] ? ` · ${t.units[0]} unit${t.units[0] > 1 ? 's' : ''}` : ''}</span>
          <span className="num">{t.pts[1]} pts{t.units[1] ? ` · ${t.units[1]} unit${t.units[1] > 1 ? 's' : ''}` : ''}</span>
          <span className="rc-l">{final ? 'Dice luck' : 'Dice so far'}</span>
          <span className={`rc-luck ${(t.luck[0] ?? 0) >= 0.1 ? 'up' : (t.luck[0] ?? 0) <= -0.1 ? 'down' : ''}`}>{luckText(t.luck[0])}</span>
          <span className={`rc-luck ${(t.luck[1] ?? 0) >= 0.1 ? 'up' : (t.luck[1] ?? 0) <= -0.1 ? 'down' : ''}`}>{luckText(t.luck[1])}</span>
        </div>
        {t.mvp && <div className="rc-mvp"><Icon name="trophy" size={16} /> {final ? 'Unit of the battle' : 'Unit of the round'}: <b className={t.mvp.owner ? 'p1' : 'p0'}>{t.mvp.name}</b> <span className="muted">· {t.mvp.pts} pts destroyed</span></div>}
        {actions ? <div className="rc-acts">{actions}</div> : <div className="rc-tap">Tap to continue</div>}
       </div>
      </div>
    </div>
  );
}
