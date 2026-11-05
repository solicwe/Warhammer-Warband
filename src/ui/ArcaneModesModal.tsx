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

export function ArcaneModesModal({ onClose, onCampaign, onBattle }: Props) {
  const run = loadRun();
  const runLayer = run ? Math.max(0, ...run.path.map((id) => (run.map.find((n) => n.id === id)?.layer ?? -1) + 1)) : 0;
  const runLayers = run ? Math.max(...run.map.map((n) => n.layer)) + 1 : 0;

  const [confirmNewRun, setConfirmNewRun] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'campaign' | 'special'>('all');

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
        style={{ maxWidth: 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Modal Header */}
        <div className="sheet-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 6, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Icon name="arcane" size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '0.04em' }}>ARCADE MODES</h3>
              <div className="tiny muted">Roguelike campaign and specialized arcade battle modes</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ minWidth: 40, minHeight: 40 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Category Filter */}
        <div className="seg" style={{ margin: '10px 16px 4px', display: 'flex', gap: 4 }}>
          <button
            className={selectedCategory === 'all' ? 'on' : ''}
            onClick={() => setSelectedCategory('all')}
            style={{ flex: 1, minHeight: 32, fontSize: 12, textTransform: 'uppercase' }}
          >
            All Modes
          </button>
          <button
            className={selectedCategory === 'campaign' ? 'on' : ''}
            onClick={() => setSelectedCategory('campaign')}
            style={{ flex: 1, minHeight: 32, fontSize: 12, textTransform: 'uppercase' }}
          >
            Campaign & Roguelike
          </button>
          <button
            className={selectedCategory === 'special' ? 'on' : ''}
            onClick={() => setSelectedCategory('special')}
            style={{ flex: 1, minHeight: 32, fontSize: 12, textTransform: 'uppercase' }}
          >
            Special Scenarios
          </button>
        </div>

        {/* Scrollable Modes List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 1. HERO ROGUELIKE CAMPAIGN */}
          {(selectedCategory === 'all' || selectedCategory === 'campaign') && (
            <div
              className="card"
              style={{
                padding: '16px',
                border: '1.5px solid var(--accent)',
                background: 'var(--surface)',
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                boxShadow: 'var(--card-shadow)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ padding: 8, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    <Icon name="trophy" size={24} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 17, color: 'var(--text)' }}>Demo Roguelike Campaign</b>
                      <span className="pill-att" style={{ fontSize: 10, padding: '2px 6px', background: 'var(--accent)', color: '#090d16', fontWeight: 800 }}>FEATURED</span>
                    </div>
                    <div className="tiny muted">Sector map · Unit drafts · Ancient relics · Escalating threats</div>
                  </div>
                </div>

                {run && !run.over && (
                  <span className="pill-att" style={{ fontSize: 11, padding: '3px 8px', background: 'var(--p0-soft)', color: 'var(--p0)', border: '1px solid var(--p0)' }}>
                    Stage {Math.min(runLayer + 1, runLayers)} of {runLayers}
                  </span>
                )}
              </div>

              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.45 }}>
                Lead your custom warband across a branching nodal map. Secure requisition points, draft reinforcements, acquire ancient archeotech relics, and survive escalating enemy reinforcements.
              </p>

              {run && !run.over ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    className="btn primary grow"
                    style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700 }}
                    onClick={() => {
                      onClose();
                      onCampaign();
                    }}
                  >
                    <Icon name="next" size={16} /> Continue Run (Stage {Math.min(runLayer + 1, runLayers)})
                  </button>
                  <button
                    className={`btn ${confirmNewRun ? 'danger on-armed' : 'ghost'}`}
                    style={{ minHeight: 44, fontSize: 12, padding: '0 12px' }}
                    onClick={handleStartNewRun}
                  >
                    {confirmNewRun ? 'Confirm Reset' : 'New Run'}
                  </button>
                </div>
              ) : (
                <button
                  className="btn primary"
                  style={{ marginTop: 4, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700 }}
                  onClick={() => {
                    onClose();
                    onCampaign();
                  }}
                >
                  <Icon name="trophy" size={18} /> Start Roguelike Campaign
                </button>
              )}
            </div>
          )}

          {/* 2. ESCALATION LEAGUE */}
          {(selectedCategory === 'all' || selectedCategory === 'special') && (
            <div
              className="card"
              style={{
                padding: '14px 16px',
                border: '1px solid var(--line-2)',
                background: 'var(--surface)',
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ padding: 7, borderRadius: 8, background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                    <Icon name="swords" size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 15 }}>Escalation League</b>
                      <span className="pill-att" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--warn-soft)', color: 'var(--warn)' }}>SERIES</span>
                    </div>
                    <div className="tiny muted">3-match progressive skirmish (500 → 1000 → 2000 pts)</div>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
                A 3-game progression where your force expands each round: start with a swift Combat Patrol (500 pts), advance to Incursion (1000 pts), and clash in a full Strike Force (2000 pts).
              </p>

              <button
                className="btn"
                style={{ minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
                onClick={() => {
                  onClose();
                  onBattle?.();
                }}
              >
                <Icon name="fight" size={16} /> Launch Escalation Match
              </button>
            </div>
          )}

          {/* 3. LAST STAND / HORDE SURVIVAL */}
          {(selectedCategory === 'all' || selectedCategory === 'special') && (
            <div
              className="card"
              style={{
                padding: '14px 16px',
                border: '1px solid var(--line-2)',
                background: 'var(--surface)',
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ padding: 7, borderRadius: 8, background: 'var(--bad-soft)', color: 'var(--bad)' }}>
                    <Icon name="skull" size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 15 }}>Last Stand: Horde Invasion</b>
                      <span className="pill-att" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--bad-soft)', color: 'var(--bad)' }}>WAVE DEFENSE</span>
                    </div>
                    <div className="tiny muted">Infinite alien swarms · Perimeter defense</div>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
                Hold your ground as unending waves of Tyranid Gaunts and Greenskin hordes descend on your position. How many battle rounds can your warband survive?
              </p>

              <button
                className="btn"
                style={{ minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
                onClick={() => {
                  onClose();
                  onBattle?.();
                }}
              >
                <Icon name="fight" size={16} /> Start Last Stand
              </button>
            </div>
          )}

          {/* 4. RELIC HUNT */}
          {(selectedCategory === 'all' || selectedCategory === 'special') && (
            <div
              className="card"
              style={{
                padding: '14px 16px',
                border: '1px solid var(--line-2)',
                background: 'var(--surface)',
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ padding: 7, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    <Icon name="sparkles" size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 15 }}>Relic Hunt: Archeotech Extraction</b>
                      <span className="pill-att" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--accent-soft)', color: 'var(--accent)' }}>NARRATIVE</span>
                    </div>
                    <div className="tiny muted">Recover archeotech before orbital bombardment</div>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
                Three high-value archeotech relics lie dormant in the contested zone. Pick them up, defend carriers from enemy fire, and evacuate to your extraction line.
              </p>

              <button
                className="btn"
                style={{ minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
                onClick={() => {
                  onClose();
                  onBattle?.();
                }}
              >
                <Icon name="fight" size={16} /> Play Relic Hunt
              </button>
            </div>
          )}

          {/* 5. BOSS RAID */}
          {(selectedCategory === 'all' || selectedCategory === 'special') && (
            <div
              className="card"
              style={{
                padding: '14px 16px',
                border: '1px solid var(--line-2)',
                background: 'var(--surface)',
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ padding: 7, borderRadius: 8, background: 'var(--good-soft)', color: 'var(--good)' }}>
                    <Icon name="target" size={20} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 15 }}>Apex Colossus: Boss Raid</b>
                      <span className="pill-att" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--good-soft)', color: 'var(--good)' }}>ASYMMETRIC</span>
                    </div>
                    <div className="tiny muted">Elite strike team vs Colossal Apex Monster</div>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
                Assemble an elite strike force to confront an apex monster (Carnifex, Hive Tyrant, or C'tan Shard) equipped with triple health and lethal reactive stratagems.
              </p>

              <button
                className="btn"
                style={{ minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600 }}
                onClick={() => {
                  onClose();
                  onBattle?.();
                }}
              >
                <Icon name="fight" size={16} /> Challenge Apex Beast
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
