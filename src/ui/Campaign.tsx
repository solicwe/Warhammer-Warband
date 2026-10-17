// The campaign screen: pick a faction, then walk a branching map of short battles to the boss.
// Features a full roguelike engine: scrap currency, unit veterancy, battle honors, armory, medicae tents,
// and in-campaign roster customization.
import { useEffect, useMemo, useState } from 'react';
import { attachOptions, autoAttach, defaultWargear, listPoints, pointsOptions, syncList, syncWargear, wargearSummary } from '../engine/army';
import { autoList, playable } from '../engine/autoList';
import {
  adoptDetachment, afterBattle, applyCampaign, applyMedicaeService, BATTLE_HONORS, battleHonorById,
  bossRuleById, buyHonorForUnit, changeSquadSize, cheapest, combineSquads, continueNextLoop, dismissUnit, enter, loadRun, makeOffer,
  newRun, reachable, recruitUnit, relicById, relicDesc, rerollOffer, saveRun, START_POINTS, takeReward,
  type MapNode, type Reward, type Run,
} from '../engine/campaign';
import { hasFactionRules } from '../engine/effects';
import { createGame } from '../engine/game';
import type { ArmyUnitEntry, FactionData, GameState, WargearPick } from '../engine/types';
import { Emblem, SECTIONS, sectionOf, WargearEditor } from './ArmyBuilder';
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
  battle: { name: 'Battle', icon: 'fight', note: 'A 3-round battle. Win to earn Scrap and rewards.' },
  elite: { name: 'Elite Miniboss', icon: 'skull', note: 'A 3-round battle against a tougher foe with a boss rule. Yields high Scrap and rare relics.' },
  armory: { name: 'Munitorum Depot', icon: 'shop', note: 'Field depot: buy Battle Honors for units, hire reinforcements, or customize wargear.' },
  medicae: { name: 'Medicae Field Camp', icon: 'heal', note: 'Restore lost Fate or hold a tactical briefing to gain +1 CP per battle.' },
  supply: { name: 'Supply drop', icon: 'cards', note: 'Secure a supply cache: choose from units, relics, or scrap.' },
  boss: { name: 'The Warlord Boss', icon: 'trophy', note: 'A 5-round climactic battle against the enemy warlord with two special rules.' },
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
  const [rosterTab, setRosterTab] = useState<'roster' | 'recruit' | 'detachments'>('roster');
  const [upgradingUid, setUpgradingUid] = useState<string | null>(null);
  const [wargearUid, setWargearUid] = useState<string | null>(null);
  const [attachingUid, setAttachingUid] = useState<string | null>(null);
  const [sizingUid, setSizingUid] = useState<string | null>(null);

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
    const next = afterBattle(run, battle.winner, fac, battle.players[1].name, battle.campaignScrap ?? 0);
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
      const isBoss = node.kind === 'boss';
      const maxRounds = isBoss ? 5 : 3;
      const s = createGame({
        lists: [syncList(r.list, fac), autoAttach(syncList(enemyList, ef), ef)], factions: [fac, ef],
        names: ['You', isBoss ? `${ef.name} Warlord` : ef.name], secondaryMode: 'none', maxRounds, seed: node.enemy.seed,
        primaryId: 'roguelike-annihilation',
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
          <button className="appbar-back-btn" aria-label="Back" onClick={onBack}>&lt;</button>
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
  const at = run.path?.length ? run.path[run.path.length - 1] : undefined;
  const pos = (n: MapNode) => ({ x: 12 + n.x * 76, y: (layers - 1 - n.layer) * rowH + rowH / 2 });

  return (
    <div className="app campaign">
      <header className="appbar">
        <button className="appbar-back-btn" aria-label="Back" onClick={onBack}>&lt;</button>
        <span className="appbar-title">Campaign · Sector {run.loop ?? 1}</span>
        <span className="cmp-scrap" title="Scrap Currency: spend in Armory & Roster"><Icon name="shop" size={14} /> <span className="num">{run.scrap ?? 0}</span> <span>Scrap</span></span>
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
              <span className="muted small">Sector {run.loop ?? 1} · <span className="num">{pts}</span> pts · {run.list.units.length} units · {run.wins} {run.wins === 1 ? 'win' : 'wins'}{run.cp ? ` · +${run.cp} CP` : ''}</span>
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
            {run.list.units.map((u) => {
              const attachedSquad = u.attachTo ? run.list.units.find((x) => x.uid === u.attachTo) : undefined;
              const ledBy = run.list.units.filter((x) => x.attachTo === u.uid);
              return (
                <div key={u.uid} className="cmp-unit">
                  <div>
                    <span className="cmp-rank-badge">{rankLabel(u.xp)}</span>
                    <span>{u.datasheet}{u.models > 1 ? ` ×${u.models}` : ''}</span>
                    {attachedSquad && (
                      <span className="cmp-honor-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)' }}>
                        {getPortrait(attachedSquad.datasheet) && (
                          <img src={getPortrait(attachedSquad.datasheet)!} alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} />
                        )}
                        Attached with {attachedSquad.datasheet}
                      </span>
                    )}
                    {ledBy.length > 0 && (
                      <span className="cmp-honor-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
                        {ledBy.map((l) => {
                          const lp = getPortrait(l.datasheet);
                          return (
                            <span key={l.uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              {lp && <img src={lp} alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} />}
                              Led by {l.datasheet}
                            </span>
                          );
                        })}
                      </span>
                    )}
                    {u.honors?.map((h) => <span key={h} className="cmp-honor-badge">{battleHonorById(h)?.name}</span>)}
                  </div>
                  <span className="num muted">{u.pts + (u.wargearPts ?? 0)} pts</span>
                </div>
              );
            })}
          </details>
        </div></section>

        {run.over && (
          <section className={`cmp-over slate ${run.over}`}><div className="slate-in">
            <div className="cmp-kicker">{run.over === 'won' ? 'Campaign won' : 'Campaign lost'}</div>
            <div className="cmp-title"><Icon name={run.over === 'won' ? 'trophy' : 'skull'} size={24} /> {run.over === 'won' ? 'The Warlord has fallen' : 'Your forces are spent'}</div>
            <div className="small">{run.wins} battles won · {run.relics.length} relics · {run.list.units.length} units · {run.scrap ?? 0} Scrap remaining</div>
            <ol className="cmp-story">{run.story.slice(-8).map((t, i) => <li key={i}>{t}</li>)}</ol>
            {run.over === 'won' && fac ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.75rem' }}>
                <button
                  className="btn primary big"
                  onClick={() => {
                    const next = continueNextLoop(run, fac);
                    setRun(next);
                    saveRun(next);
                    setFocus(null);
                    play('good');
                  }}
                >
                  <Icon name="next" size={18} /> Enter Sector {(run.loop ?? 1) + 1} (Endless Mode)
                </button>
                <button className="btn secondary" onClick={() => { setRun(null); setFocus(null); }}>Start new campaign</button>
              </div>
            ) : (
              <button className="btn primary" onClick={() => { setRun(null); setFocus(null); }}>New campaign</button>
            )}
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
                        <span>{rw.kind === 'unit' ? 'Reinforcements' : isUpgrade ? 'Upgrade' : rw.kind === 'relic' ? (relic?.rare ? 'Rare relic' : 'Relic') : rw.kind === 'detachment' ? 'Detachment' : rw.kind === 'scrap' ? 'Scrap Cache' : 'Command'}</span>
                        {isUpgrade && <span className="chip warn small" style={{ fontSize: '0.72rem', padding: '1px 6px', fontWeight: 800 }}>Lv.{nextLvl}</span>}
                      </span>
                      {rw.kind === 'relic' && <RelicToken id={rw.id} lvl={isUpgrade ? nextLvl : 1} big />}
                      {rw.kind === 'unit' && <span className="cmp-card-icon"><Icon name="plus" size={22} /></span>}
                      {rw.kind === 'detachment' && <span className="cmp-card-icon"><Icon name="cards" size={22} /></span>}
                      {rw.kind === 'cp' && <span className="cmp-card-icon"><Icon name="strat" size={22} /></span>}
                      {rw.kind === 'scrap' && <span className="cmp-card-icon"><Icon name="shop" size={22} /></span>}
                      <b className="cmp-card-name">
                        {rw.kind === 'unit' ? rw.datasheet : rw.kind === 'relic' ? (isUpgrade ? `${relic?.name} (Lv.${nextLvl})` : relic?.name) : rw.kind === 'detachment' ? rw.name : rw.kind === 'scrap' ? `+${rw.amount} Scrap` : '+1 CP every battle'}
                      </b>
                      <span className="cmp-card-text">
                        {rw.kind === 'unit' ? `${rw.models} models · ${rw.pts} pts joins army` : rw.kind === 'relic' && relic ? relicDesc(relic, isUpgrade ? nextLvl : 1) : rw.kind === 'detachment' ? 'Adopt Detachment: gain rules, abilities, and 6 Stratagems!' : rw.kind === 'scrap' ? `Add ${rw.amount} scrap to buy armory upgrades.` : 'Start each battle with one more CP.'}
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
              <button type="button" className="appbar-back-btn" aria-label="Back" onClick={() => setShowRoster(false)}>&lt;</button>
              <div className="cmp-armory-header-center">
                <div className="cmp-armory-title">Roster & Armory</div>
                <div className="cmp-armory-sub">{pts} pts · {run.list.units.length} units in force</div>
              </div>
              <div className="cmp-armory-header-right">
                <span className="cmp-scrap"><Icon name="shop" size={14} /> <b>{run.scrap ?? 0}</b></span>
                <button type="button" className="cmp-close-btn" onClick={() => setShowRoster(false)} aria-label="Close" title="Close">
                  <Icon name="close" size={18} />
                </button>
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
                <button className={`cmp-armory-tab ${rosterTab === 'detachments' ? 'active' : ''}`} onClick={() => setRosterTab('detachments')}>
                  <Icon name="cards" size={14} /> Detachments ({run.list.detachments?.length ?? 1})
                </button>
              </div>

              {rosterTab === 'roster' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {SECTIONS.filter((sec) => sec.id !== 'allies' || run.list.units.some((u) => sectionOf(fac.datasheets.find((x) => x.name === u.datasheet), run.factionId) === 'allies')).map((sec) => {
                    const secUnits = run.list.units.filter((u) => {
                      const d = fac.datasheets.find((x) => x.name === u.datasheet);
                      return sectionOf(d, run.factionId) === sec.id;
                    });
                    if (!secUnits.length) return null;
                    return (
                      <section key={sec.id} className="ab-section">
                        <div className="ab-section-head">
                          <span>{sec.title}</span>
                          <span className="tiny muted" style={{ fontWeight: 'normal', textTransform: 'none', letterSpacing: 'normal' }}>
                            {secUnits.length} {secUnits.length === 1 ? 'unit' : 'units'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {secUnits.map((u) => {
                            const d = fac.datasheets.find((x) => x.name === u.datasheet);
                            const photo = getPortrait(u.datasheet);
                            const wg = wargearSummary(d, u);
                            const isUpgrading = upgradingUid === u.uid;
                            const isEditingWargear = wargearUid === u.uid;
                            const isAttaching = attachingUid === u.uid;
                            const isSizing = sizingUid === u.uid;
                            const canLead = Boolean(d?.leads && d.leads.length > 0);
                            const sizeOpts = d ? pointsOptions(d) : [];
                            const otherSquads = run.list.units.filter((x) => x.uid !== u.uid && x.datasheet === u.datasheet);
                            const canResizeOrMerge = sizeOpts.length > 1 || otherSquads.length > 0;
                            const attachedSquad = u.attachTo ? run.list.units.find((x) => x.uid === u.attachTo) : undefined;
                            const attachedLeaders = run.list.units.filter((x) => x.attachTo === u.uid);
                            return (
                              <div key={u.uid} className="cmp-roster-card">
                                <div className="cmp-card-main">
                                  <div className="cmp-card-thumb">
                                    {photo ? <img src={photo} alt="" className="cmp-roster-img" />
                                      : <div className="cmp-roster-img-ph"><Icon name="fight" size={22} /></div>}
                                  </div>
                                  <div className="cmp-card-details">
                                    <div className="cmp-card-badges">
                                      <span className="cmp-rank-badge">{rankLabel(u.xp)} (XP {u.xp ?? 0})</span>
                                      <span className="cmp-card-pts">{u.pts + (u.wargearPts ?? 0)} pts</span>
                                    </div>
                                    <div className="cmp-roster-name">{u.datasheet}</div>
                                    <div className="cmp-roster-meta">{u.models} {u.models === 1 ? 'model' : 'models'}</div>
                                    {wg && (
                                      <div style={{ marginTop: 2, fontSize: 11.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Icon name="wargear" size={12} />
                                        <span>{wg}</span>
                                      </div>
                                    )}
                                    {attachedSquad && (
                              <div style={{ marginTop: 4 }}>
                                <span className="chip subtle small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(245, 158, 11, 0.1)' }}>
                                  {getPortrait(attachedSquad.datasheet) && (
                                    <img src={getPortrait(attachedSquad.datasheet)!} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover' }} />
                                  )}
                                  Attached with: {attachedSquad.datasheet}
                                </span>
                              </div>
                            )}
                            {canLead && !u.attachTo && (
                              <div style={{ marginTop: 4 }}>
                                <span className="chip subtle small" style={{ color: '#94a3b8' }}>
                                  Unattached (Solo)
                                </span>
                              </div>
                            )}
                            {attachedLeaders.length > 0 && (
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {attachedLeaders.map((l) => {
                                  const lPhoto = getPortrait(l.datasheet);
                                  return (
                                    <span key={l.uid} className="chip subtle small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)', background: 'rgba(56, 189, 248, 0.1)' }}>
                                      {lPhoto && (
                                        <img src={lPhoto} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover' }} />
                                      )}
                                      Led by: {l.datasheet}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {u.honors?.length ? (
                              <div className="cmp-honors-list">
                                {u.honors.map((h) => <span key={h} className="cmp-honor-badge">{battleHonorById(h)?.name}</span>)}
                              </div>
                            ) : null}
                          </div>

                          {run.list.units.length > 1 && (
                            <button className="cmp-card-del-btn" onClick={() => { setRun(dismissUnit(run, u.uid)); play('bad'); }} title="Dismiss squad" aria-label="Dismiss squad">
                              <Icon name="delete" size={16} />
                            </button>
                          )}
                        </div>

                        <div className="cmp-card-actions">
                          {canLead && (
                            <button className={`cmp-card-btn ${isAttaching ? 'active' : ''}`} onClick={() => { setAttachingUid(isAttaching ? null : u.uid); setUpgradingUid(null); setWargearUid(null); setSizingUid(null); }}>
                              <Icon name="swords" size={14} />
                              <span>Attach</span>
                            </button>
                          )}
                          {canResizeOrMerge && (
                            <button className={`cmp-card-btn ${isSizing ? 'active' : ''}`} onClick={() => { setSizingUid(isSizing ? null : u.uid); setUpgradingUid(null); setWargearUid(null); setAttachingUid(null); }}>
                              <Icon name="size" size={14} />
                              <span>{otherSquads.length ? `Combine (${otherSquads.length}) / Size` : `Size (${u.models})`}</span>
                            </button>
                          )}
                          <button className={`cmp-card-btn ${isUpgrading ? 'active' : ''}`} onClick={() => { setUpgradingUid(isUpgrading ? null : u.uid); setWargearUid(null); setAttachingUid(null); setSizingUid(null); }}>
                            <Icon name="shop" size={14} />
                            <span>Battle Honors {u.honors?.length ? `(${u.honors.length})` : ''}</span>
                          </button>
                          {d?.wargearOptions?.length ? (
                            <button className={`cmp-card-btn ${isEditingWargear ? 'active' : ''}`} onClick={() => { setWargearUid(isEditingWargear ? null : u.uid); setUpgradingUid(null); setAttachingUid(null); setSizingUid(null); }}>
                              <Icon name="wargear" size={14} />
                              <span>Wargear</span>
                            </button>
                          ) : null}
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div className="cmp-kicker" style={{ color: '#fef08a' }}>Wargear Configuration</div>
                              <button
                                type="button"
                                onClick={() => setWargearUid(null)}
                                title="Close"
                                aria-label="Close"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#94a3b8',
                                  cursor: 'pointer',
                                  padding: '4px 6px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  borderRadius: '4px',
                                }}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            </div>
                            <WargearEditor
                              sheet={d}
                              u={u}
                              onChange={(patch) => {
                                const next = { ...u, ...patch };
                                const synced = syncWargear(d, next);
                                const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? synced : x));
                                setRun({ ...run, list: { ...run.list, units: updatedUnits } });
                                play('tick');
                              }}
                            />
                            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn small primary"
                                onClick={() => setWargearUid(null)}
                                style={{ padding: '6px 14px', fontSize: '13px' }}
                              >
                                Done / Save Wargear
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Squad Attachment Drawer */}
                        {isAttaching && canLead && d && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div className="cmp-kicker" style={{ color: '#fef08a', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Icon name="swords" size={13} />
                                <span>Squad Attachment</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setAttachingUid(null)}
                                title="Close"
                                aria-label="Close"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#94a3b8',
                                  cursor: 'pointer',
                                  padding: '4px 6px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  borderRadius: '4px',
                                }}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            </div>
                            <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 10, lineHeight: 1.4 }}>
                              Characters can attach to an eligible bodyguard squad before battle, sharing wounds and granting leadership abilities according to 40k rules.
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {/* Solo Option */}
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  if (u.attachTo) {
                                    const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: undefined } : x));
                                    setRun({ ...run, list: { ...run.list, units: updatedUnits } });
                                    play('tick');
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    if (u.attachTo) {
                                      const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: undefined } : x));
                                      setRun({ ...run, list: { ...run.list, units: updatedUnits } });
                                      play('tick');
                                    }
                                  }
                                }}
                                style={{
                                  padding: '12px 14px',
                                  borderRadius: 8,
                                  background: !u.attachTo ? 'rgba(217, 155, 38, 0.12)' : '#181B22',
                                  border: !u.attachTo ? '1.5px solid #F59E0B' : '1px solid #262930',
                                  boxShadow: !u.attachTo ? '0 0 12px rgba(245, 158, 11, 0.2)' : 'none',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  cursor: !u.attachTo ? 'default' : 'pointer',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <div
                                    style={{
                                      width: 38,
                                      height: 38,
                                      borderRadius: 6,
                                      background: !u.attachTo ? 'rgba(217, 155, 38, 0.2)' : '#1F242D',
                                      border: `1px solid ${!u.attachTo ? 'rgba(245, 158, 11, 0.4)' : '#374151'}`,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: !u.attachTo ? '#FBBF24' : '#9CA3AF',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <Icon name="leader" size={20} />
                                  </div>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <b style={{ color: !u.attachTo ? '#FBBF24' : '#F8FAFC', fontSize: 13.5 }}>Deploy Solo</b>
                                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>(Independent Character)</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                                      Fight as a standalone single-model unit on the battlefield
                                    </div>
                                  </div>
                                </div>

                                <div>
                                  {!u.attachTo ? (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        padding: '4px 10px',
                                        borderRadius: 6,
                                        background: 'rgba(245, 158, 11, 0.2)',
                                        border: '1px solid rgba(245, 158, 11, 0.4)',
                                        color: '#FBBF24',
                                        fontSize: '11.5px',
                                        fontWeight: 700,
                                        letterSpacing: '0.03em',
                                      }}
                                    >
                                      <Icon name="check" size={13} /> ACTIVE
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn small"
                                      style={{
                                        border: '1px solid #374151',
                                        background: '#1F242D',
                                        color: '#E5E7EB',
                                        fontSize: '12px',
                                        padding: '4px 12px',
                                      }}
                                    >
                                      Deploy Solo
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Eligible bodyguard squads */}
                              {(() => {
                                const eligible = attachOptions(run.list, fac, u);
                                if (eligible.length === 0) {
                                  return (
                                    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.15)', color: '#94a3b8', fontSize: 12.5 }}>
                                      <div>No eligible bodyguard squads currently in your roster to attach to.</div>
                                      {d.leads?.length ? (
                                        <div style={{ marginTop: 4, color: '#64748b', fontSize: 11.5 }}>
                                          This Character can lead: {d.leads.join(', ')}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                }

                                return eligible.map((body) => {
                                  const isCurrent = u.attachTo === body.uid;
                                  const bodyPhoto = getPortrait(body.datasheet);
                                  return (
                                    <div
                                      key={body.uid}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => {
                                        if (!isCurrent) {
                                          const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: body.uid } : x));
                                          setRun({ ...run, list: { ...run.list, units: updatedUnits } });
                                          play('good');
                                        }
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          if (!isCurrent) {
                                            const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: body.uid } : x));
                                            setRun({ ...run, list: { ...run.list, units: updatedUnits } });
                                            play('good');
                                          }
                                        }
                                      }}
                                      style={{
                                        padding: '12px 14px',
                                        borderRadius: 8,
                                        background: isCurrent ? 'rgba(217, 155, 38, 0.12)' : '#181B22',
                                        border: isCurrent ? '1.5px solid #F59E0B' : '1px solid #262930',
                                        boxShadow: isCurrent ? '0 0 12px rgba(245, 158, 11, 0.2)' : 'none',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 12,
                                        cursor: isCurrent ? 'default' : 'pointer',
                                        transition: 'all 0.15s ease',
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        {bodyPhoto ? (
                                          <img
                                            src={bodyPhoto}
                                            alt=""
                                            style={{
                                              width: 38,
                                              height: 38,
                                              borderRadius: 6,
                                              objectFit: 'cover',
                                              border: `1px solid ${isCurrent ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                                              flexShrink: 0,
                                            }}
                                          />
                                        ) : (
                                          <div
                                            style={{
                                              width: 38,
                                              height: 38,
                                              borderRadius: 6,
                                              background: isCurrent ? 'rgba(245, 158, 11, 0.2)' : '#1e293b',
                                              border: `1px solid ${isCurrent ? 'rgba(245, 158, 11, 0.4)' : '#374151'}`,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              color: isCurrent ? '#FBBF24' : '#9CA3AF',
                                              flexShrink: 0,
                                            }}
                                          >
                                            <Icon name="fight" size={18} />
                                          </div>
                                        )}
                                        <div>
                                          <b style={{ color: isCurrent ? '#FBBF24' : '#F8FAFC', fontSize: 13.5 }}>{body.datasheet}</b>
                                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                                            {body.models} {body.models === 1 ? 'model' : 'models'} · {body.pts + (body.wargearPts ?? 0)} pts
                                          </div>
                                        </div>
                                      </div>

                                      <div>
                                        {isCurrent ? (
                                          <span
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 6,
                                              padding: '4px 10px',
                                              borderRadius: 6,
                                              background: 'rgba(245, 158, 11, 0.2)',
                                              border: '1px solid rgba(245, 158, 11, 0.4)',
                                              color: '#FBBF24',
                                              fontSize: '11.5px',
                                              fontWeight: 700,
                                              letterSpacing: '0.03em',
                                            }}
                                          >
                                            <Icon name="check" size={13} /> Attached with {u.datasheet}
                                            {photo && (
                                              <img
                                                src={photo}
                                                alt=""
                                                style={{
                                                  width: 22,
                                                  height: 22,
                                                  borderRadius: 4,
                                                  objectFit: 'cover',
                                                  border: '1px solid rgba(245, 158, 11, 0.5)',
                                                  marginLeft: 2,
                                                }}
                                              />
                                            )}
                                          </span>
                                        ) : (
                                          <button
                                            type="button"
                                            className="btn small"
                                            style={{
                                              border: '1px solid #374151',
                                              background: '#1F242D',
                                              color: '#E5E7EB',
                                              fontSize: '12px',
                                              padding: '4px 12px',
                                            }}
                                          >
                                            Attach
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        )}

                        {/* Squad Size & Combine Squads drawer */}
                        {isSizing && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            {sizeOpts.length > 1 && (
                              <div style={{ marginBottom: otherSquads.length ? 14 : 0 }}>
                                <div className="cmp-kicker" style={{ marginBottom: 8, color: '#38bdf8' }}>
                                  Squad Size (จำนวนโมเดลในกอง)
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                                  {sizeOpts.map((o) => {
                                    const isCurrent = u.models === o.models;
                                    const currentOpt = sizeOpts.find((x) => x.models === u.models) ?? { pts: u.pts };
                                    const scrapDiff = o.pts - currentOpt.pts;
                                    const canAfford = scrapDiff <= 0 || (run.scrap ?? 0) >= scrapDiff;
                                    return (
                                      <div
                                        key={o.models}
                                        style={{
                                          padding: 10,
                                          borderRadius: 8,
                                          background: isCurrent ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255,255,255,0.04)',
                                          border: isCurrent ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          justifyContent: 'space-between',
                                          gap: 8,
                                        }}
                                      >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <b style={{ color: '#f8fafc', fontSize: 14 }}>{o.models} {o.models === 1 ? 'model' : 'models'}</b>
                                          <span className="cmp-card-pts">{o.pts} pts</span>
                                        </div>
                                        {isCurrent ? (
                                          <span className="chip ok small" style={{ width: 'fit-content' }}>
                                            <Icon name="check" size={12} /> Current ({o.models})
                                          </span>
                                        ) : (
                                          <button
                                            type="button"
                                            className="btn small primary"
                                            disabled={!canAfford}
                                            onClick={() => {
                                              setRun(changeSquadSize(run, fac, u.uid, o.models));
                                              play('good');
                                            }}
                                          >
                                            {scrapDiff > 0 ? `Reinforce (-${scrapDiff} Scrap)` : `Reorganize to ${o.models}`}
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {otherSquads.length > 0 && (
                              <div style={{ marginTop: sizeOpts.length > 1 ? 12 : 0 }}>
                                <div className="cmp-kicker" style={{ marginBottom: 6, color: '#f59e0b' }}>
                                  Combine Squads (รวมกอง)
                                </div>
                                <div className="tiny muted" style={{ marginBottom: 8 }}>
                                  Merge a duplicate squad into this unit for free. Total models, Experience, and Battle Honors are combined!
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {otherSquads.map((src) => {
                                    const combinedModels = u.models + src.models;
                                    const matchedOpt = sizeOpts.find((o) => o.models === combinedModels)
                                      ?? sizeOpts.filter((o) => o.models <= combinedModels).sort((a, b) => b.models - a.models)[0]
                                      ?? sizeOpts[sizeOpts.length - 1];
                                    const targetCount = matchedOpt ? matchedOpt.models : combinedModels;
                                    return (
                                      <div
                                        key={src.uid}
                                        style={{
                                          padding: 10,
                                          borderRadius: 8,
                                          background: 'rgba(245, 158, 11, 0.08)',
                                          border: '1px solid rgba(245, 158, 11, 0.25)',
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          flexWrap: 'wrap',
                                          gap: 8,
                                        }}
                                      >
                                        <div>
                                          <div style={{ fontWeight: 700, color: '#fef08a', fontSize: 13.5 }}>
                                            {src.datasheet} ({src.models} models)
                                          </div>
                                          <div className="tiny muted">
                                            XP {src.xp ?? 0}{src.honors?.length ? ` · ${src.honors.length} honors` : ''} → Combine to {targetCount} models
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="btn small"
                                          style={{ background: '#d97706', borderColor: '#f59e0b', color: '#fff', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                          onClick={() => {
                                            setRun(combineSquads(run, fac, u.uid, src.uid));
                                            play('good');
                                          }}
                                        >
                                          <Icon name="size" size={13} /> Combine into {targetCount} models (Free)
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}

              {rosterTab === 'recruit' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="cmp-armory-hint">
                    Recruit new datasheets into your strike force using accumulated Scrap currency.
                  </div>
                  {fac.datasheets
                    .filter((d) => !d.ally && d.points?.[0]?.options?.length && !d.keywords?.includes('FORTIFICATION'))
                    .map((d) => {
                      const opts = pointsOptions(d);
                      if (!opts.length) return null;
                      const photo = getPortrait(d.name);
                      const isEpicHero = (d.keywords || []).includes('EPIC HERO');
                      const alreadyInForce = isEpicHero && run.list.units.some((u) => u.datasheet === d.name);
                      return (
                        <div key={d.name} className="cmp-roster-card" style={alreadyInForce ? { opacity: 0.65 } : undefined}>
                          <div className="cmp-card-main">
                            <div className="cmp-card-thumb">
                              {photo ? <img src={photo} alt="" className="cmp-roster-img" />
                                : <div className="cmp-roster-img-ph"><Icon name="plus" size={20} /></div>}
                            </div>
                            <div className="cmp-card-details">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <div className="cmp-roster-name">{d.name}</div>
                                {isEpicHero && (
                                  <span className="chip subtle small" style={{ color: '#c084fc', borderColor: 'rgba(192, 132, 252, 0.4)', background: 'rgba(192, 132, 252, 0.12)', fontSize: '11px', padding: '1px 6px' }}>
                                    Epic Hero
                                  </span>
                                )}
                              </div>
                              <div className="cmp-roster-meta">
                                {opts.map((o) => `${o.models} models (${o.pts} pts)`).join(' · ')}
                              </div>
                            </div>
                          </div>
                          <div className="cmp-card-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
                            {opts.map((o) => {
                              const canAfford = (run.scrap ?? 0) >= o.pts;
                              const canRecruit = canAfford && !alreadyInForce;
                              return (
                                <button
                                  key={o.models}
                                  className="cmp-btn-recruit"
                                  style={{ flex: '1 1 140px', minHeight: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                  disabled={!canRecruit}
                                  onClick={() => { setRun(recruitUnit(run, fac, d.name, o.models)); play('good'); }}
                                >
                                  <Icon name="plus" size={14} /> {alreadyInForce ? 'Already Recruited (Limit 1)' : `Recruit ${o.models} models (${o.pts} Scrap)`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {rosterTab === 'detachments' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="cmp-armory-hint">
                    In Roguelike Campaign, your army can unlock and stack multiple Detachments! Each Detachment provides its unique Army Rule, Enhancements, and 6 Stratagems in battle.
                  </div>

                  <div>
                    <div className="cmp-kicker" style={{ color: '#4ade80', marginBottom: 8, fontSize: 13 }}>
                      Active Detachments ({run.list.detachments?.length ?? 0})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {(run.list.detachments ?? []).map((detName) => {
                        const det = fac.detachments.find((d) => d.name === detName);
                        const rulesText = det?.rules?.map((r) => `${r.name}: ${r.text}`).join('\n\n') || 'Detachment abilities and stratagems active.';
                        return (
                          <div key={detName} className="cmp-roster-card" style={{ background: 'rgba(74, 222, 128, 0.06)', borderColor: 'rgba(74, 222, 128, 0.3)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="chip ok small" style={{ fontWeight: 800 }}>ACTIVE</span>
                                <b style={{ color: '#f8fafc', fontSize: 15 }}>{detName}</b>
                              </div>
                              {det?.forceDisposition && <span className="disp-chip small">{det.forceDisposition}</span>}
                            </div>
                            <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 6, whiteSpace: 'pre-line', lineHeight: 1.4 }}>
                              {rulesText}
                            </div>
                            {det?.stratagems?.length ? (
                              <div className="tiny muted" style={{ marginTop: 6 }}>
                                Includes {det.stratagems.length} Stratagems: {det.stratagems.map((s) => s.name).join(', ')}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(() => {
                    const available = fac.detachments.filter((d) => !(run.list.detachments ?? []).includes(d.name));
                    if (!available.length) return null;
                    return (
                      <div style={{ marginTop: 8 }}>
                        <div className="cmp-kicker" style={{ color: '#fef08a', marginBottom: 8, fontSize: 13 }}>
                          Available Detachments to Requisition
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {available.map((d) => {
                            const cost = 100;
                            const canAfford = (run.scrap ?? 0) >= cost;
                            const rulesText = d.rules?.map((r) => `${r.name}: ${r.text}`).join('\n\n') || '';
                            return (
                              <div key={d.name} className="cmp-roster-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <b style={{ color: '#f8fafc', fontSize: 14 }}>{d.name}</b>
                                    {d.forceDisposition && <span className="disp-chip small">{d.forceDisposition}</span>}
                                  </div>
                                </div>
                                {rulesText && (
                                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, whiteSpace: 'pre-line', lineHeight: 1.35 }}>
                                    {rulesText}
                                  </div>
                                )}
                                {d.stratagems?.length ? (
                                  <div className="tiny muted" style={{ marginTop: 2 }}>
                                    Stratagems: {d.stratagems.map((s) => s.name).join(', ')}
                                  </div>
                                ) : null}
                                <div className="cmp-card-actions">
                                  <button
                                    className="cmp-card-btn active"
                                    style={{ width: '100%', minHeight: '38px', justifyContent: 'center' }}
                                    disabled={!canAfford}
                                    onClick={() => {
                                      const next = adoptDetachment(run, d.name, cost);
                                      setRun(next);
                                      play('good');
                                      setInfo(`Adopted Detachment: ${d.name}!`);
                                    }}
                                  >
                                    <Icon name="plus" size={13} /> {canAfford ? `Adopt Detachment (${cost} Scrap)` : `Need ${cost} Scrap`}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="cmp-armory-footer">
              <button className="cmp-footer-btn" onClick={() => setShowRoster(false)}>
                <Icon name="check" size={18} />
                <span>Done</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {info && <div className="toast" role="status">{info}</div>}
    </div>
  );
}
