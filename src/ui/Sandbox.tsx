// Lore-Accurate Sandbox & Massive Firefight Simulator:
// Allows testing huge firefights, massive armadas, and realistic range/cover interactions on large battlefields.
import { useState, useEffect } from 'react';
import { autoAttach, defaultWargear, listPoints, syncList, syncWargear } from '../engine/army';
import { buildShootPools, expectedDamage, resolveAll, startAttack } from '../engine/attack';
import { createGame } from '../engine/game';
import type { ArmyList, ArmyUnitEntry, FactionData, GameState, Pool } from '../engine/types';
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
  const [faction0Id, setFaction0Id] = useState<string>('SM');
  const [faction1Id, setFaction1Id] = useState<string>('CD');
  const [fac0, setFac0] = useState<FactionData | null>(null);
  const [fac1, setFac1] = useState<FactionData | null>(null);
  const [side0Units, setSide0Units] = useState<ArmyUnitEntry[]>([]);
  const [side1Units, setSide1Units] = useState<ArmyUnitEntry[]>([]);
  const [activeSide, setActiveSide] = useState<0 | 1>(0);
  const [fireStats, setFireStats] = useState<FirefightStats | null>(null);
  const [simState, setSimState] = useState<GameState | null>(null);
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
      if (d && d.points[0]?.options[0]) {
        const o = d.points[0].options[0];
        const e = syncWargear(d, defaultWargear(d, { uid: 's0-u1', datasheet: d.name, models: o.models, pts: o.pts }));
        setSide0Units([e]);
      }
    }
  }, [fac0, side0Units.length]);

  useEffect(() => {
    if (side1Units.length === 0 && fac1) {
      const d = fac1.datasheets.find((x) => x.name.includes('Bloodletter') || x.name.includes('Daemon') || x.name.includes('Boyz')) ?? fac1.datasheets[0];
      if (d && d.points[0]?.options[0]) {
        const o = d.points[0].options[0];
        const e = syncWargear(d, defaultWargear(d, { uid: 's1-u1', datasheet: d.name, models: o.models, pts: o.pts }));
        setSide1Units([e]);
      }
    }
  }, [fac1, side1Units.length]);

  // Build GameState for simulation / board
  const buildGameState = (unitsA: ArmyUnitEntry[], unitsB: ArmyUnitEntry[], curFac0: FactionData, curFac1: FactionData): GameState => {
    const listA: ArmyList = { id: 'sandbox-a', name: 'Force Blue', factionId: curFac0.id, battleSize: 'apocalypse', detachments: [], units: unitsA };
    const listB: ArmyList = { id: 'sandbox-b', name: 'Force Red', factionId: curFac1.id, battleSize: 'apocalypse', detachments: [], units: unitsB };
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

    // Position units on realistic firing lines separated by `distance`
    const centerY = scale.height / 2;
    const y0 = Math.max(3, centerY - distance / 2);
    const y1 = Math.min(scale.height - 3, centerY + distance / 2);

    // Arrange Side 0 along y0
    const u0 = s.units.filter((u) => u.owner === 0);
    const step0 = scale.width / (u0.length + 1);
    u0.forEach((u, idx) => {
      const x = step0 * (idx + 1);
      u.models.forEach((m, mIdx) => {
        m.x = x + (mIdx % 5) * 1.6 - 1.6;
        m.y = y0 + Math.floor(mIdx / 5) * 1.6;
        m.rot = Math.PI / 2; // Facing down toward enemy
      });
    });

    // Arrange Side 1 along y1
    const u1 = s.units.filter((u) => u.owner === 1);
    const step1 = scale.width / (u1.length + 1);
    u1.forEach((u, idx) => {
      const x = step1 * (idx + 1);
      u.models.forEach((m, mIdx) => {
        m.x = x + (mIdx % 5) * 1.6 - 1.6;
        m.y = y1 - Math.floor(mIdx / 5) * 1.6;
        m.rot = -Math.PI / 2; // Facing up toward attacker
      });
    });

    s.phase = 'shooting';
    s.active = 0;
    return s;
  };

  const addUnitToSide = (side: 0 | 1, datasheetName: string) => {
    const f = side === 0 ? fac0 : fac1;
    if (!f) return;
    const d = f.datasheets.find((x) => x.name === datasheetName);
    if (!d || !d.points[0]?.options[0]) return;
    const o = d.points[0].options[0];
    const uid = `sb-${side}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const e = syncWargear(d, defaultWargear(d, { uid, datasheet: d.name, models: o.models, pts: o.pts }));
    if (side === 0) setSide0Units([...side0Units, e]);
    else setSide1Units([...side1Units, e]);
    play('good');
  };

  const removeUnitFromSide = (side: 0 | 1, uid: string) => {
    if (side === 0) setSide0Units(side0Units.filter((u) => u.uid !== uid));
    else setSide1Units(side1Units.filter((u) => u.uid !== uid));
    play('bad');
  };

  // Run full mass volley shooting simulation
  const runMassVolley = (fromSide: 0 | 1 = 0) => {
    if (!fac0 || !fac1) return;
    setBusy(true);
    try {
      const s = buildGameState(side0Units, side1Units, fac0, fac1);
      const shooters = s.units.filter((u) => u.owner === fromSide && u.models.some((m) => !m.dead));
      const targets = s.units.filter((u) => u.owner === (1 - fromSide) && u.models.some((m) => !m.dead));

      let totalShots = 0;
      let totalHits = 0;
      let totalWounds = 0;
      let totalFailedSaves = 0;
      let totalDmg = 0;
      let totalSlain = 0;
      const details: string[] = [];

      for (const shooter of shooters) {
        if (!targets.length) break;
        const target = targets[0]; // Primary target
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
          details.push(`${shooter.name} fired on ${target.name}: ${slain} models slain`);
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
      setSimState(s);
      play('kill');
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const launchInteractiveBattle = () => {
    if (!fac0 || !fac1 || !side0Units.length || !side1Units.length) return;
    const s = buildGameState(side0Units, side1Units, fac0, fac1);
    onPlayBattle(withAutoRules(s));
  };

  const pts0 = fac0 ? listPoints({ factionId: fac0.id, detachments: [], units: side0Units, battleSize: 'apocalypse', name: '' }, fac0) : 0;
  const pts1 = fac1 ? listPoints({ factionId: fac1.id, detachments: [], units: side1Units, battleSize: 'apocalypse', name: '' }, fac1) : 0;

  return (
    <div className="app sandbox" style={{ overflowY: 'auto' }}>
      <header className="appbar">
        <button className="icon-btn" aria-label="Back" onClick={onBack}><span className="chev-left" aria-hidden="true" /></button>
        <span className="appbar-title">Lore-Accurate Sandbox & Firefight</span>
        <button className="btn small primary" onClick={launchInteractiveBattle} disabled={!side0Units.length || !side1Units.length}>
          <Icon name="fight" size={15} /> Play on Big Map
        </button>
      </header>

      <main className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 960, margin: '0 auto', width: '100%' }}>
        {/* Map Scale Selection */}
        <section className="slate"><div className="slate-in">
          <div className="cmp-kicker">Battlefield Dimensions & Realistic Scale</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 8 }}>
            {SCALES.map((sc) => (
              <button
                key={sc.id}
                className={`btn ${scale.id === sc.id ? 'primary' : 'ghost'}`}
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px' }}
                onClick={() => setScale(sc)}
              >
                <b>{sc.name}</b>
                <span className="tiny muted">{sc.note}</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <span className="label">Engagement Distance:</span>
            {[12, 18, 24, 36, 48].map((d) => (
              <button
                key={d}
                className={`btn small ${distance === d ? 'primary' : ''}`}
                onClick={() => setDistance(d)}
              >
                {d}"
              </button>
            ))}
            <span className="tiny muted">({distance < 24 ? 'Point-blank / Rapid Fire' : distance === 24 ? 'Standard Firefight' : 'Long-range Artillery / Sniper'})</span>
          </div>
        </div></section>

        {/* Armies Side-by-Side Builder */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          {/* Side 0 (Blue Force) */}
          <section className="slate" style={{ borderTop: '3px solid var(--p0)' }}><div className="slate-in">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Emblem factionId={faction0Id} />
                <div>
                  <b style={{ color: 'var(--p0)', fontSize: 16 }}>Attacker Force (Blue)</b>
                  <div className="tiny muted">{pts0} pts · {side0Units.length} squads</div>
                </div>
              </div>
              <select
                value={faction0Id}
                onChange={(e) => setFaction0Id(e.target.value)}
                style={{ background: 'var(--surface-3)', color: 'var(--text)', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: 6 }}
              >
                {(index?.factions ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
              {side0Units.map((u) => {
                const photo = getPortrait(u.datasheet);
                return (
                  <div key={u.uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 6, background: 'var(--surface-2)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {photo ? <img src={photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                        : <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-3)', display: 'grid', placeItems: 'center' }}><Icon name="fight" size={14} /></span>}
                      <span style={{ fontSize: 13 }}>{u.datasheet} ×{u.models}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tiny muted">{u.pts} pts</span>
                      <button className="icon-btn" onClick={() => removeUnitFromSide(0, u.uid)} aria-label="Remove"><Icon name="delete" size={15} /></button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Add for Side 0 */}
            <div style={{ marginTop: 8 }}>
              <span className="tiny muted">Spawn Squad:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {fac0?.datasheets.slice(0, 6).map((d) => (
                  <button key={d.name} className="btn small" onClick={() => addUnitToSide(0, d.name)}>
                    + {d.name}
                  </button>
                ))}
              </div>
            </div>
          </div></section>

          {/* Side 1 (Red Force) */}
          <section className="slate" style={{ borderTop: '3px solid var(--p1)' }}><div className="slate-in">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Emblem factionId={faction1Id} />
                <div>
                  <b style={{ color: 'var(--p1)', fontSize: 16 }}>Target Force (Red)</b>
                  <div className="tiny muted">{pts1} pts · {side1Units.length} squads</div>
                </div>
              </div>
              <select
                value={faction1Id}
                onChange={(e) => setFaction1Id(e.target.value)}
                style={{ background: 'var(--surface-3)', color: 'var(--text)', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: 6 }}
              >
                {(index?.factions ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
              {side1Units.map((u) => {
                const photo = getPortrait(u.datasheet);
                return (
                  <div key={u.uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 6, background: 'var(--surface-2)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {photo ? <img src={photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                        : <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-3)', display: 'grid', placeItems: 'center' }}><Icon name="fight" size={14} /></span>}
                      <span style={{ fontSize: 13 }}>{u.datasheet} ×{u.models}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tiny muted">{u.pts} pts</span>
                      <button className="icon-btn" onClick={() => removeUnitFromSide(1, u.uid)} aria-label="Remove"><Icon name="delete" size={15} /></button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Add for Side 1 */}
            <div style={{ marginTop: 8 }}>
              <span className="tiny muted">Spawn Squad:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {fac1?.datasheets.slice(0, 6).map((d) => (
                  <button key={d.name} className="btn small" onClick={() => addUnitToSide(1, d.name)}>
                    + {d.name}
                  </button>
                ))}
              </div>
            </div>
          </div></section>
        </div>

        {/* Mass Firefight Action Bar */}
        <section className="slate"><div className="slate-in">
          <div className="cmp-kicker">Firefight Simulation Controls</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            <button className="btn primary big" disabled={busy || !side0Units.length || !side1Units.length} onClick={() => runMassVolley(0)}>
              <Icon name="shoot" size={18} /> Mass Volley (Attacker Fires)
            </button>
            <button className="btn big" disabled={busy || !side0Units.length || !side1Units.length} onClick={() => runMassVolley(1)}>
              <Icon name="shoot" size={18} /> Return Fire (Target Fires)
            </button>
            <button className="btn big" onClick={() => { setFireStats(null); setSimState(null); play('card'); }}>
              <Icon name="undo" size={18} /> Restore / Reset Firefight
            </button>
          </div>

          {/* Combat Statistics Display */}
          {fireStats && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div className="cmp-title" style={{ fontSize: 18 }}>Firefight Results & Damage Analytics</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 10 }}>
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                  <div className="tiny muted">Shots Fired</div>
                  <b style={{ fontSize: 20 }}>{fireStats.shots}</b>
                </div>
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                  <div className="tiny muted">Hits Landed</div>
                  <b style={{ fontSize: 20, color: '#60a5fa' }}>{fireStats.hits}</b>
                </div>
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                  <div className="tiny muted">Wounds Scored</div>
                  <b style={{ fontSize: 20, color: '#f59e0b' }}>{fireStats.wounds}</b>
                </div>
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                  <div className="tiny muted">Failed Saves</div>
                  <b style={{ fontSize: 20, color: '#f87171' }}>{fireStats.savesFailed}</b>
                </div>
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                  <div className="tiny muted">Damage Done</div>
                  <b style={{ fontSize: 20, color: '#ef4444' }}>{fireStats.damage}</b>
                </div>
                <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                  <div className="tiny muted">Models Slain</div>
                  <b style={{ fontSize: 20, color: '#ec4899' }}>{fireStats.modelsSlain}</b>
                </div>
              </div>

              {fireStats.details.length > 0 && (
                <div style={{ marginTop: 10, maxHeight: 120, overflowY: 'auto', background: 'var(--surface-3)', padding: 8, borderRadius: 6, fontSize: 12 }}>
                  {fireStats.details.map((d, i) => <div key={i}>{d}</div>)}
                </div>
              )}
            </div>
          )}
        </div></section>
      </main>
    </div>
  );
}
