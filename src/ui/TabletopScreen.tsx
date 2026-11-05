import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deploymentName,
  dispositionById,
  LAYOUTS,
  layoutsFor,
  MISSIONS,
  primaryFor,
  secondaryById,
  type DispositionId,
  type LayoutDef,
  type ScoringRule,
  type SecondaryDef,
} from '../engine/config';
import { saveBattleLog } from '../services/storage';
import { Emblem } from './ArmyBuilder';
import { type FactionIndex } from './data';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
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

interface ScoringPreset {
  vp: number;
  label: string;
}

/** Accurate mission card scoring options based on official Chapter Approved rules */
function getSecondaryScoringPresets(card: SecondaryDef): ScoringPreset[] {
  const id = card.id;
  switch (id) {
    case 'beacon':
      return [
        { vp: 3, label: 'Outside Deployment Zone (+3 VP)' },
        { vp: 5, label: 'Outside Your Territory (+5 VP)' },
      ];
    case 'cleanse':
      return [
        { vp: 2, label: '1 Objective Cleansed (+2 VP)' },
        { vp: 5, label: '2+ Objectives Cleansed (+5 VP)' },
      ];
    case 'burden-of-trust':
      return [
        { vp: 2, label: '1 Guarded Objective (+2 VP)' },
        { vp: 4, label: '2 Guarded Objectives (+4 VP)' },
        { vp: 5, label: 'Max Guarded (+5 VP)' },
      ];
    case 'defend-stronghold':
      return [
        { vp: 3, label: 'Home Held (+3 VP)' },
        { vp: 5, label: 'Home + Clear DZ (+5 VP)' },
      ];
    case 'engage-on-all-fronts':
      return [
        { vp: 2, label: '3 Quarters (+2 VP)' },
        { vp: 3, label: '3 Quarters Tac (+3 VP)' },
        { vp: 4, label: '4 Quarters (+4 VP)' },
        { vp: 5, label: '4 Quarters Tac (+5 VP)' },
      ];
    case 'behind-enemy-lines':
      return [
        { vp: 3, label: '1 Unit in Enemy DZ (+3 VP)' },
        { vp: 4, label: '2 Units in Enemy DZ (+4 VP)' },
        { vp: 5, label: 'Max in Enemy DZ (+5 VP)' },
      ];
    case 'centre-ground':
      return [
        { vp: 3, label: 'Center 3" (+3 VP)' },
        { vp: 5, label: 'Center 6" Clear (+5 VP)' },
      ];
    case 'outflank':
      return [
        { vp: 3, label: '1 Battlefield Edge (+3 VP)' },
        { vp: 5, label: '2 Opposite Edges (+5 VP)' },
      ];
    case 'display-of-might':
      return [
        { vp: 2, label: 'End Your Turn (+2 VP)' },
        { vp: 5, label: 'End Opponent Turn (+5 VP)' },
      ];
    case 'no-prisoners':
      return [
        { vp: 2, label: '1 Unit Destroyed (+2 VP)' },
        { vp: 4, label: '2 Units Destroyed (+4 VP)' },
        { vp: 5, label: '3+ Units Destroyed (+5 VP)' },
      ];
    case 'overwhelming-force':
      return [
        { vp: 3, label: '1 Unit on Obj Destroyed (+3 VP)' },
        { vp: 5, label: '2+ Units on Obj Destroyed (+5 VP)' },
      ];
    case 'assassination':
      return [
        { vp: 4, label: 'Character Model Destroyed (+4 VP)' },
        { vp: 5, label: 'All Characters / Tactical (+5 VP)' },
      ];
    case 'bring-it-down':
      return [
        { vp: 2, label: 'W10-14 Destroyed (+2 VP)' },
        { vp: 3, label: 'W15-19 Destroyed (+3 VP)' },
        { vp: 4, label: 'W20+ Destroyed (+4 VP)' },
        { vp: 5, label: 'Tactical Full (+5 VP)' },
      ];
    case 'a-grievous-blow':
      return [
        { vp: 4, label: 'Fixed (+4 VP)' },
        { vp: 5, label: 'Tactical (+5 VP)' },
      ];
    case 'secure-no-mans-land':
    case 'forward-position':
    case 'a-tempting-target':
    case 'plunder':
      return [
        { vp: 5, label: 'Achieved (+5 VP)' },
      ];
    default: {
      const parsed = getSecondaryVpOptions(card.text);
      return parsed.map((v) => ({ vp: v, label: `+${v} VP` }));
    }
  }
}

