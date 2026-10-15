// Total War: Warhammer Custom Battle & Firefight Simulator
// Features full faction roster recruitment, army trays, realistic custom battlefields, and instant battle launch.
import { useState, useEffect, useMemo } from 'react';
import { autoAttach, defaultWargear, listPoints, pointsOptions, syncList, syncWargear } from '../engine/army';
import { buildShootPools, expectedDamage, resolveAll, startAttack } from '../engine/attack';
import { createGame } from '../engine/game';
import type { ArmyList, ArmyUnitEntry, DatasheetData, FactionData, GameState, ObjectiveState, Pt, TerrainPiece } from '../engine/types';
import { Emblem } from './ArmyBuilder';
import { loadFaction, type FactionIndex } from './data';
import { Icon } from './Icon';
import { withAutoRules } from './library';
import { getPortrait } from './portraits';
import { play } from './sfx';

interface Props {
  index: FactionIndex | null;
  onBack: () => void;
  onPlayBattle: (s: GameState) => void;
}

export interface MapScale {
  id: string;
  name: string;
  width: number;
  height: number;
  note: string;
}

const SCALES: MapScale[] = [
  { id: 'incursion', name: 'Incursion (44" × 30")', width: 44, height: 30, note: 'Combat Patrol / small engagement' },
  { id: 'strikeforce', name: 'Strike Force (44" × 60")', width: 44, height: 60, note: 'Standard official 10e tournament table' },
  { id: 'onslaught', name: 'Onslaught (48" × 72")', width: 48, height: 72, note: 'Massive battlefield with extended firing lanes' },
  { id: 'apocalypse', name: 'Apocalypse (48" × 96")', width: 48, height: 96, note: 'Huge realistic theatre for mass firepower testing' },
];

type CategoryFilter = 'all' | 'leader' | 'battleline' | 'infantry' | 'vehicle' | 'monster';

function getCategory(d: DatasheetData): 'leader' | 'battleline' | 'infantry' | 'vehicle' | 'monster' {
  const kw = d.keywords.map((k) => k.toUpperCase());
  if (kw.includes('CHARACTER') || kw.includes('EPIC HERO') || (d.leads && d.leads.length > 0)) return 'leader';
  if (kw.includes('BATTLELINE')) return 'battleline';
  if (kw.includes('VEHICLE') || kw.includes('DREADNOUGHT') || kw.includes('TRANSPORT') || kw.includes('FORTIFICATION')) return 'vehicle';
  if (kw.includes('MONSTER') || kw.includes('TITANIC') || kw.includes('TOWERING')) return 'monster';
  return 'infantry';
}

