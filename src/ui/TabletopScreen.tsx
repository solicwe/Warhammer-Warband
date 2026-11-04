import { useMemo, useState } from 'react';
import { LAYOUTS, MISSIONS, type LayoutDef } from '../engine/config';
import { saveBattleLog } from '../services/storage';
import { Icon } from './Icon';
import { LayoutPreview } from './LayoutPreview';
import type { Army } from './library';
import type { FactionIndex } from './data';

interface Props {
  armies: Army[];
  index: FactionIndex | null;
  onBack: () => void;
}

interface PlayerState {
  name: string;
  faction: string;
  cp: number;
  primaryVp: number;
  secondaryVp: number;
  deck: string[];
  activeMissions: string[];
  discardedMissions: string[];
}

export function TabletopScreen({ armies, index, onBack }: Props) {
  const [tab, setTab] = useState<'score' | 'cards' | 'map'>('score');
  const [round, setRound] = useState(1);
  const [activePlayer, setActivePlayer] = useState<0 | 1>(0);

  // Layout viewer state
  const [selectedLayoutId, setSelectedLayoutId] = useState<string>(LAYOUTS[0]?.id ?? 'layout-01');
  const [zoomMap, setZoomMap] = useState(false);

  // Initialize deck helper
  const allSecondaryIds = useMemo(() => MISSIONS.secondaries.map((s) => s.id), []);

  const shuffle = (array: string[]) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const initialDeck = () => shuffle(allSecondaryIds);

  const [players, setPlayers] = useState<[PlayerState, PlayerState]>(() => [
    {
      name: armies[0]?.name || 'Player 1',
      faction: armies[0]?.factionId || 'SM',
      cp: 1,
      primaryVp: 0,
      secondaryVp: 0,
      deck: initialDeck(),
      activeMissions: [],
      discardedMissions: [],
    },
    {
      name: armies[1]?.name || 'Player 2',
      faction: armies[1]?.factionId || 'ORK',
      cp: 1,
      primaryVp: 0,
      secondaryVp: 0,
      deck: initialDeck(),
      activeMissions: [],
      discardedMissions: [],
    },
  ]);

  const [cardPlayer, setCardPlayer] = useState<0 | 1>(0);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const updatePlayer = (pIdx: 0 | 1, updater: (prev: PlayerState) => PlayerState) => {
    setPlayers((prev) => {
      const copy: [PlayerState, PlayerState] = [{ ...prev[0] }, { ...prev[1] }];
      copy[pIdx] = updater(copy[pIdx]);
      return copy;
    });
  };

  // Card actions
  const drawCard = (pIdx: 0 | 1) => {
    updatePlayer(pIdx, (p) => {
      if (p.activeMissions.length >= 2) return p;
      let curDeck = [...p.deck];
      if (curDeck.length === 0) {
        // Reshuffle discarded if deck runs out
        curDeck = shuffle(p.discardedMissions.length ? p.discardedMissions : allSecondaryIds);
      }
      if (curDeck.length === 0) return p;
      const drawn = curDeck.shift()!;
      return {
        ...p,
        deck: curDeck,
        activeMissions: [...p.activeMissions, drawn],
      };
    });
  };

  const scoreCard = (pIdx: 0 | 1, cardId: string, vp: number) => {
    updatePlayer(pIdx, (p) => ({
      ...p,
      secondaryVp: Math.min(40, p.secondaryVp + vp),
      activeMissions: p.activeMissions.filter((id) => id !== cardId),
      discardedMissions: [...p.discardedMissions, cardId],
    }));
  };

  const discardCard = (pIdx: 0 | 1, cardId: string, grantCp: boolean) => {
    updatePlayer(pIdx, (p) => ({
      ...p,
      cp: grantCp ? p.cp + 1 : p.cp,
      activeMissions: p.activeMissions.filter((id) => id !== cardId),
      discardedMissions: [...p.discardedMissions, cardId],
    }));
  };

  const newOrders = (pIdx: 0 | 1, cardId: string) => {
    updatePlayer(pIdx, (p) => {
      if (p.cp < 1) return p;
      let curDeck = [...p.deck];
      if (curDeck.length === 0) {
        curDeck = shuffle(p.discardedMissions.length ? p.discardedMissions : allSecondaryIds);
      }
      const newDrawn = curDeck.shift();
      const nextActive = p.activeMissions.filter((id) => id !== cardId);
      if (newDrawn) nextActive.push(newDrawn);

      return {
        ...p,
        cp: p.cp - 1,
        deck: curDeck,
        activeMissions: nextActive,
        discardedMissions: [...p.discardedMissions, cardId],
      };
    });
  };

  const handleFinishAndSave = () => {
    const layout = LAYOUTS.find((l) => l.id === selectedLayoutId);
    const p0Total = players[0].primaryVp + players[0].secondaryVp;
    const p1Total = players[1].primaryVp + players[1].secondaryVp;

    saveBattleLog({
      id: `tabletop-${Date.now()}`,
      timestamp: Date.now(),
      mode: 'tabletop',
      title: `Tabletop Match (${layout ? `Layout ${layout.number}` : 'Standard'})`,
      players: [
        {
          name: players[0].name,
          faction: players[0].faction,
          score: p0Total,
          cp: players[0].cp,
          isWinner: p0Total > p1Total,
        },
        {
          name: players[1].name,
          faction: players[1].faction,
          score: p1Total,
          cp: players[1].cp,
          isWinner: p1Total > p0Total,
        },
      ],
      turn: round,
      maxTurns: 5,
      layoutName: layout ? `Layout ${layout.number}` : undefined,
      summary: `Final Score: ${p0Total} - ${p1Total} (R${round})`,
    });

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onBack();
    }, 1500);
  };

  const curLayout: LayoutDef = LAYOUTS.find((l) => l.id === selectedLayoutId) ?? LAYOUTS[0];
  const p0Total = players[0].primaryVp + players[0].secondaryVp;
  const p1Total = players[1].primaryVp + players[1].secondaryVp;

  return (
    <div className="app tabletop-companion" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="appbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ minWidth: 44, minHeight: 44 }}>
            <Icon name="back" size={20} />
          </button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Tabletop Companion</div>
            <div className="tiny muted">Physical 40k Match Assistant</div>
          </div>
        </div>

        <button
          className="btn primary"
          style={{ minHeight: 36, padding: '4px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={handleFinishAndSave}
          disabled={savedSuccess}
        >
          <Icon name="check" size={15} />
          {savedSuccess ? 'Saved!' : 'Finish & Save'}
        </button>
      </header>

      {/* Mode / Feature Switcher */}
      <nav className="seg" style={{ margin: '8px 12px', display: 'flex', gap: 4 }}>
        <button
          className={tab === 'score' ? 'on' : ''}
          onClick={() => setTab('score')}
          style={{ flex: 1, minHeight: 40, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Icon name="trophy" size={16} />
          <span>Score & CP</span>
        </button>
        <button
          className={tab === 'cards' ? 'on' : ''}
          onClick={() => setTab('cards')}
          style={{ flex: 1, minHeight: 40, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Icon name="cards" size={16} />
          <span>Tactical Deck</span>
        </button>
        <button
          className={tab === 'map' ? 'on' : ''}
          onClick={() => setTab('map')}
          style={{ flex: 1, minHeight: 40, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Icon name="map" size={16} />
          <span>45 Layouts</span>
        </button>
      </nav>

      <main className="screen" style={{ flex: 1, padding: '0 12px 24px 12px', overflowY: 'auto' }}>
        {/* TAB 1: SCORE & CP TRACKER */}
        {tab === 'score' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Round & Turn Bar */}
            <div className="card" style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Battle Round</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button
                      key={r}
                      className={round === r ? 'btn primary' : 'btn ghost'}
                      style={{ minWidth: 36, minHeight: 36, padding: 0, fontSize: 13, fontWeight: 700 }}
                      onClick={() => setRound(r)}
                    >
                      R{r}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--line-1)', paddingTop: 8 }}>
                <span className="tiny muted">Turn:</span>
                <div className="seg" style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={activePlayer === 0 ? 'on' : ''}
                    style={{ minHeight: 32, fontSize: 12, padding: '2px 10px' }}
                    onClick={() => setActivePlayer(0)}
                  >
                    {players[0].name}
                  </button>
                  <button
                    className={activePlayer === 1 ? 'on' : ''}
                    style={{ minHeight: 32, fontSize: 12, padding: '2px 10px' }}
                    onClick={() => setActivePlayer(1)}
                  >
                    {players[1].name}
                  </button>
                </div>
              </div>
            </div>

            {/* Overall Score Summary Header */}
            <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-around', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{players[0].name}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: p0Total >= p1Total ? 'var(--accent)' : 'inherit' }}>{p0Total}</div>
              </div>
              <div style={{ fontSize: 18, opacity: 0.4, fontWeight: 700 }}>VP</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{players[1].name}</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: p1Total >= p0Total ? 'var(--accent)' : 'inherit' }}>{p1Total}</div>
              </div>
            </div>

            {/* Player Cards */}
            {([0, 1] as const).map((pIdx) => {
              const p = players[pIdx];
              const totalVp = p.primaryVp + p.secondaryVp;

              return (
                <div
                  key={pIdx}
                  className="card"
                  style={{
                    padding: '14px',
                    border: activePlayer === pIdx ? '1.5px solid var(--accent)' : '1px solid var(--line-2)',
                    background: 'var(--surface)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <input
                        type="text"
                        value={p.name}
                        onChange={(e) => updatePlayer(pIdx, (prev) => ({ ...prev, name: e.target.value }))}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px dashed var(--line-2)',
                          fontSize: 16,
                          fontWeight: 700,
                          color: 'var(--text)',
                          width: 140,
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="tiny muted">CP:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          className="btn ghost"
                          style={{ minWidth: 32, minHeight: 32, padding: 0 }}
                          onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, cp: Math.max(0, prev.cp - 1) }))}
                          aria-label="Decrease CP"
                        >
                          -
                        </button>
                        <b style={{ minWidth: 20, textAlign: 'center', fontSize: 14 }}>{p.cp}</b>
                        <button
                          className="btn ghost"
                          style={{ minWidth: 32, minHeight: 32, padding: 0 }}
                          onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, cp: prev.cp + 1 }))}
                          aria-label="Increase CP"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Primary VP Tracker */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--line-1)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Primary VP</div>
                      <div className="tiny muted">Max 45 VP</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        className="btn ghost"
                        style={{ minWidth: 36, minHeight: 36, padding: 0 }}
                        onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, primaryVp: Math.max(0, prev.primaryVp - 5) }))}
                      >
                        -5
                      </button>
                      <button
                        className="btn ghost"
                        style={{ minWidth: 30, minHeight: 36, padding: 0 }}
                        onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, primaryVp: Math.max(0, prev.primaryVp - 1) }))}
                      >
                        -1
                      </button>
                      <b style={{ minWidth: 28, textAlign: 'center', fontSize: 16, color: 'var(--accent)' }}>{p.primaryVp}</b>
                      <button
                        className="btn ghost"
                        style={{ minWidth: 30, minHeight: 36, padding: 0 }}
                        onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, primaryVp: Math.min(45, prev.primaryVp + 1) }))}
                      >
                        +1
                      </button>
                      <button
                        className="btn"
                        style={{ minWidth: 36, minHeight: 36, padding: 0, fontWeight: 700 }}
                        onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, primaryVp: Math.min(45, prev.primaryVp + 5) }))}
                      >
                        +5
                      </button>
                    </div>
                  </div>

                  {/* Secondary VP Tracker */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--line-1)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Secondary VP</div>
                      <div className="tiny muted">Max 40 VP</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        className="btn ghost"
                        style={{ minWidth: 30, minHeight: 36, padding: 0 }}
                        onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, secondaryVp: Math.max(0, prev.secondaryVp - 2) }))}
                      >
                        -2
                      </button>
                      <b style={{ minWidth: 28, textAlign: 'center', fontSize: 16, color: '#38bdf8' }}>{p.secondaryVp}</b>
                      <button
                        className="btn ghost"
                        style={{ minWidth: 30, minHeight: 36, padding: 0 }}
                        onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, secondaryVp: Math.min(40, prev.secondaryVp + 2) }))}
                      >
                        +2
                      </button>
                      <button
                        className="btn"
                        style={{ minWidth: 36, minHeight: 36, padding: 0, fontWeight: 700 }}
                        onClick={() => updatePlayer(pIdx, (prev) => ({ ...prev, secondaryVp: Math.min(40, prev.secondaryVp + 5) }))}
                      >
                        +5
                      </button>
                    </div>
                  </div>

                  {/* Total line */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
                    <span className="tiny muted">Total Player VP:</span>
                    <b style={{ fontSize: 16, color: 'var(--text)' }}>{totalVp} / 90</b>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: SECONDARY MISSION TACTICAL DECK */}
        {tab === 'cards' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Player Switcher */}
            <div className="seg" style={{ display: 'flex', gap: 4 }}>
              <button
                className={cardPlayer === 0 ? 'on' : ''}
                style={{ flex: 1, minHeight: 38, fontSize: 13 }}
                onClick={() => setCardPlayer(0)}
              >
                {players[0].name} ({players[0].activeMissions.length}/2 Active)
              </button>
              <button
                className={cardPlayer === 1 ? 'on' : ''}
                style={{ flex: 1, minHeight: 38, fontSize: 13 }}
                onClick={() => setCardPlayer(1)}
              >
                {players[1].name} ({players[1].activeMissions.length}/2 Active)
              </button>
            </div>

            {/* Deck Controls */}
            <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Tactical Deck ({players[cardPlayer].deck.length} left)</div>
                <div className="tiny muted">{players[cardPlayer].discardedMissions.length} discarded</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn primary"
                  style={{ minHeight: 38, padding: '4px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => drawCard(cardPlayer)}
                  disabled={players[cardPlayer].activeMissions.length >= 2 || players[cardPlayer].deck.length === 0}
                >
                  <Icon name="cards" size={16} /> Draw Card
                </button>
              </div>
            </div>

            {/* Active Secondary Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="cards" size={16} /> Active Tactical Missions ({players[cardPlayer].activeMissions.length}/2)
              </div>

              {players[cardPlayer].activeMissions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px dashed var(--line-2)' }}>
                  <Icon name="cards" size={28} style={{ opacity: 0.35, marginBottom: 6 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>No active mission cards</div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>Tap "Draw Card" to draw your tactical objectives for this turn.</div>
                </div>
              ) : (
                players[cardPlayer].activeMissions.map((id) => {
                  const card = MISSIONS.secondaries.find((m) => m.id === id);
                  if (!card) return null;

                  return (
                    <div
                      key={id}
                      className="card"
                      style={{
                        padding: '12px 14px',
                        border: '1.5px solid var(--accent)',
                        background: 'var(--surface)',
                        borderRadius: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{card.name}</div>
                          <span className="tiny muted">{card.when}</span>
                        </div>
                        <span className="pill-att" style={{ fontSize: 11, padding: '2px 8px' }}>
                          Tactical
                        </span>
                      </div>

                      <div style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--text)' }}>
                        {card.text}
                      </div>

                      {/* Card Action Buttons */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--line-1)' }}>
                        <button
                          className="btn primary"
                          style={{ flex: 1, minHeight: 36, padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                          onClick={() => scoreCard(cardPlayer, id, 5)}
                        >
                          <Icon name="check" size={14} /> Score (5 VP)
                        </button>
                        <button
                          className="btn"
                          style={{ flex: 1, minHeight: 36, padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                          onClick={() => scoreCard(cardPlayer, id, 2)}
                        >
                          Score (2 VP)
                        </button>
                        <button
                          className="btn ghost"
                          style={{ minHeight: 36, padding: '4px 10px', fontSize: 12 }}
                          onClick={() => discardCard(cardPlayer, id, true)}
                          title="Discard at end of turn to gain 1 CP"
                        >
                          Discard (+1 CP)
                        </button>
                        <button
                          className="btn ghost"
                          style={{ minHeight: 36, padding: '4px 10px', fontSize: 12 }}
                          onClick={() => newOrders(cardPlayer, id)}
                          disabled={players[cardPlayer].cp < 1}
                          title="Spend 1 CP to discard and draw immediately"
                        >
                          New Orders (1 CP)
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Discard Pile View */}
            {players[cardPlayer].discardedMissions.length > 0 && (
              <div className="card" style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--line-1)' }}>
                <div className="tiny muted" style={{ marginBottom: 6, fontWeight: 600 }}>
                  Discarded / Scored Cards ({players[cardPlayer].discardedMissions.length}):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {players[cardPlayer].discardedMissions.map((id, i) => {
                    const c = MISSIONS.secondaries.find((m) => m.id === id);
                    return (
                      <span key={i} className="tiny muted" style={{ background: 'var(--line-1)', padding: '2px 6px', borderRadius: 4 }}>
                        {c?.name ?? id}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: 45 OFFICIAL TERRAIN LAYOUTS */}
        {tab === 'map' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
              <label htmlFor="layout-select" style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Official Layout ({LAYOUTS.length} layouts):
              </label>
              <select
                id="layout-select"
                value={selectedLayoutId}
                onChange={(e) => setSelectedLayoutId(e.target.value)}
                style={{ width: '100%', minHeight: 42, padding: '0 10px', fontSize: 14, borderRadius: 6, background: 'var(--field-bg)', color: 'var(--text)', border: '1px solid var(--line-2)' }}
              >
                {LAYOUTS.map((l) => (
                  <option key={l.id} value={l.id}>
                    Layout {l.number} ({l.terrain.length} Ruins, {l.objectives.length} Objectives)
                  </option>
                ))}
              </select>
            </div>

            {/* Layout Overview & Interactive Preview */}
            <div
              className="card"
              style={{
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                background: 'var(--surface)',
                border: '1px solid var(--line-2)',
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <div>
                  <b style={{ fontSize: 15 }}>Layout {curLayout.number}</b>
                  <div className="tiny muted">44″ × 60″ Standard Table</div>
                </div>
                <button
                  className="btn"
                  style={{ minHeight: 34, padding: '2px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={() => setZoomMap(true)}
                >
                  <Icon name="search" size={14} /> Full Map
                </button>
              </div>

              {/* Preview SVG */}
              <div
                style={{
                  background: '#ece7dc',
                  padding: 8,
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: '1px solid var(--line-2)',
                }}
                onClick={() => setZoomMap(true)}
                title="Tap to zoom"
              >
                <LayoutPreview layout={curLayout} width={260} />
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: 'rgba(178,34,34,0.7)', borderRadius: 2 }} /> Attacker Zone
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: 'rgba(14,111,164,0.7)', borderRadius: 2 }} /> Defender Zone
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: '#2f6b4f', borderRadius: 2 }} /> Ruins / Walls
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', border: '1.5px solid #111' }} /> Objectives
                </span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ZOOM MAP MODAL */}
      {zoomMap && (
        <div className="sheet-backdrop" onClick={() => setZoomMap(false)} role="dialog" aria-modal="true">
          <div
            className="sheet-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Layout {curLayout.number} Details</div>
              <button className="icon-btn" onClick={() => setZoomMap(false)} aria-label="Close" style={{ minWidth: 44, minHeight: 44 }}>
                <Icon name="close" size={20} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#ece7dc', borderRadius: 8, padding: 8 }}>
              <LayoutPreview layout={curLayout} width={320} />
            </div>

            <div style={{ marginTop: 10, fontSize: 12, textAlign: 'center', color: 'var(--text-2)' }}>
              Objectives at 44″×60″ standard coordinates. Set up terrain according to ruin outlines and walls.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
