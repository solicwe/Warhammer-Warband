import React, { useState } from 'react';
import type { FactionData, ArmyUnitEntry } from '../engine/types';
import {
  type Run,
  canCompressSquad,
  compressSquad,
  canBuyMunitorumAmmo,
  buyMunitorumAmmo,
  setTacticalClock,
  hireAdvisor,
  unlockAdvisorSlot,
  upgradeOrbitalModule,
  selectOrbitalModule,
  selectPatronContract,
} from '../engine/campaign';
import {
  HIGH_COMMAND_ADVISORS,
  TACTICAL_CLOCK_DIRECTIVES,
  ROUND_DOCTRINES,
  getRoundDoctrineCost,
  buyRoundDoctrine,
  MUNITORUM_AMMO,
  ORBITAL_MODULES,
  PATRON_CONTRACTS,
  type AdvisorId,
  type OrbitalModuleId,
  type PatronContractId,
  type TacticalClockDirectiveId,
} from '../engine/campaignSystems';
import { Icon, type IconName } from './Icon';
import { UnitArt } from './ArmyBuilder';

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

  const units = run.list?.units ?? [];
  const scrap = run.scrap ?? 0;
  const activeAdvisors = run.activeAdvisors ?? [];
  const maxSlots = run.unlockedAdvisorSlots ?? 1;
  return (
    <div className="cmp-modal-backdrop" onClick={onClose}>
      <div className="cmp-armory-modal war-room-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880 }}>
        {/* Header */}
        <div className="cmp-armory-header">
          <button type="button" className="appbar-back-btn" onClick={onClose} aria-label="Back">&lt;</button>
          <div className="cmp-armory-header-center">
            <div className="cmp-armory-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icon name="tabletop" size={18} />
              <span>War Room & Strategium Council</span>
            </div>
            <div className="cmp-armory-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>Zero-Collision Rule Engine</span>
              <span>·</span>
              <Icon name="heal" size={13} style={{ color: '#10b981' }} />
              <span>Fleet Integrity: {run.fleetIntegrityHP ?? 100}/100 HP</span>
            </div>
          </div>
          <div className="cmp-armory-header-right">
            <span className="cmp-scrap"><Icon name="shop" size={14} /> <b>{scrap}</b> Scrap</span>
            <button type="button" className="cmp-close-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="cmp-armory-tabs" style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 16px' }}>
          <button
            type="button"
            className={`cmp-armory-tab ${tab === 'compression' ? 'active' : ''}`}
            onClick={() => setTab('compression')}
            style={{ padding: '10px 16px', fontWeight: tab === 'compression' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'compression' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'compression' ? '2px solid #f59e0b' : 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="shield" size={14} />
            <span>Army & Compression ({units.length}/8)</span>
          </button>
          <button
            type="button"
            className={`cmp-armory-tab ${tab === 'highCommand' ? 'active' : ''}`}
            onClick={() => setTab('highCommand')}
            style={{ padding: '10px 16px', fontWeight: tab === 'highCommand' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'highCommand' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'highCommand' ? '2px solid #f59e0b' : 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="leader" size={14} />
            <span>High Command ({activeAdvisors.length}/4)</span>
          </button>
          <button
            type="button"
            className={`cmp-armory-tab ${tab === 'tacticalClock' ? 'active' : ''}`}
            onClick={() => setTab('tacticalClock')}
            style={{ padding: '10px 16px', fontWeight: tab === 'tacticalClock' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'tacticalClock' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'tacticalClock' ? '2px solid #f59e0b' : 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="history" size={14} />
            <span>Round Doctrines</span>
          </button>
          <button
            type="button"
            className={`cmp-armory-tab ${tab === 'patron' ? 'active' : ''}`}
            onClick={() => setTab('patron')}
            style={{ padding: '10px 16px', fontWeight: tab === 'patron' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'patron' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'patron' ? '2px solid #f59e0b' : 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="cards" size={14} />
            <span>Patron Contracts</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="cmp-armory-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: 16 }}>
          {/* TAB 1: ARMY COMPRESSION & RANKING */}
          {tab === 'compression' && (
            <div>
              {/* Compression Engine Rules Table */}
              <div style={{ background: '#0f172a', padding: 14, borderRadius: 8, marginBottom: 16, border: '1px solid #d97706' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <b style={{ color: '#f59e0b', fontSize: '0.95em', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="shield" size={16} />
                    <span>Anti-Lag Elite Compression Engine</span>
                  </b>
                  <span style={{ fontSize: '0.78em', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>
                    Deployment Limit: Max 8 Active Squads
                  </span>
                </div>
                <div style={{ fontSize: '0.82em', color: '#94a3b8', marginBottom: 10 }}>
                  Merge duplicate squads of the same datasheet to increase Veteran Rank without adding board clutter or lag:
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8em', color: '#f8fafc', background: '#1e293b', borderRadius: 6, overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ background: '#334155', textAlign: 'left', borderBottom: '1px solid #475569' }}>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Rank</th>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Required Squads</th>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Wounds (HP)</th>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Attacks</th>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Combat Bonuses</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #334155' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#94a3b8' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="check" size={12} /> Tier I</span>
                        </td>
                        <td style={{ padding: '6px 10px' }}>1 Squad</td>
                        <td style={{ padding: '6px 10px' }}>1.0x (Base)</td>
                        <td style={{ padding: '6px 10px' }}>1.0x (Base)</td>
                        <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>Standard datasheet profile</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #334155', background: 'rgba(245, 158, 11, 0.05)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#fbbf24' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="star" size={12} /> Tier II (Elite)</span>
                        </td>
                        <td style={{ padding: '6px 10px' }}>2 Duplicate Squads</td>
                        <td style={{ padding: '6px 10px', color: '#34d399', fontWeight: 'bold' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="heal" size={11} /> +1 W flat</span>
                        </td>
                        <td style={{ padding: '6px 10px', color: '#38bdf8', fontWeight: 'bold' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="swords" size={11} /> +1 Attack</span>
                        </td>
                        <td style={{ padding: '6px 10px', color: '#fef08a' }}>+1 Objective Control (OC), +1 Armour Save</td>
                      </tr>
                      <tr style={{ background: 'rgba(239, 68, 68, 0.05)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#f87171' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="trophy" size={12} /> Tier III (Apex)</span>
                        </td>
                        <td style={{ padding: '6px 10px' }}>3 Duplicate Squads</td>
                        <td style={{ padding: '6px 10px', color: '#34d399', fontWeight: 'bold' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="heal" size={11} /> +2 W flat</span>
                        </td>
                        <td style={{ padding: '6px 10px', color: '#38bdf8', fontWeight: 'bold' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="swords" size={11} /> +1 Attack, +1 Str</span>
                        </td>
                        <td style={{ padding: '6px 10px', color: '#f87171', fontWeight: 'bold' }}>Feel No Pain 6+, +1 Objective Control (OC)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Squad List with Portraits, Distinct Numbering, Upgrades & Compress Buttons */}
              <h4 style={{ margin: '16px 0 8px 0', color: '#e5e7eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="fight" size={16} />
                <span>Active Squads & Rank Compression:</span>
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {units.map((u) => {
                  const tier = u.compressionTier ?? 1;
                  const canRankUp = canCompressSquad(run, u.uid);
                  const isOverStrikeCap = units.indexOf(u) >= 8;
                  const sheet = faction?.datasheets?.find((d) => d.name === u.datasheet);

                  // Number duplicate squads clearly
                  const sameUnits = units.filter((x) => x.datasheet === u.datasheet);
                  const isDuplicate = sameUnits.length > 1;
                  const squadIndex = sameUnits.findIndex((x) => x.uid === u.uid) + 1;
                  const squadLabel = isDuplicate ? `${u.datasheet} #${squadIndex}` : u.datasheet;

                  // Attached leader & led squads
                  const attachedTo = u.attachTo ? units.find((x) => x.uid === u.attachTo) : null;
                  const ledByUnits = units.filter((x) => x.attachTo === u.uid);

                  // Enhancements
                  const enhancements = (u.enhancements && u.enhancements.length > 0)
                    ? u.enhancements.map((e) => e.name)
                    : u.enhancement ? [u.enhancement] : [];

                  return (
                    <div
                      key={u.uid}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        borderRadius: 8,
                        background: tier === 3 ? 'rgba(245, 158, 11, 0.12)' : tier === 2 ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                        border: tier === 3 ? '1.5px solid #f59e0b' : tier === 2 ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, flex: 1 }}>
                        {/* Squad portrait */}
                        <div style={{
                          width: 44,
                          height: 44,
                          borderRadius: 6,
                          overflow: 'hidden',
                          border: '1.5px solid rgba(255, 255, 255, 0.2)',
                          background: '#1e293b',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <UnitArt sheet={sheet} />
                        </div>

                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <b style={{ fontSize: 14.5, color: tier === 3 ? '#fbbf24' : tier === 2 ? '#7dd3fc' : '#f8fafc' }}>
                              {squadLabel}
                            </b>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              {u.pts + (u.wargearPts ?? 0)} pts · {u.models} models
                            </span>
                            {tier > 1 && (
                              <span style={{ fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 4, background: tier === 3 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.2)', color: tier === 3 ? '#fcd34d' : '#38bdf8', border: `1px solid ${tier === 3 ? '#f59e0b' : '#38bdf8'}`, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Icon name={tier === 3 ? 'trophy' : 'star'} size={10} />
                                <span>{tier === 3 ? 'Tier III (Apex Legend)' : 'Tier II (Elite)'}</span>
                              </span>
                            )}
                            {isOverStrikeCap && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#334155', color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Icon name="reserves" size={10} />
                                <span>Support Bench (Reserves)</span>
                              </span>
                            )}
                          </div>

                          {/* Upgrades, Attachments & Ammo Badges */}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                            {attachedTo && (
                              <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Icon name="leader" size={11} />
                                <span>Attached to: {attachedTo.datasheet}</span>
                              </span>
                            )}
                            {ledByUnits.map((l) => (
                              <span key={l.uid} style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Icon name="leader" size={11} />
                                <span>Led by: {l.datasheet}</span>
                              </span>
                            ))}
                            {enhancements.map((enh, enhIdx) => (
                              <span key={enhIdx} style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Icon name="enhancement" size={11} />
                                <span>Enhancement: {enh}</span>
                              </span>
                            ))}
                            {u.tempAmmoLoadout && (
                              <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Icon name={(MUNITORUM_AMMO[u.tempAmmoLoadout]?.icon || 'crosshair') as IconName} size={11} />
                                <span>Ammo: {MUNITORUM_AMMO[u.tempAmmoLoadout]?.name}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {canRankUp && (
                          <button
                            type="button"
                            className="btn small primary"
                            style={{ background: '#f59e0b', color: '#000', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onClick={() => onUpdateRun(compressSquad(run, u.uid))}
                          >
                            <Icon name="star" size={13} />
                            <span>Rank Up to Tier {tier + 1}</span>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h4 style={{ margin: 0, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="leader" size={16} />
                    <span>Strategium Council ({activeAdvisors.length}/{maxSlots} Slots Unlocked)</span>
                  </h4>
                  <div style={{ fontSize: '0.85em', color: '#94a3b8', marginTop: 2 }}>Advisors trigger powerful effects in every Command Phase and grant passive campaign bonuses.</div>
                </div>
                {maxSlots < 4 && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={scrap < (maxSlots === 1 ? 100 : maxSlots === 2 ? 200 : 300)}
                    onClick={() => onUpdateRun(unlockAdvisorSlot(run))}
                    style={{ background: '#3b82f6', color: '#fff', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <Icon name="plus" size={12} />
                    <span>Unlock Slot {maxSlots + 1} ({maxSlots === 1 ? '100' : maxSlots === 2 ? '200' : '300'} Scrap)</span>
                  </button>
                )}
              </div>

              {/* Advisors Overview Table */}
              <div style={{ background: '#0f172a', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #334155' }}>
                <b style={{ color: '#38bdf8', fontSize: '0.9em', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Icon name="leader" size={14} />
                  <span>High Command Advisor Abilities</span>
                </b>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78em', color: '#f8fafc', background: '#1e293b', borderRadius: 6, overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ background: '#334155', textAlign: 'left', borderBottom: '1px solid #475569' }}>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Advisor</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Command Phase Aura</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Passive Campaign Perk</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(HIGH_COMMAND_ADVISORS) as AdvisorId[]).map((advId) => {
                        const def = HIGH_COMMAND_ADVISORS[advId];
                        const isHired = activeAdvisors.includes(advId);
                        return (
                          <tr key={advId} style={{ borderBottom: '1px solid #334155', background: isHired ? 'rgba(16, 185, 129, 0.08)' : 'transparent' }}>
                            <td style={{ padding: '5px 8px', fontWeight: 'bold', color: isHired ? '#34d399' : '#e2e8f0', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <Icon name={(def.icon || 'leader') as IconName} size={13} />
                                <span>{def.name}</span>
                              </span>
                            </td>
                            <td style={{ padding: '5px 8px', color: '#cbd5e1' }}>{def.battleDesc}</td>
                            <td style={{ padding: '5px 8px', color: '#38bdf8' }}>{def.campaignDesc}</td>
                            <td style={{ padding: '5px 8px', color: '#fef08a', whiteSpace: 'nowrap' }}>{def.hireCost} Scrap</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Advisors Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
                {(Object.keys(HIGH_COMMAND_ADVISORS) as AdvisorId[]).map((advId) => {
                  const def = HIGH_COMMAND_ADVISORS[advId];
                  const isHired = activeAdvisors.includes(advId);
                  const isFull = activeAdvisors.length >= maxSlots;
                  const canHire = !isHired && !isFull && scrap >= def.hireCost;

                  return (
                    <div
                      key={advId}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: isHired ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255,255,255,0.04)',
                        border: isHired ? '1.5px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b style={{ color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name={(def.icon || 'leader') as IconName} size={15} />
                          <span>{def.name}</span>
                        </b>
                        <span style={{ fontSize: '0.8em', color: '#fcd34d', fontWeight: 'bold' }}>{def.hireCost} Scrap</span>
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#38bdf8', margin: '6px 0 2px 0', lineHeight: 1.35 }}>
                        <b>Battle:</b> {def.battleDesc}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#4ade80', marginBottom: 8, lineHeight: 1.35 }}>
                        <b>Campaign:</b> {def.campaignDesc}
                      </div>
                      {isHired ? (
                        <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.85em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="check" size={13} /> [Appointed]
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn small"
                          disabled={!canHire}
                          onClick={() => onUpdateRun(hireAdvisor(run, advId))}
                          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        >
                          <Icon name="plus" size={12} />
                          <span>{isFull ? `Slots Full (${activeAdvisors.length}/${maxSlots})` : `Hire (${def.hireCost} Scrap)`}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Orbital Strike Bay */}
              <h4 style={{ margin: '16px 0 8px 0', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="zap" size={16} />
                <span>Flagship Orbital Bay (Fires in Round 1):</span>
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
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
                        border: isActive ? '1.5px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b style={{ color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name={(def.icon || 'zap') as IconName} size={15} />
                          <span>{def.name} (Lv.{currentLvl})</span>
                        </b>
                        {isActive && <span style={{ color: '#60a5fa', fontSize: '0.75em', fontWeight: 'bold' }}>[ACTIVE]</span>}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#cbd5e1', margin: '6px 0', lineHeight: 1.35 }}>
                        {currentLvl === 1 ? def.descLv1 : currentLvl === 2 ? def.descLv2 : def.descLv3}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        {!isActive && (
                          <button type="button" className="btn small" onClick={() => onUpdateRun(selectOrbitalModule(run, modId))} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Icon name="check" size={12} />
                            <span>Select Active</span>
                          </button>
                        )}
                        {currentLvl < 3 && (
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={scrap < upgradeCost}
                            onClick={() => onUpdateRun(upgradeOrbitalModule(run, modId))}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <Icon name="star" size={12} />
                            <span>Upgrade to Lv.{currentLvl + 1} ({upgradeCost} Scrap)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: ROUND TACTICAL DOCTRINES & STACKABLE SURGES */}
          {tab === 'tacticalClock' && (
            <div>
              <div style={{ background: '#0f172a', padding: 14, borderRadius: 8, marginBottom: 16, border: '1px solid #d97706' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <b style={{ color: '#f59e0b', fontSize: '0.98em', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="zap" size={17} />
                    <span>Round Tactical Doctrines (Stackable Surge Shop)</span>
                  </b>
                  <span style={{ fontSize: '0.78em', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>
                    Battle Rounds 1 - 5 · Stackable up to Lv.3
                  </span>
                </div>
                <div style={{ fontSize: '0.82em', color: '#94a3b8' }}>
                  Purchase high-impact battle surges for each round with Scrap. Surges can be stacked up to Level 3 for exponential combat boosts (costs increase per stack)!
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                {[1, 2, 3, 4, 5].map((roundNum) => {
                  const def = ROUND_DOCTRINES[roundNum];
                  if (!def) return null;
                  const currentLvl = run.roundDoctrineLevels?.[roundNum] ?? (run.purchasedRoundDoctrines?.includes(roundNum) ? 1 : 0);
                  const nextLvl = currentLvl + 1;
                  const isMaxLvl = currentLvl >= 3;
                  const nextCost = getRoundDoctrineCost(roundNum, nextLvl);
                  const canBuy = !isMaxLvl && scrap >= nextCost;

                  const currentDesc = currentLvl === 1 ? def.descLv1 : currentLvl === 2 ? def.descLv2 : currentLvl === 3 ? def.descLv3 : null;
                  const nextDesc = currentLvl === 0 ? def.descLv1 : currentLvl === 1 ? def.descLv2 : def.descLv3;

                  return (
                    <div
                      key={roundNum}
                      style={{
                        padding: 14,
                        borderRadius: 8,
                        background: currentLvl > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                        border: currentLvl === 3 ? '2px solid #10b981' : currentLvl > 0 ? '1.5px solid #059669' : '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ background: currentLvl > 0 ? '#10b981' : '#f59e0b', color: '#000', fontWeight: 'bold', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>
                              Round {roundNum}
                            </span>
                            {currentLvl > 0 && (
                              <span style={{ fontSize: 10.5, fontWeight: 'bold', color: currentLvl === 3 ? '#34d399' : '#a7f3d0', background: 'rgba(16, 185, 129, 0.2)', padding: '2px 6px', borderRadius: 4 }}>
                                {currentLvl === 3 ? 'MAX STACK (Lv.3)' : `Stack ×${currentLvl} (Lv.${currentLvl})`}
                              </span>
                            )}
                          </div>
                          {!isMaxLvl && (
                            <span style={{ fontSize: '0.82em', color: '#fcd34d', fontWeight: 'bold' }}>
                              {currentLvl === 0 ? `${nextCost} Scrap` : `Next Stack: ${nextCost} Scrap`}
                            </span>
                          )}
                        </div>

                        <div style={{ fontWeight: 'bold', color: '#f8fafc', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon name={(def.icon || 'zap') as IconName} size={15} />
                          <span>{def.name}</span>
                        </div>

                        {/* Current Active Effects */}
                        {currentDesc && (
                          <div style={{ fontSize: '0.82em', color: '#86efac', marginTop: 8, lineHeight: 1.4, padding: '6px 8px', borderRadius: 6, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                            <b>Active (Stack Lv.{currentLvl}):</b> {currentDesc}
                          </div>
                        )}

                        {/* Next Upgrade Preview */}
                        {!isMaxLvl && (
                          <div style={{ fontSize: '0.8em', color: currentLvl === 0 ? '#cbd5e1' : '#94a3b8', marginTop: 8, lineHeight: 1.35 }}>
                            <b>{currentLvl === 0 ? 'Surge Effect:' : `Next Stack Upgrade (Lv.${nextLvl}):`}</b> {nextDesc}
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: 6 }}>
                        {isMaxLvl ? (
                          <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.82em', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', background: 'rgba(16, 185, 129, 0.15)', borderRadius: 4, width: '100%', justifyContent: 'center' }}>
                            <Icon name="check" size={13} />
                            <span>Fully Stacked (Max Level 3)</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={!canBuy}
                            onClick={() => onUpdateRun(buyRoundDoctrine(run, roundNum))}
                            style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                          >
                            <Icon name="plus" size={12} />
                            <span>{currentLvl === 0 ? `Purchase Surge (${nextCost} Scrap)` : `Add Stack to Lv.${nextLvl} (+${nextCost} Scrap)`}</span>
                          </button>
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
                <h4 style={{ margin: 0, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="cards" size={16} />
                  <span>Sector Patronage Contracts:</span>
                </h4>
                <div style={{ fontSize: '0.85em', color: '#94a3b8', marginTop: 4 }}>
                  Sign a covenant with one of the grand 40k factions for this sector. Meet their army condition to gain sector-long buffs and a massive boss payout.
                </div>
              </div>

              {/* Patron Comparison Table */}
              <div style={{ background: '#0f172a', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #334155' }}>
                <b style={{ color: '#f59e0b', fontSize: '0.9em', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Icon name="cards" size={14} />
                  <span>Patron Covenants Comparison</span>
                </b>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78em', color: '#f8fafc', background: '#1e293b', borderRadius: 6, overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ background: '#334155', textAlign: 'left', borderBottom: '1px solid #475569' }}>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Patron Faction</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Enemy Hunt Bounty</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Sector Buff</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Boss Bounty</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(PATRON_CONTRACTS) as PatronContractId[]).map((cid) => {
                        const def = PATRON_CONTRACTS[cid];
                        const isSigned = run.activePatronContract === cid;
                        return (
                          <tr key={cid} style={{ borderBottom: '1px solid #334155', background: isSigned ? 'rgba(245, 158, 11, 0.08)' : 'transparent' }}>
                            <td style={{ padding: '5px 8px', fontWeight: 'bold', color: isSigned ? '#fbbf24' : '#e2e8f0', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <Icon name={(def.icon || 'cards') as IconName} size={13} />
                                <span>{def.name}</span>
                              </span>
                            </td>
                            <td style={{ padding: '5px 8px', color: '#38bdf8' }}>{def.conditionDesc}</td>
                            <td style={{ padding: '5px 8px', color: '#cbd5e1' }}>{def.buffDesc}</td>
                            <td style={{ padding: '5px 8px', color: '#4ade80' }}>{def.bossRewardDesc}</td>
                            <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                              {isSigned ? <span style={{ color: '#10b981', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="check" size={11} /> [Signed]</span> : <span style={{ color: '#94a3b8' }}>Available</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                        border: isSigned ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <div style={{ fontWeight: 'bold', fontSize: 15, color: isSigned ? '#f59e0b' : '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name={(def.icon || 'cards') as IconName} size={16} />
                        <span>{def.name}</span>
                      </div>
                      <div style={{ fontSize: '0.78em', color: '#94a3b8', marginBottom: 8 }}>{def.sponsor}</div>
                      <div style={{ fontSize: '0.8em', color: '#fcd34d', marginBottom: 4, lineHeight: 1.35 }}>
                        <b>Condition:</b> {def.conditionDesc}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#93c5fd', marginBottom: 4, lineHeight: 1.35 }}>
                        <b>Sector Buff:</b> {def.buffDesc}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#86efac', marginBottom: 10, lineHeight: 1.35 }}>
                        <b>Boss Payout:</b> {def.bossRewardDesc}
                      </div>
                      {isSigned ? (
                        <div style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.85em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="check" size={13} /> [Active Covenant]
                        </div>
                      ) : (
                        <button type="button" className="btn small primary" onClick={() => onUpdateRun(selectPatronContract(run, cid))} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="check" size={13} />
                          <span>Sign Covenant</span>
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
