import { memo } from 'react';
import type { GameState, UnitState } from '../engine/types';
import { alive, hasKw, isEngaged } from '../engine/state';
import { unitFlags } from '../rules-engine/effects';
import { shootingModes } from '../engine/attack';
import { chargeEligibility } from '../engine/game';
import { canDesignateDeathstrike, canFireDeathstrike } from '../factions/deathstrike';
import { Icon, type IconName } from './Icon';

export interface UnitAction {
  id: string;
  label: string;
  sublabel?: string;
  icon?: IconName;
  primary?: boolean;
  disabled?: boolean;
  tooltip?: string;
  onClick: () => void;
}

export interface UnitActionBarProps {
  s: GameState;
  unit: UnitState;
  isCurrentPlayer: boolean;
  canUndoMove?: boolean;
  onUndoMove?: () => void;
  onMove?: (kind: 'normal' | 'advance' | 'fallback') => void;
  onHold?: () => void;
  onShoot?: () => void;
  onCharge?: () => void;
  onFight?: () => void;
  onDeathstrikeDesignate?: () => void;
  onDeathstrikeFire?: () => void;
  onRotate?: (deg: number) => void;
  onOpenSheet?: () => void;
  onOpenStrats?: () => void;
  onToggleTape?: () => void;
  onClose?: () => void;
}

/**
 * Redesigned Grimdark Unit Action Bar
 * Pinned contextual action dock providing immediate 1-click access to unit actions,
 * eliminating deep side-panel scrolling and standardizing the 40k aesthetic.
 */
