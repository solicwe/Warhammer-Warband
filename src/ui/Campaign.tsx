// The campaign screen: pick a faction, then walk a branching map of short battles to the boss.
// Features a full roguelike engine: scrap currency, unit veterancy, battle honors, armory, medicae tents,
// and in-campaign roster customization.
import { useEffect, useMemo, useState } from 'react';
import { attachOptions, autoAttach, defaultWargear, enhancementFits, enhancementOptions, listPoints, pointsOptions, syncList, syncWargear, wargearSummary } from '../engine/army';
import { autoList, playable } from '../engine/autoList';
import {
  adoptDetachment, afterBattle, applyCampaign, applyMedicaeService, BATTLE_HONORS, battleHonorById,
  bossRuleById, buyEnhancementForUnit, buyHonorForUnit, changeSquadSize, cheapest, continueNextLoop, dismissUnit,
  enhancementScrapCost, enter, loadRun, makeOffer, newRun, reachable, recruitUnit, relicById, relicDesc,
  removeEnhancementFromUnit, rerollOffer, saveRun, START_POINTS, takeReward,
  type MapNode, type Reward, type Run,
} from '../engine/campaign';
import { hasFactionRules } from '../engine/effects';
import { createGame } from '../engine/game';
import type { ArmyUnitEntry, DatasheetData, FactionData, GameState, WargearPick } from '../engine/types';
import { Emblem, SECTIONS, sectionOf, UnitArt, WargearEditor } from './ArmyBuilder';
import { DatasheetView } from './Sheet';
import { loadFaction, type FactionIndex } from './data';
import { Icon, type IconName } from './Icon';
import { withAutoRules } from './library';
import { getPortrait } from './portraits';
import { RelicToken } from './Relics';
import { play } from './sfx';
import { Em } from './Em';

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
  const [menu, setMenu] = useState<string | null>(null);
  const [panelCollapse, setPanelCollapse] = useState<Record<string, Record<string, boolean>>>({});
  const [pop, setPop] = useState<{ uid: string; x: number; y: number; mode?: 'size' | 'attach' } | null>(null);
  const [recruitQ, setRecruitQ] = useState('');
  const [recruitSize, setRecruitSize] = useState<string | null>(null);
  const [recruitView, setRecruitView] = useState<string | null>(null);

  const closeRoster = () => {
    setShowRoster(false);
    setPop(null);
    setRecruitSize(null);
    setRecruitView(null);
  };

  const isSectionOpen = (uid: string, section: string, defaultOpen = true) => {
    return panelCollapse[uid]?.[section] !== undefined ? panelCollapse[uid][section] : defaultOpen;
  };
  const toggleSection = (uid: string, section: string, defaultOpen = true) => {
    setPanelCollapse((prev) => {
      const cur = prev[uid]?.[section] !== undefined ? prev[uid][section] : defaultOpen;
      return {
        ...prev,
        [uid]: {
          ...prev[uid],
          [section]: !cur,
        },
      };
    });
  };

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

  const quickMenu = () => {
    if (!pop || !fac) return null;
    const u = run.list.units.find((x) => x.uid === pop.uid);
    if (!u) return null;
    const sheet = fac.datasheets.find((x) => x.name === u.datasheet);
    const opts = sheet ? pointsOptions(sheet) : [];
    const body = u.attachTo ? run.list.units.find((b) => b.uid === u.attachTo) : undefined;
    const isChar = !!sheet?.keywords?.includes('CHARACTER')
      || (run.list.detachments?.includes('Houndpack Lance') && !!sheet?.keywords?.includes('WAR DOG'))
      || run.factionId === 'TL'
      || !!sheet?.keywords?.includes('ADEPTUS TITANICUS')
      || !!sheet?.factionKeywords?.includes('ADEPTUS TITANICUS');
    const attachables = !u.attachTo ? attachOptions(run.list, fac, u) : [];

    const close = () => setPop(null);
    const w = pop.mode ? Math.min(340, window.innerWidth - 16) : 260;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, pop.x - w));
    const top = Math.max(8, Math.min(pop.y + 4, window.innerHeight * 0.45));
    const maxHeight = window.innerHeight - top - 16;

    let content: React.ReactNode;
    if (pop.mode === 'size') {
      content = (
        <>
          <div className="ab-pop-head">Unit size · {u.datasheet}</div>
          {opts.map((o) => {
            const isCurrent = u.models === o.models;
            const currentOpt = opts.find((x) => x.models === u.models) ?? { pts: u.pts };
            const diff = o.pts - currentOpt.pts;
            const canAfford = diff <= 0 || (run.scrap ?? 0) >= diff;
            return (
              <button
                key={o.models}
                type="button"
                className={`ab-pop-size ${isCurrent ? 'on' : ''}`}
                disabled={!canAfford && !isCurrent}
                onClick={() => {
                  if (isCurrent) { close(); return; }
                  const next = changeSquadSize(run, fac, u.uid, o.models);
                  if (next !== run) {
                    setRun(next);
                    play(diff > 0 ? 'good' : 'tick');
                    setInfo(diff > 0 ? `Reinforced ${u.datasheet} to ${o.models} models (-${diff} Scrap)` : `Reorganized ${u.datasheet} to ${o.models} models`);
                  }
                  close();
                }}
              >
                <span className="ab-pop-pts">{o.pts} pts</span>
                <span className="muted">({o.models} models{diff > 0 ? ` · +${diff} Scrap` : ''})</span>
                <span className="ab-pop-plus">{isCurrent ? <Icon name="check" size={18} /> : '+'}</span>
              </button>
            );
          })}
        </>
      );
    } else if (pop.mode === 'attach') {
      content = (
        <>
          <div className="ab-pop-head">Attach {u.datasheet} to Squad</div>
          {attachables.map((target) => (
            <button
              key={target.uid}
              type="button"
              className="ab-pop-card has"
              style={{ width: 'calc(100% - 16px)', padding: '10px 14px' }}
              onClick={() => {
                const nextUnits = run.list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: target.uid } : x));
                setRun({ ...run, list: { ...run.list, units: nextUnits } });
                setInfo(`${u.datasheet} attached to ${target.datasheet}`);
                close();
              }}
            >
              <span className="ab-pop-name">{target.datasheet} ({target.models} models)</span>
            </button>
          ))}
        </>
      );
    } else {
      content = (
        <>
          {attachables.length > 0 && (
            <button type="button" onClick={() => setPop({ ...pop, mode: 'attach' })}>
              <Icon name="plus" size={22} />Attach to Squad
            </button>
          )}
          {body && (
            <button
              type="button"
              onClick={() => {
                const nextUnits = run.list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: undefined } : x));
                setRun({ ...run, list: { ...run.list, units: nextUnits } });
                setInfo(`${u.datasheet} left ${body.datasheet}`);
                close();
              }}
            >
              <Icon name="leave" size={22} />Leave Squad
            </button>
          )}
          {opts.length > 1 && (
            <button type="button" onClick={() => setPop({ ...pop, mode: 'size' })}>
              <Icon name="size" size={22} />Unit size <span className="ab-pop-val">{u.models}</span>
            </button>
          )}
          {isChar && (
            <button
              type="button"
              className={u.warlord ? 'on' : ''}
              onClick={() => {
                const nextUnits = run.list.units.map((x) => ({ ...x, warlord: x.uid === u.uid ? !u.warlord : false }));
                setRun({ ...run, list: { ...run.list, units: nextUnits } });
                close();
              }}
            >
              <Icon name={u.warlord ? 'check' : 'leader'} size={22} />
              {u.warlord ? 'Warlord' : 'Make Warlord'}
            </button>
          )}
          {run.list.units.length > 1 && (
            <button
              type="button"
              style={{ color: '#ef4444' }}
              onClick={() => {
                setRun(dismissUnit(run, u.uid));
                play('bad');
                setInfo(`Dismissed ${u.datasheet}`);
                close();
              }}
            >
              <Icon name="delete" size={22} />Dismiss Squad
            </button>
          )}
        </>
      );
    }

    return (
      <div
        className="ab-pop-backdrop"
        style={{ zIndex: 150 }}
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <div
          className="ab-pop"
          style={{ left, top, width: w, maxHeight, zIndex: 151 }}
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </div>
      </div>
    );
  };

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
        <div className="cmp-modal-backdrop" onClick={closeRoster}>
          <div className="cmp-armory-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cmp-armory-header">
              <button type="button" className="appbar-back-btn" aria-label="Back" onClick={closeRoster}>&lt;</button>
              <div className="cmp-armory-header-center">
                <div className="cmp-armory-title">Roster & Armory</div>
                <div className="cmp-armory-sub">{pts} pts · {run.list.units.length} units in force</div>
              </div>
              <div className="cmp-armory-header-right">
                <span className="cmp-scrap"><Icon name="shop" size={14} /> <b>{run.scrap ?? 0}</b></span>
                <button type="button" className="cmp-close-btn" onClick={closeRoster} aria-label="Close" title="Close">
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

              {rosterTab === 'roster' && (() => {
                const unitPanel = (u: ArmyUnitEntry) => {
                  const sheet = fac.datasheets.find((x) => x.name === u.datasheet);
                  const canLead = Boolean(sheet?.leads && sheet.leads.length > 0);
                  const sizeOpts = sheet ? pointsOptions(sheet) : [];
                  const canResize = sizeOpts.length > 1;
                  const enhOpts = fac ? enhancementOptions(run.list, fac, u) : [];
                  const canTakeEnh = enhOpts.length > 0 || Boolean(u.enhancement);
                  const attachedSquad = u.attachTo ? run.list.units.find((x) => x.uid === u.attachTo) : undefined;

                  const isSheetOpen = isSectionOpen(u.uid, 'sheet', false);
                  const isHonorsOpen = isSectionOpen(u.uid, 'honors', true);
                  const isWargearOpen = isSectionOpen(u.uid, 'wargear', true);
                  const isEnhOpen = isSectionOpen(u.uid, 'enh', false);
                  const isSizeOpen = isSectionOpen(u.uid, 'size', false);
                  const isAttachOpen = isSectionOpen(u.uid, 'attach', false);

                  return (
                    <div className="ab-inline" key={`panel-${u.uid}`}>
                      <div className="ab-inline-body">
                        {/* 1. Datasheet Profile & Rules */}
                        {sheet && (
                          <div className="ab-collapsible-section">
                            <button type="button" className="ab-section-toggle" onClick={() => toggleSection(u.uid, 'sheet', false)}>
                              <span className="row gap-2" style={{ alignItems: 'center' }}>
                                <Icon name={isSheetOpen ? 'down' : 'next'} size={16} />
                                <span>Datasheet Profile & Rules</span>
                              </span>
                              <span className="tiny muted">{isSheetOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
                            </button>
                            {isSheetOpen && <DatasheetView sheet={sheet} factionId={fac.id} />}
                          </div>
                        )}

                        {/* 2. Battle Honors */}
                        <div className="ab-collapsible-section field">
                          <button type="button" className="ab-section-toggle" onClick={() => toggleSection(u.uid, 'honors', true)}>
                            <span className="row gap-2" style={{ alignItems: 'center' }}>
                              <Icon name={isHonorsOpen ? 'down' : 'next'} size={16} />
                              <Icon name="shop" size={15} />
                              <b>Battle Honors (Veterancy)</b>
                              {u.honors?.length ? <span className="ab-badge-selected">{u.honors.length} honors</span> : null}
                            </span>
                            <span className="tiny muted">{isHonorsOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
                          </button>
                          {isHonorsOpen && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, marginTop: 8 }}>
                              {BATTLE_HONORS.map((h) => {
                                const has = (u.honors ?? []).includes(h.id);
                                const canAfford = (run.scrap ?? 0) >= h.cost;
                                return (
                                  <div key={h.id} style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                    <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <b style={{ color: '#f8fafc', fontSize: 13.5 }}>{h.name}</b>
                                        <span className="cmp-scrap"><Icon name="shop" size={12} /> {h.cost}</span>
                                      </div>
                                      <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4, lineHeight: 1.35 }}>{h.desc}</div>
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
                          )}
                        </div>

                        {/* 3. Wargear Options with Scrap mode */}
                        {sheet && (sheet.wargearOptions?.length || sheet.wargearCosts?.length) ? (
                          <div className="ab-collapsible-section field">
                            <button type="button" className="ab-section-toggle" onClick={() => toggleSection(u.uid, 'wargear', true)}>
                              <span className="row gap-2" style={{ alignItems: 'center' }}>
                                <Icon name={isWargearOpen ? 'down' : 'next'} size={16} />
                                <Icon name="wargear" size={15} />
                                <b>Wargear Options</b>
                                {u.wargearPts ? <span className="ab-badge-selected">+{u.wargearPts} pts (Scrap)</span> : null}
                              </span>
                              <span className="tiny muted">{isWargearOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
                            </button>
                            {isWargearOpen && (
                              <WargearEditor
                                sheet={sheet}
                                u={u}
                                scrapMode={true}
                                onChange={(patch) => {
                                  const next = { ...u, ...patch };
                                  const synced = syncWargear(sheet, next);
                                  const prevWargearPts = u.wargearPts ?? 0;
                                  const nextWargearPts = synced.wargearPts ?? 0;
                                  const scrapDiff = nextWargearPts - prevWargearPts;
                                  if (scrapDiff > 0 && (run.scrap ?? 0) < scrapDiff) {
                                    setInfo(`Need ${scrapDiff} Scrap for this wargear upgrade!`);
                                    play('bad');
                                    return;
                                  }
                                  const nextScrap = (run.scrap ?? 0) - scrapDiff;
                                  const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? synced : x));
                                  setRun({ ...run, scrap: Math.max(0, nextScrap), list: { ...run.list, units: updatedUnits } });
                                  if (scrapDiff > 0) {
                                    setInfo(`Equipped wargear (-${scrapDiff} Scrap)`);
                                    play('good');
                                  } else if (scrapDiff < 0) {
                                    setInfo(`Unequipped wargear (+${-scrapDiff} Scrap refunded)`);
                                    play('good');
                                  } else {
                                    play('tick');
                                  }
                                }}
                              />
                            )}
                          </div>
                        ) : null}

                        {/* 4. Detachment Enhancements (with Scrap) */}
                        {(canTakeEnh || u.enhancement) && (
                          <div className="ab-collapsible-section field">
                            <button type="button" className="ab-section-toggle" onClick={() => toggleSection(u.uid, 'enh', false)}>
                              <span className="row gap-2" style={{ alignItems: 'center' }}>
                                <Icon name={isEnhOpen ? 'down' : 'next'} size={16} />
                                <Icon name="enhancement" size={15} />
                                <b>Enhancement (Scrap)</b>
                                {u.enhancement && <span className="ab-badge-selected">{u.enhancement} (+{u.enhancementPts} pts)</span>}
                              </span>
                              <span className="tiny muted">{isEnhOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
                            </button>
                            {isEnhOpen && (
                              <div style={{ marginTop: 8 }}>
                                {u.enhancement && (
                                  <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span className="chip warn small" style={{ fontWeight: 700 }}>Currently Equipped</span>
                                      <b style={{ color: '#fef08a', fontSize: 13.5 }}>{u.enhancement}</b>
                                      <span className="tiny muted">(+{u.enhancementPts ?? 0} pts)</span>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn small"
                                      style={{ border: '1px solid #ef4444', background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5' }}
                                      onClick={() => {
                                        setRun(removeEnhancementFromUnit(run, u.uid));
                                        play('bad');
                                      }}
                                    >
                                      Unequip & Refund (+{enhancementScrapCost(u.enhancementPts ?? 0)} Scrap)
                                    </button>
                                  </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                                  {enhOpts.map((o) => {
                                    const isCurrent = u.enhancement === o.name;
                                    const taken = run.list.units.find((x) => x.uid !== u.uid && x.enhancement === o.name);
                                    const fit = sheet ? enhancementFits(o.text, [...sheet.keywords, ...sheet.factionKeywords, sheet.name, ...(u.mark ? [u.mark] : [])]) : null;
                                    const cost = enhancementScrapCost(o.pts);
                                    const refund = u.enhancement ? enhancementScrapCost(u.enhancementPts ?? 0) : 0;
                                    const netCost = cost - refund;
                                    const canAfford = netCost <= 0 || (run.scrap ?? 0) >= netCost;
                                    return (
                                      <div
                                        key={o.detachment + o.name}
                                        style={{
                                          padding: 10,
                                          borderRadius: 8,
                                          background: isCurrent ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255,255,255,0.04)',
                                          border: isCurrent ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          justifyContent: 'space-between',
                                          gap: 8,
                                          opacity: taken || (fit && !fit.ok) ? 0.6 : 1,
                                        }}
                                      >
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                                            <div>
                                              <b style={{ color: isCurrent ? '#fef08a' : '#f8fafc', fontSize: 13.5 }}>{o.name}</b>
                                              <div className="tiny muted">{o.detachment} · +{o.pts} pts</div>
                                            </div>
                                            <span className="cmp-scrap"><Icon name="shop" size={12} /> {cost}</span>
                                          </div>
                                          {fit && !fit.ok && <div style={{ marginTop: 4, color: '#f87171', fontSize: 11.5, fontWeight: 600 }}>Requires: {fit.need}</div>}
                                          {o.text && <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.35 }}><Em text={o.text} /></div>}
                                        </div>
                                        <div style={{ marginTop: 8 }}>
                                          {isCurrent ? (
                                            <span className="chip ok small" style={{ width: '100%', justifyContent: 'center' }}>
                                              <Icon name="check" size={12} /> Equipped
                                            </span>
                                          ) : taken ? (
                                            <span className="chip subtle small" style={{ width: '100%', justifyContent: 'center', color: '#94a3b8' }}>
                                              Equipped on {taken.datasheet}
                                            </span>
                                          ) : fit && !fit.ok ? (
                                            <button type="button" className="btn small" disabled style={{ width: '100%' }}>Not Eligible</button>
                                          ) : (
                                            <button
                                              type="button"
                                              className="btn small primary"
                                              disabled={!canAfford}
                                              style={{ width: '100%' }}
                                              onClick={() => {
                                                setRun(buyEnhancementForUnit(run, fac, u.uid, o.name, o.pts));
                                                play('good');
                                              }}
                                            >
                                              {!canAfford ? `Need Scrap (${netCost > 0 ? netCost : cost})` : `Equip (${cost} Scrap)`}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 5. Squad Size & Reinforce */}
                        {canResize && (
                          <div className="ab-collapsible-section field">
                            <button type="button" className="ab-section-toggle" onClick={() => toggleSection(u.uid, 'size', false)}>
                              <span className="row gap-2" style={{ alignItems: 'center' }}>
                                <Icon name={isSizeOpen ? 'down' : 'next'} size={16} />
                                <Icon name="size" size={15} />
                                <b>Squad Size & Reinforce</b>
                                <span className="ab-badge-selected">{u.models} models</span>
                              </span>
                              <span className="tiny muted">{isSizeOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
                            </button>
                            {isSizeOpen && (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 8 }}>
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
                                        <b style={{ color: '#f8fafc', fontSize: 13.5 }}>{o.models} {o.models === 1 ? 'model' : 'models'}</b>
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
                            )}
                          </div>
                        )}

                        {/* 6. Squad Attachment */}
                        {canLead && (
                          <div className="ab-collapsible-section field">
                            <button type="button" className="ab-section-toggle" onClick={() => toggleSection(u.uid, 'attach', false)}>
                              <span className="row gap-2" style={{ alignItems: 'center' }}>
                                <Icon name={isAttachOpen ? 'down' : 'next'} size={16} />
                                <Icon name="swords" size={15} />
                                <b>Squad Attachment</b>
                                {u.attachTo ? <span className="ab-badge-selected">Attached with {attachedSquad?.datasheet}</span> : <span className="tiny muted">(Solo)</span>}
                              </span>
                              <span className="tiny muted">{isAttachOpen ? 'Tap to collapse' : 'Tap to expand'}</span>
                            </button>
                            {isAttachOpen && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
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
                                  style={{
                                    padding: '10px 12px',
                                    borderRadius: 8,
                                    background: !u.attachTo ? 'rgba(217, 155, 38, 0.12)' : '#181B22',
                                    border: !u.attachTo ? '1.5px solid #F59E0B' : '1px solid #262930',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    cursor: !u.attachTo ? 'default' : 'pointer',
                                  }}
                                >
                                  <div>
                                    <b style={{ color: !u.attachTo ? '#F59E0B' : '#F8FAFC', fontSize: 13.5 }}>Solo Operation (Unattached)</b>
                                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Operates independently as a single Character</div>
                                  </div>
                                  {!u.attachTo && <span className="chip ok small"><Icon name="check" size={12} /> Active</span>}
                                </div>
                                {attachOptions(run.list, fac, u).map((opt) => {
                                  const body = run.list.units.find((x) => x.uid === opt.uid);
                                  if (!body) return null;
                                  const isCurrent = u.attachTo === body.uid;
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
                                      style={{
                                        padding: '10px 12px',
                                        borderRadius: 8,
                                        background: isCurrent ? 'rgba(245, 158, 11, 0.12)' : '#181B22',
                                        border: isCurrent ? '1.5px solid #F59E0B' : '1px solid #262930',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        cursor: isCurrent ? 'default' : 'pointer',
                                      }}
                                    >
                                      <div>
                                        <b style={{ color: isCurrent ? '#F59E0B' : '#F8FAFC', fontSize: 13.5 }}>{body.datasheet}</b>
                                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{body.models} models · {body.pts + (body.wargearPts ?? 0)} pts</div>
                                      </div>
                                      {isCurrent ? <span className="chip ok small"><Icon name="check" size={12} /> Attached</span> : <span className="btn small">Attach</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        <button type="button" className="ab-moreinfo" onClick={() => setMenu(null)}>
                          Close <Icon name="down" size={18} />
                        </button>
                      </div>
                    </div>
                  );
                };

                const unitRow = (u: ArmyUnitEntry, inGroup = false) => {
                  const sheet = fac.datasheets.find((x) => x.name === u.datasheet);
                  const body = u.attachTo ? run.list.units.find((b) => b.uid === u.attachTo) : undefined;
                  const leads = body;
                  const wg = wargearSummary(sheet, u);
                  const line = [
                    u.warlord && 'Warlord',
                    leads && (inGroup ? 'Attached Leader' : `Attached with ${leads.datasheet}`),
                    u.honors?.length ? `${u.honors.length} Battle ${u.honors.length === 1 ? 'Honor' : 'Honors'}` : null,
                  ].filter(Boolean).join(' · ');

                  const isOpen = menu === u.uid;
                  const row = (
                    <div key={u.uid} className={`ab-row ${inGroup ? 'in-group' : ''} ${isOpen ? 'open' : ''}`}>
                      <button type="button" className="ab-row-main" onClick={() => setMenu(isOpen ? null : u.uid)}>
                        <span className="ab-art-wrap"><UnitArt sheet={sheet} /></span>
                        <span className="ab-row-text">
                          <span className="ab-name">{u.datasheet} <span className="ab-count">({u.models})</span></span>
                          <span className="ab-pts">
                            {u.pts + (u.wargearPts ?? 0) + (u.enhancementPts ?? 0)} pts
                            <span className="cmp-rank-badge" style={{ marginLeft: 6 }}>{rankLabel(u.xp)} (XP {u.xp ?? 0})</span>
                            {u.enhancement && <span className="ab-enh" style={{ marginLeft: 6 }}> {u.enhancement}</span>}
                          </span>
                          {line && <span className="ab-sub">{line}</span>}
                          {wg && <span className="ab-sub ab-wg"><Icon name="wargear" size={13} /> {wg}</span>}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ab-kebab"
                        aria-label={`Options for ${u.datasheet}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          setPop({ uid: u.uid, x: r.right, y: r.bottom });
                        }}
                      >
                        <Icon name="more" size={22} />
                      </button>
                    </div>
                  );

                  return isOpen ? [row, unitPanel(u)] : row;
                };

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {SECTIONS.filter((sec) => sec.id !== 'allies' || run.list.units.some((u) => sectionOf(fac.datasheets.find((x) => x.name === u.datasheet), run.factionId) === 'allies')).map((sec) => {
                      const joined = (b: ArmyUnitEntry) => run.list.units.filter((c) => c.attachTo === b.uid);
                      const homeOf = (u: ArmyUnitEntry): string => {
                        const body = u.attachTo ? run.list.units.find((b) => b.uid === u.attachTo) : undefined;
                        if (body) return homeOf(body);
                        const first = joined(u)[0];
                        const d = fac.datasheets.find((x) => x.name === (first ?? u).datasheet);
                        return sectionOf(d, run.factionId);
                      };
                      const us = run.list.units.filter((u) => (!u.attachTo || !run.list.units.some((b) => b.uid === u.attachTo)) && homeOf(u) === sec.id);
                      if (!us.length) return null;

                      const squadRows = (u: ArmyUnitEntry, inGroup: boolean) => [
                        ...joined(u).map((c) => unitRow(c, true)),
                        unitRow(u, inGroup || joined(u).length > 0),
                      ];

                      return (
                        <section key={sec.id} className="ab-section">
                          <div className="ab-section-head">
                            <span>{sec.title}</span>
                            <button type="button" className="ab-add" aria-label={`Recruit ${sec.title}`} onClick={() => setRosterTab('recruit')}>+</button>
                          </div>
                          {us.map((u) => {
                            const attachCount = joined(u).length;
                            if (!attachCount) return unitRow(u);
                            return (
                              <div key={u.uid} className="ab-group">
                                {squadRows(u, true)}
                              </div>
                            );
                          })}
                        </section>
                      );
                    })}
                  </div>
                );
              })()}

              {rosterTab === 'recruit' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="cmp-armory-hint">
                    Recruit reinforcements into your strike force using accumulated Scrap currency.
                  </div>

                  <input
                    placeholder="Search datasheets to recruit…"
                    value={recruitQ}
                    onChange={(e) => setRecruitQ(e.target.value)}
                  />

                  {(() => {
                    const qClean = recruitQ.trim().toLowerCase();
                    const availableSheets = fac.datasheets.filter(
                      (d) => !d.ally && d.points?.[0]?.options?.length && !d.keywords?.includes('FORTIFICATION')
                    );
                    const matchesQ = (d: DatasheetData) =>
                      !qClean ||
                      d.name.toLowerCase().includes(qClean) ||
                      (d.role && d.role.toLowerCase().includes(qClean)) ||
                      (d.keywords && d.keywords.some((k) => k.toLowerCase().includes(qClean)));

                    const filtered = availableSheets.filter(matchesQ);
                    if (!filtered.length) {
                      return <div className="ab-empty">No datasheets found matching &quot;{recruitQ}&quot;</div>;
                    }

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {SECTIONS.filter((sec) => sec.id !== 'allies').map((sec) => {
                          const sheetsInSec = filtered.filter((d) => sectionOf(d, fac.id) === sec.id);
                          if (!sheetsInSec.length) return null;

                          return (
                            <section key={sec.id} className="ab-section">
                              <div className="ab-section-head">
                                <span>{sec.title}</span>
                                <span className="tiny muted" style={{ textTransform: 'none' }}>{sheetsInSec.length} available</span>
                              </div>
                              <div className="ab-pick">
                                {sheetsInSec.map((d) => {
                                  const opts = pointsOptions(d);
                                  const count = run.list.units.filter((u) => u.datasheet === d.name).length;
                                  const isEpicHero = (d.keywords || []).includes('EPIC HERO');
                                  const alreadyInForce = isEpicHero && count > 0;
                                  const minCost = cheapest(d)?.pts ?? opts[0]?.pts ?? 0;
                                  const canAffordAny = (run.scrap ?? 0) >= minCost;
                                  const isOpenPeek = recruitView === d.name;
                                  const isOpenSize = recruitSize === d.name;

                                  return [
                                    <div
                                      key={d.name}
                                      className={`ab-row ${isOpenPeek ? 'open' : ''}`}
                                      style={alreadyInForce ? { opacity: 0.6 } : undefined}
                                    >
                                      <button
                                        type="button"
                                        className="ab-row-main"
                                        onClick={() => setRecruitView(isOpenPeek ? null : d.name)}
                                      >
                                        <span className="ab-art-wrap"><UnitArt sheet={d} /></span>
                                        <span className="ab-row-text">
                                          <span className="ab-name">
                                            {d.name}
                                            {count ? <span className="ab-count"> ×{count}</span> : null}
                                            {isEpicHero && (
                                              <span className="chip subtle small" style={{ marginLeft: 6, color: '#c084fc', borderColor: 'rgba(192, 132, 252, 0.4)', background: 'rgba(192, 132, 252, 0.12)', fontSize: '11px', padding: '1px 6px' }}>
                                                Epic Hero
                                              </span>
                                            )}
                                          </span>
                                          <span className="ab-pts">
                                            {opts.map((o) => `${o.models}: ${o.pts}`).join(' / ')} Scrap
                                          </span>
                                          <span className="ab-sub">
                                            {alreadyInForce
                                              ? 'Already Recruited (Limit 1)'
                                              : d.role || (d.keywords ? d.keywords.slice(0, 3).join(', ') : '')}
                                          </span>
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className="ab-add dark"
                                        aria-label={`Recruit ${d.name}`}
                                        title={alreadyInForce ? 'Limit 1 (Already recruited)' : !canAffordAny ? `Need ${minCost} Scrap` : `Recruit ${d.name}`}
                                        disabled={alreadyInForce || !canAffordAny}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (alreadyInForce) return;
                                          if (opts.length > 1) {
                                            setRecruitSize(isOpenSize ? null : d.name);
                                          } else if (canAffordAny) {
                                            const next = recruitUnit(run, fac, d.name, opts[0].models);
                                            if (next !== run) {
                                              setRun(next);
                                              play('good');
                                              setInfo(`Recruited ${d.name}!`);
                                            }
                                          }
                                        }}
                                      >
                                        +
                                      </button>
                                    </div>,
                                    isOpenSize && (
                                      <div key={`size-${d.name}`} className="ab-add-size">
                                        <div className="ab-pop-head">Unit size · {d.name}</div>
                                        {opts.map((o) => {
                                          const canAfford = (run.scrap ?? 0) >= o.pts;
                                          const disabled = !canAfford || alreadyInForce;
                                          return (
                                            <button
                                              key={o.models}
                                              type="button"
                                              className="ab-pop-size"
                                              disabled={disabled}
                                              onClick={() => {
                                                if (disabled) return;
                                                const next = recruitUnit(run, fac, d.name, o.models);
                                                if (next !== run) {
                                                  setRun(next);
                                                  play('good');
                                                  setInfo(`Recruited ${d.name} (${o.models} models)!`);
                                                  setRecruitSize(null);
                                                }
                                              }}
                                            >
                                              <span className="ab-pop-models">{o.models} {o.models === 1 ? 'model' : 'models'}</span>
                                              <span className="ab-pop-pts">{o.pts} Scrap</span>
                                              <span className="ab-pop-plus">
                                                {disabled ? (alreadyInForce ? 'Limit 1' : 'Need Scrap') : '+ Recruit'}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    ),
                                    isOpenPeek && (
                                      <div className="ab-inline" key={`peek-${d.name}`}>
                                        <div className="ab-inline-body">
                                          <DatasheetView sheet={d} factionId={fac.id} />
                                          <button type="button" className="ab-moreinfo" onClick={() => setRecruitView(null)}>
                                            Close <Icon name="down" size={18} />
                                          </button>
                                        </div>
                                      </div>
                                    ),
                                  ];
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    );
                  })()}
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
              <button className="cmp-footer-btn" onClick={closeRoster}>
                <Icon name="check" size={18} />
                <span>Done</span>
              </button>
            </div>
          </div>
          {quickMenu()}
        </div>
      )}

      {info && <div className="toast" role="status">{info}</div>}
    </div>
  );
}
