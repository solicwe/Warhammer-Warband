import { loadRun } from '../services/storage';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
  onCampaign: () => void;
  onTabletop: () => void;
  onLogs: () => void;
}

export function ArcaneModesModal({ onClose, onCampaign, onTabletop, onLogs }: Props) {
  const run = loadRun();
  const runLayer = run ? Math.max(0, ...run.path.map((id) => (run.map.find((n) => n.id === id)?.layer ?? -1) + 1)) : 0;
  const runLayers = run ? Math.max(...run.map.map((n) => n.layer)) + 1 : 0;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Arcane Modes">
      <div
        className="sheet-panel arcane-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="sheet-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="arcane" size={22} style={{ color: 'var(--accent)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Arcane Modes</h3>
              <div className="tiny muted">Special campaigns, roguelike, and game modes</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Roguelike Card */}
          <div
            className="card"
            style={{
              padding: '14px',
              border: '1.5px solid var(--accent)',
              background: 'linear-gradient(135deg, rgba(74, 144, 226, 0.08) 0%, rgba(30, 41, 59, 0.5) 100%)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ padding: 6, borderRadius: 6, background: 'rgba(74, 144, 226, 0.2)', color: 'var(--accent)' }}>
                  <Icon name="trophy" size={20} />
                </div>
                <div>
                  <b style={{ fontSize: 16 }}>Demo Roguelike</b>
                  <div className="tiny muted">Branching campaign with relics & fate</div>
                </div>
              </div>
              {run && !run.over && (
                <span className="pill-att" style={{ fontSize: 11, padding: '2px 8px' }}>
                  Stage {Math.min(runLayer + 1, runLayers)} of {runLayers}
                </span>
              )}
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
              Command your warband through branching nodes, draft reinforcements, acquire ancient relics, and face escalating enemy incursions.
            </p>

            <button
              className="btn primary"
              style={{ marginTop: 4, minHeight: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
              onClick={() => {
                onClose();
                onCampaign();
              }}
            >
              <Icon name="trophy" size={16} />
              {run && !run.over ? 'Continue Roguelike Run' : 'Start Demo Roguelike'}
            </button>
          </div>

          {/* Tabletop Physical Companion Card */}
          <div
            className="card"
            style={{
              padding: '14px',
              border: '1px solid var(--line-2)',
              background: 'var(--surface)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ padding: 6, borderRadius: 6, background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80' }}>
                <Icon name="tabletop" size={20} />
              </div>
              <div>
                <b style={{ fontSize: 15 }}>Tabletop Physical Companion</b>
                <div className="tiny muted">Scorekeeper, tactical deck, and 45 terrain maps</div>
              </div>
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
              Take your phone to physical 40k matches. Track rounds, CP, primary and secondary VP, draw tactical secondary cards, and inspect official terrain layouts.
            </p>

            <button
              className="btn"
              style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onClick={() => {
                onClose();
                onTabletop();
              }}
            >
              <Icon name="tabletop" size={16} /> Open Companion
            </button>
          </div>

          {/* Battle History Card */}
          <div
            className="card"
            style={{
              padding: '14px',
              border: '1px solid var(--line-2)',
              background: 'var(--surface)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ padding: 6, borderRadius: 6, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                <Icon name="history" size={20} />
              </div>
              <div>
                <b style={{ fontSize: 15 }}>Battle Chronicles & Replay</b>
                <div className="tiny muted">Match history and deterministic replay</div>
              </div>
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
              Review your previous encounters, analyze victory conditions, and step through past matches with automatic replay.
            </p>

            <button
              className="btn"
              style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onClick={() => {
                onClose();
                onLogs();
              }}
            >
              <Icon name="history" size={16} /> View Battle History
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
