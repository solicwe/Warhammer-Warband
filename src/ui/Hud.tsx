// What sits round the board and tells the player how the battle stands, at a glance and as it changes:
// each side's VP (a "+5 VP" rises when they score) and CP as gems (a gem pops in when gained, shatters when spent),
// who has the upper hand (the advantage bar), the bot's commander speaking, and the summaries between rounds.
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameState, PlayerId } from '../engine/types';
import { lastRound } from '../engine/state';
import { flowAreas, isThousandSonsArmy } from '../factions/flow';
import { Emblem } from './ArmyBuilder';
import { DiceFace } from './DiceFace';
import { Icon } from './Icon';
import { play } from './sfx';
import { voiceOf } from './voice';
import { getPlayerFactionTheme } from './factionColors';

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
export const SideScore = memo(function SideScore({ s, p, label, onOpen }: { s: GameState; p: PlayerId; label: string; onOpen: () => void }) {
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
  const miracleDice = P.miracleDice ?? [];
  const fateDice = P.fateDice ?? [];
  return (
    <button className={`side-score s${p}`} onClick={onOpen} aria-label={`${label}: ${vp} VP, ${P.cp} CP${miracleDice.length ? `, ${miracleDice.length} Miracle Dice` : ''}${fateDice.length ? `, ${fateDice.length} Fate Dice` : ''} — open mission cards`}>
      <span className="ss-label">{label}</span>
      <span className="ss-vp num">{shown}<small>VP</small></span>
      <CpGems cp={P.cp} />
      {miracleDice.length > 0 && (
        <span className="miracle-pool" title={`Miracle Dice pool: ${miracleDice.slice().sort((a, b) => b - a).join(', ')}`}>
          {miracleDice.slice().sort((a, b) => b - a).slice(0, 4).map((d, i) => (
            <DiceFace key={i} value={d} size={15} variant="miracle" />
          ))}
          {miracleDice.length > 4 && <b className="miracle-more">+{miracleDice.length - 4}</b>}
        </span>
      )}
      {fateDice.length > 0 && (
        <span className="miracle-pool fate-pool" title={`Fate Dice pool: ${fateDice.slice().sort((a, b) => b - a).join(', ')}`}>
          {fateDice.slice().sort((a, b) => b - a).slice(0, 4).map((d, i) => (
            <DiceFace key={i} value={d} size={15} variant="fate" />
          ))}
          {fateDice.length > 4 && <b className="miracle-more fate-more">+{fateDice.length - 4}</b>}
        </span>
      )}
      {P.votannAbility && (
        <span className="miracle-pool votann-pool" title={`Prioritised Efficiency: ${P.votannAbility} (${P.yieldPoints ?? 0} YP)`}>
          <Icon name="radar" size={11} />
          <b className="miracle-more" style={{ color: '#ffb347' }}>{P.yieldPoints ?? 0}YP</b>
          <small style={{ fontSize: 11, opacity: 0.85, marginLeft: 2 }}>{P.votannAbility === 'Hostile Acquisition' ? 'Hostile' : 'Fortify'}</small>
        </span>
      )}
      {P.admechImperative && (
        <span className="miracle-pool admech-pool" title={`Doctrina Imperatives: ${P.admechImperative}`}>
          <Icon name="gear" size={11} />
          <b className="miracle-more" style={{ color: '#e74c3c' }}>
            {P.admechImperative.startsWith('Protector') ? 'Protector' : 'Conqueror'}
          </b>
        </span>
      )}
      {P.painTokens !== undefined && (
        <span className="miracle-pool drukhari-pool" title={`Power from Pain: ${P.painTokens} Pain token${P.painTokens === 1 ? '' : 's'}`}>
          <Icon name="skull" size={11} />
          <b className="miracle-more" style={{ color: '#2dd4bf' }}>{P.painTokens} Pain</b>
        </span>
      )}
      {P.fluxTokens !== undefined && (
        <span className="miracle-pool cd-pool" title={`Fates in Flux: ${P.fluxTokens} Flux token${P.fluxTokens === 1 ? '' : 's'}`}>
          <Icon name="sparkles" size={11} />
          <b className="miracle-more" style={{ color: '#ec4899' }}>{P.fluxTokens} Flux</b>
        </span>
      )}
      {P.resurgencePoints !== undefined && (
        <span className="miracle-pool gc-pool" title={`Cult Ambush: ${P.resurgencePoints} Resurgence point${P.resurgencePoints === 1 ? '' : 's'}`}>
          <Icon name="reserves" size={11} />
          <b className="miracle-more" style={{ color: '#a855f7' }}>{P.resurgencePoints} RP</b>
        </span>
      )}
      {isThousandSonsArmy(s, p) && (() => {
        const flow = flowAreas(s, p);
        const zones: string[] = ['Own'];
        if (flow.nml) zones.push('NML');
        if (flow.opp) zones.push('Enemy');
        const summary = zones.join('+');
        return (
          <span className="miracle-pool ts-flow-pool" title={`Flow of Magic: Psychic attacks re-roll 1s to wound (+1 to wound if wholly within Flow). Active zones: ${zones.join(', ')}`}>
            <Icon name="sparkles" size={11} />
            <b className="miracle-more" style={{ color: '#22d3ee' }}>Flow: {summary}</b>
          </span>
        );
      })()}
      {gain && <span key={gain.k} className="ss-gain">+{gain.n} VP</span>}
    </button>
  );
});