function buildSandboxBattlefield(width: number, height: number): { terrain: TerrainPiece[]; objectives: ObjectiveState[] } {
  const terrain: TerrainPiece[] = [];
  const objectives: ObjectiveState[] = [];

  // 1. Objectives: 5 strategic points distributed across the board
  const objCoords = [
    { id: 'obj-c', x: width / 2, y: height / 2, type: 'neutral' },
    { id: 'obj-w', x: width * 0.22, y: height / 2, type: 'neutral' },
    { id: 'obj-e', x: width * 0.78, y: height / 2, type: 'neutral' },
    { id: 'home-a', x: width / 2, y: Math.max(5, height * 0.15), type: 'home', owner: 'attacker' },
    { id: 'home-d', x: width / 2, y: Math.min(height - 5, height * 0.85), type: 'home', owner: 'defender' },
  ];

  const R = 3 + 20 / 25.4; // 3" control zone around marker
  for (const [i, o] of objCoords.entries()) {
    const areaId = `obj-t-${i}`;
    const poly: Pt[] = Array.from({ length: 24 }, (_, k) => ({
      x: o.x + R * Math.cos((k / 24) * Math.PI * 2),
      y: o.y + R * Math.sin((k / 24) * Math.PI * 2),
    }));
    terrain.push({
      id: areaId,
      kind: 'objective-area',
      label: `Objective Marker (${o.id})`,
      category: 'exposed',
      height: 0,
      walls: [],
      obstacles: [],
      poly,
      objectiveId: o.id,
    });
    objectives.push({
      id: o.id,
      type: o.type,
      x: o.x,
      y: o.y,
      terrainId: areaId,
      controller: null,
      ownerRole: o.owner,
    } as ObjectiveState);
  }

  // 2. Realistic Ruins & Cover pieces positioned across the board
  const makeRuin = (id: string, cx: number, cy: number, w: number, h: number): TerrainPiece => {
    const hw = w / 2, hh = h / 2;
    const poly = [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh },
    ];
    const walls = [
      { a: { x: cx - hw, y: cy + hh }, b: { x: cx - hw, y: cy - hh } },
      { a: { x: cx - hw, y: cy - hh }, b: { x: cx + hw * 0.5, y: cy - hh } },
    ];
    return {
      id,
      kind: 'ruin',
      label: 'Ruins (Dense Cover)',
      category: 'dense',
      height: 5,
      poly,
      walls,
      obstacles: [],
    };
  };

  const makeCrate = (id: string, cx: number, cy: number, w = 3.5, h = 2): TerrainPiece => {
    const hw = w / 2, hh = h / 2;
    const poly = [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh },
    ];
    return {
      id,
      kind: 'container',
      label: 'Armoured Container (Light)',
      category: 'light',
      height: 2.5,
      poly,
      walls: [
        { a: poly[0], b: poly[1] },
        { a: poly[1], b: poly[2] },
        { a: poly[2], b: poly[3] },
        { a: poly[3], b: poly[0] },
      ],
      obstacles: [],
      box: poly,
    };
  };

  // Center flanking ruins
  terrain.push(makeRuin('t-mid-left', width * 0.28, height * 0.42, 8, 6));
  terrain.push(makeRuin('t-mid-right', width * 0.72, height * 0.58, 8, 6));
  // Flank cover
  terrain.push(makeRuin('t-flank-w', width * 0.12, height * 0.5, 6, 8));
  terrain.push(makeRuin('t-flank-e', width * 0.88, height * 0.5, 6, 8));
  // Deployment zone ruins
  terrain.push(makeRuin('t-dep-a', width * 0.5, Math.max(9, height * 0.22), 7, 5));
  terrain.push(makeRuin('t-dep-d', width * 0.5, Math.min(height - 9, height * 0.78), 7, 5));
  // Containers
  terrain.push(makeCrate('t-crate-1', width * 0.4, height * 0.5));
  terrain.push(makeCrate('t-crate-2', width * 0.6, height * 0.5));

  return { terrain, objectives };
}

interface FirefightStats {
  shots: number;
  hits: number;
  wounds: number;
  savesFailed: number;
  damage: number;
  modelsSlain: number;
  details: string[];
}

