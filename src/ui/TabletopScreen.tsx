import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deploymentName,
  LAYOUTS,
  layoutsFor,
  MISSIONS,
  secondaryById,
  type DispositionId,
  type LayoutDef,
} from '../engine/config';
import { saveBattleLog } from '../services/storage';
import { Emblem } from './ArmyBuilder';
import { type FactionIndex } from './data';
import { Icon } from './Icon';
import { LayoutPreview } from './LayoutPreview';
import { Die } from './RollOverlay';
import { play } from './sfx';
import { armyColor } from './Sheet';
import type { Army } from './library';

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
  scoredMissions: string[];
}

const DEFAULT_FACTIONS = [
  { id: 'SM', name: 'Space Marines' },
  { id: 'TYR', name: 'Tyranids' },
  { id: 'ORK', name: 'Orks' },
  { id: 'NEC', name: 'Necrons' },
  { id: 'CSM', name: 'Chaos Space Marines' },
  { id: 'AE', name: 'Aeldari' },
  { id: 'AM', name: 'Astra Militarum' },
  { id: 'TAU', name: "T'au Empire" },
  { id: 'DG', name: 'Death Guard' },
  { id: 'AS', name: 'Adepta Sororitas' },
  { id: 'AC', name: 'Adeptus Custodes' },
  { id: 'GK', name: 'Grey Knights' },
  { id: 'LoV', name: 'Leagues of Votann' },
  { id: 'DRU', name: 'Drukhari' },
  { id: 'TS', name: 'Thousand Sons' },
  { id: 'WE', name: 'World Eaters' },
  { id: 'QI', name: 'Imperial Knights' },
  { id: 'QT', name: 'Chaos Knights' },
];

