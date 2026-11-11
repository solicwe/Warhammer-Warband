import React, { useState } from 'react';
import type { FactionData } from '../engine/types';
import {
  type Run,
  canCompressSquad,
  compressSquad,
  canBuyMunitorumAmmo,
  buyMunitorumAmmo,
  setApexDesignation,
  setTacticalClock,
  hireAdvisor,
  unlockAdvisorSlot,
  upgradeOrbitalModule,
  selectOrbitalModule,
  selectPatronContract,
  fortifyGarrisonNode,
} from '../engine/campaign';
import {
  HIGH_COMMAND_ADVISORS,
  TACTICAL_CLOCK_DIRECTIVES,
  APEX_DESIGNATIONS,
  MUNITORUM_AMMO,
  ORBITAL_MODULES,
  PATRON_CONTRACTS,
  type AdvisorId,
  type ApexDesignationId,
  type MunitorumAmmoId,
  type OrbitalModuleId,
  type PatronContractId,
  type TacticalClockDirectiveId,
} from '../engine/campaignSystems';
import { Icon } from './Icon';

interface WarRoomModalProps {
  run: Run;
  faction: FactionData;
  onUpdateRun: (next: Run) => void;
  onClose: () => void;
  initialTab?: 'compression' | 'highCommand' | 'tacticalClock' | 'patron';
}

