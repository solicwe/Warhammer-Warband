// The campaign screen: pick a faction, then walk a branching map of short battles to the boss.
// Features a full roguelike engine: scrap currency, the army tree (Renown), VETERAN units, armory, medicae tents,
// and in-campaign roster customization.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { loadRun, saveRun } from '../services/storage';
import { buildUnits, loadoutLines, attachOptions, autoAttach, canLeaderAttach, defaultWargear, embarkCheck, enhancementFits, enhancementOptions, listPoints, parseTransport, pointsOptions, supportIn, syncList, syncWargear, transportLoads, wargearSummary } from '../engine/army';
import { autoList, playable } from '../engine/autoList';
import { adoptDetachment, afterBattle, ALL_PLAYABLE_FACTIONS, applyCampaign, applyMedicaeService, campaignMission, enemyDetachmentCount, enemyDetachments, bossRuleById, buyEnhancementForUnit, canRecruitTitanOrKnight, changeSquadSize, cheapest, continueNextLoop, detachmentScrapCost, dupeMultiplier, enhancementScrapCost, enter, getFactionFamily, isFactionAllowedKnight, newRun, reachable, recruitScrapCost, recruitUnit, relicById, relicDesc, removeEnhancementFromUnit, requiresTitanRequisition, rerollOffer, sellUnit, sellValue, START_POINTS, takeReward, type MapNode, type Reward, type Run } from '../engine/campaign';
import { enemyTreePoints, isVeteran, titanKeystone, VETERAN_BATTLES } from '../engine/campaignTree';
import { ArmyTree } from './ArmyTree';
import { detachmentAllyOf } from '../engine/allies';
import { hasFactionRules } from '../rules-engine/effects';
import { createGame } from '../engine/game';
import type { ArmyUnitEntry, DatasheetData, FactionData, GameState } from '../engine/types';
import { Emblem, KINDS, SECTIONS, sectionOf, UnitArt, unitKind, WargearEditor } from './ArmyBuilder';
import { armyColor, DatasheetView, weaponCounts } from './Sheet';
import { loadFaction, type FactionIndex } from './data';
import { Icon, type IconName } from './Icon';
import { withAutoRules } from './library';
import { getPortrait, hasRealPortrait } from './portraits';
import { RelicToken } from './Relics';
import { play } from './sfx';
import { Em } from './Em';
import { WarRoomModal } from './WarRoomModal';
import {
  calculateHoardInterest,
  calculateGarrisonBuffs,
  autoOptimizePreBattle,
  setTacticalClock,
  setApexDesignation,
  buyMunitorumAmmo,
  fortifyGarrisonNode,
  selectPatronContract,
  absorbBossRule,
  TACTICAL_CLOCK_DIRECTIVES,
  APEX_DESIGNATIONS,
  MUNITORUM_AMMO,
  PATRON_CONTRACTS,
  type TacticalClockDirectiveId,
  type MunitorumAmmoId,
  type PatronContractId,
} from '../engine/campaignSystems';

interface Props {
  index: FactionIndex | null;
  /** the battle saved on this device (a campaign battle in progress or just finished) */
  saved: GameState | null;
  onBack: () => void;
  onPlay: (s: GameState) => void;
  onClearSaved: () => void;
}