/** Command points as gems: a new one pops in with a glint, a spent one shatters. */
export const CpGems = memo(function CpGems({ cp }: { cp: number }) {
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
});

/** Who has the upper hand, as the bot weighs it (VP, objectives held, army left): player 0's share, 0..1. */
export const AdvantageBar = memo(function AdvantageBar({ share, names, colors }: { share: number; names: [string, string]; colors?: [string, string] }) {
  const pct = Math.round(share * 100);
  const lead = pct >= 50 ? 0 : 1;
  const by = Math.abs(pct - 50) * 2;
  const text = by < 8 ? 'Even battle' : `${names[lead]} ahead`;
  return (
    <div className="adv" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Advantage: ${text}`} title={`Advantage (VP, objectives held, army left): ${text}`}>
      <i className="adv-0" style={{ width: `${pct}%`, background: colors?.[0] }} />
      <i className="adv-1" style={{ width: `${100 - pct}%`, background: colors?.[1] }} />
    </div>
  );
});

export interface ThinkView { values: Record<string, number>; done: number; total: number }

const STYLE_NAME: Record<string, string> = { steady: 'As planned', aggressive: 'Aggressive', careful: 'Careful', objectives: 'Objectives', hunt: 'Hunt' };

/**
 * The bot's commander: its army's emblem, a title, and what it says. While it thinks, the ways of playing the turn it
 * is weighing fill in as each is played out on copies of the game (the best one leads).
 */
export const Commander = memo(function Commander({ s, p, think, planning, quiet }: { s: GameState; p: PlayerId; think: ThinkView | null; planning?: { done: number; total: number } | null; quiet?: boolean }) {
  const P = s.players[p];
  const v = voiceOf(P.factionId);
  const warlordUnit = s.units.find((u) => u.owner === p && u.isWarlordUnit)
    ?? s.units.find((u) => u.owner === p && u.keywords.includes('CHARACTER'));
  const speakerTitle = warlordUnit?.warlordSource ?? warlordUnit?.name ?? v.title;
  const entries = think ? Object.entries(think.values) : [];
  const lo = Math.min(...entries.map(([, x]) => x), 0), hi = Math.max(...entries.map(([, x]) => x), 1);
  const best = entries.length ? entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
  return (
    <div className={`commander s${p} ${quiet ? 'quiet' : ''}`} aria-live="polite">
      <span className="cmd-emblem"><Emblem factionId={P.factionId} sub={P.subfaction} /></span>
      <div className="cmd-body">
        <div className="cmd-name">
          <b>{speakerTitle}</b> <span className="muted">· {warlordUnit ? 'Warlord' : P.name}</span>
          {think && <span className="cmd-thinking"><Icon name="wait" size={13} /> thinking{think.total ? ` ${think.done}/${think.total}` : '…'}</span>}
          {!think && planning && <span className="cmd-thinking quiet" title="The bot works out its next turn while you play yours"><Icon name="wait" size={13} /> planning its turn {planning.done}/{planning.total}</span>}
        </div>
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
});

export interface RoundTally { round: number; vp: [number, number]; pts: [number, number]; units: [number, number]; mvp: { name: string; owner: PlayerId; pts: number } | null }

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
  return { round: round ?? s.round, vp, pts, units, mvp };
}

/** Between battle rounds (and at the end): the round in numbers. Tap anywhere to go on. */
export const RoundSummary = memo(function RoundSummary({ s, t, final, onClose, actions }: { s: GameState; t: RoundTally; final?: boolean; onClose: () => void; actions?: ReactNode }) {
  const names = [s.players[0].name, s.players[1].name];
  const win = s.winner;
  const theme0 = getPlayerFactionTheme(s, 0);
  const theme1 = getPlayerFactionTheme(s, 1);
  const winTheme = typeof win === 'number' ? getPlayerFactionTheme(s, win as PlayerId) : null;

  // Auto-dismiss between rounds after a brief delay, allowing gameplay to continue smoothly
  useEffect(() => {
    if (final) return;
    const timer = setTimeout(() => {
      onClose();
    }, 3500);
    return () => clearTimeout(timer);
  }, [final, onClose]);

  return (
    <div className="tray-backdrop center" onClick={final ? undefined : onClose}>
      <div className={`round-card slate ${final ? 'final' : ''}`} role="dialog" aria-label={final ? 'Battle result' : `Round ${t.round} summary`} onClick={final ? undefined : onClose}>
       <div className="slate-in">
        <div className="rc-kicker">{final ? 'Battle over' : `Round ${t.round} of ${lastRound(s)} complete`}</div>
        {final && (
          <div
            className="rc-title"
            style={{
              color: winTheme ? winTheme.primary : undefined,
              textShadow: winTheme ? `0 0 16px ${winTheme.glow}` : undefined,
            }}
          >
            <Icon name="trophy" size={26} /> {win === 'draw' ? 'Draw' : `${names[win as number]} wins`}
          </div>
        )}
        <div className="rc-grid">
          <span />
          <b style={{ color: theme0.primary }}>{names[0]}</b>
          <b style={{ color: theme1.primary }}>{names[1]}</b>
          <span className="rc-l">{final ? 'Final score' : 'VP this round'}</span>
          <span className="num rc-v">{final ? s.players[0].vp + s.players[0].secVp : `+${t.vp[0]}`}</span>
          <span className="num rc-v">{final ? s.players[1].vp + s.players[1].secVp : `+${t.vp[1]}`}</span>
          <span className="rc-l">Destroyed</span>
          <span className="num">{t.pts[0]} pts{t.units[0] ? ` · ${t.units[0]} unit${t.units[0] > 1 ? 's' : ''}` : ''}</span>
          <span className="num">{t.pts[1]} pts{t.units[1] ? ` · ${t.units[1]} unit${t.units[1] > 1 ? 's' : ''}` : ''}</span>
        </div>
        {t.mvp && (
          <div className="rc-mvp">
            <Icon name="trophy" size={16} /> {final ? 'Unit of the battle' : 'Unit of the round'}:{' '}
            <b style={{ color: t.mvp.owner === 1 ? theme1.primary : theme0.primary }}>{t.mvp.name}</b>{' '}
            <span className="muted">· {t.mvp.pts} pts destroyed</span>
          </div>
        )}
        {actions ? <div className="rc-acts">{actions}</div> : <div className="rc-tap">{final ? 'Tap to continue' : 'Auto-continuing · Tap to skip'}</div>}
       </div>
      </div>
    </div>
  );
});
