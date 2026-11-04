import { useState } from 'react';
import { clearBattleLogs, deleteBattleLog, loadBattleLogs, type BattleRecord } from '../services/storage';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
  onReplay: (log: BattleRecord) => void;
}

export function BattleLogsModal({ onClose, onReplay }: Props) {
  const [logs, setLogs] = useState<BattleRecord[]>(loadBattleLogs);
  const [filter, setFilter] = useState<'all' | 'simulator' | 'tabletop' | 'campaign'>('all');
  const [armedClear, setArmedClear] = useState(false);

  const handleDelete = (id: string) => {
    deleteBattleLog(id);
    setLogs(loadBattleLogs());
  };

  const handleClearAll = () => {
    if (!armedClear) {
      setArmedClear(true);
      setTimeout(() => setArmedClear(false), 3000);
      return;
    }
    clearBattleLogs();
    setLogs([]);
    setArmedClear(false);
  };

  const filtered = filter === 'all' ? logs : logs.filter((l) => l.mode === filter);

  const formatTime = (ts: number) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Battle Chronicles">
      <div className="sheet-panel battle-logs-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="sheet-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="history" size={20} />
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Battle History</h3>
            <span className="group-count num">{logs.length}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Filter segment */}
        <div className="seg" style={{ margin: '12px 16px 8px 16px', display: 'flex', gap: 4 }}>
          {(['all', 'simulator', 'tabletop', 'campaign'] as const).map((m) => (
            <button
              key={m}
              className={filter === m ? 'on' : ''}
              onClick={() => setFilter(m)}
              style={{ flex: 1, textTransform: 'capitalize', minHeight: 36, fontSize: 12, padding: '4px 6px' }}
            >
              {m === 'all' ? 'All' : m === 'simulator' ? 'Sim' : m === 'tabletop' ? 'Tabletop' : 'Campaign'}
            </button>
          ))}
        </div>

        {/* Content list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-3)' }}>
              <Icon name="history" size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No battle logs found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Play a simulator match or record a tabletop battle to review it here.</div>
            </div>
          ) : (
            filtered.map((log) => {
              const p0 = log.players[0];
              const p1 = log.players[1];
              const isP0Win = p0?.isWinner || (p0 && p1 && p0.score > p1.score);
              const isP1Win = p1?.isWinner || (p0 && p1 && p1.score > p0.score);

              return (
                <div
                  key={log.id}
                  className="card"
                  style={{
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    border: '1px solid var(--line-2)',
                    background: 'var(--surface)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        className="mode-tag"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          padding: '2px 6px',
                          borderRadius: 4,
                          background:
                            log.mode === 'simulator'
                              ? 'rgba(56, 189, 248, 0.15)'
                              : log.mode === 'tabletop'
                              ? 'rgba(74, 222, 128, 0.15)'
                              : 'rgba(251, 191, 36, 0.15)',
                          color:
                            log.mode === 'simulator'
                              ? '#38bdf8'
                              : log.mode === 'tabletop'
                              ? '#4ade80'
                              : '#fbbf24',
                          border: `1px solid ${
                            log.mode === 'simulator'
                              ? 'rgba(56, 189, 248, 0.35)'
                              : log.mode === 'tabletop'
                              ? 'rgba(74, 222, 128, 0.35)'
                              : 'rgba(251, 191, 36, 0.35)'
                          }`,
                        }}
                      >
                        {log.mode}
                      </span>
                      <span className="muted">{formatTime(log.timestamp)}</span>
                    </div>
                    {log.layoutName && <span className="muted" style={{ fontSize: 11 }}>{log.layoutName}</span>}
                  </div>

                  {/* Players & Scores */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <div style={{ fontWeight: isP0Win ? 700 : 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {p0?.name ?? 'Player 1'}
                        {isP0Win && <Icon name="trophy" size={14} style={{ color: '#fbbf24' }} />}
                      </div>
                      {p0?.faction && <span className="muted" style={{ fontSize: 11 }}>{p0.faction}</span>}
                    </div>

                    <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.02em', padding: '0 8px' }}>
                      <span style={{ color: isP0Win ? 'var(--accent)' : 'inherit' }}>{p0?.score ?? 0}</span>
                      <span style={{ opacity: 0.4, margin: '0 4px' }}>:</span>
                      <span style={{ color: isP1Win ? 'var(--accent)' : 'inherit' }}>{p1?.score ?? 0}</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div style={{ fontWeight: isP1Win ? 700 : 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isP1Win && <Icon name="trophy" size={14} style={{ color: '#fbbf24' }} />}
                        {p1?.name ?? 'Player 2'}
                      </div>
                      {p1?.faction && <span className="muted" style={{ fontSize: 11 }}>{p1.faction}</span>}
                    </div>
                  </div>

                  {/* Bottom bar with Replay / Delete */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--line-1)' }}>
                    <span className="tiny muted">
                      {log.turn ? `Turn ${log.turn}` : ''} {log.summary ? `· ${log.summary}` : ''}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {log.replayState?.savedGame && (
                        <button
                          className="btn"
                          style={{ minHeight: 36, padding: '4px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => onReplay(log)}
                        >
                          <Icon name="history" size={14} /> Replay
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        style={{ minWidth: 36, minHeight: 36, color: 'var(--text-3)' }}
                        onClick={() => handleDelete(log.id)}
                        aria-label="Delete log"
                        title="Delete log"
                      >
                        <Icon name="delete" size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {logs.length > 0 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="tiny muted">{filtered.length} log(s) shown</span>
            <button
              className={`btn ${armedClear ? 'danger on-armed' : 'ghost'}`}
              style={{ minHeight: 36, fontSize: 12, padding: '4px 12px' }}
              onClick={handleClearAll}
            >
              {armedClear ? 'Tap again to confirm' : 'Clear all logs'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