const KIND: Record<MapNode['kind'], { name: string; icon: IconName; note: string }> = {
  battle: { name: 'Battle', icon: 'fight', note: 'A full battle: the mission, Tactical secondaries, 5 rounds. Win to earn Scrap and rewards.' },
  elite: { name: 'Elite Miniboss', icon: 'skull', note: 'A full battle against a tougher foe with a boss rule. Yields high Scrap and rare relics.' },
  armory: { name: 'Munitorum Depot', icon: 'shop', note: '+25 Scrap, then take one: a reinforcement unit for free, or a relic (one you hold levels up).' },
  medicae: { name: 'Medicae Field Camp', icon: 'heal', note: 'Repair Fleet Integrity, hold a tactical briefing for +1 CP per battle, or refund army tree nodes.' },
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
  const [showWarRoom, setShowWarRoom] = useState(false);
  const [warRoomTab, setWarRoomTab] = useState<'compression' | 'highCommand' | 'tacticalClock' | 'patron'>('compression');
  const [dismissPatronModal, setDismissPatronModal] = useState(false);
  const [ammoShopTarget, setAmmoShopTarget] = useState<MunitorumAmmoId | null>(null);
  const [rosterTab, setRosterTab] = useState<'roster' | 'tech' | 'detachments'>('roster');
  /** the roster section whose + was tapped: its recruit list is open */
  const [recruitSec, setRecruitSec] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [panelCollapse, setPanelCollapse] = useState<Record<string, Record<string, boolean>>>({});
  const [pop, setPop] = useState<{ uid: string; x: number; y: number; mode?: 'squad' | 'leader' | 'support' | 'embark' | 'size' } | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [recruitQ, setRecruitQ] = useState('');
  const [recruitSize, setRecruitSize] = useState<string | null>(null);
  const [recruitView, setRecruitView] = useState<string | null>(null);

  const closeRoster = () => {
    setShowRoster(false);
    setRecruitSec(null);
    setPop(null);
    setPeek(null);
    setRecruitSize(null);
    setRecruitView(null);
  };

  const isSectionOpen = (uid: string, section: string, defaultOpen = false) => {
    return panelCollapse[uid]?.[section] !== undefined ? panelCollapse[uid][section] : defaultOpen;
  };
  const toggleSection = (uid: string, section: string, defaultOpen = false) => {
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
    if (battle.idleTactic) next.idleTactic = battle.idleTactic;
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
      const enemies = ALL_PLAYABLE_FACTIONS.filter((id) => id !== f.id && id !== 'TL');
      setFac(f);
      const nr = newRun(f, list, enemies, seed);
      setRun(nr);
      play('turn');
    } catch (e) { setErr(`Could not start: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };

  const fight = async (node: MapNode) => {
    if (!run || !fac || !node.enemy) return;
    setBusy(true); setErr(null);
    try {
      const enemyFactionId = typeof node.enemy.factionId === 'string' ? node.enemy.factionId : String((node.enemy.factionId as any)?.id || (node.enemy.factionId as any)?.name || 'ORK');
      let ef = await loadFaction(enemyFactionId).catch(() => null);
      if (!ef || !playable(ef)) ef = await loadFaction('ORK');
      const base = autoList(ef, node.enemy.pts, node.enemy.seed);
      // later battles: the enemy brings more detachments
      const enemyList = { ...base, detachments: enemyDetachments(ef, base.detachments, enemyDetachmentCount(run, node.kind), node.enemy.seed) };
      const r = run.fighting === node.id ? run : enter(run, node.id, fac);
      const isBoss = node.kind === 'boss';
      const m = campaignMission(node);
      const s = createGame({
        lists: [syncList(r.list, fac), autoAttach(syncList(enemyList, ef), ef)], factions: [fac, ef],
        names: ['You', isBoss ? `${ef.name} Warlord` : ef.name], secondaryMode: m.secondaryMode, maxRounds: m.maxRounds, seed: node.enemy.seed,
        dispositions: m.dispositions,
      });
      s.botPlayer = 1;
      s.idleBots = [1];
      s.bots = [0, 1];
      if (s.phase === 'deploy') {
        s.autoDeploy = [0, 1];
        s.deployAllOnField = [0, 1];
      }
      s.botLevel = node.enemy.level;
      applyCampaign(s, r, node.enemy.rules || []);
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
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82em', color: '#f8fafc', background: '#1e293b', borderRadius: 6, overflow: 'hidden' }}>
                <thead>
                  <tr style={{ background: '#334155', textAlign: 'left', borderBottom: '1px solid #475569' }}>
                    <th style={{ padding: '6px 10px', color: '#fef08a' }}>Core System</th>
                    <th style={{ padding: '6px 10px', color: '#fef08a' }}>Mechanics</th>
                    <th style={{ padding: '6px 10px', color: '#fef08a' }}>Tactical Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#38bdf8', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="heal" size={13} />
                        <span>Fleet Integrity</span>
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px' }}>100 HP Health Bar</td>
                    <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>Defeats deal scaled damage; comeback supply drops at 75, 50, 25 HP</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#38bdf8', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="shop" size={13} />
                        <span>Scrap Economy</span>
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px' }}>10% Interest & Consolation</td>
                    <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>Defeats award bonus Scrap (Damage x 3) to fund rapid comeback recruits</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#38bdf8', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="shield" size={13} />
                        <span>Compression Engine</span>
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px' }}>Merge Duplicates (Tier I-III)</td>
                    <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>Deploy max 8 squads; elite multipliers without board clutter or lag</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#38bdf8', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="tabletop" size={13} />
                        <span>War Room Council</span>
                      </span>
                    </td>
                    <td style={{ padding: '6px 10px' }}>Clock & Advisors</td>
                    <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>Pre-set 5 turn directives and Command Phase advisor perks</td>
                  </tr>
                </tbody>
              </table>
            </div>
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
    const u = pop ? run.list.units.find((x) => x.uid === pop.uid) : undefined;
    if (!pop || !u || !fac) return null;
    const sheet = fac.datasheets.find((d) => d.name === u.datasheet);
    const body = u.attachTo ? run.list.units.find((b) => b.uid === u.attachTo) : undefined;
    const joined = run.list.units.filter((c) => c.attachTo === u.uid).map((c) => ({ c, d: fac.datasheets.find((d) => d.name === c.datasheet) }));
    const rider = body ?? u; // a Leader rides with the unit it leads
    const rideIn = rider.embarkIn ? run.list.units.find((t) => t.uid === rider.embarkIn) : undefined;
    const isTransport = !!parseTransport(sheet?.transport) || !!sheet?.keywords.includes('TRANSPORT');
    // transports this unit could ride (a full one still shows, in red) / units this transport could carry
    const rides = isTransport ? [] : run.list.units.filter((t) => t.uid !== rider.uid && parseTransport(fac.datasheets.find((d) => d.name === t.datasheet)?.transport))
      .map((t) => ({ t, c: embarkCheck(run.list, fac, rider.uid, t.uid) })).filter(({ c }) => !c.why || c.full);
    const myLoad = transportLoads(run.list, fac).find((t) => t.uid === u.uid);
    const cargo = !myLoad ? [] : run.list.units.filter((r) => r.uid !== u.uid && !r.attachTo)
      .filter((r) => !r.embarkIn || r.embarkIn === u.uid || !run.list.units.some((t) => t.uid === r.embarkIn))
      .map((r) => ({ r, c: embarkCheck(run.list, fac, r.uid, u.uid) })).filter(({ c }) => !c.why || c.full);
    // once units are aboard, only they and what still fits show; an empty transport lists everything it can carry
    const aboard = cargo.some(({ r }) => r.embarkIn === u.uid);
    const cargoShown = aboard ? cargo.filter(({ r, c }) => r.embarkIn === u.uid || !c.full) : cargo;
    const opts = sheet ? pointsOptions(sheet) : [];
    const isChar = !!sheet?.keywords.includes('CHARACTER')
      || (run.list.detachments?.includes('Houndpack Lance') && !!sheet?.keywords.includes('WAR DOG'))
      || run.factionId === 'TL'
      || !!sheet?.keywords.includes('ADEPTUS TITANICUS')
      || !!sheet?.factionKeywords.includes('ADEPTUS TITANICUS');

    const allowed = (x: { subfaction?: string }) => {
      if (!x.subfaction) return true;
      if (run.list.subfaction && x.subfaction === run.list.subfaction) return true;
      if (!run.list.subfaction) return true;
      if (sheet && (canLeaderAttach(sheet, x as DatasheetData) || canLeaderAttach(x as DatasheetData, sheet))) return true;
      return false;
    };
    // characters that could join this squad: Leader slot, then Support slot
    const leadersFor = (support: boolean) => fac.datasheets.filter((d) => allowed(d) && !d.ally && sheet && canLeaderAttach(d, sheet) && supportIn(run.list, d) === support && pointsOptions(d).length);
    const hasLeader = joined.some((x) => x.d && !supportIn(run.list, x.d));
    const hasSupport = joined.some((x) => x.d && supportIn(run.list, x.d));
    const canLeader = !u.attachTo && !hasLeader && leadersFor(false).length > 0;
    const canSupport = !u.attachTo && !hasSupport && leadersFor(true).length > 0;
    // a Leader in a squad: Add Support works on the squad it leads
    const bodySheet = body ? fac.datasheets.find((d) => d.name === body.datasheet) : undefined;
    const bodySupport = body && bodySheet && !supportIn(run.list, sheet) && !run.list.units.some((c) => c.attachTo === body.uid && supportIn(run.list, fac.datasheets.find((d) => d.name === c.datasheet)))
      && fac.datasheets.some((d) => allowed(d) && !d.ally && supportIn(run.list, d) && canLeaderAttach(d, bodySheet) && pointsOptions(d).length);
    const squadsFor = sheet?.leads?.length && !body ? fac.datasheets.filter((d) => allowed(d) && !d.ally && pointsOptions(d).length > 0 && canLeaderAttach(sheet, d)) : [];

    const close = () => { setPop(null); setPeek(null); };
    const w = pop.mode && pop.mode !== 'size' ? Math.min(340, window.innerWidth - 16) : 260;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, pop.x - w));
    const top = pop.mode && pop.mode !== 'size' ? Math.max(8, Math.min(pop.y + 4, window.innerHeight * 0.15)) : Math.max(8, Math.min(pop.y + 4, window.innerHeight * 0.45));
    const maxHeight = window.innerHeight - top - 8;

    const setUnit = (uid: string, patch: Partial<ArmyUnitEntry>) => {
      const units = run.list.units.map((x) => {
        if (x.uid !== uid) return x;
        const d = fac.datasheets.find((s) => s.name === x.datasheet);
        const untouched = patch.models !== undefined && patch.models !== x.models
          && JSON.stringify(x.wargear ?? []) === JSON.stringify(defaultWargear(d, { ...x, wargear: undefined }).wargear ?? []);
        const next = { ...x, ...patch };
        return syncWargear(d, untouched ? defaultWargear(d, { ...next, wargear: undefined }) : next);
      });
      setRun({ ...run, list: { ...run.list, units } });
    };

    const attach = (charUid: string, bodyUid: string, msg: string) => {
      setUnit(charUid, { attachTo: bodyUid, embarkIn: undefined });
      setInfo(msg);
      close();
    };

    /** The unit picture: tap it to read the datasheet (abilities) before adding. */
    const peekArt = (name: string) => (
      <span className="ab-pop-art" role="button" tabIndex={0} aria-label={`${name} datasheet`} onClick={(e) => { e.stopPropagation(); setPeek(name); }}>
        <UnitArt sheet={fac.datasheets.find((d) => d.name === name)} />
      </span>
    );

    /** Who this roster unit is already joined with ("with Chaos Lord", "led by Master of Executions"). */
    const joinedNote = (x: ArmyUnitEntry) => {
      const host = x.attachTo ? run.list.units.find((c) => c.uid === x.attachTo) : undefined;
      const led = run.list.units.filter((c) => c.attachTo === x.uid).map((c) => c.datasheet);
      return host ? `Joined with ${host.datasheet}` : led.length ? `Led by ${led.join(' + ')}` : 'Not joined yet';
    };

    /** A unit already in the roster (white): tap to use it. */
    const rosterCard = (x: ArmyUnitEntry, onPick: (x: ArmyUnitEntry) => void) => (
      <button key={`has-${x.uid}`} type="button" className="ab-pop-card has" onClick={() => onPick(x)}>
        <span className="ab-pop-card-head">
          {peekArt(x.datasheet)}
          <span className="ab-pop-card-text">
            <span className="ab-pop-name">{x.datasheet}</span>
            <span className="ab-pop-line"><span className="ab-pop-pts">{x.pts + (x.wargearPts ?? 0) + (x.enhancementPts ?? 0)} pts</span> <span className="muted">({x.models})</span></span>
            <span className="ab-pop-sub">{joinedNote(x)}</span>
          </span>
        </span>
      </button>
    );

    /** A datasheet to add new (grey), one + per size. */
    const newCard = (d: DatasheetData, onNew: (models: number) => void) => {
      const isEpicHero = (d.keywords || []).includes('EPIC HERO');
      const already = isEpicHero && run.list.units.some((x) => x.datasheet === d.name);
      const minCost = cheapest(d)?.pts ?? pointsOptions(d)[0]?.pts ?? 0;
      const canAffordAny = (run.scrap ?? 0) >= minCost;
      const isDim = already || !canAffordAny;
      return (
        <div key={`new-${d.name}`} className="ab-pop-card" style={isDim ? { opacity: 0.5, filter: 'grayscale(0.75)' } : undefined}>
          <div className="ab-pop-card-head">
            {peekArt(d.name)}
            <div className="ab-pop-card-text">
              <div className="ab-pop-name">{d.name}</div>
              {pointsOptions(d).map((o) => {
                const canAfford = (run.scrap ?? 0) >= o.pts;
                const disabled = !canAfford || already;
                return (
                  <button key={o.models} type="button" className="ab-pop-size" disabled={disabled} onClick={() => onNew(o.models)} style={disabled ? { opacity: 0.45, filter: 'grayscale(0.75)' } : undefined}>
                    <span className="ab-pop-pts">{o.pts} Scrap</span> <span className="muted">({o.models})</span>
                    <span className="ab-pop-plus">{already ? 'Limit 1' : canAfford ? '+' : 'Need Scrap'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    };

    /** A unit card for the embark lists: picture, names, a note under them. */
    const rideCard = (key: string, sheetName: string, title: string, note: string, cls: string, disabled: boolean, onClick: () => void, val?: string, r?: ArmyUnitEntry) => {
      const group = r ? [...run.list.units.filter((c) => c.attachTo === r.uid), r] : [];
      const leaders = group.slice(0, -1);
      const enh = group.filter((x) => x.enhancement).map((x) => `${x.enhancement} (${x.datasheet})`);
      return (
        <button key={key} type="button" className={`ab-pop-ride ${cls}`} disabled={disabled} onClick={onClick}>
          <span className="ab-ride-art">
            <UnitArt sheet={fac.datasheets.find((d) => d.name === sheetName)} />
            {leaders.length > 0 && <span className="ab-ride-leads">{leaders.map((c) => <UnitArt key={c.uid} sheet={fac.datasheets.find((d) => d.name === c.datasheet)} />)}</span>}
          </span>
          <span className="grow">{title}{enh.length > 0 && <span className="ab-pop-sub ab-ride-enh">{enh.join(' · ')}</span>}{note && <span className="ab-pop-sub">{note}</span>}</span>
          {val && <span className="ab-pop-val">{val}</span>}
          {cls === 'on' && <Icon name="check" size={20} />}
        </button>
      );
    };

    let content: React.ReactNode;
    if (pop.mode === 'squad') {
      content = (
        <>
          <div className="ab-pop-head">{supportIn(run.list, sheet) ? 'Add Squad (as Support)' : 'Add Squad (as Leader)'}</div>
          {attachOptions(run.list, fac, u).filter((b) => squadsFor.some((d) => d.name === b.datasheet))
            .map((b) => rosterCard(b, () => attach(u.uid, b.uid, `${u.datasheet} joined ${b.datasheet}`)))}
          {squadsFor.map((d) => newCard(d, (models) => {
            const nextRun = recruitUnit(run, fac, d.name, models);
            if (nextRun !== run) {
              const newBody = nextRun.list.units[nextRun.list.units.length - 1];
              const updatedUnits = nextRun.list.units.map((x) => (x.uid === u.uid ? { ...x, attachTo: newBody.uid, embarkIn: undefined } : x));
              setRun({ ...nextRun, list: { ...nextRun.list, units: updatedUnits } });
              setInfo(`Recruited ${d.name}; ${u.datasheet} joined it`);
              play('good');
              close();
            }
          }))}
        </>
      );
    } else if (pop.mode === 'leader' || pop.mode === 'support') {
      const support = pop.mode === 'support';
      content = (
        <>
          <div className="ab-pop-head">{support ? 'Add Support' : 'Add Leader'} · {u.datasheet}</div>
          {run.list.units.filter((c) => leadersFor(support).some((d) => d.name === c.datasheet) && attachOptions(run.list, fac, c).some((b) => b.uid === u.uid))
            .map((c) => rosterCard(c, () => attach(c.uid, u.uid, `${c.datasheet} joined ${u.datasheet}`)))}
          {leadersFor(support).map((d) => newCard(d, (models) => {
            const nextRun = recruitUnit(run, fac, d.name, models);
            if (nextRun !== run) {
              const newChar = nextRun.list.units[nextRun.list.units.length - 1];
              const updatedUnits = nextRun.list.units.map((x) => (x.uid === newChar.uid ? { ...x, attachTo: u.uid, embarkIn: undefined } : x));
              setRun({ ...nextRun, list: { ...nextRun.list, units: updatedUnits } });
              setInfo(`Recruited ${d.name} to ${u.datasheet}`);
              play('good');
              close();
            }
          }))}
        </>
      );
    } else if (pop.mode === 'embark' && myLoad) {
      // the transport's own menu: tick the units that start the battle inside it
      const names = (r: ArmyUnitEntry) => [...run.list.units.filter((c) => c.attachTo === r.uid).map((c) => c.datasheet), r.datasheet].join(' + ');
      content = (
        <>
          <div className="ab-pop-head">Embark · {u.datasheet} <span className="ab-pop-val">{myLoad.used}/{myLoad.capacity}</span></div>
          {cargoShown.map(({ r, c }) => {
            const on = r.embarkIn === u.uid;
            return rideCard(r.uid, r.datasheet, names(r), on ? `${c.need} slots · tap to disembark` : c.full ? `No room: needs ${c.need}, ${Math.max(0, c.capacity - c.used)} left` : `${c.need} slots`,
              on ? 'on' : c.full ? 'full' : '', !on && c.full,
              () => { setUnit(r.uid, { embarkIn: on ? undefined : u.uid }); setInfo(on ? `${r.datasheet} left ${u.datasheet}` : `${r.datasheet} starts embarked in ${u.datasheet}`); }, undefined, r);
          })}
        </>
      );
    } else if (pop.mode === 'embark') {
      content = (
        <>
          <div className="ab-pop-head">Start embarked{body ? ` (whole unit with ${body.datasheet})` : ''}</div>
          {rides.map(({ t, c }) => rideCard(t.uid, t.datasheet, t.datasheet, c.full ? `Full: needs ${c.need}, ${Math.max(0, c.capacity - c.used)} left` : '',
            rider.embarkIn === t.uid ? 'on' : c.full ? 'full' : '', c.full,
            () => { setUnit(rider.uid, { embarkIn: t.uid }); setInfo(`${rider.datasheet} starts embarked in ${t.datasheet}`); close(); }, `${c.used}/${c.capacity}`))}
        </>
      );
    } else if (pop.mode === 'size') {
      content = (
        <>
          <div className="ab-pop-head">Unit size · {u.datasheet}</div>
          {opts.map((o) => {
            const isCurrent = u.models === o.models;
            const currentOpt = opts.find((x) => x.models === u.models) ?? { pts: u.pts };
            const diff = o.pts - currentOpt.pts;
            const canAfford = diff <= 0 || (run.scrap ?? 0) >= diff;
            const disabled = !canAfford && !isCurrent;
            return (
              <button
                key={o.models}
                type="button"
                className={`ab-pop-size ${isCurrent ? 'on' : ''}`}
                disabled={disabled}
                style={disabled ? { opacity: 0.45, filter: 'grayscale(0.75)' } : undefined}
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
    } else {
      content = (
        <>
          {sheet && !sheet.keywords.includes('EPIC HERO') && (
            <button
              type="button"
              style={{ background: 'rgba(245, 158, 11, 0.15)', borderColor: '#f59e0b', color: '#fef08a' }}
              onClick={() => {
                const cost = recruitScrapCost(run, sheet, u.pts);
                if ((run.scrap ?? 0) < cost) {
                  setInfo(`Not enough Scrap for duplicate ${u.datasheet} (${cost} needed, you have ${run.scrap ?? 0})`);
                  close();
                  return;
                }
                const next = recruitUnit(run, fac, u.datasheet, u.models);
                if (next !== run) {
                  setRun(next);
                  play('good');
                  setInfo(`Recruited duplicate ${u.datasheet} (-${cost} Scrap). Merge in War Room to rank up!`);
                }
                close();
              }}
            >
              <Icon name="plus" size={22} />
              <span>Recruit Duplicate ({recruitScrapCost(run, sheet, u.pts)} Scrap)</span>
            </button>
          )}
          {squadsFor.length > 0 && <button type="button" onClick={() => setPop({ ...pop, mode: 'squad' })}><Icon name="plus" size={22} />Add Squad</button>}
          {canLeader && <button type="button" onClick={() => setPop({ ...pop, mode: 'leader' })}><Icon name="plus" size={22} />Add Leader</button>}
          {canSupport && <button type="button" onClick={() => setPop({ ...pop, mode: 'support' })}><Icon name="plus" size={22} />Add Support</button>}
          {bodySupport && <button type="button" onClick={() => setPop({ ...pop, uid: body!.uid, mode: 'support' })}><Icon name="plus" size={22} />Add Support <span className="ab-pop-val">{body!.datasheet}</span></button>}
          {body && (
            <button type="button" onClick={() => { setUnit(u.uid, { attachTo: undefined }); setInfo(`${u.datasheet} left ${body.datasheet}`); close(); }}>
              <Icon name="leave" size={22} />Leave Squad
            </button>
          )}
          {joined.map(({ c }) => (
            <button
              key={c.uid}
              type="button"
              onClick={() => {
                setUnit(c.uid, { attachTo: undefined });
                setInfo(`${c.datasheet} left ${u.datasheet}`);
                close();
              }}
            >
              <Icon name="leave" size={22} />Detach {c.datasheet}
            </button>
          ))}
          {myLoad && cargo.length > 0 && (
            <button type="button" onClick={() => setPop({ ...pop, mode: 'embark' })}><Icon name="embark" size={22} />Embark <span className="ab-pop-val">{myLoad.used}/{myLoad.capacity}</span></button>
          )}
          {!isTransport && (rideIn ? (
            <button type="button" onClick={() => { setUnit(rider.uid, { embarkIn: undefined }); setInfo(`${rider.datasheet} left ${rideIn.datasheet}`); close(); }}>
              <Icon name="leave" size={22} />Disembark <span className="ab-pop-val">{rideIn.datasheet}</span>
            </button>
          ) : rides.length > 0 && (
            <button type="button" onClick={() => setPop({ ...pop, mode: 'embark' })}><Icon name="embark" size={22} />Embark</button>
          ))}
          {opts.length > 1 && <button type="button" onClick={() => setPop({ ...pop, mode: 'size' })}><Icon name="size" size={22} />Unit size <span className="ab-pop-val">{u.models}</span></button>}
          {isChar && (
            <button type="button" className={u.warlord ? 'on' : ''} onClick={() => {
              const nextUnits = run.list.units.map((x) => ({ ...x, warlord: x.uid === u.uid ? !u.warlord : false }));
              setRun({ ...run, list: { ...run.list, units: nextUnits } });
              close();
            }}>
              <Icon name={u.warlord ? 'check' : 'leader'} size={22} />{u.warlord ? 'Warlord' : 'Make Warlord'}
            </button>
          )}
          {(() => {
            const topLevel = run.list.units.filter((x) => !x.attachTo);
            const isLast = topLevel.length <= 1 && !u.attachTo;
            const refund = sellValue(u);
            return !isLast && (
              <button type="button" className="danger" onClick={() => {
                if (!armed) { setArmed(true); return; }
                const next = sellUnit(run, u.uid);
                if (next !== run) {
                  setRun(next);
                  play('tick');
                  setInfo(`Sold ${u.datasheet} (+${refund} Scrap)`);
                }
                setArmed(false);
                close();
              }}>
                <Icon name="delete" size={22} />{armed ? 'Tap again to sell' : `Sell Unit (+${refund} Scrap)`}
              </button>
            );
          })()}
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
        {peek && fac.datasheets.find((d) => d.name === peek) && (
          <div className="tray-backdrop" style={{ zIndex: 160 }} onClick={(e) => { e.stopPropagation(); setPeek(null); }}>
            <div className="tray" role="dialog" aria-label={`${peek} datasheet`} onClick={(e) => e.stopPropagation()}>
              <div className="tray-head">
                <span className="sheet-title grow">{peek}</span>
                <button className="btn small ghost" onClick={() => setPeek(null)}>Close</button>
              </div>
              <DatasheetView sheet={fac.datasheets.find((d) => d.name === peek)!} factionId={fac.id} />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app campaign">
      <header className="appbar">
        <button className="appbar-back-btn" aria-label="Back" onClick={onBack}>&lt;</button>
        <span className="appbar-title">Campaign · Sector {run.sector || run.loop || 1}</span>
        <span className="cmp-scrap" title="Fleet Integrity: campaign HP">
          <span style={{ color: (run.fleetIntegrityHP ?? 100) > 50 ? '#10b981' : (run.fleetIntegrityHP ?? 100) > 25 ? '#f59e0b' : '#ef4444', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="heal" size={13} />
            <span>Fleet HP: {run.fleetIntegrityHP ?? 100}/100</span>
          </span>
          {(run.winLossStreak ?? 0) !== 0 && (
            <span style={{ marginLeft: 4, fontSize: '0.85em', color: (run.winLossStreak ?? 0) > 0 ? '#f59e0b' : '#ef4444', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {(run.winLossStreak ?? 0) > 0 ? (
                <>
                  <Icon name="zap" size={12} />
                  <span>Streak: +{run.winLossStreak}</span>
                </>
              ) : (
                <>
                  <Icon name="skull" size={12} />
                  <span>Losses: {Math.abs(run.winLossStreak ?? 0)}</span>
                </>
              )}
            </span>
          )}
        </span>
        <span className="cmp-scrap" title="Scrap Currency: +10% Hoard Interest per node"><Icon name="shop" size={14} /> <span className="num">{run.scrap ?? 0}</span> <span style={{ opacity: 0.8, fontSize: '0.85em' }}>(+{calculateHoardInterest(run.scrap ?? 0, run.maxInterestCap ?? 50)})</span></span>
        <button
          type="button"
          className="btn small"
          style={{ background: '#f59e0b', color: '#000', fontWeight: 'bold', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          onClick={() => { setWarRoomTab('compression'); setShowWarRoom(true); }}
          title="Open War Room & Strategium Council"
        >
          <Icon name="tabletop" size={14} />
          <span>War Room</span>
        </button>
        <span className="cmp-scrap" title="Renown: allocate army tree nodes"><Icon name="trophy" size={14} /> <span className="num">{run.renown ?? 0}</span> <span>Renown</span></span>
      </header>

      <main className="screen">

        <section className="cmp-army slate"><div className="slate-in">
          <div className="cmp-army-top">
            <span className="cmp-emblem"><Emblem factionId={run.factionId} /></span>
            <span className="cmp-army-text">
              <b>{run.list.name}</b>
              <span className="muted small">Sector {(run.sector || run.loop || 1) > 5 ? `${run.loop} (Endless)` : `${run.sector || run.loop || 1} of 5`} · <span className="num">{pts}</span> pts · {run.list.units.length} units · {run.wins} {run.wins === 1 ? 'win' : 'wins'}{run.cp ? ` · +${run.cp} CP` : ''}</span>
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
              const tier = u.compressionTier ?? 1;
              return (
                <div key={u.uid} className="cmp-unit">
                  <div>
                    {isVeteran(u) && <span className="cmp-rank-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="sparkles" size={10} /> VETERAN</span>}
                    {tier > 1 && (
                      <span className="cmp-honor-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#f59e0b', borderColor: '#f59e0b' }}>
                        <Icon name="star" size={10} /> Tier {tier}
                      </span>
                    )}
                    {u.apexDesignation && (
                      <span className="cmp-honor-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#34d399', borderColor: '#10b981' }}>
                        <Icon name="trophy" size={10} /> {APEX_DESIGNATIONS[u.apexDesignation]?.name}
                      </span>
                    )}
                    {u.tempAmmoLoadout && (
                      <span className="cmp-honor-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#60a5fa', borderColor: '#3b82f6' }}>
                        <Icon name="crosshair" size={10} /> {MUNITORUM_AMMO[u.tempAmmoLoadout]?.name}
                      </span>
                    )}
                    <span>{u.datasheet}{u.models > 1 ? ` ×${u.models}` : ''}</span>
                    {attachedSquad && (
                      <span className="cmp-honor-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)' }}>
                        <Icon name="leader" size={11} />
                        {getPortrait(attachedSquad.datasheet) && (
                          <img src={getPortrait(attachedSquad.datasheet)!} alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} />
                        )}
                        Attached with {attachedSquad.datasheet}
                      </span>
                    )}
                    {ledBy.length > 0 && (
                      <span className="cmp-honor-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
                        <Icon name="leader" size={11} />
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
                const isUnit = rw.kind === 'unit';
                const sheet = isUnit ? fac.datasheets.find((x) => x.name === rw.datasheet) : null;
                const bonusSheet = isUnit && rw.bonusLeader ? fac?.datasheets.find((x) => x.name === rw.bonusLeader!.datasheet) : null;
                const rarity = isUnit ? (rw.rarity ?? 'common') : null;
                const rarityColors: Record<string, string> = {
                  common: '#94A3B8',
                  rare: '#38BDF8',
                  epic: '#A855F7',
                  legendary: '#F59E0B',
                };
                const borderCol = rarity ? rarityColors[rarity] : undefined;

                return (
                  <button
                    key={i}
                    className={`cmp-card slate k-${rw.kind} ${relic?.rare ? 'rare' : ''} ${isUpgrade ? 'upgrade' : ''}`}
                    style={{
                      animationDelay: `${i * 90}ms`,
                      position: 'relative',
                      // the slate's frame is its padding over its own background (its clip-path cuts off borders and
                      // box-shadows), so the rarity colour goes there, with a glow that follows the cut corners
                      ...(borderCol ? { padding: 2, background: borderCol, filter: `drop-shadow(0 0 10px ${borderCol}99)` } : {}),
                    }}
                    onClick={() => take(rw)}
                  >
                    <span className="slate-in">
                      <span className="cmp-card-kind" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>
                          {isUnit
                            ? 'Reinforcements'
                            : isUpgrade ? 'Upgrade' : rw.kind === 'relic' ? (relic?.rare ? 'Rare relic' : 'Relic') : rw.kind === 'detachment' ? 'Detachment' : rw.kind === 'scrap' ? 'Scrap Cache' : 'Command'}
                        </span>
                        {isUnit && rarity && (
                          <span
                            className="chip small"
                            style={{
                              fontSize: '0.68rem',
                              padding: '1px 6px',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              color: borderCol,
                              borderColor: borderCol,
                              background: `${borderCol}18`,
                            }}
                          >
                            {rarity}
                          </span>
                        )}
                        {isUpgrade && <span className="chip warn small" style={{ fontSize: '0.72rem', padding: '1px 6px', fontWeight: 800 }}>Lv.{nextLvl}</span>}
                      </span>

                      {rw.kind === 'relic' && <RelicToken id={rw.id} lvl={isUpgrade ? nextLvl : 1} big />}
                      {isUnit && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '8px 0', position: 'relative' }}>
                          <div style={{
                            width: 76,
                            height: 76,
                            borderRadius: '50%',
                            overflow: 'hidden',
                            border: `2px solid ${borderCol ?? '#94A3B8'}`,
                            boxShadow: `0 0 14px ${borderCol ?? '#94A3B8'}44`,
                            background: '#FFFFFF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <span className="cmp-card-art"><UnitArt sheet={sheet ?? undefined} /></span>
                          </div>
                          {bonusSheet && (
                            <div
                              title={`Bonus Attached Leader: ${bonusSheet.name}`}
                              style={{
                                position: 'absolute',
                                right: '12%',
                                bottom: -4,
                                width: 38,
                                height: 38,
                                borderRadius: '50%',
                                overflow: 'hidden',
                                border: '2px solid #F59E0B',
                                background: '#FFFFFF',
                                boxShadow: '0 0 12px rgba(245, 158, 11, 0.7)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <span className="cmp-card-art"><UnitArt sheet={bonusSheet} /></span>
                            </div>
                          )}
                        </div>
                      )}
                      {rw.kind === 'detachment' && <span className="cmp-card-icon"><Icon name="cards" size={22} /></span>}
                      {rw.kind === 'cp' && <span className="cmp-card-icon"><Icon name="strat" size={22} /></span>}
                      {rw.kind === 'scrap' && <span className="cmp-card-icon"><Icon name="shop" size={22} /></span>}
                      <b className="cmp-card-name">
                        {rw.kind === 'unit' ? rw.datasheet : rw.kind === 'relic' ? (isUpgrade ? `${relic?.name} (Lv.${nextLvl})` : relic?.name) : rw.kind === 'detachment' ? rw.name : rw.kind === 'scrap' ? `+${rw.amount} Scrap` : '+1 CP every battle'}
                      </b>
                      <span className="cmp-card-text">
                        {rw.kind === 'unit' ? (
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span>{rw.models} models · {rw.pts} pts joins army</span>
                            {rw.bonusLeader ? (
                              <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.75rem', marginTop: 2 }}>
                                + Attached Leader: {rw.bonusLeader.datasheet} ({rw.bonusLeader.pts} pts Free)
                              </span>
                            ) : null}
                          </span>
                        ) : rw.kind === 'relic' && relic ? relicDesc(relic, isUpgrade ? nextLvl : 1) : rw.kind === 'detachment' ? 'Adopt Detachment: gain rules, abilities, and 6 Stratagems!' : rw.kind === 'scrap' ? `Add ${rw.amount} scrap to buy armory upgrades.` : 'Start each battle with one more CP.'}
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

        
        {/* Cleared Garrison Outpost Detail Panel */}
        {focused && !run.over && run.path.includes(focused.id) && !run.offer && (
          <section className="cmp-detail slate garrison-outpost"><div className="slate-in">
            <div className="cmp-kicker" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="hold" size={13} />
              <span>Sector Garrison Outpost</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, padding: '4px 8px', borderRadius: 4, background: run.fortifiedNodeIds?.includes(focused.id) ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.2)', color: run.fortifiedNodeIds?.includes(focused.id) ? '#f59e0b' : '#38bdf8', border: '1px solid currentColor', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {run.fortifiedNodeIds?.includes(focused.id) ? (
                    <>
                      <Icon name="shield" size={12} />
                      <span>BASTION</span>
                    </>
                  ) : (
                    <>
                      <Icon name="hold" size={12} />
                      <span>GARRISON</span>
                    </>
                  )}
                </span>
                <div>
                  <b style={{ color: '#fef08a' }}>{KIND[focused.kind].name} Outpost (Layer {focused.layer + 1})</b>
                  <div className="tiny muted">
                    {run.fortifiedNodeIds?.includes(focused.id)
                      ? 'Fortified Bastion — Yielding 200% persistent sector resources'
                      : 'Standard Garrison — Securing territorial control and passive sector buffs'}
                  </div>
                </div>
              </div>
              {!run.fortifiedNodeIds?.includes(focused.id) ? (
                <button
                  type="button"
                  className="btn small primary"
                  disabled={(run.scrap ?? 0) < 60}
                  onClick={() => {
                    setRun(fortifyGarrisonNode(run, focused.id));
                    setInfo(`Fortified ${KIND[focused.kind].name} into Bastion (+100% Buffs)!`);
                    play('good');
                  }}
                  style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Icon name="shield" size={13} />
                  <span>Fortify Outpost (60 Scrap)</span>
                </button>
              ) : (
                <span className="chip good small" style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="check" size={11} />
                  <span>Bastion Lv.2 (Max Level)</span>
                </span>
              )}
            </div>

            {/* Garrison Buffs Overview */}
            {(() => {
              const visitedGarrisons = run.map
                .filter((m) => (run.garrisonedNodeIds ?? []).includes(m.id))
                .map((m) => ({ id: m.id, kind: m.kind }));
              const buffs = calculateGarrisonBuffs(visitedGarrisons, run.fortifiedNodeIds ?? []);
              return (
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Icon name="hold" size={13} />
                    <span>Active Sector Garrison Benefits:</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#e2e8f0' }}>
                    {buffs.scrapDropPercent > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="shop" size={12} /> +{buffs.scrapDropPercent}% Scrap Drops</span>}
                    {buffs.startingShield > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="shield" size={12} /> +{buffs.startingShield} Starting Shield HP</span>}
                    {buffs.startingCP > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="strat" size={12} /> +{buffs.startingCP} Starting CP</span>}
                    {buffs.critDamagePercent > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="target" size={12} /> +{buffs.critDamagePercent}% Crit Damage</span>}
                    {buffs.earlyRoundsAP > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="crosshair" size={12} /> +{buffs.earlyRoundsAP} AP in R1-R2</span>}
                    {buffs.turnStartHeal > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="heal" size={12} /> +{buffs.turnStartHeal} HP Regeneration</span>}
                  </div>
                </div>
              );
            })()}
          </div></section>
        )}

        {focused && !run.over && (open.some((n) => n.id === focused.id) || run.fighting === focused.id) && !run.offer && (
          <section className={`cmp-detail slate ${focused.kind}`}><div className="slate-in">
            <div className="cmp-kicker">{KIND[focused.kind].name}</div>
            {focused.enemy ? (
              <>
                <div className="cmp-foe">
                  <span className="cmp-emblem"><Emblem factionId={focused.enemy.factionId} /></span>
                  <span className="cmp-army-text"><b>{nameOf(focused.enemy.factionId)}</b><span className="muted small"><span className="num">{focused.enemy.pts}</span> pts · bot {LEVEL[focused.enemy.level]} · {focused.kind === 'boss' ? 5 : 3} rounds</span></span>
                </div>
                <div className="small">Mission: <b>{campaignMission(focused).primary.name}</b>{campaignMission(focused).primary.action ? ' (actions)' : ''} · {enemyDetachmentCount(run, focused.kind)} {enemyDetachmentCount(run, focused.kind) === 1 ? 'detachment' : 'detachments'} · army tree {enemyTreePoints(run.tree?.length ?? 0, focused.kind)} nodes</div>
                {focused.enemy.rules.map((rawRule, idx) => { const b = bossRuleById(rawRule); if (!b) return null; return <div key={b.id || idx} className="cmp-rule"><RelicToken id={b.id} enemy /> <span><b>{b.name}</b> — {b.text}</span></div>; })}
              </>
            ) : <div className="small">{KIND[focused.kind].note}</div>}

            {focused.kind === 'medicae' && (
              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <button
                  className="btn small primary"
                  disabled={(run.fleetIntegrityHP ?? 100) >= (run.maxFleetIntegrityHP ?? 100) || (run.scrap ?? 0) < 60}
                  onClick={() => { setRun(applyMedicaeService(run, 'repair')); play('good'); }}
                >
                  <Icon name="heal" size={14} /> Repair Fleet Integrity (+25 HP) (60 Scrap)
                </button>
                <button className="btn small" disabled={(run.scrap ?? 0) < 45} onClick={() => { setRun(applyMedicaeService(run, 'cp')); play('good'); }}>
                  <Icon name="strat" size={14} /> War Council: +1 CP (45 Scrap)
                </button>
              </div>
            )}


            {focused.enemy && <div className="tiny muted">{KIND[focused.kind].note}</div>}
            {err && <div className="err" role="alert">{err}</div>}
            
            {/* Pre-Battle Strategium Dock: 5-Round Clock & Munitorum Consumables */}
            {focused.enemy && (
              <div className="prebattle-dock">
                {/* 1. Pre-Battle Dock Header with Auto-Optimize button */}
                <div className="prebattle-header">
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="radar" size={15} />
                    <span>Pre-Battle Strategium Dock</span>
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn small"
                      style={{
                        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.45))',
                        border: '1.5px solid #f59e0b',
                        color: '#fef08a',
                        fontWeight: 800,
                        padding: '4px 10px',
                        borderRadius: 6,
                        boxShadow: '0 0 10px rgba(245, 158, 11, 0.3)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                      onClick={() => {
                        setRun(autoOptimizePreBattle(run, fac));
                        setInfo('Battle tactics & Apex badges auto-optimized!');
                        play('good');
                      }}
                      title="Automatically configures the Tactical Clock to your army's weapon profile and equips available Apex badges"
                    >
                      <Icon name="sparkles" size={13} />
                      <span>Auto-Optimize Tactics</span>
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
                      style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => {
                        setWarRoomTab('tacticalClock');
                        setShowWarRoom(true);
                      }}
                    >
                      <Icon name="gear" size={12} />
                      <span>Configure</span>
                    </button>
                  </div>
                </div>

                {/* 2. 5-Round Tactical Clock Strip */}
                <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span>5-Round Tactical Clock:</span>
                  <span className="tiny muted">(Tap round to cycle directive)</span>
                </div>
                <div className="prebattle-clock-strip">
                  {((run.tacticalClock as TacticalClockDirectiveId[] | undefined) ?? [
                    'SHROUD_OF_NIGHT',
                    'BLITZKRIEG_SURGE',
                    'ANNIHILATION_VOLLEY',
                    'AEGIS_OF_IRON',
                    'WARMASTER_ASCENDANCY',
                  ]).map((directiveId, rIdx) => {
                    const d = TACTICAL_CLOCK_DIRECTIVES[directiveId];
                    const clockOpts: TacticalClockDirectiveId[] = [
                      'SHROUD_OF_NIGHT',
                      'BLITZKRIEG_SURGE',
                      'ANNIHILATION_VOLLEY',
                      'AEGIS_OF_IRON',
                      'WARMASTER_ASCENDANCY',
                    ];
                    return (
                      <div
                        key={`clock-r${rIdx + 1}`}
                        className="prebattle-clock-card"
                        title={`${d?.name ?? directiveId}: ${d?.desc ?? ''}`}
                        onClick={() => {
                          const curClock = [...((run.tacticalClock as TacticalClockDirectiveId[]) ?? clockOpts)] as [
                            TacticalClockDirectiveId,
                            TacticalClockDirectiveId,
                            TacticalClockDirectiveId,
                            TacticalClockDirectiveId,
                            TacticalClockDirectiveId
                          ];
                          const curIdx = clockOpts.indexOf(curClock[rIdx]);
                          const nextDirective = clockOpts[(curIdx + 1) % clockOpts.length];
                          curClock[rIdx] = nextDirective;
                          setRun(setTacticalClock(run, curClock));
                          play('tick');
                        }}
                      >
                        <span className="prebattle-clock-round">Round {rIdx + 1}</span>
                        <span className="prebattle-clock-name" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <Icon name={(d?.icon || 'history') as IconName} size={13} />
                          <span>{d?.name ?? directiveId}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* 3. Munitorum Ammo & Stimms Quick Shop */}
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 8, marginTop: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="wargear" size={14} />
                      <span>Munitorum Loadout (1-Match Consumables):</span>
                    </span>
                    <span className="tiny muted">Scrap: <b style={{ color: '#fef08a' }}>{run.scrap ?? 0} Scrap</b></span>
                  </div>

                  <div className="prebattle-ammo-grid">
                    {(Object.keys(MUNITORUM_AMMO) as MunitorumAmmoId[]).map((ammoId) => {
                      const def = MUNITORUM_AMMO[ammoId];
                      const hasLogis = run.activeAdvisors?.includes('ADV_LOGIS');
                      const cost = hasLogis ? Math.floor(def.cost * 0.5) : def.cost;
                      const canAfford = (run.scrap ?? 0) >= cost;
                      const equippedSquads = (run.list?.units ?? []).filter((u) => u.tempAmmoLoadout === ammoId);

                      return (
                        <button
                          key={ammoId}
                          type="button"
                          className="prebattle-ammo-btn"
                          disabled={!canAfford && equippedSquads.length === 0}
                          onClick={() => setAmmoShopTarget(ammoShopTarget === ammoId ? null : ammoId)}
                          style={{
                            borderColor: equippedSquads.length > 0 ? '#38bdf8' : ammoShopTarget === ammoId ? '#f59e0b' : undefined,
                            background: equippedSquads.length > 0 ? 'rgba(56, 189, 248, 0.15)' : ammoShopTarget === ammoId ? 'rgba(245, 158, 11, 0.15)' : undefined,
                          }}
                          title={def.desc}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <b style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <Icon name={(def.icon || 'crosshair') as IconName} size={14} />
                              <span>{def.name}</span>
                            </b>
                            <span style={{ color: '#fef08a', fontWeight: 700 }}>{cost} Scrap</span>
                          </div>
                          <span className="tiny muted" style={{ fontSize: 9.5, lineHeight: 1.2 }}>
                            {equippedSquads.length > 0 ? `Equipped on ${equippedSquads.length} squad(s)` : def.desc.slice(0, 45) + '...'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* If an ammo type is selected, show target squad selector */}
                  {ammoShopTarget && (
                    <div style={{ marginTop: 10, padding: 12, background: '#111418', borderRadius: 8, border: '1.5px solid #38bdf8' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="target" size={15} />
                            <span>Select Squad to Equip {MUNITORUM_AMMO[ammoShopTarget].name}:</span>
                          </span>
                          <div className="tiny muted" style={{ marginTop: 2 }}>{MUNITORUM_AMMO[ammoShopTarget].desc}</div>
                        </div>
                        <button type="button" className="btn small ghost" onClick={() => setAmmoShopTarget(null)} style={{ padding: '2px 8px', fontSize: 12 }}>Close</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                        {(run.list?.units ?? []).map((u) => {
                          const sheet = fac?.datasheets?.find((d) => d.name === u.datasheet);
                          const sameUnits = (run.list?.units ?? []).filter((x) => x.datasheet === u.datasheet);
                          const isDup = sameUnits.length > 1;
                          const squadIdx = sameUnits.findIndex((x) => x.uid === u.uid) + 1;
                          const squadLabel = isDup ? `${u.datasheet} #${squadIdx}` : u.datasheet;
                          const isEquipped = u.tempAmmoLoadout === ammoShopTarget;
                          const hasOther = u.tempAmmoLoadout && !isEquipped;
                          const tier = u.compressionTier ?? 1;
                          const attachedTo = u.attachTo ? run.list.units.find((x) => x.uid === u.attachTo) : null;
                          const ledByUnits = run.list.units.filter((x) => x.attachTo === u.uid);
                          const enhList = (u.enhancements && u.enhancements.length > 0) ? u.enhancements.map((e) => e.name) : (u.enhancement ? [u.enhancement] : []);

                          return (
                            <div
                              key={u.uid}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 10px',
                                borderRadius: 6,
                                background: isEquipped ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                                border: isEquipped ? '1.5px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                                gap: 8,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                                <div style={{ width: 34, height: 34, borderRadius: 4, overflow: 'hidden', background: '#1e293b', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <UnitArt sheet={sheet} />
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {squadLabel}
                                  </div>
                                  <div className="tiny muted" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                                    <span>{u.pts + (u.wargearPts ?? 0)} pts</span>
                                    {tier > 1 && (
                                      <span style={{ color: '#f59e0b', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                        <Icon name="star" size={10} /> Tier {tier}
                                      </span>
                                    )}
                                    {attachedTo && (
                                      <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                        <Icon name="leader" size={10} /> [With {attachedTo.datasheet}]
                                      </span>
                                    )}
                                    {ledByUnits.length > 0 && (
                                      <span style={{ color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                        <Icon name="leader" size={10} /> [Led by {ledByUnits.map((l) => l.datasheet).join(', ')}]
                                      </span>
                                    )}
                                    {enhList.length > 0 && (
                                      <span style={{ color: '#c084fc', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                        <Icon name="enhancement" size={10} /> [{enhList[0]}]
                                      </span>
                                    )}
                                    {hasOther && (
                                      <span style={{ color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                        <Icon name="crosshair" size={10} /> [{u.tempAmmoLoadout?.split('_')[0]}]
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                className={`btn small ${isEquipped ? 'ghost' : 'primary'}`}
                                style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                onClick={() => {
                                  if (isEquipped) {
                                    const updatedUnits = run.list.units.map((x) => (x.uid === u.uid ? { ...x, tempAmmoLoadout: undefined } : x));
                                    setRun({ ...run, list: { ...run.list, units: updatedUnits } });
                                    play('tick');
                                  } else {
                                    setRun(buyMunitorumAmmo(run, u.uid, ammoShopTarget));
                                    setInfo(`Equipped ${MUNITORUM_AMMO[ammoShopTarget].name} on ${squadLabel}!`);
                                  }
                                }}
                              >
                                <Icon name={isEquipped ? 'check' : 'plus'} size={11} />
                                <span>{isEquipped ? 'Remove' : 'Equip'}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

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

      
      {/* Warlord Trophy Claim Modal (Post-Boss Victory) */}
      {run.pendingBossTrophyRules && run.pendingBossTrophyRules.length > 0 && (
        <div className="cmp-modal-backdrop" style={{ zIndex: 140 }}>
          <div className="cmp-armory-modal" style={{ maxHeight: '90vh', maxWidth: 640 }}>
            <div className="cmp-armory-header">
              <div className="cmp-armory-header-center">
                <div className="cmp-armory-title" style={{ color: '#f59e0b', fontSize: 18, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Icon name="trophy" size={20} />
                  <span>Warlord Trophy Claim</span>
                </div>
                <div className="cmp-armory-sub">The Enemy Warlord has fallen! Absorb a Boss Rule into your Trophy Rack (max 3 slots).</div>
              </div>
            </div>
            <div className="cmp-armory-body" style={{ padding: 16 }}>
              {/* Current Trophy Rack */}
              <div style={{ marginBottom: 14, padding: 10, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="trophy" size={13} />
                  <span>Active Trophy Rack ({run.absorbedBossRules?.length ?? 0}/3 Slots Filled):</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[0, 1, 2].map((slotIdx) => {
                    const r = run.absorbedBossRules?.[slotIdx];
                    const b = r ? bossRuleById(r.ruleId) : null;
                    return (
                      <div key={slotIdx} style={{ flex: 1, minWidth: 140, padding: 8, background: r ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.02)', border: r ? '1.5px solid #f59e0b' : '1px dashed rgba(255,255,255,0.15)', borderRadius: 6, textAlign: 'center' }}>
                        {r && b ? (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 800, color: '#fef08a' }}>{b.name}</div>
                            <span className="chip warn small" style={{ fontSize: 10, marginTop: 2 }}>{r.level === 2 ? 'Apex Lv.2' : 'Lv.1 Active'}</span>
                          </>
                        ) : (
                          <span className="tiny muted">Slot {slotIdx + 1} Open</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Boss Rules Available */}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="skull" size={14} style={{ color: '#ef4444' }} />
                <span>Select a Warlord Rule to Absorb:</span>
              </div>
              <div className="trophy-grid">
                {run.pendingBossTrophyRules.map((rId) => {
                  const b = bossRuleById(rId);
                  if (!b) return null;
                  const alreadyHeld = run.absorbedBossRules?.find((x) => x.ruleId === b.id);
                  const isLv1 = alreadyHeld?.level === 1;
                  const isLv2 = alreadyHeld?.level === 2;
                  const rackFull = (run.absorbedBossRules?.length ?? 0) >= 3 && !alreadyHeld;

                  return (
                    <div key={b.id} className={`trophy-card ${alreadyHeld ? 'ascended' : ''}`}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <b style={{ color: '#fef08a', fontSize: 14 }}>{b.name}</b>
                          {isLv2 ? (
                            <span className="chip good small">Maxed Lv.2</span>
                          ) : isLv1 ? (
                            <span className="chip warn small">Upgrade to Lv.2</span>
                          ) : (
                            <span className="chip small">New Trophy</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.4 }}>{b.text}</div>
                        {isLv1 && (
                          <div className="tiny" style={{ color: '#f59e0b', marginTop: 4 }}>
                            Ascending to Lv.2 doubles rule potency across your army!
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className="btn primary small wide"
                        disabled={isLv2 || rackFull}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                        onClick={() => {
                          const nextRun = absorbBossRule(run, b.id);
                          setRun({ ...nextRun, pendingBossTrophyRules: undefined });
                          setInfo(isLv1 ? `Ascended ${b.name} to Apex Lv.2!` : `Absorbed ${b.name} into Trophy Rack!`);
                          play('good');
                        }}
                      >
                        <Icon name={isLv2 ? 'check' : isLv1 ? 'star' : 'trophy'} size={13} />
                        <span>{isLv2 ? 'Already at Max Lv.2' : rackFull ? 'Trophy Rack Full' : isLv1 ? 'Ascend to Apex Lv.2' : 'Absorb Boss Rule'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Salvage Alternative Button */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn ghost small"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  onClick={() => {
                    setRun({ ...run, scrap: (run.scrap ?? 0) + 100, pendingBossTrophyRules: undefined });
                    setInfo('Scavenged +100 Scrap from the defeated Warlord!');
                    play('gem');
                  }}
                >
                  <Icon name="shop" size={13} />
                  <span>Salvage Remains for +100 Scrap instead</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sector Start Patron Contract Selection Modal */}
      {run.activePatronContract === null && run.path.length === 0 && !dismissPatronModal && !run.offer && (
        <div className="cmp-modal-backdrop" style={{ zIndex: 135 }}>
          <div className="cmp-armory-modal" style={{ maxHeight: '92vh', maxWidth: 680 }}>
            <div className="cmp-armory-header">
              <div className="cmp-armory-header-center">
                <div className="cmp-armory-title" style={{ color: '#f59e0b', fontSize: 18, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Icon name="cards" size={20} />
                  <span>High Lords of Terra: Faction Patronage</span>
                </div>
                <div className="cmp-armory-sub">Select your sponsor covenant for this Sector campaign to receive permanent buffs & rewards.</div>
              </div>
              <button type="button" className="cmp-close-btn" onClick={() => setDismissPatronModal(true)} title="Decide Later">
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="cmp-armory-body" style={{ padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {(Object.keys(PATRON_CONTRACTS) as PatronContractId[]).map((cid) => {
                  const p = PATRON_CONTRACTS[cid];
                  return (
                    <div
                      key={cid}
                      style={{
                        padding: 12,
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1.5px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                          <Icon name={(p.icon || 'cards') as IconName} size={22} style={{ color: '#f59e0b', flexShrink: 0 }} />
                          <div>
                            <b style={{ color: '#fef08a', fontSize: 14 }}>{p.name}</b>
                            <div className="tiny muted">{p.sponsor}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.4, margin: '6px 0' }}>
                          <b>Buff:</b> {p.buffDesc}
                        </div>
                        <div className="tiny" style={{ color: '#f59e0b' }}>
                          <b>Climax Reward:</b> {p.bossRewardDesc}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn primary small wide"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                        onClick={() => {
                          setRun(selectPatronContract(run, cid));
                          setDismissPatronModal(true);
                          setInfo(`Signed covenant with ${p.sponsor}!`);
                          play('good');
                        }}
                      >
                        <Icon name="check" size={13} />
                        <span>Sign Covenant</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                <button
                  type="button"
                  className="btn ghost small"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  onClick={() => setDismissPatronModal(true)}
                >
                  <Icon name="tabletop" size={13} />
                  <span>Decide Later in War Room</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* War Room & Strategium Council Modal */}
      {showWarRoom && fac && (
        <WarRoomModal run={run} faction={fac} onUpdateRun={setRun} onClose={() => setShowWarRoom(false)} initialTab={warRoomTab} />
      )}

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
              <div className="cmp-armory-tabs" style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={`cmp-armory-tab ${rosterTab === 'roster' ? 'active' : ''}`}
                  onClick={() => setRosterTab('roster')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="shield" size={14} />
                  <span>Active Roster ({run.list.units.length})</span>
                </button>
                <button
                  type="button"
                  className={`cmp-armory-tab ${rosterTab === 'tech' ? 'active' : ''}`}
                  onClick={() => setRosterTab('tech')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="trophy" size={14} />
                  <span>Army Tree{run.renown ? ` (${run.renown})` : ''}</span>
                </button>
                <button
                  type="button"
                  className={`cmp-armory-tab ${rosterTab === 'detachments' ? 'active' : ''}`}
                  onClick={() => setRosterTab('detachments')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="swords" size={14} />
                  <span>Detachments ({run.list.detachments?.length ?? 1})</span>
                </button>
              </div>

              {rosterTab === 'roster' && (() => {
                const unitPanel = (u: ArmyUnitEntry) => {
                  const sheet = fac.datasheets.find((x) => x.name === u.datasheet);
                  const enhOpts = fac ? enhancementOptions(run.list, fac, u) : [];
                  const canTakeEnh = enhOpts.length > 0 || Boolean(u.enhancement);

                  const isSheetOpen = isSectionOpen(u.uid, 'sheet', false);
                  const isWargearOpen = isSectionOpen(u.uid, 'wargear', false);
                  const isEnhOpen = isSectionOpen(u.uid, 'enh', false);

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
                            </button>
                            {isSheetOpen && (() => {
                              let counts;
                              try { counts = weaponCounts(buildUnits({ ...run.list, units: [{ ...u, attachTo: undefined }] }, fac, 0).flatMap((x) => x.models)); } catch { counts = undefined; }
                              return <DatasheetView sheet={sheet} factionId={fac.id} counts={counts} />;
                            })()}
                          </div>
                        )}

                        {/* 3. Wargear Options with Scrap mode */}
                        {sheet && (sheet.wargearOptions?.length || sheet.wargearCosts?.length || loadoutLines(sheet).length) ? (
                          <div className="ab-collapsible-section field">
                            <button type="button" className="ab-section-toggle" onClick={() => toggleSection(u.uid, 'wargear', false)}>
                              <span className="row gap-2" style={{ alignItems: 'center' }}>
                                <Icon name={isWargearOpen ? 'down' : 'next'} size={16} />
                                <Icon name="wargear" size={15} />
                                <b>Wargear Options</b>
                                {u.wargearPts ? <span className="ab-badge-selected">+{u.wargearPts} pts (Scrap)</span> : null}
                              </span>
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
                                {(() => {
                                  const eqList = (u.enhancements && u.enhancements.length > 0) ? u.enhancements : (u.enhancement ? [{ name: u.enhancement, pts: u.enhancementPts ?? 0 }] : []);
                                  return eqList.length > 0 ? <span className="ab-badge-selected">{eqList.length} equipped (+{eqList.reduce((s, x) => s + x.pts, 0)} pts)</span> : null;
                                })()}
                              </span>
                            </button>
                            {isEnhOpen && (() => {
                              const eqList = (u.enhancements && u.enhancements.length > 0) ? u.enhancements : (u.enhancement ? [{ name: u.enhancement, pts: u.enhancementPts ?? 0 }] : []);
                              const nextSlot = eqList.length;
                              return (
                                <div style={{ marginTop: 8 }}>
                                  <div className="tiny muted" style={{ marginBottom: 10, color: '#94a3b8', lineHeight: 1.4 }}>
                                    Enhancements are repeatable and stackable with no unit or army limits. Each additional Enhancement equipped on a unit incurs an escalating Scrap cost (+50% per slot).
                                  </div>
                                  {eqList.length > 0 && (
                                    <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      {eqList.map((eq, eqIdx) => {
                                        const slotRefund = enhancementScrapCost(eq.pts, eqList.length - 1);
                                        return (
                                          <div key={`eq-${eq.name}-${eqIdx}`} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                              <span className="chip warn small" style={{ fontWeight: 700 }}>Slot {eqIdx + 1}</span>
                                              <b style={{ color: '#fef08a', fontSize: 13.5 }}>{eq.name}</b>
                                              <span className="tiny muted">(+{eq.pts} pts)</span>
                                            </div>
                                            <button
                                              type="button"
                                              className="btn small"
                                              style={{ border: '1px solid #ef4444', background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5' }}
                                              onClick={() => {
                                                setRun(removeEnhancementFromUnit(run, u.uid, eqIdx));
                                                play('bad');
                                              }}
                                            >
                                              Unequip (+{slotRefund} Scrap)
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                                    {enhOpts.map((o) => {
                                      const fit = sheet ? enhancementFits(o.text, [...sheet.keywords, ...sheet.factionKeywords, sheet.name, ...(u.mark ? [u.mark] : [])]) : null;
                                      const cost = enhancementScrapCost(o.pts, nextSlot);
                                      const canAfford = (run.scrap ?? 0) >= cost;
                                      const alreadyCount = eqList.filter((x) => x.name === o.name).length;
                                      return (
                                        <div
                                          key={o.detachment + o.name}
                                          style={{
                                            padding: 10,
                                            borderRadius: 8,
                                            background: alreadyCount > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255,255,255,0.04)',
                                            border: alreadyCount > 0 ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'space-between',
                                            gap: 8,
                                            opacity: (fit && !fit.ok) || (!canAfford && alreadyCount === 0) ? 0.5 : 1,
                                            filter: (fit && !fit.ok) || (!canAfford && alreadyCount === 0) ? 'grayscale(0.75)' : 'none',
                                          }}
                                        >
                                          <div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                                              <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                  <b style={{ color: alreadyCount > 0 ? '#fef08a' : '#f8fafc', fontSize: 13.5 }}>{o.name}</b>
                                                  {alreadyCount > 0 && <span className="chip warn small" style={{ fontSize: 11, padding: '1px 5px' }}>x{alreadyCount}</span>}
                                                </div>
                                                <div className="tiny muted">{o.detachment} · +{o.pts} pts</div>
                                              </div>
                                              <span className="cmp-scrap"><Icon name="shop" size={12} /> {cost}</span>
                                            </div>
                                            {fit && !fit.ok && <div style={{ marginTop: 4, color: '#f87171', fontSize: 11.5, fontWeight: 600 }}>Requires: {fit.need}</div>}
                                            {o.text && <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.35 }}><Em text={o.text} /></div>}
                                          </div>
                                          <div style={{ marginTop: 8 }}>
                                            {fit && !fit.ok ? (
                                              <button type="button" className="btn small" disabled style={{ width: '100%' }}>Not Eligible</button>
                                            ) : alreadyCount > 0 ? (
                                              <button
                                                type="button"
                                                className="btn small"
                                                disabled
                                                title="This character model already has this Enhancement equipped."
                                                style={{ width: '100%', opacity: 0.7, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: '#38bdf8', cursor: 'not-allowed' }}
                                              >
                                                Equipped
                                              </button>
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
                                                {!canAfford ? `Need ${cost} Scrap` : `Equip Slot ${nextSlot + 1} (${cost} Scrap)`}
                                              </button>
                                            )}
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
                  const rider = body ?? u;
                  const rideIn = rider.embarkIn ? run.list.units.find((t) => t.uid === rider.embarkIn) : undefined;
                  const rides = rideIn ? fac.datasheets.find((x) => x.name === rideIn.datasheet) : undefined;
                  const load = transportLoads(run.list, fac).find((t) => t.uid === u.uid);
                  const carried = load?.riders.map((r) => run.list.units.find((x) => x.uid === r)?.datasheet).filter(Boolean) ?? [];
                  const wg = wargearSummary(sheet, u);
                  const dupes = run.list.units.filter((x) => x.datasheet === u.datasheet);
                  const dupeIdx = dupes.length > 1 ? dupes.findIndex((x) => x.uid === u.uid) + 1 : null;
                  const squadLabel = dupeIdx ? `${u.datasheet} #${dupeIdx}` : u.datasheet;
                  const rank = u.compressionTier ?? 1;
                  const apex = u.apexDesignation ? APEX_DESIGNATIONS[u.apexDesignation] : null;
                  const ammo = u.tempAmmoLoadout ? MUNITORUM_AMMO[u.tempAmmoLoadout] : null;
                  const enhList = (u.enhancements && u.enhancements.length > 0)
                    ? u.enhancements
                    : (u.enhancement ? [{ name: u.enhancement, pts: u.enhancementPts ?? 0 }] : []);
                  const line = [
                    u.warlord && 'Warlord',
                    leads && !inGroup && `${supportIn(run.list, sheet) ? 'Support for' : 'Leading'} ${leads.datasheet}`,
                    leads && inGroup && (supportIn(run.list, sheet) ? 'Support' : 'Leader'),
                    isVeteran(u) ? 'VETERAN' : `${u.battles ?? 0}/${VETERAN_BATTLES} battles to VETERAN`,
                    rides && (inGroup ? 'Embarked' : `Starts embarked in ${rides.name}`),
                    load && (carried.length ? `Carrying ${carried.join(', ')} (${load.used}/${load.capacity})` : `Empty (0/${load.capacity})`),
                  ].filter(Boolean).join(' · ');

                  const isOpen = menu === u.uid;
                  const row = (
                    <div key={u.uid} className={`ab-row ${inGroup ? 'in-group' : ''} ${isOpen ? 'open' : ''}`}>
                      <button type="button" className="ab-row-main" onClick={() => setMenu(isOpen ? null : u.uid)}>
                        <span className="ab-art-wrap"><UnitArt sheet={sheet} /></span>
                        <span className="ab-row-text">
                          <span className="ab-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>{squadLabel}</span>
                            <span className="ab-count">({u.models})</span>
                            {rank > 1 && (
                              <span className="chip warn small" style={{ fontSize: 10, padding: '1px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Icon name="star" size={10} /> Tier {rank === 3 ? 'III' : 'II'}
                              </span>
                            )}
                            {apex && (
                              <span className="chip good small" style={{ fontSize: 10, padding: '1px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Icon name="trophy" size={10} /> {apex.name}
                              </span>
                            )}
                            {ammo && (
                              <span className="chip subtle small" style={{ fontSize: 10, padding: '1px 5px', color: '#38bdf8', borderColor: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Icon name="crosshair" size={10} /> {ammo.name}
                              </span>
                            )}
                            {enhList.length > 0 && (
                              <span className="chip warn small" style={{ fontSize: 10, padding: '1px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Icon name="enhancement" size={10} /> {enhList.length > 1 ? `${enhList.length} Enh` : enhList[0].name}
                              </span>
                            )}
                            {sheet && sheet.keywords.includes('EPIC HERO') && (
                              <span className="chip subtle small" style={{ color: '#c084fc', borderColor: 'rgba(192, 132, 252, 0.4)', background: 'rgba(192, 132, 252, 0.12)', fontSize: '11px', padding: '1px 6px' }}>
                                Epic Hero
                              </span>
                            )}
                            {sheet && sheet.keywords.includes('CHARACTER') && !sheet.keywords.includes('EPIC HERO') && (
                              <span className="chip subtle small" style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)', background: 'rgba(56, 189, 248, 0.12)', fontSize: '11px', padding: '1px 6px' }}>
                                Character
                              </span>
                            )}
                          </span>
                          <span className="ab-pts">
                            {u.pts + (u.wargearPts ?? 0) + (u.enhancementPts ?? 0)} pts
                            {u.enhancement && <span className="ab-enh" style={{ marginLeft: 6 }}> {u.enhancement}</span>}
                          </span>
                          {line && <span className="ab-sub">{line}</span>}
                          {wg && <span className="ab-sub ab-wg"><Icon name="wargear" size={13} /> {wg}</span>}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ab-kebab"
                        aria-label={`Options for ${squadLabel}`}
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
                    {SECTIONS.filter((sec) => sec.id !== 'allies' || fac.datasheets.some((d) => sectionOf(d, run.factionId) === 'allies')).map((sec) => {
                      const joined = (b: ArmyUnitEntry) => run.list.units.filter((c) => c.attachTo === b.uid);
                      const homeOf = (u: ArmyUnitEntry): string => {
                        const body = u.attachTo ? run.list.units.find((b) => b.uid === u.attachTo) : undefined;
                        if (body) return homeOf(body);
                        const first = joined(u)[0];
                        const d = fac.datasheets.find((x) => x.name === (first ?? u).datasheet);
                        return sectionOf(d, run.factionId);
                      };
                      const inRide = (u: ArmyUnitEntry) => !!u.embarkIn && run.list.units.some((t) => t.uid === u.embarkIn);
                      const us = run.list.units.filter((u) => (!u.attachTo || !run.list.units.some((b) => b.uid === u.attachTo)) && !inRide(u) && homeOf(u) === sec.id);
                      const sortedUs = [...us].sort((a, b) => {
                        const sheetA = fac.datasheets.find((x) => x.name === a.datasheet);
                        const sheetB = fac.datasheets.find((x) => x.name === b.datasheet);
                        if (sec.id === 'characters') {
                          const aEpic = Number((sheetA?.keywords || []).includes('EPIC HERO'));
                          const bEpic = Number((sheetB?.keywords || []).includes('EPIC HERO'));
                          if (bEpic !== aEpic) return bEpic - aEpic; // Epic Heroes first
                        }
                        const kindA = sheetA ? unitKind(sheetA) : 'Other';
                        const kindB = sheetB ? unitKind(sheetB) : 'Other';
                        return KINDS.indexOf(kindA) - KINDS.indexOf(kindB) || a.datasheet.localeCompare(b.datasheet);
                      });

                      const bySupport = (a: ArmyUnitEntry, b: ArmyUnitEntry) =>
                        Number(!!supportIn(run.list, fac.datasheets.find((x) => x.name === a.datasheet))) -
                        Number(!!supportIn(run.list, fac.datasheets.find((x) => x.name === b.datasheet)));

                      const squadRows = (u: ArmyUnitEntry, inGroup: boolean) => [
                        ...joined(u).sort(bySupport).map((c) => unitRow(c, true)),
                        unitRow(u, inGroup || joined(u).length > 0),
                      ];

                      return (
                        <section key={sec.id} className="ab-section">
                          <div className="ab-section-head">
                            <span>{sec.title}</span>
                            <button type="button" className="ab-add" aria-label={`Recruit ${sec.title}`} onClick={() => { setRecruitQ(''); setRecruitSec(sec.id); }}>+</button>
                          </div>
                          {sortedUs.map((u) => {
                            const riders = run.list.units.filter((r) => r.embarkIn === u.uid && !r.attachTo);
                            const rowNode = (!joined(u).length && !riders.length) ? (
                              unitRow(u)
                            ) : (
                              <div key={u.uid} className="ab-group">
                                {squadRows(u, true)}
                                {riders.map((r) => <div key={`ride-${r.uid}`} className="ab-ride">{squadRows(r, true)}</div>)}
                              </div>
                            );

                            return (
                              <Fragment key={`item-${u.uid}`}>
                                {rowNode}
                              </Fragment>
                            );
                          })}
                        </section>
                      );
                    })}
                  </div>
                );
              })()}


              {rosterTab === 'tech' && <ArmyTree run={run} onRun={(r) => { setRun(r); play('good'); }} onInfo={setInfo} />}

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
                    // the army's own detachments first, then one group per Chapter
                    const available = fac.detachments.filter((d) => !(run.list.detachments ?? []).includes(d.name))
                      .sort((a, b) => (a.subfaction ?? '').localeCompare(b.subfaction ?? ''));
                    const titled = (k: string) => k.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
                    if (!available.length) return null;
                    return (
                      <div style={{ marginTop: 8 }}>
                        <div className="cmp-kicker" style={{ color: '#fef08a', marginBottom: 8, fontSize: 13 }}>
                          Available Detachments to Requisition
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {available.map((d, i) => {
                            const cost = detachmentScrapCost(d);
                            const canAfford = (run.scrap ?? 0) >= cost;
                            const tint = armyColor(fac.id, d.subfaction);
                            const head = (i === 0 || available[i - 1].subfaction !== d.subfaction) && available.some((x) => x.subfaction);
                            const rulesText = d.rules?.map((r) => `${r.name}: ${r.text}`).join('\n\n') || '';
                            return (
                              <Fragment key={d.name}>
                              {head && <div className="dt-group" style={{ ['--tint' as string]: tint }}>{d.subfaction ? titled(d.subfaction) : `${fac.name} detachments`}</div>}
                              <div className="cmp-roster-card" style={{ borderLeft: `4px solid ${tint}`, ...(!canAfford ? { filter: 'grayscale(0.75)' } : {}) }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <b style={{ color: '#f8fafc', fontSize: 14 }}>{d.name}</b>
                                    <span className="chip subtle small">{d.dp} DP</span>
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
                              </Fragment>
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
            {/* outside the scrolling body: iPhone Safari clips a fixed tray inside a scroller under the Done bar */}
              {recruitSec && (
                <div className="tray-backdrop" style={{ zIndex: 160 }} onClick={() => setRecruitSec(null)}>
                <div className="tray" onClick={(e) => e.stopPropagation()}>
                  <div className="row">
                    <div className="sheet-title grow">Add {SECTIONS.find((x) => x.id === recruitSec)?.title}</div>
                    <button className="btn small ghost" onClick={() => setRecruitSec(null)}>Close</button>
                  </div>
                  <input
                    placeholder="Search datasheets to recruit…"
                    value={recruitQ}
                    onChange={(e) => setRecruitQ(e.target.value)}
                  />

                  {(() => {
                    const qClean = recruitQ.trim().toLowerCase();
                    const family = getFactionFamily(fac.id);
                    const availableSheets = fac.datasheets.filter(
                      (d) => (!d.ally || (family === 'IMPERIUM' && (d.ally === 'QI' || d.ally === 'TL')) || (family === 'CHAOS' && (d.ally === 'QT' || d.ally === 'CD')))
                        && d.points?.[0]?.options?.length && !d.keywords?.includes('FORTIFICATION')
                        && hasRealPortrait(d.name)
                        && isFactionAllowedKnight(fac.id, d)
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
                        {SECTIONS.filter((sec) => sec.id === recruitSec).map((sec) => {
                          const sheetsInSec = filtered.filter((d) => sectionOf(d, fac.id) === sec.id);
                          if (!sheetsInSec.length) return null;

                          const detAlly = (d: DatasheetData) => detachmentAllyOf(fac.id, d);
                          const groupOf = (d: DatasheetData) => {
                            if (sec.id === 'characters') {
                              return (d.keywords || []).includes('EPIC HERO') ? 'Epic Heroes' : 'Characters & Leaders';
                            }
                            return d.ally ? `${d.allyName} · ${unitKind(d)}` : detAlly(d) ? `${detAlly(d)!.rule} · ${unitKind(d)}` : unitKind(d);
                          };

                          const sortedSheets = [...sheetsInSec].sort((a, b) => {
                            if (sec.id === 'characters') {
                              const aEpic = Number((a.keywords || []).includes('EPIC HERO'));
                              const bEpic = Number((b.keywords || []).includes('EPIC HERO'));
                              if (bEpic !== aEpic) return bEpic - aEpic; // Epic heroes first!
                            }
                            return (a.allyName ?? '').localeCompare(b.allyName ?? '') ||
                              KINDS.indexOf(unitKind(a)) - KINDS.indexOf(unitKind(b)) ||
                              Number(!!b.subfaction) - Number(!!a.subfaction) ||
                              a.name.localeCompare(b.name);
                          });

                          return (
                            <section key={sec.id} className="ab-section">
                              <div className="ab-section-head">
                                <span>{sec.title}</span>
                                <span className="tiny muted" style={{ textTransform: 'none' }}>{run.scrap ?? 0} Scrap to spend</span>
                              </div>
                              <div className="ab-pick">
                                {sortedSheets.map((d, i) => {
                                  const kind = groupOf(d);
                                  const showKind = (sec.id === 'characters' || sec.id === 'others' || sec.id === 'allies') && (i === 0 || groupOf(sortedSheets[i - 1]) !== kind);
                                  const opts = pointsOptions(d);
                                  const count = run.list.units.filter((u) => u.datasheet === d.name).length;
                                  const isEpicHero = (d.keywords || []).includes('EPIC HERO');
                                  const isChar = (d.keywords || []).includes('CHARACTER') && !isEpicHero;
                                  const alreadyInForce = isEpicHero && count > 0;
                                  const basePts = cheapest(d)?.pts ?? opts[0]?.pts ?? 0;
                                  const minCost = recruitScrapCost(run, d, basePts);
                                  const canAffordAny = (run.scrap ?? 0) >= minCost;
                                  const needsTier4 = requiresTitanRequisition(d) && !canRecruitTitanOrKnight(fac.id, d, run);
                                  const isOpenPeek = recruitView === d.name;
                                  const isOpenSize = recruitSize === d.name;
                                  const isUnaffordable = (!canAffordAny || needsTier4) && !alreadyInForce;

                                  return [
                                    showKind && <div key={`kind-${kind}`} className="ab-kind">{kind}</div>,
                                    <div
                                      key={d.name}
                                      className={`ab-row ${isOpenPeek ? 'open' : ''} ${alreadyInForce ? 'already-recruited' : ''} ${isUnaffordable ? 'unaffordable' : ''}`}
                                      style={
                                        alreadyInForce
                                          ? { opacity: 0.45, filter: 'grayscale(0.85)' }
                                          : isUnaffordable
                                          ? { opacity: 0.45, filter: 'grayscale(0.75)' }
                                          : undefined
                                      }
                                    >
                                      <button
                                        type="button"
                                        className="ab-row-main"
                                        onClick={() => { setRecruitView(isOpenPeek ? null : d.name); setRecruitSize(null); }}
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
                                            {isChar && (
                                              <span className="chip subtle small" style={{ marginLeft: 6, color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)', background: 'rgba(56, 189, 248, 0.12)', fontSize: '11px', padding: '1px 6px' }}>
                                                Character
                                              </span>
                                            )}
                                            {needsTier4 && (
                                              <span className="chip subtle small" style={{ marginLeft: 6, color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(245, 158, 11, 0.12)', fontSize: '11px', padding: '1px 6px' }}>
                                                Requires {titanKeystone(fac.id)?.name ?? 'a titan keystone'}
                                              </span>
                                            )}
                                          </span>
                                          <span className="ab-pts" style={isUnaffordable ? { color: '#94a3b8' } : undefined}>
                                            {opts.map((o) => `${o.models}: ${recruitScrapCost(run, d, o.pts)}`).join(' / ')} Scrap
                                            {dupeMultiplier(run, d) > 1 && (
                                              <span className="chip subtle small" style={{ marginLeft: 6, color: '#f59e0b', borderColor: '#f59e0b', fontSize: '11px', padding: '1px 5px' }}>
                                                +{Math.round((dupeMultiplier(run, d) - 1) * 100)}% Dupe Cost
                                              </span>
                                            )}
                                            {needsTier4 ? (
                                              <span className="tiny" style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>
                                                (Locked: requires {titanKeystone(fac.id)?.name ?? 'a titan keystone'})
                                              </span>
                                            ) : isUnaffordable ? (
                                              <span className="tiny" style={{ marginLeft: 6, color: '#f87171', fontWeight: 600 }}>
                                                (Need {minCost - (run.scrap ?? 0)} more)
                                              </span>
                                            ) : null}
                                          </span>
                                          <span className="ab-sub">
                                            {alreadyInForce
                                              ? 'Already Recruited (Limit 1)'
                                              : needsTier4
                                              ? `Super-Heavy Support · take ${titanKeystone(fac.id)?.name ?? 'the titan keystone'} in the army tree`
                                              : d.role || (d.keywords ? d.keywords.slice(0, 3).join(', ') : '')}
                                          </span>
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className="ab-add dark"
                                        aria-label={`Recruit ${d.name}`}
                                        title={alreadyInForce ? 'Limit 1 (Already recruited)' : needsTier4 ? `Requires ${titanKeystone(fac.id)?.name ?? 'a titan keystone'} (army tree)` : !canAffordAny ? `Need ${minCost} Scrap` : `Recruit ${d.name}`}
                                        disabled={alreadyInForce || !canAffordAny || needsTier4}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (alreadyInForce) return;
                                          if (opts.length > 1) {
                                            setRecruitSize(isOpenSize ? null : d.name);
                                            if (recruitView !== d.name) setRecruitView(null);
                                          } else if (canAffordAny) {
                                            const next = recruitUnit(run, fac, d.name, opts[0].models);
                                            if (next !== run) {
                                              setRun(next);
                                              play('good');
                                              setInfo(`Recruited ${d.name}!`);
                                              setRecruitView(null);
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
                                          const cost = recruitScrapCost(run, d, o.pts);
                                          const canAfford = (run.scrap ?? 0) >= cost;
                                          const disabled = !canAfford || alreadyInForce;
                                          return (
                                            <button
                                              key={o.models}
                                              type="button"
                                              className="ab-pop-size"
                                              disabled={disabled}
                                              style={disabled ? { opacity: 0.45, filter: 'grayscale(0.75)' } : undefined}
                                              onClick={() => {
                                                if (disabled) return;
                                                const next = recruitUnit(run, fac, d.name, o.models);
                                                if (next !== run) {
                                                  setRun(next);
                                                  play('good');
                                                  setInfo(`Recruited ${d.name} (${o.models} models)!`);
                                                  setRecruitSize(null);
                                                  setRecruitView(null);
                                                }
                                              }}
                                            >
                                              <span className="ab-pop-models">{o.models} {o.models === 1 ? 'model' : 'models'}</span>
                                              <span className="ab-pop-pts" style={!canAfford ? { color: '#94a3b8' } : undefined}>{cost} Scrap</span>
                                              <span className="ab-pop-plus" style={disabled ? { background: 'rgba(255,255,255,0.08)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' } : undefined}>
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
                </div>
              )}
          </div>
          {quickMenu()}
        </div>
      )}

      {info && <div className="toast" role="status">{info}</div>}
    </div>
  );
}
