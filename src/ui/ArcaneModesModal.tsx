import { useState } from 'react';
import { loadRun, saveRun } from '../services/storage';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
  onCampaign: () => void;
  onBattle?: () => void;
  onTabletop?: () => void;
  onLogs?: () => void;
}

export function ArcaneModesModal({ onClose, onCampaign }: Props) {
  const run = loadRun();
  const runLayer = run ? Math.max(0, ...run.path.map((id) => (run.map.find((n) => n.id === id)?.layer ?? -1) + 1)) : 0;
  const runLayers = run ? Math.max(...run.map.map((n) => n.layer)) + 1 : 0;

  const [confirmNewRun, setConfirmNewRun] = useState(false);

  const handleStartNewRun = () => {
    if (!confirmNewRun && run && !run.over) {
      setConfirmNewRun(true);
      setTimeout(() => setConfirmNewRun(false), 3000);
      return;
    }
    saveRun(null);
    onClose();
    onCampaign();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Arcade Modes">
      <div
        className="sheet-panel arcade-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Modal Header with Back Button and Close Button */}
        <div
          className="sheet-head"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--line-2)',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button
              className="btn ghost"
              onClick={onClose}
              aria-label="ย้อนกลับ"
              title="ย้อนกลับ"
              style={{
                minHeight: 34,
                padding: '2px 10px',
                fontSize: 12.5,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 6,
              }}
            >
              <Icon name="back" size={15} />
              <span>ย้อนกลับ</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ padding: 6, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', flexShrink: 0 }}>
                <Icon name="arcane" size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: '0.04em', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  ARCADE MODES
                </h3>
                <div className="tiny muted" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  Roguelike Warband Campaign
                </div>
              </div>
            </div>
          </div>

          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close" style={{ minWidth: 36, minHeight: 36 }}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Modal Body: Focused solely on Roguelike Campaign */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Main Campaign Card */}
          <div
            className="card"
            style={{
              padding: '18px',
              border: '1.5px solid var(--accent)',
              background: 'var(--surface)',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: 'var(--card-shadow)',
            }}
          >
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ padding: 8, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  <Icon name="trophy" size={24} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 18, color: 'var(--text)' }}>Roguelike Campaign</b>
                    <span className="pill-att" style={{ fontSize: 10, padding: '2px 7px', background: 'var(--accent)', color: '#090d16', fontWeight: 800 }}>
                      CAMPAIGN
                    </span>
                  </div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>Sector Map · Unit Drafts · Archeotech Relics</div>
                </div>
              </div>

              {run && !run.over && (
                <span
                  className="pill-att"
                  style={{
                    fontSize: 11,
                    padding: '3px 9px',
                    background: 'var(--good-soft)',
                    color: 'var(--good)',
                    border: '1px solid var(--good)',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Stage {Math.min(runLayer + 1, runLayers)} / {runLayers}
                </span>
              )}
            </div>

            {/* Campaign Description */}
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>
              Lead your custom warband across an expeditionary sector map. Secure tactical objectives, draft veteran reinforcements, discover archeotech relics, and survive escalating adversary forces across multiple battle encounters.
            </p>

            {/* In-Progress Run Info if active */}
            {run && !run.over && (
              <div
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--accent)' }}>
                    Active Run in Progress
                  </div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>
                    Current Sector: Stage {Math.min(runLayer + 1, runLayers)} of {runLayers} · {run.path.length} encounters completed
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', textAlign: 'right' }}>
                  <div>{run.list?.units?.length ?? 0} Units</div>
                  <div className="tiny muted">{run.scrap ?? 0} Scrap</div>
                </div>
              </div>
            )}

            {/* Feature Highlights Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 8,
                marginTop: 2,
              }}
            >
              <div style={{ padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="map" size={13} /> Sector Map
                </div>
                <div className="tiny muted" style={{ marginTop: 3 }}>Branching nodes & choices</div>
              </div>

              <div style={{ padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="enhancement" size={13} /> Relics & Upgrades
                </div>
                <div className="tiny muted" style={{ marginTop: 3 }}>Archeotech warband buffs</div>
              </div>

              <div style={{ padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="swords" size={13} /> Escalating War
                </div>
                <div className="tiny muted" style={{ marginTop: 3 }}>Increasing points & bosses</div>
              </div>
            </div>

            {/* Action Buttons */}
            {run && !run.over ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  className="btn primary grow"
                  style={{
                    minHeight: 46,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    fontWeight: 800,
                    fontSize: 14,
                  }}
                  onClick={() => {
                    onClose();
                    onCampaign();
                  }}
                >
                  <Icon name="next" size={17} /> Continue Run (Stage {Math.min(runLayer + 1, runLayers)})
                </button>
                <button
                  className={`btn ${confirmNewRun ? 'danger on-armed' : 'ghost'}`}
                  style={{ minHeight: 46, fontSize: 12.5, fontWeight: 700, padding: '0 14px' }}
                  onClick={handleStartNewRun}
                  title="Abandon current run and start from Sector 1"
                >
                  {confirmNewRun ? 'Confirm Reset' : 'New Run'}
                </button>
              </div>
            ) : (
              <button
                className="btn primary"
                style={{
                  marginTop: 4,
                  minHeight: 46,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontWeight: 800,
                  fontSize: 14,
                }}
                onClick={() => {
                  onClose();
                  onCampaign();
                }}
              >
                <Icon name="trophy" size={18} /> Start Roguelike Campaign
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