export const UnitActionBar = memo(function UnitActionBar({
  s,
  unit,
  isCurrentPlayer,
  canUndoMove,
  onUndoMove,
  onMove,
  onHold,
  onShoot,
  onCharge,
  onFight,
  onDeathstrikeDesignate,
  onDeathstrikeFire,
  onRotate,
  onOpenSheet,
  onOpenStrats,
  onToggleTape,
  onClose,
}: UnitActionBarProps) {
  const models = alive(unit);
  const leadModel = models[0];
  const profile = leadModel?.profile;
  const flags = unitFlags(s, unit);
  const moveDist = (profile?.M ?? 0) + flags.move;
  const engaged = isEngaged(s, unit);
  const isVehicleOrOval = hasKw(unit, 'VEHICLE') || hasKw(unit, 'MONSTER') || models.some((m) => !!m.hl);

  // Derive phase actions
  const primaryActions: UnitAction[] = [];

  if (isCurrentPlayer && unit.owner === s.active) {
    if (s.phase === 'command') {
      if (canDesignateDeathstrike(s, unit) && onDeathstrikeDesignate) {
        primaryActions.push({
          id: 'deathstrike-designate',
          label: unit.dsMarker ? 'Relocate Marker' : 'Designate Target',
          sublabel: '6" Radius',
          icon: 'objective',
          primary: true,
          onClick: onDeathstrikeDesignate,
          tooltip: 'Place or move the Deathstrike Target Marker anywhere on the battlefield',
        });
      }
    } else if (s.phase === 'deploy') {
      if (isVehicleOrOval && onRotate) {
        primaryActions.push({
          id: 'rotate-left-45',
          label: '↺ -45°',
          sublabel: 'Pivot',
          onClick: () => onRotate(-45),
          tooltip: 'Rotate unit counter-clockwise by 45 degrees',
        });
        primaryActions.push({
          id: 'rotate-right-45',
          label: '↻ +45°',
          sublabel: 'Pivot',
          onClick: () => onRotate(45),
          tooltip: 'Rotate unit clockwise by 45 degrees',
        });
      }
    } else if (s.phase === 'movement') {
      if (canUndoMove && onUndoMove) {
        primaryActions.push({
          id: 'undo-move',
          label: 'Undo Move',
          icon: 'undo',
          primary: true,
          onClick: onUndoMove,
          tooltip: 'Revert this unit’s move to choose a different path',
        });
      } else if (!unit.move) {
        if (!engaged && onMove) {
          primaryActions.push({
            id: 'move-normal',
            label: `Move ${moveDist}"`,
            icon: 'move',
            primary: true,
            onClick: () => onMove('normal'),
            tooltip: 'Make a Normal Move up to maximum Move characteristic',
          });
          primaryActions.push({
            id: 'move-advance',
            label: 'Advance',
            sublabel: '+D6"',
            icon: 'advance',
            onClick: () => onMove('advance'),
            tooltip: 'Advance: Move + D6" (cannot shoot or charge unless Assault)',
          });
        } else if (engaged && onMove) {
          primaryActions.push({
            id: 'move-fallback',
            label: 'Fall Back',
            icon: 'fallback',
            primary: true,
            onClick: () => onMove('fallback'),
            tooltip: 'Fall back out of enemy Engagement Range',
          });
        }
        if (onHold) {
          primaryActions.push({
            id: 'move-hold',
            label: 'Stationary',
            icon: 'hold',
            onClick: onHold,
            tooltip: 'Remain Stationary (triggers Heavy weapon bonus)',
          });
        }
        if (isVehicleOrOval && onRotate) {
          primaryActions.push({
            id: 'rotate-left-45',
            label: '↺ -45°',
            sublabel: 'Pivot',
            onClick: () => onRotate(-45),
            tooltip: 'Rotate unit counter-clockwise by 45 degrees',
          });
          primaryActions.push({
            id: 'rotate-right-45',
            label: '↻ +45°',
            sublabel: 'Pivot',
            onClick: () => onRotate(45),
            tooltip: 'Rotate unit clockwise by 45 degrees',
          });
          primaryActions.push({
            id: 'rotate-left-15',
            label: '↺ -15°',
            sublabel: 'Fine',
            onClick: () => onRotate(-15),
            tooltip: 'Fine-tune rotation counter-clockwise by 15 degrees',
          });
          primaryActions.push({
            id: 'rotate-right-15',
            label: '↻ +15°',
            sublabel: 'Fine',
            onClick: () => onRotate(15),
            tooltip: 'Fine-tune rotation clockwise by 15 degrees',
          });
        }
      }
    } else if (s.phase === 'shooting') {
      const smodes = shootingModes(s, unit);
      if (!unit.selectedToShoot && smodes.length > 0 && onShoot) {
        primaryActions.push({
          id: 'shoot',
          label: 'Shoot',
          sublabel: `${smodes.length} Mode${smodes.length > 1 ? 's' : ''}`,
          icon: 'shoot',
          primary: true,
          onClick: onShoot,
          tooltip: 'Select target and fire ranged weapons',
        });
      }
      if (canFireDeathstrike(s, unit) && onDeathstrikeFire) {
        primaryActions.push({
          id: 'deathstrike-fire',
          label: 'Launch Warhead',
          sublabel: 'Blast 2D6 Mortal',
          icon: 'shoot',
          primary: true,
          onClick: onDeathstrikeFire,
          tooltip: 'Detonate Deathstrike Plasma Warhead on target marker (attacks all units within 6")',
        });
      }
      if (canDesignateDeathstrike(s, unit) && onDeathstrikeDesignate) {
        primaryActions.push({
          id: 'deathstrike-designate',
          label: unit.dsMarker ? 'Relocate Marker' : 'Designate Target',
          sublabel: '6" Radius',
          icon: 'objective',
          primary: false,
          onClick: onDeathstrikeDesignate,
          tooltip: 'Place or move the Deathstrike Target Marker anywhere on the battlefield',
        });
      }
    } else if (s.phase === 'charge') {
      if (!unit.declaredCharge && !chargeEligibility(s, unit) && onCharge) {
        primaryActions.push({
          id: 'charge',
          label: 'Charge',
          sublabel: '2D6"',
          icon: 'charge',
          primary: true,
          onClick: onCharge,
          tooltip: 'Declare charge against enemy units within 12"',
        });
      }
    } else if (s.phase === 'fight') {
      if (!unit.fought && engaged && onFight) {
        primaryActions.push({
          id: 'fight',
          label: 'Fight',
          icon: 'fight',
          primary: true,
          onClick: onFight,
          tooltip: 'Pile in 3", make melee attacks, consolidate 3"',
        });
      }
    }
  }

  const woundsMax = profile?.W ?? 1;
  const woundsCurrent = models.reduce((acc, m) => acc + m.wounds, 0);
  const totalWoundsMax = models.length * woundsMax;
  const woundsPct = Math.round((woundsCurrent / Math.max(1, totalWoundsMax)) * 100);

  return (
    <div
      className="unit-action-bar-container floating-unit-menu"
      style={{
        position: 'relative',
        zIndex: 25,
        margin: 0,
        padding: '10px 14px',
        background: '#12161c',
        border: '1.5px solid #2d3748',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Top Header: Unit identification and quick stats */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: '14.5px', color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {unit.name}
              </span>
              {unit.battleShocked && (
                <span style={{ background: '#7f1d1d', color: '#fca5a5', border: '1px solid #ef4444', padding: '1px 5px', borderRadius: 4, fontSize: '11px', fontWeight: 800 }}>
                  SHOCKED
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <span>{models.length} {models.length === 1 ? 'Model' : 'Models'}</span>
              <span>·</span>
              <span style={{ color: woundsPct < 50 ? '#f87171' : '#4ade80', fontWeight: 700 }}>
                {woundsCurrent}/{totalWoundsMax} W ({woundsPct}%)
              </span>
              {hasKw(unit, 'FLY') && <span>· FLY</span>}
              {hasKw(unit, 'CHARACTER') && <span>· CHAR</span>}
            </div>
          </div>
        </div>

        {/* Tactical Stat Pills */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {profile && (
            <>
              <div style={{ background: '#1a1f26', border: '1px solid #2d3748', borderRadius: 4, padding: '2px 5px', textAlign: 'center', minWidth: 28 }}>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 700 }}>T</div>
                <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 800 }}>{profile.T}</div>
              </div>
              <div style={{ background: '#1a1f26', border: '1px solid #2d3748', borderRadius: 4, padding: '2px 5px', textAlign: 'center', minWidth: 28 }}>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 700 }}>SV</div>
                <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 800 }}>{profile.Sv}+</div>
              </div>
              <div style={{ background: '#1a1f26', border: '1px solid #2d3748', borderRadius: 4, padding: '2px 5px', textAlign: 'center', minWidth: 28 }}>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 700 }}>OC</div>
                <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 800 }}>{unit.battleShocked ? 0 : (profile.OC ?? 1)}</div>
              </div>
            </>
          )}
          {onClose && (
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              style={{ width: 28, height: 28, margin: 0, padding: 0, color: '#94a3b8' }}
              title="Deselect Unit"
              aria-label="Close"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Primary Actions Row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {primaryActions.map((act) => (
          <button
            key={act.id}
            type="button"
            className={`btn ${act.primary ? 'primary' : ''}`}
            disabled={act.disabled}
            onClick={act.onClick}
            title={act.tooltip}
            style={{
              flex: '1 1 80px',
              minHeight: 42,
              padding: '6px 10px',
              background: act.primary ? '#d99b26' : '#1c222b',
              borderColor: act.primary ? '#f59e0b' : '#334155',
              color: act.primary ? '#0f172a' : '#f8fafc',
              fontWeight: 800,
              fontSize: '13.5px',
              letterSpacing: '0.02em',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {act.icon && <Icon name={act.icon} size={15} />}
            <span>{act.label}</span>
            {act.sublabel && (
              <span style={{ fontSize: '11px', opacity: 0.85, fontWeight: 600 }}>
                {act.sublabel}
              </span>
            )}
          </button>
        ))}

        {/* Quick Utility Tools */}
        {onOpenSheet && (
          <button
            type="button"
            className="btn small"
            onClick={onOpenSheet}
            style={{ background: '#181d24', borderColor: '#2e3846', color: '#cbd5e1' }}
            title="View full Datasheet, Weapons, and Abilities"
          >
            <Icon name="cards" size={14} />
            <span>Sheet</span>
          </button>
        )}

        {onOpenStrats && isCurrentPlayer && (
          <button
            type="button"
            className="btn small"
            onClick={onOpenStrats}
            style={{ background: '#181d24', borderColor: '#2e3846', color: '#cbd5e1' }}
            title="View usable Stratagems for this unit"
          >
            <Icon name="ability" size={14} />
            <span>Stratagems</span>
          </button>
        )}

        {onToggleTape && (
          <button
            type="button"
            className="btn small"
            onClick={onToggleTape}
            style={{ background: '#181d24', borderColor: '#2e3846', color: '#cbd5e1' }}
            title="Toggle Tape Measure Tool"
          >
            <Icon name="ruler" size={14} />
            <span>Measure</span>
          </button>
        )}
      </div>
    </div>
  );
});
