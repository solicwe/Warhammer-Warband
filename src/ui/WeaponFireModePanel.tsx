import React from 'react';
import type { WeaponData, WeaponProfileData } from '../engine/types';
import { Icon } from './Icon';

export interface WeaponFireModePanelProps {
  hasCQ: boolean;
  smode: string;
  firedAny: boolean;
  useCQ: boolean;
  nonCqWeapons: Map<string, WeaponData>;
  cqWeapons: Map<string, WeaponData>;
  multi: WeaponData[];
  profileChoices: Record<string, number>;
  onSelectCQ: (useCQ: boolean) => void;
  onSelectProfile: (weaponName: string, profileIndex: number, profileName: string) => void;
}

/** Color mapping for weapon trait / ability badges */
export function getKeywordBadgeStyle(kw: string): { bg: string; color: string; border: string } {
  const k = kw.toLowerCase().replace(/[\[\]]/g, '').trim();
  if (k.includes('hazardous')) return { bg: '#2D1412', color: '#F87171', border: '#DC2626' };
  if (k.includes('close-quarters')) return { bg: '#0C2840', color: '#38BDF8', border: '#0284C7' };
  if (k.includes('assault')) return { bg: '#064E3B', color: '#34D399', border: '#059669' };
  if (k.includes('heavy')) return { bg: '#2A2012', color: '#F59E0B', border: '#D99B26' };
  if (k.includes('rapid fire')) return { bg: '#231238', color: '#C084FC', border: '#9333EA' };
  if (k.includes('blast')) return { bg: '#2E1A0C', color: '#FB923C', border: '#EA580C' };
  if (k.includes('devastating')) return { bg: '#3B0D11', color: '#FCA5A5', border: '#EF4444' };
  if (k.includes('lethal')) return { bg: '#082F49', color: '#38BDF8', border: '#0284C7' };
  if (k.includes('torrent') || k.includes('ignores cover')) return { bg: '#1E293B', color: '#94A3B8', border: '#475569' };
  return { bg: '#1F242D', color: '#FBBF24', border: 'rgba(245, 158, 11, 0.4)' };
}

/** Compact Mini Stat Grid row for a weapon profile */
export const MiniStatGrid = React.memo(function MiniStatGrid({ profile }: { profile: WeaponProfileData }) {
  const rangeStr = profile.range === 'Melee' ? 'Melee' : `${profile.range}"`;
  const skillStr = profile.skill ? `${profile.skill}+` : 'N/A';
  const strStr = profile.S !== null && profile.S !== undefined ? String(profile.S) : '-';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '4px',
        width: '100%',
        marginTop: '6px',
      }}
    >
      <div style={statBoxStyle}>
        <span style={statLabelStyle}>Range</span>
        <b style={statValueStyle}>{rangeStr}</b>
      </div>
      <div style={statBoxStyle}>
        <span style={statLabelStyle}>A</span>
        <b style={statValueStyle}>{profile.A}</b>
      </div>
      <div style={statBoxStyle}>
        <span style={statLabelStyle}>{profile.range === 'Melee' ? 'WS' : 'BS'}</span>
        <b style={statValueStyle}>{skillStr}</b>
      </div>
      <div style={statBoxStyle}>
        <span style={statLabelStyle}>S</span>
        <b style={statValueStyle}>{strStr}</b>
      </div>
      <div style={statBoxStyle}>
        <span style={statLabelStyle}>AP</span>
        <b style={statValueStyle}>{profile.AP}</b>
      </div>
      <div style={statBoxStyle}>
        <span style={statLabelStyle}>D</span>
        <b style={statValueStyle}>{profile.D}</b>
      </div>
    </div>
  );
});

/** Color-coded keyword badges row */
export const KeywordBadges = React.memo(function KeywordBadges({ abilities }: { abilities: string[] }) {
  if (!abilities || !abilities.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
      {abilities.map((a, i) => {
        const clean = a.toUpperCase().startsWith('[') ? a.toUpperCase() : `[${a.toUpperCase()}]`;
        const st = getKeywordBadgeStyle(clean);
        return (
          <span
            key={i}
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              background: st.bg,
              color: st.color,
              border: `1px solid ${st.border}`,
              letterSpacing: '0.03em',
              lineHeight: 1.2,
            }}
          >
            {clean}
          </span>
        );
      })}
    </div>
  );
});

const statBoxStyle: React.CSSProperties = {
  background: '#141820',
  border: '1px solid #262D3B',
  borderRadius: '4px',
  padding: '4px 2px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minWidth: 0,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: '9px',
  color: '#9CA3AF',
  textTransform: 'uppercase',
  fontWeight: 600,
  lineHeight: 1,
};

const statValueStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#F8FAFC',
  fontWeight: 700,
  marginTop: '2px',
  lineHeight: 1.1,
};

