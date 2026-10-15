// The campaign screen: pick a faction, then walk a branching map of short battles to the boss.
// Features a full roguelike engine: scrap currency, unit veterancy, battle honors, armory, medicae tents,
// and in-campaign roster customization.
import { useEffect, useMemo, useState } from 'react';
import { autoAttach, defaultWargear, listPoints, syncList, syncWargear } from '../engine/army';
import { autoList, playable } from '../engine/autoList';
import {
  afterBattle, applyCampaign, applyMedicaeService, BATTLE_HONORS, battleHonorById,
  bossRuleById, buyHonorForUnit, cheapest, dismissUnit, enter, loadRun, makeOffer,
  newRun, reachable, recruitUnit, relicById, relicDesc, rerollOffer, saveRun, START_POINTS, takeReward,
  type MapNode, type Reward, type Run,
} from '../engine/campaign';
import { hasFactionRules } from '../engine/effects';
import { createGame } from '../engine/game';
import type { ArmyUnitEntry, FactionData, GameState, WargearPick } from '../engine/types';
import { Emblem } from './ArmyBuilder';
import { loadFaction, type FactionIndex } from './data';
import { Icon, type IconName } from './Icon';
import { withAutoRules } from './library';
import { getPortrait } from './portraits';
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
  battle: { name: 'Battle', icon: 'fight', note: 'A short 3-round battle. Win to earn Scrap and rewards.' },
  elite: { name: 'Elite enemy', icon: 'skull', note: 'Tougher foe with a boss rule. Yields high Scrap and rare relics.' },
  armory: { name: 'Munitorum Depot', icon: 'shop', note: 'Field depot: buy Battle Honors for units, hire reinforcements, or customize wargear.' },
  medicae: { name: 'Medicae Field Camp', icon: 'heal', note: 'Restore lost Fate or hold a tactical briefing to gain +1 CP per battle.' },
  supply: { name: 'Supply drop', icon: 'cards', note: 'Secure a supply cache: choose from units, relics, or scrap.' },
  boss: { name: 'The Warlord', icon: 'trophy', note: 'The final confrontation: a massive army with two special rules.' },
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

  // Roguelike Roster & Armory state
  const [showRoster, setShowRoster] = useState(false);
  const [rosterTab, setRosterTab] = useState<'roster' | 'recruit'>('roster');
  const [upgradingUid, setUpgradingUid] = useState<string | null>(null);
  const [wargearUid, setWargearUid] = useState<string | null>(null);

  useEffect(() => { if (!info) return; const t = window.setTimeout(() => setInfo(null), 3200); return () => window.clearTimeout(t); }, [info]);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(false), 3000); return () => window.clearTimeout(t); }, [armed]);

  const nameOf = (id: string) => index?.factions.find((f) => f.id === id)?.name ?? id;

  // the run's faction (for rewards and battles)
  useEffect(() => {
    if (!run) return;
    let live = true;
    loadFaction(run.factionId).then((f) => { if (live) setFac(f); }).catch(() => setErr('Could not load the army data.'));
    return () => { live = false; };
  }, [run?.factionId]);

  // a campaign battle just finished: its result moves the run on
  const battle = saved?.campaign && run?.fighting && saved.campaign.node === run.fighting ? saved : null;
  useEffect(() => {
    if (!run || !fac || !battle || battle.phase !== 'gameover') return;
    const next = afterBattle(run, battle.winner, fac, battle.players[1].name);
    play(battle.winner === 1 ? 'bad' : 'vp');
    setRun(next);
    onClearSaved();
  }, [fac, battle?.phase]);

  const begin = async () => {
    setBusy(true); setErr(null);
    try {
      const f = await loadFaction(pickId);
      if (!playable(f)) { setErr(`${f.name} has too few units in the data for a campaign yet. Pick another army.`); return; }
      const seed = Date.now() >>> 0;
      const list = { ...autoList(f, START_POINTS, seed, true), name: `${f.name} Strike Force` };
      const enemies = (index?.factions ?? []).map((x) => x.id).filter((id) => id !== f.id && hasFactionRules(id) && id !== 'TL');
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
    if (node.kind === 'supply' || node.kind === 'armory' || node.kind === 'medicae') {
      setRun(enter(run, node.id, fac));
      setFocus(null);
      play('card');
      if (node.kind === 'armory') setShowRoster(true);
      return;
    }
    void fight(node);
  };

  const take = (rw: Reward) => {
    if (!run || !fac) return;
    setRun(takeReward(run, rw, fac));
    play(rw.kind === 'relic' ? 'good' : 'gem');
  };

  const open = useMemo(() => (run ? reachable(run) : []), [run]);
  const focused = run?.map.find((n) => n.id === (focus ?? run.fighting)) ?? null;

  // Rank calculator based on XP
  const rankLabel = (xp = 0) => {
    if (xp >= 3) return 'Legendary';
    if (xp >= 2) return 'Veteran';
    if (xp >= 1) return 'Blooded';
    return 'Recruit';
  };

  if (!run) {
    const groups = new Map<string, { id: string; name: string }[]>();
    for (const f of (index?.factions ?? []).filter((x) => hasFactionRules(x.id) && x.id !== 'TL')) {
      const g = f.group ?? 'Armies';
      groups.set(g, [...(groups.get(g) ?? []), f]);
    }
    return (
      <div className="app campaign">
        <header className="appbar">
          <button className="icon-btn" aria-label="Back" onClick={onBack}><span className="chev-left" aria-hidden="true" /></button>
          <span className="appbar-title">Roguelike Campaign</span>
        </header>
        <main className="screen">
          <section className="cmp-intro slate"><div className="slate-in">
            <div className="cmp-kicker">Roguelike Tactical Run</div>
            <div className="cmp-title">Fight your way to the Warlord</div>
            <ul className="cmp-points">
              <li><Icon name="fight" size={16} /> {START_POINTS}-point army, 3-round battles</li>
              <li><Icon name="shop" size={16} /> Earn Scrap: customize roster, buy Battle Honors & reinforcements</li>
              <li><Icon name="cards" size={16} /> Relics & boons: stack powerful army-wide modifiers</li>
              <li><Icon name="fate" size={16} /> 3 Fate: each defeat costs one</li>
            </ul>
          </div></section>
          <section className="group pad" aria-label="Your army">
            <div className="group-head"><h3>Your army</h3><span className="group-note">select your starting faction</span></div>
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
          <div className="cta-bar"><button className="btn primary big wide" disabled={busy || !index} onClick={begin}>{busy ? 'Mustering…' : `Begin Campaign with ${nameOf(pickId)}`}</button></div>
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
        <span className="cmp-scrap" title="Scrap Currency: spend in Armory & Roster"><Icon name="shop" size={14} /> <span className="num">{run.scrap ?? 0}</span></span>
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
              <span className="muted small"><span className="num">{pts}</span> pts · {run.list.units.length} units · {run.wins} {run.wins === 1 ? 'win' : 'wins'}{run.cp ? ` · +${run.cp} CP` : ''}</span>
            </span>
            <button className="btn small primary cmp-roster-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowRoster(true)}>
              <Icon name="swords" size={15} /> Roster & Armory
            </button>
          </div>
          {run.relics.length > 0 && (
            <div className="cmp-relics">{run.relics.map((id) => <RelicToken key={id} id={id} lvl={run.relicLevels?.[id] ?? 1} big onInfo={setInfo} />)}</div>
          )}
          <details className="cmp-units">
            <summary>Active Roster ({run.list.units.length} units)</summary>
            {run.list.units.map((u) => (
              <div key={u.uid} className="cmp-unit">
                <div>
                  <span className="cmp-rank-badge">{rankLabel(u.xp)}</span>
                  <span>{u.datasheet}{u.models > 1 ? ` ×${u.models}` : ''}</span>
                  {u.honors?.map((h) => <span key={h} className="cmp-honor-badge">{battleHonorById(h)?.name}</span>)}
                </div>
                <span className="num muted">{u.pts + (u.wargearPts ?? 0)} pts</span>
              </div>
            ))}
          </details>
        </div></section>

        {run.over && (
          <section className={`cmp-over slate ${run.over}`}><div className="slate-in">
            <div className="cmp-kicker">{run.over === 'won' ? 'Campaign won' : 'Campaign lost'}</div>
            <div className="cmp-title"><Icon name={run.over === 'won' ? 'trophy' : 'skull'} size={24} /> {run.over === 'won' ? 'The Warlord has fallen' : 'Your forces are spent'}</div>
            <div className="small">{run.wins} battles won · {run.relics.length} relics · {run.list.units.length} units · {run.scrap ?? 0} Scrap remaining</div>
            <ol className="cmp-story">{run.story.slice(-8).map((t, i) => <li key={i}>{t}</li>)}</ol>
            <button className="btn primary" onClick={() => { setRun(null); setFocus(null); }}>New campaign</button>
          </div></section>
        )}

        {run.offer && fac && (
          <section className="cmp-offer" aria-label="Choose a reward">
            <div className="cmp-kicker center" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontWeight: 800 }}>{(run.picksLeft ?? 1) > 1 ? `Boss Spoils: Choose 2 (${run.picksLeft} picks left)` : 'Choose one reward'}</span>
              <button
                type="button"
                className="btn small"
                disabled={(run.freeRerolls ?? 0) <= 0 && (run.scrap ?? 0) < 30}
                onClick={() => {
                  const next = rerollOffer(run, fac);
                  setRun(next);
                  saveRun(next);
                  play('dice', 2);
                  setInfo((run.freeRerolls ?? 0) > 0 ? 'Spun! (Free reroll)' : 'Spun! (-30 Scrap)');
                }}
                style={{ padding: '4px 10px', fontSize: '0.8rem', fontWeight: 700 }}
              >
                <Icon name="reroll" size={14} /> Spin {(run.freeRerolls ?? 0) > 0 ? '(Free)' : '(30 Scrap)'}
              </button>
            </div>
            <div className="cmp-cards">
              {run.offer.map((rw, i) => {
                const relic = rw.kind === 'relic' ? relicById(rw.id) : null;
                const curLvl = rw.kind === 'relic' ? (run.relicLevels?.[rw.id] ?? (run.relics.includes(rw.id) ? 1 : 0)) : 0;
                const isUpgrade = curLvl > 0;
                const nextLvl = curLvl + 1;
                return (
                  <button key={i} className={`cmp-card slate k-${rw.kind} ${relic?.rare ? 'rare' : ''} ${isUpgrade ? 'upgrade' : ''}`} style={{ animationDelay: `${i * 90}ms`, position: 'relative' }} onClick={() => take(rw)}>
                    <span className="slate-in">
                      <span className="cmp-card-kind" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{rw.kind === 'unit' ? 'Reinforcements' : isUpgrade ? 'Upgrade' : rw.kind === 'relic' ? (relic?.rare ? 'Rare relic' : 'Relic') : rw.kind === 'scrap' ? 'Scrap Cache' : 'Command'}</span>
                        {isUpgrade && <span className="chip warn small" style={{ fontSize: '0.72rem', padding: '1px 6px', fontWeight: 800 }}>Lv.{nextLvl}</span>}
                      </span>
                      {rw.kind === 'relic' && <RelicToken id={rw.id} lvl={isUpgrade ? nextLvl : 1} big />}
                      {rw.kind === 'unit' && <span className="cmp-card-icon"><Icon name="plus" size={22} /></span>}
                      {rw.kind === 'cp' && <span className="cmp-card-icon"><Icon name="strat" size={22} /></span>}
                      {rw.kind === 'scrap' && <span className="cmp-card-icon"><Icon name="shop" size={22} /></span>}
                      <b className="cmp-card-name">
                        {rw.kind === 'unit' ? rw.datasheet : rw.kind === 'relic' ? (isUpgrade ? `${relic?.name} (Lv.${nextLvl})` : relic?.name) : rw.kind === 'scrap' ? `+${rw.amount} Scrap` : '+1 CP every battle'}
                      </b>
                      <span className="cmp-card-text">
                        {rw.kind === 'unit' ? `${rw.models} models · ${rw.pts} pts joins army` : rw.kind === 'relic' && relic ? relicDesc(relic, isUpgrade ? nextLvl : 1) : rw.kind === 'scrap' ? `Add ${rw.amount} scrap to buy armory upgrades.` : 'Start each battle with one more CP.'}
                      </span>
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

            {focused.kind === 'medicae' && (
              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <button className="btn small primary" disabled={run.fate >= 3 || (run.scrap ?? 0) < 60} onClick={() => { setRun(applyMedicaeService(run, 'fate')); play('good'); }}>
                  <Icon name="heal" size={14} /> Restore 1 Fate (60 Scrap)
                </button>
                <button className="btn small" disabled={(run.scrap ?? 0) < 45} onClick={() => { setRun(applyMedicaeService(run, 'cp')); play('good'); }}>
                  <Icon name="strat" size={14} /> War Council: +1 CP (45 Scrap)
                </button>
              </div>
            )}

            {focused.kind === 'armory' && (
              <div style={{ marginTop: 8 }}>
                <button className="btn small primary" onClick={() => setShowRoster(true)}>
                  <Icon name="shop" size={14} /> Open Armory & Upgrade Roster
                </button>
              </div>
            )}

            {focused.enemy && <div className="tiny muted">{KIND[focused.kind].note}</div>}
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn primary big wide" style={{ marginTop: 10 }} disabled={busy || !fac} onClick={() => go(focused)}>
              {busy ? 'Deploying…' : focused.kind === 'supply' ? 'Open Supply Drop' : focused.kind === 'armory' ? 'Enter Armory Depot' : focused.kind === 'medicae' ? 'Enter Medicae Camp' : run.fighting === focused.id ? 'Fight Again' : 'Engage Battle'}
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

      {/* Roster & Armory Customization Modal */}
      {showRoster && fac && (
        <div className="cmp-modal-backdrop" onClick={() => setShowRoster(false)}>
          <div className="cmp-armory-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cmp-armory-header">
              <div>
                <div className="cmp-armory-title">Roster & Armory</div>
                <div className="cmp-armory-sub">{pts} pts · {run.list.units.length} units in force</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="cmp-scrap"><Icon name="shop" size={14} /> <b>{run.scrap ?? 0}</b> Scrap</span>
                <button className="icon-btn" onClick={() => setShowRoster(false)} aria-label="Close"><Icon name="close" size={20} /></button>
              </div>
            </div>

            <div className="cmp-armory-body">
              <div className="cmp-armory-tabs">
                <button className={`cmp-armory-tab ${rosterTab === 'roster' ? 'active' : ''}`} onClick={() => setRosterTab('roster')}>
                  Active Roster ({run.list.units.length})
                </button>
                <button className={`cmp-armory-tab ${rosterTab === 'recruit' ? 'active' : ''}`} onClick={() => setRosterTab('recruit')}>
                  Recruit Reinforcements
                </button>
              </div>

              {rosterTab === 'roster' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {run.list.units.map((u) => {
                    const d = fac.datasheets.find((x) => x.name === u.datasheet);
                    const photo = getPortrait(u.datasheet);
                    const isUpgrading = upgradingUid === u.uid;
                    const isEditingWargear = wargearUid === u.uid;
                    return (
                      <div key={u.uid} className="cmp-roster-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                            {photo ? <img src={photo} alt="" className="cmp-roster-img" />
                              : <div className="cmp-roster-img" style={{ display: 'grid', placeItems: 'center' }}><Icon name="fight" size={20} /></div>}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span className="cmp-rank-badge">{rankLabel(u.xp)} (XP {u.xp ?? 0})</span>
                                <span className="cmp-roster-name">{u.datasheet}</span>
                              </div>
                              <div className="cmp-roster-meta">{u.models} {u.models === 1 ? 'model' : 'models'} · {u.pts + (u.wargearPts ?? 0)} pts</div>
                              {u.honors?.length ? (
                                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {u.honors.map((h) => <span key={h} className="cmp-honor-badge">{battleHonorById(h)?.name}</span>)}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <button className={`btn small ${isUpgrading ? 'primary' : ''}`} onClick={() => { setUpgradingUid(isUpgrading ? null : u.uid); setWargearUid(null); }}>
                              <Icon name="shop" size={14} /> Honors
                            </button>
                            {d?.wargearOptions?.length ? (
                              <button className={`btn small ${isEditingWargear ? 'primary' : ''}`} onClick={() => { setWargearUid(isEditingWargear ? null : u.uid); setUpgradingUid(null); }}>
                                <Icon name="wargear" size={14} /> Wargear
                              </button>
                            ) : null}
                            {run.list.units.length > 1 && (
                              <button className="btn small danger" onClick={() => { setRun(dismissUnit(run, u.uid)); play('bad'); }} title="Dismiss squad">
                                <Icon name="delete" size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Battle Honors upgrade drawer */}
                        {isUpgrading && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <div className="cmp-kicker" style={{ marginBottom: 8, color: '#fef08a' }}>Available Battle Honors</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                              {BATTLE_HONORS.map((h) => {
                                const has = (u.honors ?? []).includes(h.id);
                                const canAfford = (run.scrap ?? 0) >= h.cost;
                                return (
                                  <div key={h.id} style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                    <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <b style={{ color: '#f8fafc', fontSize: 14 }}>{h.name}</b>
                                        <span className="cmp-scrap"><Icon name="shop" size={12} /> {h.cost}</span>
                                      </div>
                                      <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 4, lineHeight: 1.35 }}>{h.desc}</div>
                                    </div>
                                    <button
                                      className="btn small primary"
                                      style={{ marginTop: 8 }}
                                      disabled={has || !canAfford}
                                      onClick={() => { setRun(buyHonorForUnit(run, u.uid, h.id)); play('good'); }}
                                    >
                                      {has ? 'Equipped' : !canAfford ? 'Need Scrap' : `Purchase (${h.cost} Scrap)`}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Wargear Drawer */}
                        {isEditingWargear && d && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <div className="cmp-kicker" style={{ marginBottom: 8, color: '#fef08a' }}>Wargear Options</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {d.wargearOptions?.map((opt, optIdx) => (
                                <div key={optIdx} style={{ padding: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 6, fontSize: 12.5, color: '#cbd5e1' }}>
                                  <div>{opt.text}</div>
                                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                    {opt.choices.map((ch, chIdx) => {
                                      const pick = (u.wargear ?? []).find((w) => w.opt === optIdx && w.choice === chIdx);
                                      const isChosen = !!pick && pick.count > 0;
                                      return (
                                        <button
                                          key={chIdx}
                                          className={`btn small ${isChosen ? 'primary' : ''}`}
                                          onClick={() => {
                                            const old = u.wargear ?? [];
                                            const nextPicks: WargearPick[] = isChosen
                                              ? old.filter((w) => !(w.opt === optIdx && w.choice === chIdx))
                                              : [...old.filter((w) => w.opt !== optIdx), { opt: optIdx, choice: chIdx, count: opt.scope === 'all' || opt.scope === 'any' ? u.models : 1 }];
                                            const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? syncWargear(d, { ...x, wargear: nextPicks }) : x));
                                            setRun({ ...run, list: { ...run.list, units: updatedUnits } });
                                            play('tick');
                                          }}
                                        >
                                          {ch.join(' + ') || 'Default'}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {rosterTab === 'recruit' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="cmp-armory-hint">
                    Recruit new datasheets into your strike force using accumulated Scrap currency.
                  </div>
                  {fac.datasheets
                    .filter((d) => !d.ally && d.points[0]?.options?.length && !d.keywords.includes('EPIC HERO') && !d.keywords.includes('FORTIFICATION'))
                    .map((d) => {
                      const o = cheapest(d);
                      if (!o) return null;
                      const photo = getPortrait(d.name);
                      const canAfford = (run.scrap ?? 0) >= o.pts;
                      return (
                        <div key={d.name} className="cmp-roster-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {photo ? <img src={photo} alt="" className="cmp-roster-img" />
                              : <div className="cmp-roster-img" style={{ display: 'grid', placeItems: 'center' }}><Icon name="plus" size={18} /></div>}
                            <div>
                              <div className="cmp-roster-name">{d.name}</div>
                              <div className="cmp-roster-meta">{o.models} models · {o.pts} pts</div>
                            </div>
                          </div>
                          <button
                            className="cmp-btn-recruit"
                            disabled={!canAfford}
                            onClick={() => { setRun(recruitUnit(run, fac, d.name)); play('good'); }}
                          >
                            <Icon name="plus" size={13} /> Recruit ({o.pts} Scrap)
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {info && <div className="toast" role="status">{info}</div>}
    </div>
  );
}
