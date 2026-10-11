// The campaign screen: pick a faction, then walk a branching map of short battles to the boss. Between battles the
// player picks a reward (a unit, a relic, a Command Point) and sees their army grow; three defeats end the run.
import { useEffect, useMemo, useState } from 'react';
import { autoAttach, listPoints, syncList } from '../engine/army';
import { autoList, playable } from '../engine/autoList';
import { afterBattle, applyCampaign, bossRuleById, enter, loadRun, newRun, reachable, relicById, saveRun, START_POINTS, takeReward, type MapNode, type Reward, type Run } from '../engine/campaign';
import { hasFactionRules } from '../engine/effects';
import { createGame } from '../engine/game';
import type { FactionData, GameState } from '../engine/types';
import { Emblem } from './ArmyBuilder';
import { loadFaction, type FactionIndex } from './data';
import { Icon, type IconName } from './Icon';
import { withAutoRules } from './library';
import { RelicToken } from './Relics';
import { play } from './sfx';

interface Props {
  index: FactionIndex | null;
  /** the battle saved on this device (a campaign battle in progress or just finished) */
  saved: GameState | null;
  onBack: () => void;
  onPlay: (s: GameState) => void;
  onClearSaved: () => void;
}

const KIND: Record<MapNode['kind'], { name: string; icon: IconName; note: string }> = {
  battle: { name: 'Battle', icon: 'fight', note: 'A short battle: 3 rounds. Win to pick a reward.' },
  elite: { name: 'Elite enemy', icon: 'skull', note: 'Tougher, with a special rule. Its reward is a choice of relics.' },
  supply: { name: 'Supply drop', icon: 'cards', note: 'No battle: pick one of three rewards.' },
  boss: { name: 'Warlord', icon: 'trophy', note: 'The last battle: a big army with two special rules.' },
};
const LEVEL: Record<string, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };

export function CampaignScreen({ index, saved, onBack, onPlay, onClearSaved }: Props) {
  const [run, setRunRaw] = useState<Run | null>(loadRun);
  const setRun = (r: Run | null) => { setRunRaw(r); saveRun(r); };
  const [fac, setFac] = useState<FactionData | null>(null);
  const [pickId, setPickId] = useState<string>('SM');
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!info) return; const t = window.setTimeout(() => setInfo(null), 3200); return () => window.clearTimeout(t); }, [info]);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(false), 3000); return () => window.clearTimeout(t); }, [armed]);

  const nameOf = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;

  // the run's faction (for rewards and battles)
  useEffect(() => {
    if (!run) return;
    let live = true;
    loadFaction(run.factionId).then((f) => { if (live) setFac(f); }).catch(() => setErr('Could not load the army data.'));
    return () => { live = false; };
  }, [run?.factionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a campaign battle just finished: its result moves the run on
  const battle = saved?.campaign && run?.fighting && saved.campaign.node === run.fighting ? saved : null;
  useEffect(() => {
    if (!run || !fac || !battle || battle.phase !== 'gameover') return;
    const next = afterBattle(run, battle.winner, fac, battle.players[1].name);
    play(battle.winner === 1 ? 'bad' : 'vp');
    setRun(next);
    onClearSaved();
  }, [fac, battle?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    setBusy(true); setErr(null);
    try {
      const f = await loadFaction(pickId);
      if (!playable(f)) { setErr(`${f.name} has too few units in the data for a campaign yet. Pick another army.`); return; }
      const seed = Date.now() >>> 0;
      const list = { ...autoList(f, START_POINTS, seed % 997), name: `${f.name} strike force` };
      // only armies whose rules are all written up: theirs play as they should
      const enemies = (index?.factions ?? []).map((x) => x.id).filter((id) => id !== f.id && hasFactionRules(id));
      setFac(f);
      setRun(newRun(f, list, enemies.length ? enemies : ['ORK'], seed));
      play('turn');
    } catch (e) { setErr(`Could not start: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };

  const fight = async (node: MapNode) => {
    if (!run || !fac || !node.enemy) return;
    setBusy(true); setErr(null);
    try {
      let ef = await loadFaction(node.enemy.factionId).catch(() => null);
      if (!ef || !playable(ef)) ef = await loadFaction('ORK');
      const enemyList = autoList(ef, node.enemy.pts, node.enemy.seed);
      const r = run.fighting === node.id ? run : enter(run, node.id, fac);
      const s = createGame({
        lists: [autoAttach(syncList(r.list, fac), fac), autoAttach(syncList(enemyList, ef), ef)], factions: [fac, ef],
        names: ['You', node.kind === 'boss' ? `${ef.name} Warlord` : ef.name], secondaryMode: 'none', maxRounds: 3, seed: node.enemy.seed,
      });
      s.botPlayer = 1;
      s.bots = [1];
      s.botLevel = node.enemy.level;
      applyCampaign(s, r, node.enemy.rules);
      setRun(r);
      onPlay(withAutoRules(s));
    } catch (e) { setErr(`Could not start the battle: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };

  const go = (node: MapNode) => {
    if (!run || !fac) return;
    if (node.kind === 'supply') { setRun(enter(run, node.id, fac)); setFocus(null); play('card'); return; }
    void fight(node);
  };
  const take = (rw: Reward) => { if (!run || !fac) return; setRun(takeReward(run, rw, fac)); play(rw.kind === 'relic' ? 'good' : 'gem'); };

  const open = useMemo(() => (run ? reachable(run) : []), [run]);
  const focused = run?.map.find((n) => n.id === (focus ?? run.fighting)) ?? null;

  if (!run) {
    const groups = new Map<string, { id: string; name: string }[]>();
    for (const f of (index?.factions ?? []).filter((x) => hasFactionRules(x.id))) { const g = f.group ?? 'Armies'; groups.set(g, [...(groups.get(g) ?? []), f]); }
    return (
      <div className="app campaign">
        <header className="appbar">
          <button className="icon-btn" aria-label="Back" onClick={onBack}><span className="chev-left" aria-hidden="true" /></button>
          <span className="appbar-title">Campaign</span>
        </header>
        <main className="screen">
          <section className="cmp-intro slate"><div className="slate-in">
            <div className="cmp-kicker">A run of short battles</div>
            <div className="cmp-title">Fight your way to the Warlord</div>
            <ul className="cmp-points">
              <li><Icon name="fight" size={16} /> {START_POINTS}-point army, 3-round battles</li>
              <li><Icon name="cards" size={16} /> Win: pick 1 of 3 reward cards</li>
              <li><Icon name="hold" size={16} /> 3 Fate: each defeat costs one</li>
            </ul>
          </div></section>
          <section className="group pad" aria-label="Your army">
            <div className="group-head"><h3>Your army</h3><span className="group-note">picked for you from the faction's units</span></div>
            {[...groups].map(([g, fs]) => (
              <div key={g} className="cmp-fgroup">
                <span className="label">{g}</span>
                <div className="cmp-factions">
                  {fs.map((f) => (
                    <button key={f.id} className={`cmp-faction ${pickId === f.id ? 'on' : ''}`} aria-pressed={pickId === f.id} onClick={() => setPickId(f.id)}>
                      <Emblem factionId={f.id} /><span>{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
          {err && <div className="err" role="alert">{err}</div>}
          <div className="cta-bar"><button className="btn primary big wide" disabled={busy || !index} onClick={begin}>{busy ? 'Mustering…' : `Begin with ${nameOf(pickId)}`}</button></div>
        </main>
      </div>
    );
  }

  const pts = listPoints(run.list, fac ?? undefined);
  const layers = Math.max(...run.map.map((n) => n.layer)) + 1;
  const rowH = 76;
  const at = run.path[run.path.length - 1];
  const pos = (n: MapNode) => ({ x: 12 + n.x * 76, y: (layers - 1 - n.layer) * rowH + rowH / 2 });
  return (
    <div className="app campaign">
      <header className="appbar">
        <button className="icon-btn" aria-label="Back" onClick={onBack}><span className="chev-left" aria-hidden="true" /></button>
        <span className="appbar-title">Campaign</span>
        <span className="cmp-fate" aria-label={`${run.fate} Fate left`} title="Fate: each defeat costs one">
          {[0, 1, 2].map((i) => <i key={i} className={i < run.fate ? 'on' : ''} />)}
        </span>
      </header>
      <main className="screen">
        <section className="cmp-army slate"><div className="slate-in">
          <div className="cmp-army-top">
            <span className="cmp-emblem"><Emblem factionId={run.factionId} /></span>
            <span className="cmp-army-text">
              <b>{run.list.name}</b>
              <span className="muted small"><span className="num">{pts}</span> pts · {run.list.units.length} units · {run.wins} {run.wins === 1 ? 'win' : 'wins'}{run.cp ? ` · +${run.cp} CP each battle` : ''}</span>
            </span>
          </div>
          {run.relics.length > 0 && (
            <div className="cmp-relics">{run.relics.map((id) => <RelicToken key={id} id={id} big onInfo={setInfo} />)}</div>
          )}
          <details className="cmp-units">
            <summary>Army list</summary>
            {run.list.units.map((u) => <div key={u.uid} className="cmp-unit"><span>{u.datasheet}{u.models > 1 ? ` ×${u.models}` : ''}</span><span className="num muted">{u.pts + (u.wargearPts ?? 0)}</span></div>)}
          </details>
        </div></section>

        {run.over && (
          <section className={`cmp-over slate ${run.over}`}><div className="slate-in">
            <div className="cmp-kicker">{run.over === 'won' ? 'Campaign won' : 'Campaign lost'}</div>
            <div className="cmp-title"><Icon name={run.over === 'won' ? 'trophy' : 'skull'} size={24} /> {run.over === 'won' ? 'The Warlord has fallen' : 'Your forces are spent'}</div>
            <div className="small">{run.wins} battles won · {run.relics.length} relics · {run.list.units.length} units at the end</div>
            <ol className="cmp-story">{run.story.slice(-8).map((t, i) => <li key={i}>{t}</li>)}</ol>
            <button className="btn primary" onClick={() => { setRun(null); setFocus(null); }}>New campaign</button>
          </div></section>
        )}

        {run.offer && fac && (
          <section className="cmp-offer" aria-label="Choose a reward">
            <div className="cmp-kicker center">Choose one reward</div>
            <div className="cmp-cards">
              {run.offer.map((rw, i) => {
                const relic = rw.kind === 'relic' ? relicById(rw.id) : null;
                return (
                  <button key={i} className={`cmp-card slate k-${rw.kind} ${relic?.rare ? 'rare' : ''}`} style={{ animationDelay: `${i * 90}ms` }} onClick={() => take(rw)}>
                    <span className="slate-in">
                      <span className="cmp-card-kind">{rw.kind === 'unit' ? 'Reinforcements' : rw.kind === 'relic' ? (relic?.rare ? 'Rare relic' : 'Relic') : 'Command'}</span>
                      {rw.kind === 'relic' && <RelicToken id={rw.id} big />}
                      {rw.kind === 'unit' && <span className="cmp-card-icon"><Icon name="plus" size={22} /></span>}
                      {rw.kind === 'cp' && <span className="cmp-card-icon"><Icon name="strat" size={22} /></span>}
                      <b className="cmp-card-name">{rw.kind === 'unit' ? rw.datasheet : rw.kind === 'relic' ? relic?.name : '+1 CP every battle'}</b>
                      <span className="cmp-card-text">{rw.kind === 'unit' ? `${rw.models} ${rw.models === 1 ? 'model' : 'models'} · ${rw.pts} pts joins your army` : rw.kind === 'relic' ? relic?.text : 'Start each battle with one more Command Point for Stratagems.'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {battle && battle.phase !== 'gameover' && (
          <button className="btn primary big wide" onClick={() => onPlay(withAutoRules(battle))}><Icon name="fight" size={20} />Continue the battle</button>
        )}

        <section className="cmp-map" aria-label="Campaign map" style={{ height: layers * rowH }}>
          <svg className="cmp-roads" viewBox={`0 0 100 ${layers * rowH}`} preserveAspectRatio="none" aria-hidden="true">
            {run.map.flatMap((a) => a.next.map((id) => {
              const b = run.map.find((n) => n.id === id)!;
              const p = pos(a), q = pos(b);
              const walked = run.path.includes(a.id) && run.path.includes(b.id);
              const open1 = a.id === at && open.some((n) => n.id === b.id);
              return <line key={a.id + id} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={walked ? 'walked' : open1 ? 'open' : ''} vectorEffect="non-scaling-stroke" />;
            }))}
          </svg>
          {run.map.map((n) => {
            const p = pos(n);
            const done = run.path.includes(n.id);
            const can = open.some((o) => o.id === n.id);
            return (
              <button key={n.id} className={`cmp-node ${n.kind} ${done ? 'done' : ''} ${n.id === at ? 'here' : ''} ${can ? 'can' : ''} ${focus === n.id ? 'focus' : ''} ${run.fighting === n.id ? 'fighting' : ''}`}
                style={{ left: `${p.x}%`, top: p.y }} disabled={!can && !done && run.fighting !== n.id}
                aria-label={`${KIND[n.kind].name}${n.enemy ? `: ${nameOf(n.enemy.factionId)}, ${n.enemy.pts} pts` : ''}${done ? ' (cleared)' : ''}`}
                onClick={() => setFocus(n.id)}>
                <Icon name={KIND[n.kind].icon} size={n.kind === 'boss' ? 26 : 20} />
              </button>
            );
          })}
          {!at && <span className="cmp-start" style={{ top: layers * rowH - 14 }}>Start</span>}
        </section>

        {focused && !run.over && (open.some((n) => n.id === focused.id) || run.fighting === focused.id) && !run.offer && (
          <section className={`cmp-detail slate ${focused.kind}`}><div className="slate-in">
            <div className="cmp-kicker">{KIND[focused.kind].name}</div>
            {focused.enemy ? (
              <>
                <div className="cmp-foe">
                  <span className="cmp-emblem"><Emblem factionId={focused.enemy.factionId} /></span>
                  <span className="cmp-army-text"><b>{nameOf(focused.enemy.factionId)}</b><span className="muted small"><span className="num">{focused.enemy.pts}</span> pts · bot {LEVEL[focused.enemy.level]} · 3 rounds</span></span>
                </div>
                {focused.enemy.rules.map((id) => { const b = bossRuleById(id)!; return <div key={id} className="cmp-rule"><RelicToken id={id} enemy /> <span><b>{b.name}</b> — {b.text}</span></div>; })}
              </>
            ) : <div className="small">{KIND[focused.kind].note}</div>}
            {focused.enemy && <div className="tiny muted">{KIND[focused.kind].note}</div>}
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn primary big wide" disabled={busy || !fac} onClick={() => go(focused)}>
              {busy ? 'Deploying…' : focused.kind === 'supply' ? 'Open the supply drop' : run.fighting === focused.id ? 'Fight again' : 'Fight'}
            </button>
          </div></section>
        )}
        {!focused && open.length > 0 && !run.offer && <div className="hint center"><span>Tap a lit node on the map to choose your road</span></div>}

        {!run.over && (
          <button className={`btn ${armed ? 'danger on-armed' : 'ghost'} small`} onClick={() => { if (!armed) { setArmed(true); return; } setRun(null); setFocus(null); setArmed(false); }}>
            {armed ? 'Tap again to abandon the campaign' : 'Abandon campaign'}
          </button>
        )}
      </main>
      {info && <div className="toast" role="status">{info}</div>}
    </div>
  );
}