export const WeaponFireModePanel = React.memo(function WeaponFireModePanel({
  hasCQ,
  smode,
  firedAny,
  useCQ,
  nonCqWeapons,
  cqWeapons,
  multi,
  profileChoices,
  onSelectCQ,
  onSelectProfile,
}: WeaponFireModePanelProps) {
  const showModeSwitch = hasCQ && smode !== 'closeQuarters' && !firedAny;
  const showMultiProfiles = multi.length > 0;

  if (!showModeSwitch && !showMultiProfiles) return null;

  return (
    <div
      className="weapon-fire-mode-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        margin: '10px 0',
        padding: '12px',
        borderRadius: '8px',
        background: '#121417',
        border: '1px solid #262930',
      }}
    >
      {/* 1. Fire Mode Selection (Standard vs Pistols) */}
      {showModeSwitch && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 700,
                color: '#9CA3AF',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Fire Mode <span style={{ fontWeight: 400, textTransform: 'none', color: '#6B7280' }}>(models shoot standard weapons or pistols, not both)</span>
            </span>
          </div>
          <div style={{ height: '1px', background: '#262930', width: '100%' }} />

          {/* Mode Option Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
            {/* Standard Weapons Card */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectCQ(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectCQ(false); }}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                background: !useCQ ? 'rgba(217, 155, 38, 0.12)' : '#181B22',
                border: !useCQ ? '1.5px solid #F59E0B' : '1px solid #2A2E39',
                boxShadow: !useCQ ? '0 0 12px rgba(245, 158, 11, 0.2)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: 'none',
              }}
            >
              {/* Checkmark Badge */}
              {!useCQ && (
                <div
                  style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: '#F59E0B',
                    color: '#111827',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                  }}
                >
                  <Icon name="check" size={13} />
                </div>
              )}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <b
                    style={{
                      color: !useCQ ? '#FBBF24' : '#E5E7EB',
                      fontSize: '14px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    Standard Weapons
                  </b>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      background: '#1F242D',
                      color: '#9CA3AF',
                      border: '1px solid #374151',
                    }}
                  >
                    DEFAULT
                  </span>
                </div>

                <div
                  style={{
                    marginTop: '8px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: '#0F1216',
                    border: '1px solid #1E242E',
                    fontSize: '12px',
                    color: !useCQ ? '#FEF08A' : '#9CA3AF',
                    lineHeight: 1.35,
                  }}
                >
                  <span style={{ color: '#6B7280', fontSize: '11px', display: 'block', marginBottom: '2px' }}>
                    Equipped weapons:
                  </span>
                  {[...nonCqWeapons.keys()].join(', ') || 'Ranged weaponry'}
                </div>
              </div>
            </div>

            {/* Pistols [Close-Quarters] Card */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectCQ(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectCQ(true); }}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                background: useCQ ? 'rgba(217, 155, 38, 0.12)' : '#181B22',
                border: useCQ ? '1.5px solid #F59E0B' : '1px solid #2A2E39',
                boxShadow: useCQ ? '0 0 12px rgba(245, 158, 11, 0.2)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: 'none',
              }}
            >
              {/* Checkmark Badge */}
              {useCQ && (
                <div
                  style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: '#F59E0B',
                    color: '#111827',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                  }}
                >
                  <Icon name="check" size={13} />
                </div>
              )}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <b
                    style={{
                      color: useCQ ? '#FBBF24' : '#E5E7EB',
                      fontSize: '14px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    Pistols
                  </b>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      background: '#0C2840',
                      color: '#38BDF8',
                      border: '1px solid #0284C7',
                    }}
                  >
                    [CLOSE-QUARTERS]
                  </span>
                </div>

                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[...cqWeapons.values()].map((w) => {
                    const p = w.profiles[0];
                    return (
                      <div
                        key={w.name}
                        style={{
                          padding: '6px 8px',
                          borderRadius: '6px',
                          background: '#0F1216',
                          border: '1px solid #1E242E',
                        }}
                      >
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0' }}>
                          {w.name}
                        </div>
                        <MiniStatGrid profile={p} />
                        <KeywordBadges abilities={p.abilities} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Multi-Profile Weapon Selection */}
      {showMultiProfiles && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: showModeSwitch ? '4px' : '0' }}>
          {multi.map((w) => {
            const curIdx = Math.min(profileChoices[w.name] ?? 0, w.profiles.length - 1);
            return (
              <div key={w.name} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Icon name="shoot" size={14} />
                  <span
                    style={{
                      fontSize: '12.5px',
                      fontWeight: 700,
                      color: '#9CA3AF',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    <b>{w.name}</b> — Select Fire Profile:
                  </span>
                </div>
                <div style={{ height: '1px', background: '#262930', width: '100%' }} />

                {/* Profile Cards Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                  {w.profiles.map((p: WeaponProfileData, idx: number) => {
                    const isSelected = curIdx === idx;
                    return (
                      <div
                        key={p.name}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectProfile(w.name, idx, p.name ?? `Profile ${idx + 1}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            onSelectProfile(w.name, idx, p.name ?? `Profile ${idx + 1}`);
                          }
                        }}
                        style={{
                          position: 'relative',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          padding: '12px 14px',
                          borderRadius: '8px',
                          background: isSelected ? 'rgba(217, 155, 38, 0.12)' : '#181B22',
                          border: isSelected ? '1.5px solid #F59E0B' : '1px solid #2A2E39',
                          boxShadow: isSelected ? '0 0 12px rgba(245, 158, 11, 0.2)' : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          outline: 'none',
                        }}
                      >
                        {/* Checkmark Badge */}
                        {isSelected && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '10px',
                              right: '10px',
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: '#F59E0B',
                              color: '#111827',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                            }}
                          >
                            <Icon name="check" size={13} />
                          </div>
                        )}

                        <div>
                          {/* Profile Title */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <b
                              style={{
                                color: isSelected ? '#FBBF24' : '#E5E7EB',
                                fontSize: '13.5px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                              }}
                            >
                              {p.name}
                            </b>
                            {isSelected && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  background: 'rgba(245, 158, 11, 0.2)',
                                  color: '#FBBF24',
                                  border: '1px solid rgba(245, 158, 11, 0.4)',
                                }}
                              >
                                ACTIVE
                              </span>
                            )}
                          </div>

                          {/* Mini Stat Grid */}
                          <MiniStatGrid profile={p} />

                          {/* Keyword Badges */}
                          <KeywordBadges abilities={p.abilities} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