/** Parse scoring VP options from card text (e.g. "2VP / 2+ = 5VP" -> [2, 5]) */
function getSecondaryVpOptions(text: string): number[] {
  const matches = text.match(/\b([1-9])\s*VP\b/gi);
  if (!matches || matches.length === 0) return [2, 3, 4, 5];
  const nums = matches.map((m) => parseInt(m.replace(/\D/g, ''), 10)).filter((n) => !isNaN(n) && n > 0 && n <= 10);
  const unique = Array.from(new Set(nums)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : [2, 3, 4, 5];
}

export function TabletopScreen({ index, onBack }: Props) {
  // Mode: 'setup' (step-by-step wizard) or 'battle' (in-match)
  const [mode, setMode] = useState<'setup' | 'battle'>('setup');
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);

  // STEP 1: Dispositions & Playable Layouts (Strictly locked to matchup)
  const [p0Disp, setP0Disp] = useState<DispositionId>('take-and-hold');
  const [p1Disp, setP1Disp] = useState<DispositionId>('take-and-hold');
  const [selectedLayoutId, setSelectedLayoutId] = useState<string>('layout-01');
  const [inspectLayout, setInspectLayout] = useState<LayoutDef | null>(null);

  // STEP 2: Players & Factions (No quick-fill clutter, pure manual selection)
  const [p0Name, setP0Name] = useState('Player 1');
  const [p0Faction, setP0Faction] = useState('SM');
  const [p1Name, setP1Name] = useState('Player 2');
  const [p1Faction, setP1Faction] = useState('TYR');

  // STEP 3: Roll-Off & Turn Order (With authentic tumbling dice animation)
  const [attackerPlayer, setAttackerPlayer] = useState<0 | 1>(0); // 0 or 1 deploys first
  const [firstTurnPlayer, setFirstTurnPlayer] = useState<0 | 1>(0); // 0 or 1 takes Turn 1
  const [rollResult, setRollResult] = useState<{ p0: number; p1: number; reason: string } | null>(null);

  // Rolling Dice Animation State
  const [rolling, setRolling] = useState<'deploy' | 'turn' | null>(null);
  const [tempDice, setTempDice] = useState<{ p0: number; p1: number }>({ p0: 1, p1: 1 });
  const [landedDice, setLandedDice] = useState<{ p0: number; p1: number } | null>(null);
  const animIntervalRef = useRef<number | null>(null);

  // IN-MATCH STATE
  const [subView, setSubView] = useState<'player' | 'overview'>('player');
  const [round, setRound] = useState(1);
  const [activePlayer, setActivePlayer] = useState<0 | 1>(0);
  const [turnInRound, setTurnInRound] = useState<0 | 1>(0); // 0 = first turn, 1 = second turn
  const [zoomMap, setZoomMap] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Custom VP popover for a card
  const [customVpCardId, setCustomVpCardId] = useState<string | null>(null);
  const [customVpValue, setCustomVpValue] = useState<number>(3);

  const allSecondaryIds = useMemo(() => MISSIONS.secondaries.map((s) => s.id), []);

  const shuffle = (array: string[]) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const [players, setPlayers] = useState<[PlayerState, PlayerState]>(() => [
    {
      name: 'Player 1',
      faction: 'SM',
      cp: 1,
      primaryVp: 0,
      secondaryVp: 0,
      deck: shuffle(allSecondaryIds),
      activeMissions: [],
      discardedMissions: [],
      scoredMissions: [],
    },
    {
      name: 'Player 2',
      faction: 'TYR',
      cp: 1,
      primaryVp: 0,
      secondaryVp: 0,
      deck: shuffle(allSecondaryIds),
      activeMissions: [],
      discardedMissions: [],
      scoredMissions: [],
    },
  ]);

  // Strictly locked to the playable layouts for this matchup
  const playableLayouts = useMemo(() => {
    const matched = layoutsFor(p0Disp, p1Disp);
    return matched.length ? matched : LAYOUTS.slice(0, 3);
  }, [p0Disp, p1Disp]);

  // Sync selected layout if current selection is not in playable layouts
  useEffect(() => {
    if (!playableLayouts.some((l) => l.id === selectedLayoutId) && playableLayouts[0]) {
      setSelectedLayoutId(playableLayouts[0].id);
    }
  }, [playableLayouts, selectedLayoutId]);

  const curLayout: LayoutDef = LAYOUTS.find((l) => l.id === selectedLayoutId) ?? playableLayouts[0] ?? LAYOUTS[0];

  const factionList = useMemo(() => {
    if (index?.factions && index.factions.length > 0) {
      return index.factions.map((f) => ({ id: f.id, name: f.name }));
    }
    return DEFAULT_FACTIONS;
  }, [index]);

  const updatePlayer = (pIdx: 0 | 1, updater: (prev: PlayerState) => PlayerState) => {
    setPlayers((prev) => {
      const copy: [PlayerState, PlayerState] = [{ ...prev[0] }, { ...prev[1] }];
      copy[pIdx] = updater(copy[pIdx]);
      return copy;
    });
  };

  // Roll D6 with animation
  const rollD6 = () => Math.floor(Math.random() * 6) + 1;

  const handleStartAnimatedRoll = (type: 'deploy' | 'turn') => {
    if (rolling) return;
    setRolling(type);
    setLandedDice(null);
    play('dice');

    let r0 = rollD6();
    let r1 = rollD6();
    while (r0 === r1) {
      r0 = rollD6();
      r1 = rollD6();
    }

    // Tumble faces for 750ms
    if (animIntervalRef.current) clearInterval(animIntervalRef.current);
    animIntervalRef.current = window.setInterval(() => {
      setTempDice({ p0: rollD6(), p1: rollD6() });
    }, 65);

    setTimeout(() => {
      if (animIntervalRef.current) clearInterval(animIntervalRef.current);
      animIntervalRef.current = null;
      setTempDice({ p0: r0, p1: r1 });
      setLandedDice({ p0: r0, p1: r1 });
      play('land');

      const winner: 0 | 1 = r0 > r1 ? 0 : 1;
      const winnerName = winner === 0 ? p0Name : p1Name;

      if (type === 'deploy') {
        setAttackerPlayer(winner);
        setRollResult({ p0: r0, p1: r1, reason: `${winnerName} rolled higher (${r0} vs ${r1}) and deploys first (Attacker)!` });
      } else {
        setFirstTurnPlayer(winner);
        setRollResult({ p0: r0, p1: r1, reason: `${winnerName} rolled higher (${r0} vs ${r1}) and takes Turn 1!` });
      }

      play('good');
      setRolling(null);
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (animIntervalRef.current) clearInterval(animIntervalRef.current);
    };
  }, []);

  // Launch Battle from Setup
  const handleStartBattle = () => {
    setPlayers([
      {
        name: p0Name.trim() || 'Player 1',
        faction: p0Faction,
        cp: 1,
        primaryVp: 0,
        secondaryVp: 0,
        deck: shuffle(allSecondaryIds),
        activeMissions: [],
        discardedMissions: [],
        scoredMissions: [],
      },
      {
        name: p1Name.trim() || 'Player 2',
        faction: p1Faction,
        cp: 1,
        primaryVp: 0,
        secondaryVp: 0,
        deck: shuffle(allSecondaryIds),
        activeMissions: [],
        discardedMissions: [],
        scoredMissions: [],
      },
    ]);
    setActivePlayer(firstTurnPlayer);
    setTurnInRound(0);
    setRound(1);
    setMode('battle');
    setSubView('player');
  };

  // Tactical Deck Actions
  const handleDrawCard = (pIdx: 0 | 1) => {
    updatePlayer(pIdx, (p) => {
      if (p.activeMissions.length >= 2) return p;
      let curDeck = [...p.deck];
      if (curDeck.length === 0) {
        curDeck = shuffle(p.discardedMissions.length ? p.discardedMissions : allSecondaryIds);
      }
      if (curDeck.length === 0) return p;
      const drawn = curDeck.shift()!;
      play('card');
      return {
        ...p,
        deck: curDeck,
        activeMissions: [...p.activeMissions, drawn],
      };
    });
  };

  // Score Secondary Card (Player chooses VP)
  const handleScoreCard = (pIdx: 0 | 1, cardId: string, vp: number) => {
    updatePlayer(pIdx, (p) => ({
      ...p,
      secondaryVp: Math.min(40, p.secondaryVp + vp),
      activeMissions: p.activeMissions.filter((id) => id !== cardId),
      scoredMissions: [...p.scoredMissions, cardId],
      discardedMissions: [...p.discardedMissions, cardId],
    }));
    play('vp');
    setCustomVpCardId(null);
  };

  // Free Discard (Player manages CP on their own)
  const handleDiscardCard = (pIdx: 0 | 1, cardId: string, grantCp: boolean = false) => {
    updatePlayer(pIdx, (p) => ({
      ...p,
      cp: grantCp ? p.cp + 1 : p.cp,
      activeMissions: p.activeMissions.filter((id) => id !== cardId),
      discardedMissions: [...p.discardedMissions, cardId],
    }));
    play('tick');
  };

  // Free Redraw (Player manages CP on their own, does NOT deduct CP)
  const handleFreeRedraw = (pIdx: 0 | 1, cardId: string) => {
    updatePlayer(pIdx, (p) => {
      let curDeck = [...p.deck];
      if (curDeck.length === 0) {
        curDeck = shuffle(p.discardedMissions.length ? p.discardedMissions : allSecondaryIds);
      }
      const newDrawn = curDeck.shift();
      const nextActive = p.activeMissions.filter((id) => id !== cardId);
      if (newDrawn) nextActive.push(newDrawn);
      play('card');

      return {
        ...p,
        deck: curDeck,
        activeMissions: nextActive,
        discardedMissions: [...p.discardedMissions, cardId],
      };
    });
  };

  // Turn Passing ("เน้นเป็น รายคน เลย พอ อีกฝั่งมา ก็ ค่อย ขึ้นอีกฝั่ง")
  const handlePassTurn = () => {
    const otherPlayer: 0 | 1 = activePlayer === 0 ? 1 : 0;
    if (turnInRound === 0) {
      // First turn completed, pass to second player in this round
      setActivePlayer(otherPlayer);
      setTurnInRound(1);
      play('turn');
    } else {
      // Second turn completed, advance round!
      if (round < 5) {
        setRound((r) => r + 1);
        setActivePlayer(firstTurnPlayer);
        setTurnInRound(0);
        // Both players gain 1 CP at start of round
        setPlayers((prev) => [
          { ...prev[0], cp: prev[0].cp + 1 },
          { ...prev[1], cp: prev[1].cp + 1 },
        ]);
        play('turn');
      } else {
        // Round 5 finished
        setSubView('overview');
      }
    }
  };

  // Finish and Save Match to History
  const handleFinishAndSave = () => {
    const layout = LAYOUTS.find((l) => l.id === selectedLayoutId) ?? curLayout;
    const p0Total = players[0].primaryVp + players[0].secondaryVp;
    const p1Total = players[1].primaryVp + players[1].secondaryVp;

    saveBattleLog({
      id: `tabletop-${Date.now()}`,
      timestamp: Date.now(),
      mode: 'tabletop',
      title: `Tabletop Match (${layout ? `Layout ${layout.number}` : 'Standard'})`,
      layoutName: layout ? `Layout ${layout.number} (${deploymentName(layout.deployment)})` : 'Standard Layout',
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
      summary: `Final VP: ${p0Total} - ${p1Total} (Primary: ${players[0].primaryVp}-${players[1].primaryVp}, Sec: ${players[0].secondaryVp}-${players[1].secondaryVp})`,
    });

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onBack();
    }, 1500);
  };

  const activeP = players[activePlayer];
  const otherP = players[activePlayer === 0 ? 1 : 0];
  const p0Total = players[0].primaryVp + players[0].secondaryVp;
  const p1Total = players[1].primaryVp + players[1].secondaryVp;

  // ==========================================
  // RENDER: SETUP WIZARD (Steps 1, 2, 3)
  // ==========================================
  if (mode === 'setup') {
    return (
      <div className="app tabletop-companion" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header className="appbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ minWidth: 40, minHeight: 40 }}>
              <Icon name="back" size={20} />
            </button>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Tabletop Companion</div>
              <div className="tiny muted">11th Edition Match Setup</div>
            </div>
          </div>
          <span className="pill-att" style={{ fontSize: 11, padding: '3px 10px', background: 'rgba(74, 222, 128, 0.2)', color: '#4ade80' }}>
            Step {setupStep} of 3
          </span>
        </header>

        {/* Step Indicator */}
        <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line-2)' }}>
          <button
            className={`btn grow ${setupStep === 1 ? 'primary' : 'ghost'}`}
            style={{ minHeight: 34, fontSize: 11.5, padding: 0, fontWeight: 700 }}
            onClick={() => setSetupStep(1)}
          >
            1. Dispositions
          </button>
          <button
            className={`btn grow ${setupStep === 2 ? 'primary' : 'ghost'}`}
            style={{ minHeight: 34, fontSize: 11.5, padding: 0, fontWeight: 700 }}
            onClick={() => setSetupStep(2)}
          >
            2. Players
          </button>
          <button
            className={`btn grow ${setupStep === 3 ? 'primary' : 'ghost'}`}
            style={{ minHeight: 34, fontSize: 11.5, padding: 0, fontWeight: 700 }}
            onClick={() => setSetupStep(3)}
          >
            3. Roll-Off
          </button>
        </div>

        <main className="screen" style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>
          {/* STEP 1: FORCE DISPOSITIONS & PLAYABLE LAYOUTS (LOCKED TO MATCHUP) */}
          {setupStep === 1 && (
            <div className="tt-wizard">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Force Dispositions & Playable Layouts</h3>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Select the force disposition for each side. The matchup dictates the official tournament layouts.
                </p>
              </div>

              {/* Player 1 Disposition */}
              <div className="card" style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="hold" size={16} /> Player 1 Force Disposition
                </div>
                <div className="tt-disp-grid">
                  {MISSIONS.forceDispositions.map((d) => (
                    <div
                      key={d.id}
                      className={`tt-disp-card ${p0Disp === d.id ? 'sel' : ''}`}
                      style={{ ['--disp-color' as string]: d.color }}
                      onClick={() => setP0Disp(d.id)}
                    >
                      <div className="tt-disp-title" style={{ color: p0Disp === d.id ? d.color : 'inherit' }}>{d.name}</div>
                      <div className="tt-disp-desc">{d.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Player 2 Disposition */}
              <div className="card" style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="hold" size={16} /> Player 2 Force Disposition
                </div>
                <div className="tt-disp-grid">
                  {MISSIONS.forceDispositions.map((d) => (
                    <div
                      key={d.id}
                      className={`tt-disp-card ${p1Disp === d.id ? 'sel' : ''}`}
                      style={{ ['--disp-color' as string]: d.color }}
                      onClick={() => setP1Disp(d.id)}
                    >
                      <div className="tt-disp-title" style={{ color: p1Disp === d.id ? d.color : 'inherit' }}>{d.name}</div>
                      <div className="tt-disp-desc">{d.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Playable Layouts (Locked to this matchup) */}
              <div className="card" style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>Playable Layouts ({playableLayouts.length} Official Matchup Layouts)</span>
                    <div className="tiny muted">Locked to official 11th edition pairings for this disposition matchup</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: 10 }}>
                  {playableLayouts.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        padding: '10px 8px',
                        borderRadius: 8,
                        border: selectedLayoutId === l.id ? '2px solid var(--accent)' : '1px solid var(--line-2)',
                        background: selectedLayoutId === l.id ? 'rgba(74, 144, 226, 0.12)' : 'var(--surface-2)',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        position: 'relative',
                      }}
                    >
                      <div onClick={() => setSelectedLayoutId(l.id)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
                        <LayoutPreview layout={l} width={90} />
                        <div>
                          <b style={{ fontSize: 12.5, display: 'block' }}>Layout {l.number}</b>
                          <span className="tiny muted">{deploymentName(l.deployment)}</span>
                        </div>
                      </div>

                      {/* Inspect Layout Button */}
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ minHeight: 28, fontSize: 11, padding: '2px 8px', width: '100%', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInspectLayout(l);
                        }}
                      >
                        <Icon name="search" size={13} /> ดู Layout
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                className="btn primary"
                style={{ minHeight: 46, fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onClick={() => setSetupStep(2)}
              >
                Next: Enter Players & Factions →
              </button>
            </div>
          )}

          {/* STEP 2: PLAYERS & FACTIONS (NO QUICK-FILL CLUTTER) */}
          {setupStep === 2 && (
            <div className="tt-wizard">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Choose Players & Factions</h3>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Enter player names and select factions directly.
                </p>
              </div>

              {/* Player 1 Card */}
              <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Emblem factionId={p0Faction} />
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)' }}>Player 1 Name</label>
                    <input
                      type="text"
                      className="input"
                      value={p0Name}
                      onChange={(e) => setP0Name(e.target.value)}
                      placeholder="Player 1"
                      style={{ width: '100%', marginTop: 2, padding: '6px 10px', fontSize: 14 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                    Faction: {factionList.find((f) => f.id === p0Faction)?.name ?? p0Faction}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflowY: 'auto', padding: 4 }}>
                    {factionList.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={p0Faction === f.id ? 'btn primary' : 'btn ghost'}
                        style={{ fontSize: 11.5, minHeight: 30, padding: '2px 8px' }}
                        onClick={() => setP0Faction(f.id)}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Player 2 Card */}
              <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Emblem factionId={p1Faction} />
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)' }}>Player 2 Name</label>
                    <input
                      type="text"
                      className="input"
                      value={p1Name}
                      onChange={(e) => setP1Name(e.target.value)}
                      placeholder="Player 2"
                      style={{ width: '100%', marginTop: 2, padding: '6px 10px', fontSize: 14 }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                    Faction: {factionList.find((f) => f.id === p1Faction)?.name ?? p1Faction}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflowY: 'auto', padding: 4 }}>
                    {factionList.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={p1Faction === f.id ? 'btn primary' : 'btn ghost'}
                        style={{ fontSize: 11.5, minHeight: 30, padding: '2px 8px' }}
                        onClick={() => setP1Faction(f.id)}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" style={{ minHeight: 46, flex: 1 }} onClick={() => setSetupStep(1)}>
                  ← Back to Dispositions
                </button>
                <button
                  className="btn primary grow"
                  style={{ minHeight: 46, fontSize: 14, fontWeight: 800, flex: 2 }}
                  onClick={() => setSetupStep(3)}
                >
                  Next: Roll-Off & Turn Order →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: ROLL-OFF & DEPLOYMENT / FIRST TURN (WITH TUMBLING DICE ANIMATION) */}
          {setupStep === 3 && (
            <div className="tt-wizard">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Pre-Battle Roll-Off & Turn Order</h3>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Roll D6 to determine who deploys first (Attacker) and who takes the first battle turn.
                </p>
              </div>

              {/* Animated Tumbling Dice Box */}
              {(rolling || landedDice) && (
                <div
                  className="card"
                  style={{
                    padding: '16px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line-2)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 12,
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)' }}>
                    {rolling === 'deploy' ? 'Rolling for Deployment Order...' : rolling === 'turn' ? 'Rolling for Turn 1 Order...' : 'Roll Result'}
                  </div>

                  <div className={`ro-dice ${landedDice ? 'land' : 'tumble'}`} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: landedDice && tempDice.p0 > tempDice.p1 ? 'var(--accent)' : 'inherit' }}>
                        {p0Name}
                      </span>
                      <div className={`ro-die ${landedDice && tempDice.p0 > tempDice.p1 ? 'win' : ''}`}>
                        <Die v={tempDice.p0} color={landedDice && tempDice.p0 > tempDice.p1 ? '#38bdf8' : '#64748b'} size={68} />
                      </div>
                    </div>

                    <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-3)' }}>VS</div>

                    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: landedDice && tempDice.p1 > tempDice.p0 ? 'var(--accent)' : 'inherit' }}>
                        {p1Name}
                      </span>
                      <div className={`ro-die ${landedDice && tempDice.p1 > tempDice.p0 ? 'win' : ''}`}>
                        <Die v={tempDice.p1} color={landedDice && tempDice.p1 > tempDice.p0 ? '#38bdf8' : '#64748b'} size={68} />
                      </div>
                    </div>
                  </div>

                  {rollResult && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', textAlign: 'center' }}>
                      {rollResult.reason}
                    </div>
                  )}
                </div>
              )}

              {/* 1. Deployment Order (Attacker vs Defender) */}
              <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <b style={{ fontSize: 14 }}>1. Deployment Order (Attacker)</b>
                    <div className="tiny muted">The Attacker deploys their entire army first.</div>
                  </div>
                  <button
                    className="btn primary"
                    style={{ fontSize: 12.5, minHeight: 34, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                    onClick={() => handleStartAnimatedRoll('deploy')}
                    disabled={rolling !== null}
                  >
                    <Icon name="dice" size={16} /> Roll D6
                  </button>
                </div>

                <div className="seg" style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={attackerPlayer === 0 ? 'on' : ''}
                    style={{ flex: 1, minHeight: 40, fontSize: 12.5, fontWeight: 700 }}
                    onClick={() => setAttackerPlayer(0)}
                  >
                    {p0Name} Deploys 1st (Attacker)
                  </button>
                  <button
                    type="button"
                    className={attackerPlayer === 1 ? 'on' : ''}
                    style={{ flex: 1, minHeight: 40, fontSize: 12.5, fontWeight: 700 }}
                    onClick={() => setAttackerPlayer(1)}
                  >
                    {p1Name} Deploys 1st (Attacker)
                  </button>
                </div>
              </div>

              {/* 2. First Turn Order */}
              <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <b style={{ fontSize: 14 }}>2. First Turn Order</b>
                    <div className="tiny muted">Which player takes Turn 1 in Battle Round 1?</div>
                  </div>
                  <button
                    className="btn primary"
                    style={{ fontSize: 12.5, minHeight: 34, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                    onClick={() => handleStartAnimatedRoll('turn')}
                    disabled={rolling !== null}
                  >
                    <Icon name="dice" size={16} /> Roll D6
                  </button>
                </div>

                <div className="seg" style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={firstTurnPlayer === 0 ? 'on' : ''}
                    style={{ flex: 1, minHeight: 40, fontSize: 12.5, fontWeight: 700 }}
                    onClick={() => setFirstTurnPlayer(0)}
                  >
                    {p0Name} Takes Turn 1
                  </button>
                  <button
                    type="button"
                    className={firstTurnPlayer === 1 ? 'on' : ''}
                    style={{ flex: 1, minHeight: 40, fontSize: 12.5, fontWeight: 700 }}
                    onClick={() => setFirstTurnPlayer(1)}
                  >
                    {p1Name} Takes Turn 1
                  </button>
                </div>
              </div>

              {/* Match Summary Preview */}
              <div className="card" style={{ padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--line-2)', fontSize: 12.5, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Battle Configuration:</div>
                <div><b>Layout:</b> Layout {curLayout.number} ({deploymentName(curLayout.deployment)})</div>
                <div><b>Attacker (Deploy 1st):</b> {attackerPlayer === 0 ? p0Name : p1Name} ({attackerPlayer === 0 ? p0Faction : p1Faction})</div>
                <div><b>Defender:</b> {attackerPlayer === 0 ? p1Name : p0Name} ({attackerPlayer === 0 ? p1Faction : p0Faction})</div>
                <div><b>First Turn:</b> {firstTurnPlayer === 0 ? p0Name : p1Name}</div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" style={{ minHeight: 48, flex: 1 }} onClick={() => setSetupStep(2)}>
                  ← Back to Players
                </button>
                <button
                  className="btn primary grow"
                  style={{ minHeight: 48, fontSize: 16, fontWeight: 900, flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onClick={handleStartBattle}
                >
                  <Icon name="fight" size={20} /> START BATTLE
                </button>
              </div>
            </div>
          )}
        </main>

        {/* INSPECT LAYOUT MODAL */}
        {inspectLayout && (
          <div className="sheet-backdrop" onClick={() => setInspectLayout(null)} role="dialog" aria-modal="true">
            <div
              className="sheet-panel"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 460, maxHeight: '90vh', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Layout {inspectLayout.number}: {deploymentName(inspectLayout.deployment)}</h3>
                  <div className="tiny muted">Attacker edge: {inspectLayout.attackerEdge} · {inspectLayout.objectives.length} objectives</div>
                </div>
                <button className="icon-btn" onClick={() => setInspectLayout(null)} aria-label="Close">
                  <Icon name="close" size={20} />
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0', background: 'var(--surface-2)', borderRadius: 8 }}>
                <LayoutPreview layout={inspectLayout} width={280} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-3)' }}>
                <span>Red: Attacker Zone</span>
                <span>Blue: Defender Zone</span>
                <span>Circles: Objectives</span>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  className="btn primary grow"
                  style={{ minHeight: 40, fontSize: 13, fontWeight: 700 }}
                  onClick={() => {
                    setSelectedLayoutId(inspectLayout.id);
                    setInspectLayout(null);
                  }}
                >
                  ✓ Select Layout {inspectLayout.number}
                </button>
                <button className="btn ghost" style={{ minHeight: 40 }} onClick={() => setInspectLayout(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: IN-MATCH (ACTIVE PLAYER OR OVERVIEW)
  // ==========================================
  return (
    <div className="app tabletop-companion" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header */}
      <header className="appbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-btn" onClick={onBack} aria-label="Exit Tabletop" style={{ minWidth: 40, minHeight: 40 }}>
            <Icon name="back" size={20} />
          </button>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Round {round} of 5</span>
              <span className="pill-att" style={{ fontSize: 10, padding: '1px 6px' }}>Turn {turnInRound + 1}/2</span>
            </div>
            <div className="tiny muted">{p0Total} : {p1Total} VP</div>
          </div>
        </div>

        {/* View Switcher: Active Player vs Overview */}
        <div style={{ display: 'flex', gap: 6 }}>
          {subView === 'player' ? (
            <button
              className="btn"
              style={{ minHeight: 36, padding: '4px 12px', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)' }}
              onClick={() => setSubView('overview')}
            >
              <Icon name="map" size={15} /> Overview & Layout
            </button>
          ) : (
            <button
              className="btn primary"
              style={{ minHeight: 36, padding: '4px 12px', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setSubView('player')}
            >
              <Icon name="fight" size={15} /> Return to {activeP.name}
            </button>
          )}

          <button
            className="btn ghost"
            style={{ minHeight: 36, padding: '4px 10px', fontSize: 12 }}
            onClick={handleFinishAndSave}
            disabled={savedSuccess}
            title="Finish and record match to Battle History"
          >
            {savedSuccess ? 'Saved!' : 'Finish'}
          </button>
        </div>
      </header>

      {/* VIEW 1: ACTIVE PLAYER VIEW ("เน้นเป็น รายคน เลย โชว์เเค่ของตัวเอง") */}
      {subView === 'player' && (
        <main className="screen" style={{ flex: 1, padding: '12px 14px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Active Player Banner */}
          <div
            className="tt-active-player-banner"
            style={{
              ['--p-color' as string]: armyColor(activeP.faction),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Emblem factionId={activeP.faction} />
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#ffffff', letterSpacing: '0.04em' }}>
                  {activeP.name.toUpperCase()}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span className="pill-att" style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(255, 255, 255, 0.15)' }}>
                    {activePlayer === attackerPlayer ? 'Attacker' : 'Defender'}
                  </span>
                  <span className="pill-att" style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(255, 255, 255, 0.15)' }}>
                    {activePlayer === firstTurnPlayer ? 'Turn 1 Player' : 'Turn 2 Player'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div className="tiny muted">TOTAL SCORE</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent)', lineHeight: 1 }}>
                {activeP.primaryVp + activeP.secondaryVp} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-3)' }}>VP</span>
              </div>
            </div>
          </div>

          {/* Section 1: Command Points (CP) */}
          <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="strat" size={16} /> Command Points (CP)
              </div>
              <div className="tiny muted">Spend on Stratagems & Tactical Decisions</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn"
                style={{ minWidth: 36, minHeight: 36, padding: 0, fontSize: 18, fontWeight: 800 }}
                onClick={() => updatePlayer(activePlayer, (p) => ({ ...p, cp: Math.max(0, p.cp - 1) }))}
              >
                -
              </button>
              <span className="num" style={{ fontSize: 24, fontWeight: 900, minWidth: 32, textAlign: 'center' }}>
                {activeP.cp}
              </span>
              <button
                className="btn primary"
                style={{ minWidth: 36, minHeight: 36, padding: 0, fontSize: 18, fontWeight: 800 }}
                onClick={() => updatePlayer(activePlayer, (p) => ({ ...p, cp: p.cp + 1 }))}
              >
                +
              </button>
            </div>
          </div>

          {/* Section 2: Primary Mission Scoring */}
          <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="hold" size={16} /> Primary Objective VP
                </div>
                <div className="tiny muted">Hold objectives in Command / End of Turn phase</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--accent)' }}>
                {activeP.primaryVp} <span style={{ fontSize: 12, color: 'var(--text-3)' }}>/ 50</span>
              </div>
            </div>

            {/* Quick Scoring Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 4 }}>
              <button
                className="btn"
                style={{ minHeight: 36, fontSize: 12, fontWeight: 700, padding: 2 }}
                onClick={() => updatePlayer(activePlayer, (p) => ({ ...p, primaryVp: Math.min(50, p.primaryVp + 4) }))}
              >
                +4 VP
              </button>
              <button
                className="btn"
                style={{ minHeight: 36, fontSize: 12, fontWeight: 700, padding: 2 }}
                onClick={() => updatePlayer(activePlayer, (p) => ({ ...p, primaryVp: Math.min(50, p.primaryVp + 8) }))}
              >
                +8 VP
              </button>
              <button
                className="btn"
                style={{ minHeight: 36, fontSize: 12, fontWeight: 700, padding: 2 }}
                onClick={() => updatePlayer(activePlayer, (p) => ({ ...p, primaryVp: Math.min(50, p.primaryVp + 12) }))}
              >
                +12 VP
              </button>
              <button
                className="btn danger"
                style={{ minHeight: 36, fontSize: 12, fontWeight: 700, padding: 2 }}
                onClick={() => updatePlayer(activePlayer, (p) => ({ ...p, primaryVp: Math.max(0, p.primaryVp - 4) }))}
              >
                -4 VP
              </button>
            </div>
          </div>

          {/* Section 3: Tactical Secondary Mission Deck */}
          <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="cards" size={16} /> Tactical Secondary Missions
                </div>
                <div className="tiny muted">{activeP.secondaryVp} / 40 VP scored · {activeP.deck.length} in deck</div>
              </div>

              {activeP.activeMissions.length < 2 && (
                <button
                  className="btn primary"
                  style={{ minHeight: 36, padding: '4px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                  onClick={() => handleDrawCard(activePlayer)}
                  disabled={activeP.deck.length === 0}
                >
                  <Icon name="cards" size={15} /> Draw Card
                </button>
              )}
            </div>

            {/* Active Secondary Cards */}
            {activeP.activeMissions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px dashed var(--line-2)' }}>
                <Icon name="cards" size={28} style={{ opacity: 0.35, marginBottom: 4 }} />
                <div style={{ fontSize: 13, fontWeight: 700 }}>No Tactical Secondary Cards in Hand</div>
                <div className="tiny muted" style={{ marginTop: 2 }}>Tap "Draw Card" to draw your tactical objectives for this turn.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activeP.activeMissions.map((cardId) => {
                  const card = secondaryById(cardId);
                  if (!card) return null;
                  const vpOptions = getSecondaryVpOptions(card.text);

                  return (
                    <div
                      key={cardId}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 8,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line-2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <b style={{ fontSize: 14.5, color: '#f1f5f9' }}>{card.name}</b>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {vpOptions.map((v) => (
                            <span key={v} className="pill-att" style={{ fontSize: 11, padding: '2px 6px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontWeight: 800 }}>
                              {v} VP
                            </span>
                          ))}
                        </div>
                      </div>

                      <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.4 }}>
                        {card.text}
                      </p>

                      {/* Scoring Buttons (Player picks their earned VP) */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                        {vpOptions.map((vp) => (
                          <button
                            key={vp}
                            className="btn primary"
                            style={{ flex: 1, minHeight: 34, fontSize: 12, fontWeight: 700, padding: '0 8px' }}
                            onClick={() => handleScoreCard(activePlayer, cardId, vp)}
                          >
                            ✓ Score +{vp} VP
                          </button>
                        ))}
                        <button
                          className="btn ghost"
                          style={{ minHeight: 34, fontSize: 11, padding: '0 8px' }}
                          onClick={() => setCustomVpCardId(customVpCardId === cardId ? null : cardId)}
                        >
                          Custom VP
                        </button>
                      </div>

                      {/* Custom VP Drawer */}
                      {customVpCardId === cardId && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--line-2)' }}>
                          <span className="tiny muted">VP Amount:</span>
                          {[1, 2, 3, 4, 5].map((val) => (
                            <button
                              key={val}
                              className={customVpValue === val ? 'btn primary' : 'btn ghost'}
                              style={{ minWidth: 28, minHeight: 28, padding: 0, fontSize: 12, fontWeight: 700 }}
                              onClick={() => setCustomVpValue(val)}
                            >
                              {val}
                            </button>
                          ))}
                          <button
                            className="btn primary"
                            style={{ minHeight: 28, fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
                            onClick={() => handleScoreCard(activePlayer, cardId, customVpValue)}
                          >
                            Confirm +{customVpValue}
                          </button>
                        </div>
                      )}

                      {/* Free Discard and Redraw (No automatic CP loss or gain unless chosen) */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, borderTop: '1px solid var(--line-1)', paddingTop: 6 }}>
                        <button
                          className="btn ghost"
                          style={{ minHeight: 30, fontSize: 11.5, padding: '2px 10px' }}
                          onClick={() => handleDiscardCard(activePlayer, cardId, false)}
                          title="Discard this card from hand"
                        >
                          Discard
                        </button>
                        <button
                          className="btn ghost"
                          style={{ minHeight: 30, fontSize: 11.5, padding: '2px 10px' }}
                          onClick={() => handleDiscardCard(activePlayer, cardId, true)}
                          title="Discard at end of turn and gain 1 CP"
                        >
                          Discard (+1 CP)
                        </button>
                        <button
                          className="btn ghost"
                          style={{ minHeight: 30, fontSize: 11.5, padding: '2px 10px', color: '#38bdf8' }}
                          onClick={() => handleFreeRedraw(activePlayer, cardId)}
                          title="Redraw: Discard this card and draw a replacement from deck"
                        >
                          Redraw
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* TURN PASSING ACTION BUTTON ("พอ อีกฝั่งมา ก็ ค่อย ขึ้นอีกฝั่ง") */}
          <div style={{ marginTop: 'auto', paddingTop: 8 }}>
            <button
              className="btn primary tt-pass-turn-btn"
              style={{ width: '100%' }}
              onClick={handlePassTurn}
            >
              {turnInRound === 0 ? (
                <>
                  <span>PASS TURN TO {otherP.name.toUpperCase()}</span>
                  <Icon name="next" size={20} />
                </>
              ) : round < 5 ? (
                <>
                  <span>END ROUND {round} → ADVANCE TO ROUND {round + 1}</span>
                  <Icon name="next" size={20} />
                </>
              ) : (
                <>
                  <span>FINISH BATTLE & RECORD FINAL SCORE</span>
                  <Icon name="trophy" size={20} />
                </>
              )}
            </button>
          </div>
        </main>
      )}

      {/* VIEW 2: TABLE OVERVIEW & LAYOUT INSPECTOR ("เเละมีกดให้ ดุภาพรวมทั้งหมด ด้วย ดู Layout ด่านไรพวกนั้น") */}
      {subView === 'overview' && (
        <main className="screen" style={{ flex: 1, padding: '14px 14px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Side-by-side Scoreboard */}
          <div className="card" style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>
              Battle Scoreboard (Round {round} of 5)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}>
              {/* Player 0 Score */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Emblem factionId={players[0].faction} />
                  <div>
                    <b style={{ fontSize: 15 }}>{players[0].name}</b>
                    <div className="tiny muted">{players[0].faction}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                  <div>Primary: <b>{players[0].primaryVp}</b> VP</div>
                  <div>Secondary: <b>{players[0].secondaryVp}</b> VP</div>
                  <div>CP Available: <b>{players[0].cp}</b></div>
                </div>
              </div>

              {/* Central VP Comparison */}
              <div style={{ textAlign: 'center', padding: '0 8px' }}>
                <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '0.04em' }}>
                  <span style={{ color: p0Total >= p1Total ? 'var(--accent)' : 'inherit' }}>{p0Total}</span>
                  <span style={{ opacity: 0.4, margin: '0 6px' }}>:</span>
                  <span style={{ color: p1Total >= p0Total ? 'var(--accent)' : 'inherit' }}>{p1Total}</span>
                </div>
                <div className="tiny muted" style={{ fontWeight: 700 }}>TOTAL VP</div>
              </div>

              {/* Player 1 Score */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: 'row-reverse' }}>
                  <Emblem factionId={players[1].faction} />
                  <div style={{ textAlign: 'right' }}>
                    <b style={{ fontSize: 15 }}>{players[1].name}</b>
                    <div className="tiny muted">{players[1].faction}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, textAlign: 'right' }}>
                  <div>Primary: <b>{players[1].primaryVp}</b> VP</div>
                  <div>Secondary: <b>{players[1].secondaryVp}</b> VP</div>
                  <div>CP Available: <b>{players[1].cp}</b></div>
                </div>
              </div>
            </div>
          </div>

          {/* Deployment & Matchup Info */}
          <div className="card" style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line-2)', fontSize: 12.5, lineHeight: 1.5 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Match & Mission Parameters</div>
            <div><b>Attacker (Deployed 1st):</b> {attackerPlayer === 0 ? players[0].name : players[1].name}</div>
            <div><b>Defender:</b> {attackerPlayer === 0 ? players[1].name : players[0].name}</div>
            <div><b>First Turn Taken By:</b> {firstTurnPlayer === 0 ? players[0].name : players[1].name}</div>
            <div><b>Current Active Turn:</b> {activeP.name} (Round {round}, Turn {turnInRound + 1}/2)</div>
          </div>

          {/* Layout & Map Inspector ("ดู Layout ด่านไรพวกนั้น") */}
          <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <b style={{ fontSize: 14 }}>Layout {curLayout.number}: {deploymentName(curLayout.deployment)}</b>
                <div className="tiny muted">Attacker edge: {curLayout.attackerEdge} · {curLayout.objectives.length} objectives</div>
              </div>
              <button
                className="btn"
                style={{ fontSize: 12, minHeight: 32, padding: '2px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => setZoomMap(true)}
              >
                <Icon name="search" size={15} /> Zoom Map
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0', background: 'var(--surface-2)', borderRadius: 8 }}>
              <LayoutPreview layout={curLayout} width={260} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-3)' }}>
              <span>Red: Attacker Zone</span>
              <span>Blue: Defender Zone</span>
              <span>Circles: Objectives</span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn primary"
              style={{ minHeight: 46, fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => setSubView('player')}
            >
              <Icon name="fight" size={18} /> Return to {activeP.name}'s Turn
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                style={{ flex: 1, minHeight: 42, fontSize: 13 }}
                onClick={handleFinishAndSave}
                disabled={savedSuccess}
              >
                💾 Finish & Save Match
              </button>
              <button
                className="btn ghost"
                style={{ flex: 1, minHeight: 42, fontSize: 13 }}
                onClick={() => {
                  if (confirm('Start a new tabletop match setup?')) {
                    setMode('setup');
                    setSetupStep(1);
                  }
                }}
              >
                🔄 New Match Setup
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ZOOM MAP MODAL */}
      {zoomMap && (
        <div className="sheet-backdrop" onClick={() => setZoomMap(false)} role="dialog" aria-modal="true">
          <div
            className="sheet-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440, padding: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
          >
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
              <b style={{ fontSize: 15 }}>Layout {curLayout.number}: {deploymentName(curLayout.deployment)}</b>
              <button className="icon-btn" onClick={() => setZoomMap(false)} aria-label="Close">
                <Icon name="close" size={20} />
              </button>
            </div>
            <LayoutPreview layout={curLayout} width={340} />
            <div className="tiny muted">Dimensions: 44" × 60" · Standard 11th Edition Terrain Layout</div>
          </div>
        </div>
      )}
    </div>
  );
}
