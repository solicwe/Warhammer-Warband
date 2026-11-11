import React, { useState } from 'react';
import type { FactionData, ArmyUnitEntry } from '../engine/types';
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
  type OrbitalModuleId,
  type PatronContractId,
  type TacticalClockDirectiveId,
} from '../engine/campaignSystems';
import { Icon } from './Icon';
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
      <div className="cmp-armory-modal war-room-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880 }}>
        {/* Header */}
        <div className="cmp-armory-header">
          <button type="button" className="appbar-back-btn" onClick={onClose} aria-label="Back">&lt;</button>
          <div className="cmp-armory-header-center">
            <div className="cmp-armory-title">
              <span>War Room & Strategium Council</span>
            </div>
            <div className="cmp-armory-sub">
              Zero-Collision Rule Engine · Fleet Integrity: {run.fleetIntegrityHP ?? 100}/100 HP
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
            style={{ padding: '10px 16px', fontWeight: tab === 'compression' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'compression' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'compression' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            Army & Compression ({units.length}/8)
          </button>
          <button
            type="button"
            className={`cmp-armory-tab ${tab === 'highCommand' ? 'active' : ''}`}
            onClick={() => setTab('highCommand')}
            style={{ padding: '10px 16px', fontWeight: tab === 'highCommand' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'highCommand' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'highCommand' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            High Command ({activeAdvisors.length}/{maxSlots})
          </button>
          <button
            type="button"
            className={`cmp-armory-tab ${tab === 'tacticalClock' ? 'active' : ''}`}
            onClick={() => setTab('tacticalClock')}
            style={{ padding: '10px 16px', fontWeight: tab === 'tacticalClock' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'tacticalClock' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'tacticalClock' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            5-Round Clock
          </button>
          <button
            type="button"
            className={`cmp-armory-tab ${tab === 'patron' ? 'active' : ''}`}
            onClick={() => setTab('patron')}
            style={{ padding: '10px 16px', fontWeight: tab === 'patron' ? 'bold' : 'normal', background: 'none', border: 'none', color: tab === 'patron' ? '#f59e0b' : '#9ca3af', borderBottom: tab === 'patron' ? '2px solid #f59e0b' : 'none', cursor: 'pointer' }}
          >
            Patron Contracts
          </button>
        </div>

        {/* Tab Content */}
        <div className="cmp-armory-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: 16 }}>
          {/* TAB 1: ARMY COMPRESSION & APEX */}
          {tab === 'compression' && (
            <div>
              {/* Compression Engine Rules Table */}
              <div style={{ background: '#0f172a', padding: 14, borderRadius: 8, marginBottom: 16, border: '1px solid #d97706' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <b style={{ color: '#f59e0b', fontSize: '0.95em' }}>Anti-Lag Elite Compression Engine</b>
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
                        <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#94a3b8' }}>Tier I</td>
                        <td style={{ padding: '6px 10px' }}>1 Squad</td>
                        <td style={{ padding: '6px 10px' }}>1.0x (Base)</td>
                        <td style={{ padding: '6px 10px' }}>1.0x (Base)</td>
                        <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>Standard datasheet profile</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #334155', background: 'rgba(245, 158, 11, 0.05)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#fbbf24' }}>Tier II (Elite)</td>
                        <td style={{ padding: '6px 10px' }}>2 Duplicate Squads</td>
                        <td style={{ padding: '6px 10px', color: '#34d399', fontWeight: 'bold' }}>1.8x</td>
                        <td style={{ padding: '6px 10px', color: '#38bdf8', fontWeight: 'bold' }}>1.6x</td>
                        <td style={{ padding: '6px 10px', color: '#fef08a' }}>+1 Objective Control (OC), +1 Armour Save</td>
                      </tr>
                      <tr style={{ background: 'rgba(239, 68, 68, 0.05)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 'bold', color: '#f87171' }}>Tier III (Apex)</td>
                        <td style={{ padding: '6px 10px' }}>3 Duplicate Squads</td>
                        <td style={{ padding: '6px 10px', color: '#34d399', fontWeight: 'bold' }}>2.6x</td>
                        <td style={{ padding: '6px 10px', color: '#38bdf8', fontWeight: 'bold' }}>2.3x</td>
                        <td style={{ padding: '6px 10px', color: '#f87171', fontWeight: 'bold' }}>+1 Damage (All Weapons), Feel No Pain 5+</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Apex Designations Overview Table */}
              <div style={{ background: '#0f172a', padding: 14, borderRadius: 8, marginBottom: 16, border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <b style={{ color: '#38bdf8', fontSize: '0.95em' }}>Apex Battlefield Designations</b>
                  <span style={{ fontSize: '0.78em', color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>
                    Max 1 Squad Per Badge
                  </span>
                </div>
                <div style={{ fontSize: '0.82em', color: '#94a3b8', marginBottom: 10 }}>
                  Assign exclusive command roles to specialized squads in your roster:
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8em', color: '#f8fafc', background: '#1e293b', borderRadius: 6, overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ background: '#334155', textAlign: 'left', borderBottom: '1px solid #475569' }}>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Badge</th>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Tactical Directive</th>
                        <th style={{ padding: '6px 10px', color: '#fef08a' }}>Assigned Squad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(APEX_DESIGNATIONS) as ApexDesignationId[]).map((apexId) => {
                        const def = APEX_DESIGNATIONS[apexId];
                        const assignedUnit = units.find((u) => u.apexDesignation === apexId);
                        const assignedSheet = assignedUnit ? faction?.datasheets?.find((d) => d.name === assignedUnit.datasheet) : null;
                        const sameUnits = assignedUnit ? units.filter((x) => x.datasheet === assignedUnit.datasheet) : [];
                        const isDup = sameUnits.length > 1;
                        const squadIdx = isDup ? sameUnits.findIndex((x) => x.uid === assignedUnit?.uid) + 1 : null;
                        const assignedLabel = assignedUnit ? (isDup ? `${assignedUnit.datasheet} #${squadIdx}` : assignedUnit.datasheet) : null;

                        return (
                          <tr key={apexId} style={{ borderBottom: '1px solid #334155' }}>
                            <td style={{ padding: '6px 10px', fontWeight: 'bold', color: assignedUnit ? '#34d399' : '#e2e8f0', whiteSpace: 'nowrap' }}>
                              {def.name}
                            </td>
                            <td style={{ padding: '6px 10px', color: '#cbd5e1' }}>
                              {def.desc}
                            </td>
                            <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                              {assignedUnit ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#34d399', fontWeight: 'bold' }}>
                                  <span style={{ width: 22, height: 22, borderRadius: 3, overflow: 'hidden', display: 'inline-flex', flexShrink: 0 }}>
                                    <UnitArt sheet={assignedSheet ?? undefined} />
                                  </span>
                                  <span>{assignedLabel}</span>
                                </span>
                              ) : (
                                <span style={{ color: '#64748b' }}>[Unassigned]</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Squad List with Portraits, Distinct Numbering, Upgrades & Compress Buttons */}
              <h4 style={{ margin: '16px 0 8px 0', color: '#e5e7eb' }}>Active Squads & Rank Compression:</h4>
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
                              <span style={{ fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 4, background: tier === 3 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.2)', color: tier === 3 ? '#fcd34d' : '#38bdf8', border: `1px solid ${tier === 3 ? '#f59e0b' : '#38bdf8'}` }}>
                                {tier === 3 ? 'Tier III (Apex Legend)' : 'Tier II (Elite)'}
                              </span>
                            )}
                            {isOverStrikeCap && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#334155', color: '#cbd5e1' }}>
                                Support Bench (Reserves)
                              </span>
                            )}
                          </div>

                          {/* Upgrades, Attachments & Ammo Badges */}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                            {attachedTo && (
                              <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                                Attached to: {attachedTo.datasheet}
                              </span>
                            )}
                            {ledByUnits.map((l) => (
                              <span key={l.uid} style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                                Led by: {l.datasheet}
                              </span>
                            ))}
                            {enhancements.map((enh, enhIdx) => (
                              <span key={enhIdx} style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                                Enhancement: {enh}
                              </span>
                            ))}
                            {u.tempAmmoLoadout && (
                              <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                                Ammo: {MUNITORUM_AMMO[u.tempAmmoLoadout]?.name}
                              </span>
                            )}
                            {u.apexDesignation && (
                              <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                {APEX_DESIGNATIONS[u.apexDesignation]?.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          value={u.apexDesignation || ''}
                          onChange={(e) => onUpdateRun(setApexDesignation(run, u.uid, (e.target.value as ApexDesignationId) || null))}
                          style={{
                            background: '#1e293b',
                            color: '#f8fafc',
                            border: '1px solid #475569',
                            borderRadius: 4,
                            padding: '5px 8px',
                            fontSize: '0.82em',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">No Apex Badge</option>
                          <option value="VANGUARD_SPEARHEAD">Vanguard Spearhead</option>
                          <option value="IMMOVABLE_ANVIL">Immovable Anvil</option>
                          <option value="EXECUTIONER">Warmaster Executioner</option>
                          <option value="GRAND_SPOTTER">Grand Battery Spotter</option>
                        </select>

                        {canRankUp && (
                          <button
                            type="button"
                            className="btn small primary"
                            style={{ background: '#f59e0b', color: '#000', fontWeight: 'bold' }}
                            onClick={() => onUpdateRun(compressSquad(run, u.uid))}
                          >
                            Rank Up to Tier {tier + 1}
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
                  <h4 style={{ margin: 0, color: '#f8fafc' }}>Strategium Council ({activeAdvisors.length}/{maxSlots} Slots Unlocked)</h4>
                  <div style={{ fontSize: '0.85em', color: '#94a3b8' }}>Advisors trigger powerful effects in every Command Phase and grant passive campaign bonuses.</div>
                </div>
                {maxSlots < 3 && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={scrap < (maxSlots === 1 ? 100 : 200)}
                    onClick={() => onUpdateRun(unlockAdvisorSlot(run))}
                    style={{ background: '#3b82f6', color: '#fff', fontWeight: 'bold' }}
                  >
                    Unlock Slot {maxSlots + 1} ({maxSlots === 1 ? '100' : '200'} Scrap)
                  </button>
                )}
              </div>

              {/* Advisors Overview Table */}
              <div style={{ background: '#0f172a', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #334155' }}>
                <b style={{ color: '#38bdf8', fontSize: '0.9em', display: 'block', marginBottom: 6 }}>High Command Advisor Abilities</b>
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
                            <td style={{ padding: '5px 8px', fontWeight: 'bold', color: isHired ? '#34d399' : '#e2e8f0', whiteSpace: 'nowrap' }}>{def.name}</td>
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
                  const canHire = !isHired && activeAdvisors.length < maxSlots && scrap >= def.hireCost;

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
                        <b style={{ color: '#f8fafc' }}>{def.name}</b>
                        <span style={{ fontSize: '0.8em', color: '#fcd34d', fontWeight: 'bold' }}>{def.hireCost} Scrap</span>
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#38bdf8', margin: '6px 0 2px 0', lineHeight: 1.35 }}>
                        <b>Battle:</b> {def.battleDesc}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#4ade80', marginBottom: 8, lineHeight: 1.35 }}>
                        <b>Campaign:</b> {def.campaignDesc}
                      </div>
                      {isHired ? (
                        <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.85em' }}>[Appointed]</span>
                      ) : (
                        <button
                          type="button"
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
              <h4 style={{ margin: '16px 0 8px 0', color: '#f8fafc' }}>Flagship Orbital Bay (Fires in Round 1):</h4>
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
                        <b style={{ color: '#f8fafc' }}>{def.name} (Lv.{currentLvl})</b>
                        {isActive && <span style={{ color: '#60a5fa', fontSize: '0.75em', fontWeight: 'bold' }}>[ACTIVE]</span>}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#cbd5e1', margin: '6px 0', lineHeight: 1.35 }}>
                        {currentLvl === 1 ? def.descLv1 : currentLvl === 2 ? def.descLv2 : def.descLv3}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        {!isActive && (
                          <button type="button" className="btn small" onClick={() => onUpdateRun(selectOrbitalModule(run, modId))}>
                            Select Active
                          </button>
                        )}
                        {currentLvl < 3 && (
                          <button
                            type="button"
                            className="btn small primary"
                            disabled={scrap < upgradeCost}
                            onClick={() => onUpdateRun(upgradeOrbitalModule(run, modId))}
                          >
                            Upgrade to Lv.{currentLvl + 1} ({upgradeCost} Scrap)
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
                <b style={{ color: '#60a5fa' }}>Pre-Battle Tactical Clock (5-Round Operation Timeline):</b>
                <div style={{ fontSize: '0.85em', color: '#d1d5db', marginTop: 4, lineHeight: 1.4 }}>
                  Arrange 5 distinct Battleplan Directives across Battle Rounds 1 to 5. The engine activates each directive automatically at the start of that battle round. Click Up/Down to reorder.
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
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: '#f59e0b', color: '#000', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontWeight: 'bold' }}>
                          Round {idx + 1}
                        </div>
                        <div>
                          <b style={{ color: '#f8fafc', fontSize: 14 }}>{def?.name || dirId}</b>
                          <div style={{ fontSize: '0.8em', color: '#94a3b8', marginTop: 2 }}>{def?.desc}</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        {idx > 0 && (
                          <button type="button" className="btn small" onClick={() => swapClockRound(idx, idx - 1)}>Up</button>
                        )}
                        {idx < 4 && (
                          <button type="button" className="btn small" onClick={() => swapClockRound(idx, idx + 1)}>Down</button>
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
                <h4 style={{ margin: 0, color: '#f8fafc' }}>Sector Patronage Contracts:</h4>
                <div style={{ fontSize: '0.85em', color: '#94a3b8', marginTop: 4 }}>
                  Sign a covenant with one of the grand 40k factions for this sector. Meet their army condition to gain sector-long buffs and a massive boss payout.
                </div>
              </div>

              {/* Patron Comparison Table */}
              <div style={{ background: '#0f172a', padding: 12, borderRadius: 8, marginBottom: 16, border: '1px solid #334155' }}>
                <b style={{ color: '#f59e0b', fontSize: '0.9em', display: 'block', marginBottom: 6 }}>Patron Covenants Comparison</b>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78em', color: '#f8fafc', background: '#1e293b', borderRadius: 6, overflow: 'hidden' }}>
                    <thead>
                      <tr style={{ background: '#334155', textAlign: 'left', borderBottom: '1px solid #475569' }}>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Patron Faction</th>
                        <th style={{ padding: '5px 8px', color: '#fef08a' }}>Roster Condition</th>
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
                            <td style={{ padding: '5px 8px', fontWeight: 'bold', color: isSigned ? '#fbbf24' : '#e2e8f0', whiteSpace: 'nowrap' }}>{def.name}</td>
                            <td style={{ padding: '5px 8px', color: '#38bdf8' }}>{def.conditionDesc}</td>
                            <td style={{ padding: '5px 8px', color: '#cbd5e1' }}>{def.buffDesc}</td>
                            <td style={{ padding: '5px 8px', color: '#4ade80' }}>{def.bossRewardDesc}</td>
                            <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                              {isSigned ? <span style={{ color: '#10b981', fontWeight: 'bold' }}>[Signed]</span> : <span style={{ color: '#94a3b8' }}>Available</span>}
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
                      <div style={{ fontWeight: 'bold', fontSize: 15, color: isSigned ? '#f59e0b' : '#f8fafc' }}>
                        {def.name}
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
                        <div style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.85em' }}>[Active Covenant]</div>
                      ) : (
                        <button type="button" className="btn small primary" onClick={() => onUpdateRun(selectPatronContract(run, cid))}>
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