export const WarRoomModal: React.FC<WarRoomModalProps> = ({
  run,
  faction,
  onUpdateRun,
  onClose,
  initialTab = 'compression',
}) => {
  const [tab, setTab] = useState<'compression' | 'highCommand' | 'tacticalClock' | 'patron'>(initialTab);
  const [selectedUnitForApex, setSelectedUnitForApex] = useState<string | null>(null);

  const units = run.list?.units ?? [];
  const scrap = run.scrap ?? 0;
  const activeAdvisors = run.activeAdvisors ?? [];
  const maxSlots = run.unlockedAdvisorSlots ?? 1;
  const currentClock = run.tacticalClock ?? [
    'SHROUD_OF_NIGHT',
    'BLITZKRIEG_SURGE',
    'ANNIHILATION_VOLLEY',
    'AEGIS_OF_IRON',
    'WARMASTER_ASCENDANCY',
  ];

  // Tactical Clock Swap Helper
  const swapClockRound = (idx1: number, idx2: number) => {
    const nextClock = [...currentClock] as [
      TacticalClockDirectiveId,
      TacticalClockDirectiveId,
      TacticalClockDirectiveId,
      TacticalClockDirectiveId,
      TacticalClockDirectiveId
    ];
    const temp = nextClock[idx1];
    nextClock[idx1] = nextClock[idx2];
    nextClock[idx2] = temp;
    onUpdateRun(setTacticalClock(run, nextClock));
  };

  return (
    <div className="cmp-modal-backdrop" onClick={onClose}>
      <div className="cmp-armory-modal war-room-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
        {/* Header */}
        <div className="cmp-armory-header">
          <button type="button" className="appbar-back-btn" onClick={onClose}>&lt;</button>
          <div className="cmp-armory-header-center">
            <div className="cmp-armory-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🏛️ War Room & Strategium Council</span>
            </div>
            <div className="cmp-armory-sub">
              Zero-Collision Rule Engine · Fleet Integrity: {run.fleetIntegrityHP ?? 100}/100 HP
            </div>
          </div>
          <div className="cmp-armory-header-right">
            <span className="cmp-scrap"><Icon name="shop" size={14} /> <b>{scrap}</b> Scrap</span>
            <button type="button" className="cmp-close-btn" onClick={onClose}><Icon name="close" size={18} /></button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="cmp-armory-tabs" style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 16px' }}>
          <button
            className={`cmp-armory-tab ${tab === 'compression' ? 'active' : ''}`}
            onClick={() => setTab('compression')}
            style={{ padding: '10px 16px', fontWeight: tab === 'compression' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'compression' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'compression' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            ★ Army & Compression ({units.length}/8)
          </button>
          <button
            className={`cmp-armory-tab ${tab === 'highCommand' ? 'active' : ''}`}
            onClick={() => setTab('highCommand')}
            style={{ padding: '10px 16px', fontWeight: tab === 'highCommand' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'highCommand' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'highCommand' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            🎖️ High Command ({activeAdvisors.length}/{maxSlots})
          </button>
          <button
            className={`cmp-armory-tab ${tab === 'tacticalClock' ? 'active' : ''}`}
            onClick={() => setTab('tacticalClock')}
            style={{ padding: '10px 16px', fontWeight: tab === 'tacticalClock' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'tacticalClock' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'tacticalClock' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            🕒 5-Round Clock
          </button>
          <button
            className={`cmp-armory-tab ${tab === 'patron' ? 'active' : ''}`}
            onClick={() => setTab('patron')}
            style={{ padding: '10px 16px', fontWeight: tab === 'patron' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'patron' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'patron' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            📜 Patron Contract
          </button>
        </div>

        {/* Tab Content */}
        <div className="cmp-armory-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: 16 }}>
          {/* TAB 1: ARMY COMPRESSION & APEX */}
          {tab === 'compression' && (
            <div>
              <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                <b style={{ color: '#f59e0b' }}>🛡️ Anti-Lag Elite Compression Engine:</b>
                <div style={{ fontSize: '0.85em', color: '#d1d5db', marginTop: 4 }}>
                  Maximum 8 active squads are deployed on the battlefield at once. Merge duplicate squads to increase their Veteran Rank (★ Tier I ➔ ★★ Tier II: Wounds ×1.8, Attacks ×1.6 ➔ ★★★ Tier III: Wounds ×2.6, Attacks ×2.3, +1 Dmg, FNP 5+) without adding models to the board!
                </div>
              </div>

              {/* Apex Designations Overview */}
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#e5e7eb' }}>🎖️ Apex Battlefield Designations (Max 1 unit per badge):</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  {(Object.keys(APEX_DESIGNATIONS) as ApexDesignationId[]).map((apexId) => {
                    const def = APEX_DESIGNATIONS[apexId];
                    const assignedUnit = units.find((u) => u.apexDesignation === apexId);
                    return (
                      <div key={apexId} style={{ background: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 6, border: assignedUnit ? '1px solid #10b981' : '1px dashed #6b7280' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9em', color: assignedUnit ? '#10b981' : '#9ca3af' }}>
                          {def.icon} {def.nameTh}
                        </div>
                        <div style={{ fontSize: '0.75em', color: '#9ca3af', margin: '4px 0' }}>{def.desc}</div>
                        <div style={{ fontSize: '0.8em', marginTop: 6, fontWeight: 'bold' }}>
                          {assignedUnit ? (
                            <span style={{ color: '#10b981' }}>Equipped: {assignedUnit.datasheet}</span>
                          ) : (
                            <span style={{ color: '#6b7280' }}>[Unassigned]</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Squad List with Compress Buttons */}
              <h4 style={{ margin: '16px 0 8px 0', color: '#e5e7eb' }}>Active Squads & Compression:</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {units.map((u) => {
                  const tier = u.compressionTier ?? 1;
                  const canRankUp = canCompressSquad(run, u.uid);
                  const isOverStrikeCap = units.indexOf(u) >= 8;

                  return (
                    <div
                      key={u.uid}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: tier === 3 ? 'rgba(245, 158, 11, 0.15)' : tier === 2 ? 'rgba(148, 163, 184, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                        border: tier === 3 ? '1px solid #f59e0b' : tier === 2 ? '1px solid #94a3b8' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 'bold', fontSize: '1em', color: tier === 3 ? '#fbbf24' : tier === 2 ? '#e2e8f0' : '#f3f4f6' }}>
                            {tier === 3 ? '★★★ ' : tier === 2 ? '★★ ' : ''}{u.datasheet}
                          </span>
                          <span style={{ fontSize: '0.8em', color: '#9ca3af' }}>{u.pts} pts · {u.models} models</span>
                          {isOverStrikeCap && (
                            <span style={{ fontSize: '0.75em', background: '#374151', color: '#d1d5db', padding: '2px 6px', borderRadius: 4 }}>
                              Support Bench
                            </span>
                          )}
                          {u.apexDesignation && (
                            <span style={{ fontSize: '0.75em', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '2px 6px', borderRadius: 4 }}>
                              {APEX_DESIGNATIONS[u.apexDesignation]?.icon} {APEX_DESIGNATIONS[u.apexDesignation]?.nameTh}
                            </span>
                          )}
                          {u.tempAmmoLoadout && (
                            <span style={{ fontSize: '0.75em', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', padding: '2px 6px', borderRadius: 4 }}>
                              {MUNITORUM_AMMO[u.tempAmmoLoadout]?.nameTh}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        {/* Apex badge assign dropdown */}
                        <select
                          value={u.apexDesignation || ''}
                          onChange={(e) => onUpdateRun(setApexDesignation(run, u.uid, (e.target.value as ApexDesignationId) || null))}
                          style={{ background: '#1f2937', color: '#e5e7eb', border: '1px solid #4b5563', borderRadius: 4, padding: '4px 8px', fontSize: '0.8em' }}
                        >
                          <option value="">No Apex Badge</option>
                          <option value="VANGUARD_SPEARHEAD">🗡️ Spearhead</option>
                          <option value="IMMOVABLE_ANVIL">⚓ Anvil</option>
                          <option value="EXECUTIONER">☠️ Executioner</option>
                          <option value="GRAND_SPOTTER">🎯 Spotter</option>
                        </select>

                        {/* Rank Up Button */}
                        {canRankUp && (
                          <button
                            className="btn small primary"
                            style={{ background: '#f59e0b', color: '#000', fontWeight: 'bold' }}
                            onClick={() => onUpdateRun(compressSquad(run, u.uid))}
                          >
                            ★ Rank Up to Tier {tier + 1}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: HIGH COMMAND ADVISORS & ORBITAL BAY */}
          {tab === 'highCommand' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h4 style={{ margin: 0 }}>Strategium Council ({activeAdvisors.length}/{maxSlots} Slots Unlocked)</h4>
                  <div style={{ fontSize: '0.85em', color: '#9ca3af' }}>Advisors trigger powerful effects in every Command Phase and grant passive campaign bonuses.</div>
                </div>
                {maxSlots < 3 && (
                  <button
                    className="btn small"
                    disabled={scrap < (maxSlots === 1 ? 100 : 200)}
                    onClick={() => onUpdateRun(unlockAdvisorSlot(run))}
                    style={{ background: '#3b82f6', color: '#fff' }}
                  >
                    Unlock Slot {maxSlots + 1} ({maxSlots === 1 ? '100' : '200'} Scrap)
                  </button>
                )}
              </div>

              {/* Advisors Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
                {(Object.keys(HIGH_COMMAND_ADVISORS) as AdvisorId[]).map((advId) => {
                  const def = HIGH_COMMAND_ADVISORS[advId];
                  const isHired = activeAdvisors.includes(advId);
                  const canHire = !isHired && activeAdvisors.length < maxSlots && scrap >= def.hireCost;

                  return (
                    <div
                      key={advId}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: isHired ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.04)',
                        border: isHired ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b>{def.icon} {def.nameTh}</b>
                        <span style={{ fontSize: '0.8em', color: '#9ca3af' }}>{def.hireCost} Scrap</span>
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#60a5fa', margin: '6px 0 2px 0' }}>⚔️ <b>Battle:</b> {def.battleDesc}</div>
                      <div style={{ fontSize: '0.8em', color: '#34d399', marginBottom: 8 }}>📜 <b>Campaign:</b> {def.campaignDesc}</div>
                      {isHired ? (
                        <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.85em' }}>✓ Appointed</span>
                      ) : (
                        <button
                          className="btn small"
                          disabled={!canHire}
                          onClick={() => onUpdateRun(hireAdvisor(run, advId))}
                          style={{ width: '100%' }}
                        >
                          Hire ({def.hireCost} Scrap)
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Orbital Strike Bay */}
              <h4 style={{ margin: '16px 0 8px 0' }}>🛰️ Flagship Orbital Bay (Fires in Round 1):</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {(Object.keys(ORBITAL_MODULES) as OrbitalModuleId[]).map((modId) => {
                  const def = ORBITAL_MODULES[modId];
                  const currentLvl = run.orbitalModules?.levels?.[modId] ?? 1;
                  const isActive = (run.orbitalModules?.activeModule ?? 'LANCE_BATTERY') === modId;
                  const upgradeCost = currentLvl === 1 ? 80 : 140;

                  return (
                    <div
                      key={modId}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.04)',
                        border: isActive ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b>{def.icon} {def.nameTh} (Lv.{currentLvl})</b>
                        {isActive && <span style={{ color: '#60a5fa', fontSize: '0.75em', fontWeight: 'bold' }}>ACTIVE</span>}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#d1d5db', margin: '6px 0' }}>
                        {currentLvl === 1 ? def.descLv1 : currentLvl === 2 ? def.descLv2 : def.descLv3}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        {!isActive && (
                          <button className="btn small" onClick={() => onUpdateRun(selectOrbitalModule(run, modId))}>
                            Select Active
                          </button>
                        )}
                        {currentLvl < 3 && (
                          <button
                            className="btn small primary"
                            disabled={scrap < upgradeCost}
                            onClick={() => onUpdateRun(upgradeOrbitalModule(run, modId))}
                          >
                            Upgrade to Lv.{currentLvl + 1} ({upgradeCost}⚙️)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: 5-ROUND TACTICAL CLOCK */}
          {tab === 'tacticalClock' && (
            <div>
              <div style={{ background: 'rgba(59, 130, 246, 0.08)', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <b style={{ color: '#60a5fa' }}>🕒 Pre-Battle Tactical Clock (5-Round Operation Timeline):</b>
                <div style={{ fontSize: '0.85em', color: '#d1d5db', marginTop: 4 }}>
                  Arrange 5 distinct Battleplan Directives across Battle Rounds 1 to 5. The engine switches army-wide directives automatically at the start of each round! Click any round to swap order.
                </div>
              </div>

              {/* 5 Rounds Timeline */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {currentClock.map((dirId, idx) => {
                  const def = TACTICAL_CLOCK_DIRECTIVES[dirId];
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 12,
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: '#f59e0b', color: '#000', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                          R{idx + 1}
                        </div>
                        <div>
                          <b>{def?.icon} {def?.nameTh || dirId} ({def?.name})</b>
                          <div style={{ fontSize: '0.8em', color: '#9ca3af' }}>{def?.desc}</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 4 }}>
                        {idx > 0 && (
                          <button className="btn small" onClick={() => swapClockRound(idx, idx - 1)}>▲ Up</button>
                        )}
                        {idx < 4 && (
                          <button className="btn small" onClick={() => swapClockRound(idx, idx + 1)}>▼ Down</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: FACTION PATRONAGE */}
          {tab === 'patron' && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <h4>📜 Sector Patronage Contracts:</h4>
                <div style={{ fontSize: '0.85em', color: '#9ca3af' }}>
                  Sign a covenant with one of the grand 40k factions for this sector. Meet their army condition to gain sector-long buffs and a massive boss payout!
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {(Object.keys(PATRON_CONTRACTS) as PatronContractId[]).map((cid) => {
                  const def = PATRON_CONTRACTS[cid];
                  const isSigned = run.activePatronContract === cid;

                  return (
                    <div
                      key={cid}
                      style={{
                        padding: 14,
                        borderRadius: 8,
                        background: isSigned ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255,255,255,0.04)',
                        border: isSigned ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <div style={{ fontWeight: 'bold', color: isSigned ? '#f59e0b' : '#e5e7eb' }}>
                        {def.nameTh}
                      </div>
                      <div style={{ fontSize: '0.75em', color: '#9ca3af', marginBottom: 8 }}>{def.sponsor}</div>
                      <div style={{ fontSize: '0.8em', color: '#fcd34d', marginBottom: 4 }}><b>Condition:</b> {def.conditionDesc}</div>
                      <div style={{ fontSize: '0.8em', color: '#93c5fd', marginBottom: 4 }}><b>Sector Buff:</b> {def.buffDesc}</div>
                      <div style={{ fontSize: '0.8em', color: '#86efac', marginBottom: 10 }}><b>Boss Payout:</b> {def.bossRewardDesc}</div>
                      {isSigned ? (
                        <div style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.85em' }}>✓ Active Contract</div>
                      ) : (
                        <button className="btn small primary" onClick={() => onUpdateRun(selectPatronContract(run, cid))}>
                          Sign Covenant
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