interface MatchSnapshot {
  round: number;
  activePlayer: 0 | 1;
  turnInRound: 0 | 1;
  players: [PlayerState, PlayerState];
  actionDesc: string;
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

  // Undo History Stack
  const [undoStack, setUndoStack] = useState<MatchSnapshot[]>([]);

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

  // Record a snapshot before mutating match state
  const recordSnapshot = (actionDesc: string) => {
    setUndoStack((prev) => [
      ...prev.slice(-20),
      {
        round,
        activePlayer,
        turnInRound,
        players: JSON.parse(JSON.stringify(players)),
        actionDesc,
      },
    ]);
  };

  // Undo last action
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRound(last.round);
    setActivePlayer(last.activePlayer);
    setTurnInRound(last.turnInRound);
    setPlayers(last.players);
    play('tick');
  };

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
    setUndoStack([]);
    setMode('battle');
    setSubView('player');
  };

  // Adjust Command Points (with undo snapshot)
  const handleAdjustCp = (pIdx: 0 | 1, delta: number) => {
    recordSnapshot(delta > 0 ? '+1 CP' : '-1 CP');
    updatePlayer(pIdx, (p) => ({ ...p, cp: Math.max(0, p.cp + delta) }));
    play('tick');
  };

  // Adjust Primary VP (with undo snapshot)
  const handleAdjustPrimaryVp = (pIdx: 0 | 1, delta: number) => {
    recordSnapshot(delta > 0 ? `+${delta} Primary VP` : `${delta} Primary VP`);
    updatePlayer(pIdx, (p) => ({ ...p, primaryVp: Math.max(0, Math.min(50, p.primaryVp + delta)) }));
    play('vp');
  };

  // Tactical Deck Actions (with undo snapshot)
  const handleDrawCard = (pIdx: 0 | 1) => {
    recordSnapshot('Draw secondary mission');
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

  // Score Secondary Card (Player chooses VP, with undo snapshot)
  const handleScoreCard = (pIdx: 0 | 1, cardId: string, vp: number) => {
    const cardName = secondaryById(cardId)?.name ?? cardId;
    recordSnapshot(`Score +${vp} VP (${cardName})`);
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

  // Return scored card back to hand if misclicked
  const handleUndoScore = (pIdx: 0 | 1, cardId: string, vp: number) => {
    const cardName = secondaryById(cardId)?.name ?? cardId;
    recordSnapshot(`Return ${cardName} to hand`);
    updatePlayer(pIdx, (p) => ({
      ...p,
      secondaryVp: Math.max(0, p.secondaryVp - vp),
      scoredMissions: p.scoredMissions.filter((id) => id !== cardId),
      discardedMissions: p.discardedMissions.filter((id) => id !== cardId),
      activeMissions: [...p.activeMissions, cardId],
    }));
    play('tick');
  };

  // Discard without modifying CP (Player manages CP manually, with undo snapshot)
  const handleDiscardCard = (pIdx: 0 | 1, cardId: string) => {
    const cardName = secondaryById(cardId)?.name ?? cardId;
    recordSnapshot(`Discard (${cardName})`);
    updatePlayer(pIdx, (p) => ({
      ...p,
      activeMissions: p.activeMissions.filter((id) => id !== cardId),
      discardedMissions: [...p.discardedMissions, cardId],
    }));
    play('tick');
  };

  // Free Redraw (Player manages CP on their own, does NOT deduct CP, with undo snapshot)
  const handleFreeRedraw = (pIdx: 0 | 1, cardId: string) => {
    const cardName = secondaryById(cardId)?.name ?? cardId;
    recordSnapshot(`Redraw (${cardName})`);
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

  // Turn Passing
  const handlePassTurn = () => {
    const otherPlayer: 0 | 1 = activePlayer === 0 ? 1 : 0;
    const otherName = otherPlayer === 0 ? p0Name : p1Name;

    if (turnInRound === 0) {
      // First turn completed, pass to second player in this round
      recordSnapshot(`Pass turn to ${otherName}`);
      setActivePlayer(otherPlayer);
      setTurnInRound(1);
      play('turn');
    } else {
      // Second turn completed, advance round!
      if (round < 5) {
        recordSnapshot(`End Round ${round} → Start Round ${round + 1}`);
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
  const activeDisp = activePlayer === 0 ? p0Disp : p1Disp;
  const opponentDisp = activePlayer === 0 ? p1Disp : p0Disp;
  const activePrimary = primaryFor(activeDisp, opponentDisp);
  const activeAction = activePrimary?.action ? MISSIONS.actions[activePrimary.action] : null;
  const p0Total = players[0].primaryVp + players[0].secondaryVp;
  const p1Total = players[1].primaryVp + players[1].secondaryVp;

  // ==========================================
  // RENDER: SETUP WIZARD (Steps 1, 2, 3)
  // ==========================================
  if (mode === 'setup') {
    return (
      <div className="app tabletop-companion" style={{ height: '100%', maxHeight: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header className="appbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ minWidth: 40, minHeight: 40 }}>
              <Icon name="back" size={20} />
            </button>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Tabletop Companion</div>
              <div className="tiny muted">11th Edition Match Setup</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThemeToggle />
            <span className="pill-att" style={{ fontSize: 11, padding: '3px 10px', background: 'var(--good-soft)', color: 'var(--good)', border: '1px solid var(--good)' }}>
              Step {setupStep} of 3
            </span>
          </div>
        </header>

        {/* Step Indicator */}
        <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--line-2)', flexShrink: 0 }}>
          <button
            className={`btn grow ${setupStep === 1 ? 'primary' : 'ghost'}`}
            style={{ minHeight: 34, fontSize: 11.5, padding: 0, fontWeight: 700 }}
            onClick={() => setSetupStep(1)}
          >
            1. Mission & Map
          </button>
          <button
            className={`btn grow ${setupStep === 2 ? 'primary' : 'ghost'}`}
            style={{ minHeight: 34, fontSize: 11.5, padding: 0, fontWeight: 700 }}
            onClick={() => setSetupStep(2)}
          >
            2. Players & Forces
          </button>
          <button
            className={`btn grow ${setupStep === 3 ? 'primary' : 'ghost'}`}
            style={{ minHeight: 34, fontSize: 11.5, padding: 0, fontWeight: 700 }}
            onClick={() => setSetupStep(3)}
          >
            3. Roll-Off
          </button>
        </div>

        <main className="screen" style={{ flex: '1 1 0%', minHeight: 0, padding: '14px 14px calc(48px + env(safe-area-inset-bottom, 20px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* STEP 1: FORCE DISPOSITIONS & PLAYABLE LAYOUTS (LOCKED TO MATCHUP) */}
          {setupStep === 1 && (
            <div className="tt-wizard">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>1. Force Dispositions & Battlefield Map</h3>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Select each player's Force Disposition. The system locks the 3 official tournament layouts for this pairing.
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
                    <span style={{ fontSize: 13, fontWeight: 800 }}>Official Tournament Layouts ({playableLayouts.length} Layouts)</span>
                    <div className="tiny muted">Locked to the 3 official 11th Edition layouts for this matchup</div>
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
                        <Icon name="search" size={13} /> Inspect Layout
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
                Next: Players & Forces →
              </button>
            </div>
          )}

          {/* STEP 2: PLAYERS & FACTIONS (CLEAN, SLEEK & COMPACT) */}
          {setupStep === 2 && (
            <div className="tt-wizard">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>2. Players & Factions</h3>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Set player names and choose army factions for each side.
                </p>
              </div>

              {/* Player 1 Card */}
              <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Emblem factionId={p0Faction} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)' }}>Player 1 Name</label>
                      <input
                        type="text"
                        className="input"
                        value={p0Name}
                        onChange={(e) => setP0Name(e.target.value)}
                        placeholder="Player 1"
                        style={{ width: '100%', marginTop: 3, padding: '7px 10px', fontSize: 14 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)' }}>Faction</label>
                      <select
                        className="input"
                        value={p0Faction}
                        onChange={(e) => setP0Faction(e.target.value)}
                        style={{ width: '100%', marginTop: 3, padding: '7px 10px', fontSize: 13.5, fontWeight: 700, background: 'var(--surface-2)', color: 'var(--text)' }}
                      >
                        {factionList.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} ({f.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Player 2 Card */}
              <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Emblem factionId={p1Faction} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)' }}>Player 2 Name</label>
                      <input
                        type="text"
                        className="input"
                        value={p1Name}
                        onChange={(e) => setP1Name(e.target.value)}
                        placeholder="Player 2"
                        style={{ width: '100%', marginTop: 3, padding: '7px 10px', fontSize: 14 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)' }}>Faction</label>
                      <select
                        className="input"
                        value={p1Faction}
                        onChange={(e) => setP1Faction(e.target.value)}
                        style={{ width: '100%', marginTop: 3, padding: '7px 10px', fontSize: 13.5, fontWeight: 700, background: 'var(--surface-2)', color: 'var(--text)' }}
                      >
                        {factionList.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} ({f.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn ghost" style={{ minHeight: 46, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setSetupStep(1)}>
                  <Icon name="back" size={14} /> Back to Map Selection
                </button>
                <button
                  className="btn primary grow"
                  style={{ minHeight: 46, fontSize: 14, fontWeight: 800, flex: 2 }}
                  onClick={() => setSetupStep(3)}
                >
                  Next: Roll-Off →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: ROLL-OFF & DEPLOYMENT / FIRST TURN (WITH TUMBLING DICE ANIMATION) */}
          {setupStep === 3 && (
            <div className="tt-wizard">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>3. Roll-Off & Turn Order</h3>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Roll D6 to determine deployment priority (Attacker) and Turn 1 order.
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
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textAlign: 'center' }}>
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
                <button className="btn ghost" style={{ minHeight: 48, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setSetupStep(2)}>
                  <Icon name="back" size={14} /> Back to Players
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
                  style={{ minHeight: 40, fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => {
                    setSelectedLayoutId(inspectLayout.id);
                    setInspectLayout(null);
                  }}
                >
                  <Icon name="check" size={14} /> Select Layout {inspectLayout.number}
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
    <div className="app tabletop-companion" style={{ height: '100%', maxHeight: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top Header */}
      <header className="appbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', flexShrink: 0 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ThemeToggle />
          {undoStack.length > 0 && (
            <button
              className="btn"
              style={{
                minHeight: 34,
                padding: '2px 10px',
                fontSize: 12,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(239, 68, 68, 0.14)',
                color: '#f87171',
                borderColor: 'rgba(239, 68, 68, 0.35)',
              }}
              onClick={handleUndo}
              title={`Undo last action: ${undoStack[undoStack.length - 1].actionDesc}`}
            >
              <Icon name="back" size={14} /> Undo
            </button>
          )}

          {subView === 'player' ? (
            <button
              className="btn"
              style={{ minHeight: 36, padding: '4px 12px', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)' }}
              onClick={() => setSubView('overview')}
            >
              <Icon name="map" size={15} /> Battlefield & Layout
            </button>
          ) : (
            <button
              className="btn primary"
              style={{ minHeight: 36, padding: '4px 12px', fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setSubView('player')}
            >
              <Icon name="fight" size={15} /> Return to {activeP.name}'s Turn
            </button>
          )}

          <button
            className="btn ghost"
            style={{ minHeight: 36, padding: '4px 10px', fontSize: 12 }}
            onClick={handleFinishAndSave}
            disabled={savedSuccess}
            title="Finish and record match to Battle History"
          >
            {savedSuccess ? 'Saved!' : 'End Game'}
          </button>
        </div>
      </header>

      {/* VIEW 1: ACTIVE PLAYER VIEW (Dedicated per player) */}
      {subView === 'player' && (
        <main className="screen" style={{ flex: '1 1 0%', minHeight: 0, padding: '12px 14px calc(48px + env(safe-area-inset-bottom, 20px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                <div className="tt-player-name">
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
                onClick={() => handleAdjustCp(activePlayer, -1)}
              >
                -
              </button>
              <span className="num" style={{ fontSize: 24, fontWeight: 900, minWidth: 32, textAlign: 'center' }}>
                {activeP.cp}
              </span>
              <button
                className="btn primary"
                style={{ minWidth: 36, minHeight: 36, padding: 0, fontSize: 18, fontWeight: 800 }}
                onClick={() => handleAdjustCp(activePlayer, 1)}
              >
                +
              </button>
            </div>
          </div>

          {/* Section 2: Primary Mission Objective & Scoring */}
          <div className="card" style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 850, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                    PRIMARY OBJECTIVE
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: '1px 7px',
                      borderRadius: 4,
                      background: 'var(--surface-2)',
                      color: 'var(--text)',
                      border: '1px solid var(--line-2)',
                    }}
                  >
                    {dispositionById(activeDisp).name}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', letterSpacing: '0.02em' }}>
                  {activePrimary ? activePrimary.name : 'Primary Mission'}
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="tiny muted">PRIMARY VP</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--accent)', lineHeight: 1 }}>
                  {activeP.primaryVp} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>/ 50</span>
                </div>
              </div>
            </div>

            {/* What to do for Primary Objective */}
            <div
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--line-2)',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="hold" size={14} /> How to score Primary:
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activePrimary?.scoring.map((r: ScoringRule, i: number) => {
                  const whenLabel =
                    r.when === 'endOfYourCommandPhase' ? 'Command Phase' :
                    r.when === 'endOfYourTurn' ? 'End of Turn' :
                    r.when === 'endOfBattle' ? 'End of Battle' : r.when;
                  const roundLabel = r.rounds ? `Round ${r.rounds[0]}–${r.rounds[1]}` : 'All Rounds';

                  return (
                    <div
                      key={i}
                      style={{
                        padding: '6px 8px',
                        background: 'var(--surface)',
                        border: '1px solid var(--line)',
                        borderLeft: '3px solid var(--accent)',
                        borderRadius: '0 6px 6px 0',
                        fontSize: 12.5,
                        lineHeight: 1.4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="wait" size={12} /> {roundLabel} · {whenLabel}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#10b981' }}>
                          +{r.vp} VP
                        </span>
                      </div>
                      <div style={{ color: 'var(--text)' }}>{r.text}</div>
                      {r.bonusText && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="star" size={12} /> <i>Bonus:</i></span> {r.bonusText} {r.bonus?.vp ? `(+${r.bonus.vp} VP)` : ''}
                        </div>
                      )}
                    </div>
                  );
                })}

                {activeAction && (
                  <div
                    style={{
                      padding: '6px 8px',
                      background: 'var(--p0-soft)',
                      border: '1px solid var(--line)',
                      borderLeft: '3px solid var(--p0)',
                      borderRadius: '0 6px 6px 0',
                      fontSize: 12,
                      lineHeight: 1.4,
                      color: 'var(--text)',
                    }}
                  >
                    <b>Action: {activeAction.name}</b> (Starts: {activeAction.starts} phase) — {activeAction.text}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Primary VP Adjustment Steppers */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 6 }}>
                Record Primary VP (Adjust Score):
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {[2, 3, 4, 5].map((vp) => (
                  <button
                    key={vp}
                    className="btn"
                    style={{ minHeight: 38, fontSize: 13, fontWeight: 700, padding: 2, background: 'var(--surface-2)', borderColor: 'var(--line-2)', color: 'var(--text)' }}
                    onClick={() => handleAdjustPrimaryVp(activePlayer, vp)}
                  >
                    +{vp} VP
                  </button>
                ))}
                <button
                  className="btn"
                  style={{ minHeight: 38, fontSize: 13, fontWeight: 700, padding: 2, color: 'var(--bad)', borderColor: 'color-mix(in srgb, var(--bad) 30%, transparent)', background: 'var(--bad-soft)' }}
                  onClick={() => handleAdjustPrimaryVp(activePlayer, -1)}
                  title="-1 VP"
                >
                  -1 VP
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Tactical Secondary Mission Deck */}
          <div className="card" style={{ padding: '16px', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#38bdf8' }}>
                  SECONDARY MISSIONS · TACTICAL
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', letterSpacing: '0.02em', marginTop: 2 }}>
                  Tactical Secondaries
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="tiny muted">SECONDARY VP</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#38bdf8', lineHeight: 1 }}>
                  {activeP.secondaryVp} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>/ 40</span>
                </div>
                <div className="tiny muted" style={{ marginTop: 2 }}>{activeP.deck.length} in deck</div>
              </div>
            </div>

            {/* What to do for Secondary Missions banner */}
            <div
              style={{
                background: 'var(--p0-soft)',
                border: '1px solid color-mix(in srgb, var(--p0) 25%, transparent)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 12.5,
                color: 'var(--text)',
                lineHeight: 1.5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <span style={{ color: 'var(--p0)', flexShrink: 0, marginTop: 1 }}><Icon name="info" size={15} /></span>
              <span><b>How to score Secondary:</b> Draw up to 2 active secondary mission cards. Complete the conditions stated on each card during your turn. When completed, tap the green score button to claim VP. If you need to change cards, tap <b>Redraw</b> or <b>Discard</b> at no CP cost (manage CP points manually above).</span>
            </div>

            {activeP.activeMissions.length < 2 && (
              <button
                className="btn primary"
                style={{ minHeight: 38, padding: '4px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 800 }}
                onClick={() => handleDrawCard(activePlayer)}
                disabled={activeP.deck.length === 0}
              >
                <Icon name="cards" size={16} /> Draw Secondary Mission ({activeP.deck.length} left)
              </button>
            )}

            {/* Active Secondary Cards */}
            {activeP.activeMissions.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: 'var(--surface-2)',
                  borderRadius: 8,
                  border: '1.5px dashed var(--line-2)',
                  color: 'var(--text-2)',
                }}
              >
                <div style={{ color: 'var(--accent)', opacity: 0.75, marginBottom: 6 }}>
                  <Icon name="cards" size={32} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>No Secondary Missions in Hand</div>
                <div className="small muted" style={{ marginTop: 4, color: 'var(--text-2)' }}>Tap <b>Draw Secondary Mission</b> above to draw cards for your turn.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {activeP.activeMissions.map((cardId) => {
                  const card = secondaryById(cardId);
                  if (!card) return null;
                  const presets = getSecondaryScoringPresets(card);

                  return (
                    <div
                      key={cardId}
                      className="sec-mission-real-card"
                      style={{
                        background: 'var(--paper, #fdfbf7)',
                        color: '#1c1917',
                        border: '2px solid var(--paper-edge, #c8b79b)',
                        borderRadius: 12,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.22), inset 0 0 0 1px rgba(255,255,255,0.7)',
                        padding: '14px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Top Header: Category Tag & Status Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ font: '800 11px var(--font-cond)', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#854d0e' }}>
                          SECONDARY MISSION · TACTICAL
                        </span>
                        <span
                          className="sec-status-badge completed"
                          style={{
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#047857',
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            fontWeight: 800,
                            fontSize: 11,
                            padding: '2px 7px',
                            borderRadius: 4,
                          }}
                        >
                          READY TO SCORE
                        </span>
                      </div>

                      {/* Card Title */}
                      <div
                        style={{
                          font: '900 20px/1.15 var(--font-cond)',
                          letterSpacing: '0.03em',
                          textTransform: 'uppercase',
                          color: '#1c1917',
                          paddingBottom: 6,
                          borderBottom: '2px solid #d5c8b2',
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span>{card.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#854d0e', letterSpacing: '0.04em' }}>
                          MAX 5 VP
                        </span>
                      </div>

                      {/* Timing Banner with Icon */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          font: '700 12px var(--font-cond)',
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: '#8a2a20',
                        }}
                      >
                        <Icon name="wait" size={13} /> {card.when}
                      </div>

                      {/* Card Text Body (Parchment Inset) - Explains What To Do */}
                      <div
                        style={{
                          background: 'var(--surface-2)',
                          border: '1px dashed var(--line-2)',
                          borderRadius: 6,
                          padding: '10px 12px',
                          fontSize: 13,
                          lineHeight: 1.45,
                          color: 'var(--text)',
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#78350f', marginBottom: 4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="objective" size={13} /> Mission Requirements:
                        </div>
                        {card.text}
                      </div>

                      {/* Scoring Section */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ font: '800 11.5px var(--font-cond)', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#57534e' }}>
                            Score this Mission:
                          </span>
                          <span className="tiny" style={{ color: '#78716c' }}>
                            Tap to score VP
                          </span>
                        </div>

                        {/* Presets / Criteria Score Buttons */}
                        {presets.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {presets.map((preset) => (
                              <button
                                key={preset.label}
                                className="btn primary"
                                style={{
                                  flex: 1,
                                  minWidth: '45%',
                                  minHeight: 38,
                                  fontSize: 12.5,
                                  fontWeight: 800,
                                  padding: '4px 10px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 6,
                                  background: '#15803d',
                                  borderColor: '#166534',
                                  color: '#fff',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
                                }}
                                onClick={() => handleScoreCard(activePlayer, cardId, preset.vp)}
                              >
                                <Icon name="check" size={13} /> {preset.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Card Management Footer: Free Discard & Free Redraw (No CP change) */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 8,
                          borderTop: '1px solid #d5c8b2',
                          paddingTop: 8,
                          marginTop: 4,
                        }}
                      >
                        <button
                          className="btn ghost"
                          style={{
                            minHeight: 32,
                            fontSize: 12,
                            fontWeight: 600,
                            padding: '2px 14px',
                            color: '#78716c',
                            borderColor: '#d5c8b2',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                          onClick={() => handleDiscardCard(activePlayer, cardId)}
                          title="Discard this mission card without modifying CP"
                        >
                          <Icon name="delete" size={14} /> Discard
                        </button>

                        <button
                          className="btn"
                          style={{
                            minHeight: 32,
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '2px 16px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            borderColor: '#bae6fd',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                          onClick={() => handleFreeRedraw(activePlayer, cardId)}
                          title="Redraw: Discard and draw a replacement card without deducting CP"
                        >
                          <Icon name="reroll" size={14} /> Redraw
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* TURN PASSING ACTION BUTTON */}
          <div style={{ marginTop: 'auto', paddingTop: 8, paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 16px))', display: 'flex', gap: 8 }}>
            {undoStack.length > 0 && (
              <button
                className="btn ghost"
                style={{
                  minHeight: 46,
                  padding: '0 14px',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#f87171',
                  borderColor: 'rgba(239, 68, 68, 0.35)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
                onClick={handleUndo}
                title="Undo last action if tapped by mistake"
              >
                <Icon name="back" size={14} /> Undo
              </button>
            )}
            <button
              className="btn primary tt-pass-turn-btn"
              style={{ flex: 1, minHeight: 46 }}
              onClick={handlePassTurn}
            >
              {turnInRound === 0 ? (
                <>
                  <span>PASS TURN TO {otherP.name.toUpperCase()}</span>
                  <Icon name="next" size={20} />
                </>
              ) : round < 5 ? (
                <>
                  <span>END ROUND {round} → START ROUND {round + 1}</span>
                  <Icon name="next" size={20} />
                </>
              ) : (
                <>
                  <span>FINISH MATCH & FINALIZE SCORE</span>
                  <Icon name="trophy" size={20} />
                </>
              )}
            </button>
          </div>
        </main>
      )}

      {/* VIEW 2: TABLE OVERVIEW & LAYOUT INSPECTOR */}
      {subView === 'overview' && (
        <main className="screen" style={{ flex: '1 1 0%', minHeight: 0, padding: '14px 14px calc(48px + env(safe-area-inset-bottom, 20px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', gap: 14 }}>
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

          {/* Scored Missions List with Recovery */}
          <div className="card" style={{ padding: '14px', background: 'var(--surface)', border: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Scored Secondary Missions History</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* Player 0 Scored */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)' }}>{players[0].name} ({players[0].scoredMissions.length} scored)</div>
                {players[0].scoredMissions.length === 0 ? (
                  <div className="tiny muted">No scored missions yet</div>
                ) : (
                  players[0].scoredMissions.map((id) => (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'var(--surface-2)', borderRadius: 4, fontSize: 11.5 }}>
                      <span>{secondaryById(id)?.name ?? id}</span>
                      <button
                        className="btn ghost"
                        style={{ minHeight: 24, padding: '1px 6px', fontSize: 10.5, color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        onClick={() => handleUndoScore(0, id, 5)}
                        title="Return this card to hand and refund VP"
                      >
                        <Icon name="reroll" size={11} /> Return Card
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Player 1 Scored */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)' }}>{players[1].name} ({players[1].scoredMissions.length} scored)</div>
                {players[1].scoredMissions.length === 0 ? (
                  <div className="tiny muted">No scored missions yet</div>
                ) : (
                  players[1].scoredMissions.map((id) => (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'var(--surface-2)', borderRadius: 4, fontSize: 11.5 }}>
                      <span>{secondaryById(id)?.name ?? id}</span>
                      <button
                        className="btn ghost"
                        style={{ minHeight: 24, padding: '1px 6px', fontSize: 10.5, color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        onClick={() => handleUndoScore(1, id, 5)}
                        title="Return this card to hand and refund VP"
                      >
                        <Icon name="reroll" size={11} /> Return Card
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Deployment & Matchup Info */}
          <div className="card" style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line-2)', fontSize: 12.5, lineHeight: 1.5 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Match Parameters</div>
            <div><b>Attacker (Deploys first):</b> {attackerPlayer === 0 ? players[0].name : players[1].name}</div>
            <div><b>Defender:</b> {attackerPlayer === 0 ? players[1].name : players[0].name}</div>
            <div><b>First Turn (Turn 1):</b> {firstTurnPlayer === 0 ? players[0].name : players[1].name}</div>
            <div><b>Active Turn:</b> {activeP.name} (Round {round}, Turn {turnInRound + 1}/2)</div>
          </div>

          {/* Layout & Map Inspector */}
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
                <Icon name="search" size={15} /> Expand Layout View
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
                style={{ flex: 1, minHeight: 42, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={handleFinishAndSave}
                disabled={savedSuccess}
              >
                <Icon name="save" size={14} /> End Match & Save History
              </button>
              <button
                className="btn ghost"
                style={{ flex: 1, minHeight: 42, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={() => {
                  if (confirm('Return to match setup to change settings?')) {
                    setMode('setup');
                    setSetupStep(1);
                  }
                }}
              >
                <Icon name="gear" size={14} /> Modify Match Setup
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