export function SandboxScreen({ index, onBack, onPlayBattle }: Props) {
  const [scale, setScale] = useState<MapScale>(SCALES[1]);
  const [distance, setDistance] = useState<number>(24);
  const [aiMode, setAiMode] = useState<'pve' | 'pvp' | 'eve'>('pve');
  const [faction0Id, setFaction0Id] = useState<string>('SM');
  const [faction1Id, setFaction1Id] = useState<string>('CD');
  const [fac0, setFac0] = useState<FactionData | null>(null);
  const [fac1, setFac1] = useState<FactionData | null>(null);
  const [side0Units, setSide0Units] = useState<ArmyUnitEntry[]>([]);
  const [side1Units, setSide1Units] = useState<ArmyUnitEntry[]>([]);
  const [recruitTarget, setRecruitTarget] = useState<0 | 1>(0);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [factionModal, setFactionModal] = useState<0 | 1 | null>(null);
  const [fireStats, setFireStats] = useState<FirefightStats | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadFaction(faction0Id).then((f) => { if (live) setFac0(f); }).catch(() => null);
    return () => { live = false; };
  }, [faction0Id]);

  useEffect(() => {
    let live = true;
    loadFaction(faction1Id).then((f) => { if (live) setFac1(f); }).catch(() => null);
    return () => { live = false; };
  }, [faction1Id]);

  // Set default initial test units if empty
  useEffect(() => {
    if (side0Units.length === 0 && fac0) {
      const d = fac0.datasheets.find((x) => x.name.includes('Intercessor') || x.name.includes('Terminator') || x.name.includes('Marine')) ?? fac0.datasheets[0];
      if (d) {
        const o = pointsOptions(d)[0] ?? { models: 5, pts: 80 };
        const e = syncWargear(d, defaultWargear(d, { uid: 's0-u1', datasheet: d.name, models: o.models, pts: o.pts }));
        setSide0Units([e]);
      }
    }
  }, [fac0, side0Units.length]);

  useEffect(() => {
    if (side1Units.length === 0 && fac1) {
      const d = fac1.datasheets.find((x) => x.name.includes('Bloodletter') || x.name.includes('Daemon') || x.name.includes('Boyz')) ?? fac1.datasheets[0];
      if (d) {
        const o = pointsOptions(d)[0] ?? { models: 10, pts: 120 };
        const e = syncWargear(d, defaultWargear(d, { uid: 's1-u1', datasheet: d.name, models: o.models, pts: o.pts }));
        setSide1Units([e]);
      }
    }
  }, [fac1, side1Units.length]);

  // Total War Unit Recruitment Action
  const recruitUnit = (d: DatasheetData) => {
    const o = pointsOptions(d)[0] ?? { models: 1, pts: 100 };
    const side = recruitTarget;
    const uid = `tw-${side}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const e = syncWargear(d, defaultWargear(d, { uid, datasheet: d.name, models: o.models, pts: o.pts }));
    if (side === 0) setSide0Units((prev) => [...prev, e]);
    else setSide1Units((prev) => [...prev, e]);
    play('good');
  };

  const duplicateUnit = (side: 0 | 1, u: ArmyUnitEntry) => {
    const f = side === 0 ? fac0 : fac1;
    if (!f) return;
    const d = f.datasheets.find((x) => x.name === u.datasheet);
    if (!d) return;
    const uid = `tw-${side}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const clone = { ...u, uid };
    if (side === 0) setSide0Units((prev) => [...prev, clone]);
    else setSide1Units((prev) => [...prev, clone]);
    play('good');
  };

  const dismissUnit = (side: 0 | 1, uid: string) => {
    if (side === 0) setSide0Units((prev) => prev.filter((u) => u.uid !== uid));
    else setSide1Units((prev) => prev.filter((u) => u.uid !== uid));
    play('bad');
  };

  const clearArmy = (side: 0 | 1) => {
    if (side === 0) setSide0Units([]);
    else setSide1Units([]);
    play('card');
  };

  // Build GameState for Battle
  const buildGameState = (unitsA: ArmyUnitEntry[], unitsB: ArmyUnitEntry[], curFac0: FactionData, curFac1: FactionData): GameState => {
    const listA: ArmyList = { id: 'tw-a', name: 'Force Blue (Player)', factionId: curFac0.id, battleSize: 'apocalypse', detachments: [], units: unitsA };
    const listB: ArmyList = { id: 'tw-b', name: 'Force Red (Enemy)', factionId: curFac1.id, battleSize: 'apocalypse', detachments: [], units: unitsB };
    const s = createGame({
      lists: [autoAttach(syncList(listA, curFac0), curFac0), autoAttach(syncList(listB, curFac1), curFac1)],
      factions: [curFac0, curFac1],
      names: ['Force Blue (Player)', 'Force Red (Enemy)'],
      secondaryMode: 'none',
      maxRounds: 5,
      seed: 42,
    });

    s.table = { width: scale.width, height: scale.height };
    s.sandbox = true;

    // Apply battlefield layout matching selected scale
    const bf = buildSandboxBattlefield(scale.width, scale.height);
    s.terrain = bf.terrain;
    s.objectives = bf.objectives;

    // Arrange Units in Rank-and-File Total War Battle Lines
    const centerY = scale.height / 2;
    const y0 = Math.max(3, centerY - distance / 2);
    const y1 = Math.min(scale.height - 3, centerY + distance / 2);

    // Arrange Side 0 (Blue) facing South
    const u0 = s.units.filter((u) => u.owner === 0);
    const step0 = scale.width / (u0.length + 1);
    u0.forEach((u, idx) => {
      u.status = 'board'; // Critical: allows onBoard(u) to pass!
      const cx = step0 * (idx + 1);
      const cy = y0;
      u.models.forEach((m, mIdx) => {
        m.dead = false;
        m.wounds = m.wounds ?? 1;
        const rank = Math.floor(mIdx / 5);
        const col = (mIdx % 5) - 2;
        m.x = cx + col * 1.8;
        m.y = cy - rank * 1.8;
        m.rot = Math.PI / 2; // Facing enemy
      });
    });

    // Arrange Side 1 (Red) facing North
    const u1 = s.units.filter((u) => u.owner === 1);
    const step1 = scale.width / (u1.length + 1);
    u1.forEach((u, idx) => {
      u.status = 'board'; // Critical: allows onBoard(u) to pass!
      const cx = step1 * (idx + 1);
      const cy = y1;
      u.models.forEach((m, mIdx) => {
        m.dead = false;
        m.wounds = m.wounds ?? 1;
        const rank = Math.floor(mIdx / 5);
        const col = (mIdx % 5) - 2;
        m.x = cx + col * 1.8;
        m.y = cy + rank * 1.8;
        m.rot = -Math.PI / 2; // Facing player
      });
    });

    s.round = 1;
    s.turn = 1;
    s.phase = 'movement';
    s.active = 0;
    s.firstPlayer = 0;
    s.deployTurn = 0;
    s.attackerPlayer = 0;

    // AI Bots configuration
    if (aiMode === 'pve') {
      s.bots = [1];
    } else if (aiMode === 'eve') {
      s.bots = [0, 1];
    } else {
      s.bots = [];
    }

    return s;
  };

  const launchInteractiveBattle = () => {
    if (!fac0 || !fac1 || !side0Units.length || !side1Units.length) return;
    const s = buildGameState(side0Units, side1Units, fac0, fac1);
    play('charge');
    onPlayBattle(withAutoRules(s));
  };

  // Run full mass volley shooting simulation
  const runMassVolley = (fromSide: 0 | 1 = 0) => {
    if (!fac0 || !fac1) return;
    setBusy(true);
    try {
      const s = buildGameState(side0Units, side1Units, fac0, fac1);
      const shooters = s.units.filter((u) => u.owner === fromSide && u.models.some((m) => !m.dead));
      const targets = s.units.filter((u) => u.owner === (1 - fromSide) && u.models.some((m) => !m.dead));

      let totalShots = 0, totalHits = 0, totalWounds = 0, totalFailedSaves = 0, totalDmg = 0, totalSlain = 0;
      const details: string[] = [];

      for (const shooter of shooters) {
        if (!targets.length) break;
        const target = targets[0];
        const poolsRes = buildShootPools(s, shooter.id, target.id, { mode: 'normal' });
        if (poolsRes.pools.length > 0) {
          const aliveBefore = target.models.filter((m) => !m.dead).length;
          startAttack(s, 'shoot', shooter.id, target.id, poolsRes.pools);
          resolveAll(s);
          const aliveAfter = target.models.filter((m) => !m.dead).length;
          const slain = aliveBefore - aliveAfter;
          totalSlain += slain;

          for (const p of poolsRes.pools) {
            const exp = expectedDamage(s, p, target);
            totalShots += p.models * (parseInt(p.profile.A as string) || 1);
            totalHits += Math.round(exp.hits);
            totalWounds += Math.round(exp.wounds);
            totalDmg += Math.round(exp.unsaved);
            totalFailedSaves += Math.round(exp.unsaved);
          }
          details.push(`${shooter.name} fired on ${target.name}: ${slain} models slain (${poolsRes.pools.length} weapons)`);
        }
      }

      setFireStats({
        shots: totalShots,
        hits: totalHits,
        wounds: totalWounds,
        savesFailed: totalFailedSaves,
        damage: totalDmg,
        modelsSlain: totalSlain,
        details,
      });
      play('kill');
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const pts0 = fac0 ? listPoints({ factionId: fac0.id, detachments: [], units: side0Units, battleSize: 'apocalypse', name: '' }, fac0) : 0;
  const pts1 = fac1 ? listPoints({ factionId: fac1.id, detachments: [], units: side1Units, battleSize: 'apocalypse', name: '' }, fac1) : 0;

  // Filter datasheets for recruitment browser
  const activeFac = recruitTarget === 0 ? fac0 : fac1;
  const activeFactionName = index?.factions.find((f) => f.id === (recruitTarget === 0 ? faction0Id : faction1Id))?.name ?? '';
  const filteredDatasheets = useMemo(() => {
    if (!activeFac) return [];
    return activeFac.datasheets.filter((d) => {
      if (categoryFilter !== 'all' && getCategory(d) !== categoryFilter) return false;
      if (searchTerm && !d.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [activeFac, categoryFilter, searchTerm]);

  return (
    <div className="app sandbox" style={{ overflowY: 'auto' }}>
      <header className="appbar">
        <button className="icon-btn" aria-label="Back" onClick={onBack}><span className="chev-left" aria-hidden="true" /></button>
        <span className="appbar-title">Total War: Custom Battle & Firefight</span>
        <button
          className="btn tw-btn-start"
          onClick={launchInteractiveBattle}
          disabled={!side0Units.length || !side1Units.length}
        >
          <Icon name="fight" size={18} /> Start Battle (เข้าสู่สนามรบ)
        </button>
      </header>

      <main className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1080, margin: '0 auto', width: '100%' }}>
        {/* Battle Setup Bar */}
        <section className="tw-battle-bar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sandbox-dist-label">Battlefield Dimension</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SCALES.map((sc) => (
                <button
                  key={sc.id}
                  className={`tw-tab-btn ${scale.id === sc.id ? 'active' : ''}`}
                  onClick={() => setScale(sc)}
                >
                  {sc.name.split(' (')[0]} ({sc.width}"×{sc.height}")
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sandbox-dist-label">Engagement Distance</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[12, 18, 24, 36, 48].map((d) => (
                <button
                  key={d}
                  className={`tw-tab-btn ${distance === d ? 'active' : ''}`}
                  onClick={() => setDistance(d)}
                >
                  {d}"
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="sandbox-dist-label">Battle Mode</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button className={`tw-tab-btn ${aiMode === 'pve' ? 'active' : ''}`} onClick={() => setAiMode('pve')}>Player vs AI</button>
              <button className={`tw-tab-btn ${aiMode === 'pvp' ? 'active' : ''}`} onClick={() => setAiMode('pvp')}>Player vs Player</button>
              <button className={`tw-tab-btn ${aiMode === 'eve' ? 'active' : ''}`} onClick={() => setAiMode('eve')}>Spectator (AI vs AI)</button>
            </div>
          </div>
        </section>

        {/* Total War Armies Bar (Left: Player / Right: Enemy) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          {/* Blue Army Tray */}
          <section className="slate tw-army-panel" style={{ borderTop: '4px solid #3b82f6' }}><div className="slate-in">
            <div className="tw-army-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="icon-btn" onClick={() => setFactionModal(0)} title="Change Faction">
                  <Emblem factionId={faction0Id} />
                </button>
                <div>
                  <b style={{ color: '#60a5fa', fontSize: 16 }}>Player Force (Blue)</b>
                  <div style={{ fontSize: 12.5, color: '#cbd5e1' }}>{index?.factions.find((f) => f.id === faction0Id)?.name} · <b>{pts0} pts</b> ({side0Units.length} squads)</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="btn small" onClick={() => setFactionModal(0)}><Icon name="menu" size={14} /> Faction</button>
                <button className="btn small" onClick={() => setRecruitTarget(0)} style={{ background: recruitTarget === 0 ? '#3b82f6' : undefined, color: recruitTarget === 0 ? '#fff' : undefined }}>
                  {recruitTarget === 0 ? 'Recruiting' : 'Select'}
                </button>
                <button className="icon-btn" onClick={() => clearArmy(0)} title="Clear Army"><Icon name="undo" size={16} /></button>
              </div>
            </div>

            {/* Total War Unit Cards in Army Tray */}
            <div className="tw-army-tray">
              {side0Units.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  No units recruited. Click units from the recruitment browser below to build your army!
                </div>
              ) : (
                side0Units.map((u) => {
                  const photo = getPortrait(u.datasheet);
                  return (
                    <div key={u.uid} className="tw-unit-card">
                      {photo ? <img src={photo} alt="" className="tw-unit-card-img" /> : <div className="tw-unit-card-img" style={{ display: 'grid', placeItems: 'center' }}><Icon name="fight" size={24} /></div>}
                      <div className="tw-unit-card-body">
                        <div className="tw-unit-card-title">{u.datasheet}</div>
                        <div className="tw-unit-card-meta">
                          <span>×{u.models} models</span>
                          <span style={{ fontWeight: 700, color: '#e2b464' }}>{u.pts} pts</span>
                        </div>
                        <div className="tw-unit-card-actions">
                          <button className="tw-card-btn" onClick={() => duplicateUnit(0, u)} title="Duplicate squad">+ Clone</button>
                          <button className="tw-card-btn del" onClick={() => dismissUnit(0, u.uid)} title="Dismiss squad">Dismiss</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div></section>

          {/* Red Army Tray */}
          <section className="slate tw-army-panel" style={{ borderTop: '4px solid #ef4444' }}><div className="slate-in">
            <div className="tw-army-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="icon-btn" onClick={() => setFactionModal(1)} title="Change Faction">
                  <Emblem factionId={faction1Id} />
                </button>
                <div>
                  <b style={{ color: '#f87171', fontSize: 16 }}>Enemy Force (Red)</b>
                  <div style={{ fontSize: 12.5, color: '#cbd5e1' }}>{index?.factions.find((f) => f.id === faction1Id)?.name} · <b>{pts1} pts</b> ({side1Units.length} squads)</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="btn small" onClick={() => setFactionModal(1)}><Icon name="menu" size={14} /> Faction</button>
                <button className="btn small" onClick={() => setRecruitTarget(1)} style={{ background: recruitTarget === 1 ? '#ef4444' : undefined, color: recruitTarget === 1 ? '#fff' : undefined }}>
                  {recruitTarget === 1 ? 'Recruiting' : 'Select'}
                </button>
                <button className="icon-btn" onClick={() => clearArmy(1)} title="Clear Army"><Icon name="undo" size={16} /></button>
              </div>
            </div>

            {/* Total War Unit Cards in Army Tray */}
            <div className="tw-army-tray">
              {side1Units.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  No units recruited. Click units from the recruitment browser below to build your enemy army!
                </div>
              ) : (
                side1Units.map((u) => {
                  const photo = getPortrait(u.datasheet);
                  return (
                    <div key={u.uid} className="tw-unit-card">
                      {photo ? <img src={photo} alt="" className="tw-unit-card-img" /> : <div className="tw-unit-card-img" style={{ display: 'grid', placeItems: 'center' }}><Icon name="fight" size={24} /></div>}
                      <div className="tw-unit-card-body">
                        <div className="tw-unit-card-title">{u.datasheet}</div>
                        <div className="tw-unit-card-meta">
                          <span>×{u.models} models</span>
                          <span style={{ fontWeight: 700, color: '#e2b464' }}>{u.pts} pts</span>
                        </div>
                        <div className="tw-unit-card-actions">
                          <button className="tw-card-btn" onClick={() => duplicateUnit(1, u)} title="Duplicate squad">+ Clone</button>
                          <button className="tw-card-btn del" onClick={() => dismissUnit(1, u.uid)} title="Dismiss squad">Dismiss</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div></section>
        </div>

        {/* Total War Unit Recruitment Pool (All datasheets with categories and search) */}
        <section className="tw-browser">
          <div className="tw-browser-nav">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="sandbox-dist-label" style={{ fontSize: 15, color: '#fef08a' }}>
                Unit Recruitment Pool ({activeFactionName})
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className={`tw-tab-btn ${recruitTarget === 0 ? 'active' : ''}`}
                  onClick={() => setRecruitTarget(0)}
                  style={{ background: recruitTarget === 0 ? '#3b82f6' : undefined, color: recruitTarget === 0 ? '#fff' : undefined }}
                >
                  Target: Blue Force
                </button>
                <button
                  className={`tw-tab-btn ${recruitTarget === 1 ? 'active' : ''}`}
                  onClick={() => setRecruitTarget(1)}
                  style={{ background: recruitTarget === 1 ? '#ef4444' : undefined, color: recruitTarget === 1 ? '#fff' : undefined }}
                >
                  Target: Red Force
                </button>
              </div>
            </div>

            <input
              type="text"
              placeholder="Search unit by name (e.g. Terminator, Tank)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="tw-search-input"
            />
          </div>

          {/* Category Filter Tabs */}
          <div className="tw-browser-tabs">
            {(['all', 'leader', 'battleline', 'infantry', 'vehicle', 'monster'] as const).map((cat) => (
              <button
                key={cat}
                className={`tw-tab-btn ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === 'all' ? 'All Units' : cat === 'leader' ? 'Leaders & Heroes' : cat === 'battleline' ? 'Battleline' : cat === 'infantry' ? 'Infantry & Elites' : cat === 'vehicle' ? 'Vehicles & Armor' : 'Monsters'}
              </button>
            ))}
          </div>

          {/* Recruitment Grid */}
          <div className="tw-recruit-grid">
            {filteredDatasheets.map((d) => {
              const photo = getPortrait(d.name);
              const opt = pointsOptions(d)[0] ?? { models: 1, pts: 100 };
              const cat = getCategory(d);
              return (
                <button key={d.name} className="tw-recruit-card" onClick={() => recruitUnit(d)}>
                  {photo ? <img src={photo} alt="" className="tw-recruit-img" /> : <div className="tw-recruit-img" style={{ display: 'grid', placeItems: 'center' }}><Icon name="fight" size={20} /></div>}
                  <div className="tw-recruit-info">
                    <span className="tw-recruit-name">{d.name}</span>
                    <span className="tw-recruit-badge">{cat} · {opt.models} models</span>
                    <span className="tw-recruit-pts">{opt.pts} pts</span>
                  </div>
                  <span style={{ fontSize: 18, color: '#d3a04a', marginLeft: 'auto', fontWeight: 700 }}>+</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Simulation / Firefight Controls */}
        <section className="slate"><div className="slate-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="cmp-kicker">Mass Firefight & Auto-Resolve</div>
              <div className="tiny muted">Simulate direct volley exchange at {distance}" before entering interactive battle</div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" disabled={busy || !side0Units.length || !side1Units.length} onClick={() => runMassVolley(0)}>
                <Icon name="shoot" size={16} /> Attacker Volley (Blue)
              </button>
              <button className="btn" style={{ background: '#991b1b', borderColor: '#ef4444', color: '#fff' }} disabled={busy || !side0Units.length || !side1Units.length} onClick={() => runMassVolley(1)}>
                <Icon name="shoot" size={16} /> Return Fire (Red)
              </button>
              {fireStats && (
                <button className="btn ghost" onClick={() => setFireStats(null)}>
                  Clear Results
                </button>
              )}
            </div>
          </div>

          {fireStats && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                <div className="sandbox-stat-tile"><div className="tile-label">Shots Fired</div><b className="tile-val" style={{ color: '#f8fafc' }}>{fireStats.shots}</b></div>
                <div className="sandbox-stat-tile"><div className="tile-label">Hits Landed</div><b className="tile-val" style={{ color: '#60a5fa' }}>{fireStats.hits}</b></div>
                <div className="sandbox-stat-tile"><div className="tile-label">Wounds Scored</div><b className="tile-val" style={{ color: '#f59e0b' }}>{fireStats.wounds}</b></div>
                <div className="sandbox-stat-tile"><div className="tile-label">Failed Saves</div><b className="tile-val" style={{ color: '#f87171' }}>{fireStats.savesFailed}</b></div>
                <div className="sandbox-stat-tile"><div className="tile-label">Damage Done</div><b className="tile-val" style={{ color: '#ef4444' }}>{fireStats.damage}</b></div>
                <div className="sandbox-stat-tile"><div className="tile-label">Models Slain</div><b className="tile-val" style={{ color: '#ec4899' }}>{fireStats.modelsSlain}</b></div>
              </div>
              {fireStats.details.length > 0 && (
                <div className="sandbox-log-box">
                  {fireStats.details.map((d, i) => <div key={i}>{d}</div>)}
                </div>
              )}
            </div>
          )}
        </div></section>
      </main>

      {/* Total War Faction Picker Modal */}
      {factionModal !== null && (
        <div className="tw-modal-backdrop" onClick={() => setFactionModal(null)}>
          <div className="tw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tw-modal-header">
              <span className="tw-modal-title">Select Faction for {factionModal === 0 ? 'Player Force (Blue)' : 'Enemy Force (Red)'}</span>
              <button className="icon-btn" onClick={() => setFactionModal(null)} aria-label="Close"><Icon name="undo" size={18} /></button>
            </div>
            <div className="tw-modal-body">
              {(index?.factions ?? []).map((f) => {
                const isCur = (factionModal === 0 ? faction0Id : faction1Id) === f.id;
                return (
                  <button
                    key={f.id}
                    className={`tw-faction-btn ${isCur ? 'active' : ''}`}
                    onClick={() => {
                      if (factionModal === 0) {
                        setFaction0Id(f.id);
                        setSide0Units([]);
                      } else {
                        setFaction1Id(f.id);
                        setSide1Units([]);
                      }
                      setFactionModal(null);
                      play('card');
                    }}
                  >
                    <Emblem factionId={f.id} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
