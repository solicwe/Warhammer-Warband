import { useState } from 'react';
import { clearBattleLogs, deleteBattleLog, loadBattleLogs, saveBattleLog, type BattleRecord } from '../services/storage';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
  onReplay: (log: BattleRecord) => void | Promise<void>;
  replayError?: string | null;
}

export function BattleLogsModal({ onClose, onReplay, replayError }: Props) {
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

  const handleSeedSample = () => {
    const demoLogs: BattleRecord[] = [
      {
        id: `tabletop-${Date.now() - 3600000 * 2}`,
        timestamp: Date.now() - 3600000 * 2,
        mode: 'tabletop',
        title: 'Tabletop Match · Layout 01',
        layoutName: 'Layout 01 (Hammer & Anvil)',
        players: [
          { name: 'Player 1', faction: 'SM', score: 68, cp: 2, isWinner: true },
          { name: 'Player 2', faction: 'TYR', score: 54, cp: 1, isWinner: false },
        ],
        turn: 5,
        maxTurns: 5,
        summary: 'Primary: 40-35 · Tactical Secondaries: 28-19 (Victory P1)',
      },
      {
        id: `sim-${Date.now() - 3600000 * 24}`,
        timestamp: Date.now() - 3600000 * 24,
        mode: 'simulator',
        title: 'Simulator Battle · Search & Destroy',
        layoutName: 'Layout 04 (Search & Destroy)',
        players: [
          { name: 'Strike Force Alpha', faction: 'SM', score: 72, cp: 0, isWinner: false },
          { name: 'Waaagh! Ghazghkull', faction: 'ORK', score: 81, cp: 1, isWinner: true },
        ],
        turn: 5,
        maxTurns: 5,
        summary: 'Final VP: 72 - 81 (Ork Waaagh! Victory)',
      },
      {
        id: `campaign-${Date.now() - 3600000 * 48}`,
        timestamp: Date.now() - 3600000 * 48,
        mode: 'campaign',
        title: 'Roguelike Sector Encounter',
        layoutName: 'Layout 02 (Dawn of War)',
        players: [
          { name: 'Vanguard Crusaders', faction: 'SM', score: 65, cp: 3, isWinner: true },
          { name: 'Necron Dynastic Patrol', faction: 'NEC', score: 48, cp: 0, isWinner: false },
        ],
        turn: 5,
        maxTurns: 5,
        summary: 'Sector Cleared · Relic Acquired (Victory P1)',
      },
    ];

    for (const dl of demoLogs) {
      saveBattleLog(dl);
    }
    setLogs(loadBattleLogs());
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
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Battle History">
      <div className="sheet-panel battle-logs-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="sheet-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 6, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Icon name="history" size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>BATTLE HISTORY</h3>
                <span className="group-count num" style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: 'var(--surface-2)' }}>{logs.length}</span>
              </div>
              <div className="tiny muted">Recorded simulator, tabletop, and campaign matches</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ minWidth: 40, minHeight: 40 }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Filter segment */}
        <div className="seg" style={{ margin: '10px 16px 4px', display: 'flex', gap: 4 }}>
          {(['all', 'simulator', 'tabletop', 'campaign'] as const).map((m) => (
            <button
              key={m}
              className={filter === m ? 'on' : ''}
              onClick={() => setFilter(m)}
              style={{ flex: 1, textTransform: 'uppercase', minHeight: 34, fontSize: 11.5, padding: '4px 6px', fontWeight: 700 }}
            >
              {m === 'all' ? 'All' : m === 'simulator' ? 'Simulator' : m === 'tabletop' ? 'Tabletop' : 'Campaign'}
            </button>
          ))}
        </div>

        {/* Content list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {replayError && <div className="toast" role="alert">{replayError}</div>}
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Icon name="history" size={36} style={{ opacity: 0.35 }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)' }}>No battle logs found</div>
                <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--text-3)' }}>
                  Complete a simulator battle, campaign sector, or tabletop match to automatically record match history here.
                </div>
              </div>
              <button
                className="btn primary"
                style={{ marginTop: 8, fontSize: 13, minHeight: 38, padding: '6px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={handleSeedSample}
              >
                <Icon name="plus" size={16} /> Seed Sample History Records
              </button>
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
                    boxShadow: 'var(--card-shadow)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        className="mode-tag"
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          padding: '2px 7px',
                          borderRadius: 4,
                          background:
                            log.mode === 'simulator'
                              ? 'var(--p0-soft)'
                              : log.mode === 'tabletop'
                              ? 'var(--good-soft)'
                              : 'var(--warn-soft)',
                          color:
                            log.mode === 'simulator'
                              ? 'var(--p0)'
                              : log.mode === 'tabletop'
                              ? 'var(--good)'
                              : 'var(--warn)',
                          border: `1px solid ${
                            log.mode === 'simulator'
                              ? 'var(--p0)'
                              : log.mode === 'tabletop'
                              ? 'var(--good)'
                              : 'var(--warn)'
                          }`,
                        }}
                      >
                        {log.mode}
                      </span>
                      <span className="muted" style={{ fontSize: 11.5 }}>{formatTime(log.timestamp)}</span>
                    </div>
                    {log.layoutName && <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>{log.layoutName}</span>}
                  </div>

                  {/* Players & Scores */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <div style={{ fontWeight: isP0Win ? 800 : 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, color: isP0Win ? 'var(--text)' : 'var(--text-2)' }}>
                        {p0?.name ?? 'Player 1'}
                        {isP0Win && <Icon name="trophy" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                      </div>
                      {p0?.faction && <span className="muted" style={{ fontSize: 11 }}>{p0.faction}</span>}
                    </div>

                    <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '0.04em', padding: '0 8px', background: 'var(--surface-2)', borderRadius: 6 }}>
                      <span style={{ color: isP0Win ? 'var(--accent)' : 'inherit' }}>{p0?.score ?? 0}</span>
                      <span style={{ opacity: 0.4, margin: '0 4px' }}>:</span>
                      <span style={{ color: isP1Win ? 'var(--accent)' : 'inherit' }}>{p1?.score ?? 0}</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div style={{ fontWeight: isP1Win ? 800 : 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, color: isP1Win ? 'var(--text)' : 'var(--text-2)' }}>
                        {isP1Win && <Icon name="trophy" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                        {p1?.name ?? 'Player 2'}
                      </div>
                      {p1?.faction && <span className="muted" style={{ fontSize: 11 }}>{p1.faction}</span>}
                    </div>
                  </div>

                  {/* Bottom bar with Replay / Summary / Delete */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, paddingTop: 6, borderTop: '1px solid var(--line-1)' }}>
                    <span className="tiny muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                      {log.turn ? `Turn ${log.turn}` : ''} {log.summary ? `· ${log.summary}` : ''}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {log.replayState?.savedGame && (
                        <button
                          className="btn"
                          style={{ minHeight: 32, padding: '2px 8px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => onReplay(log)}
                        >
                          <Icon name="history" size={13} /> Replay
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        style={{ minWidth: 32, minHeight: 32, color: 'var(--text-3)' }}
                        onClick={() => handleDelete(log.id)}
                        aria-label="Delete log"
                        title="Delete log"
                      >
                        <Icon name="delete" size={14} />
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
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="tiny muted">{filtered.length} log(s) shown</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn ghost"
                style={{ minHeight: 32, fontSize: 11.5, padding: '2px 10px' }}
                onClick={handleSeedSample}
                title="Add sample history records"
              >
                + Add Sample
              </button>
              <button
                className={`btn ${armedClear ? 'danger on-armed' : 'ghost'}`}
                style={{ minHeight: 32, fontSize: 11.5, padding: '2px 10px' }}
                onClick={handleClearAll}
              >
                {armedClear ? 'Tap again to confirm' : 'Clear all'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
