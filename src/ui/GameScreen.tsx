import { autoCharges, autoDeclareCharge, autoDue, autoEndMovement, autoSelectToShoot, autoShoot, autoStep, onAuto } from '../engine/autoPlay';
import { pathBlocked, routeAround } from '../engine/pathing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { chapterRules } from '../engine/army';
import { RuleText } from './RuleText';
import { Em } from './Em';
import {
  applyMortalWounds, buildFightPools, buildShootPools, expectedDamage, finishAttack, meleeWeapons, rerollOne, resolveAll, shootingModes, startAttack, stepAttack,
  type ShootMode,
} from '../engine/attack';
import { deploymentById, dispositionById, MISSIONS, primaryById, RULES, secondaryById, type DispositionId } from '../engine/config';
import { rollN } from '../engine/dice';
import {
  autoApproach, autoCharge, autoPileMove, bestLd, canIngress, chargeEligibility, chargeTargetOptions, closeWindow, commitCharge, commitMove, consolidateEligible, consolidateMode,
  counteroffensiveCandidates, crushingImpact, declareCharge, deployUnit, endConsolidateStep, endPhase, endPileInStep, fightCandidates, findPlacement,
  formationAt, heroicCandidates, ingressUnit, ringFormation, markFought, maxMoveDistance, objectiveTerrain, openCounteroffensive, overwatchCandidates, pileInEligible,
  rapidIngressCandidates, remainStationary, rerollCharge, rollAdvance, rollBattleShock, sendToReserves, smokescreenCandidates, useCounteroffensive,
  validateMove, validatePlacement, type MoveCheck, hasArmyRule, setOathTarget, callWaaagh, isRiledUp, unitHasAbility,
  canEmbarkIn, embarkUnit, disembarkMode, disembarkUnit, validateDisembark, embarkedIn, scoutUnits, endScouts, transportSpaceUsed,
  claimSecondary, discardSecondary, swapSecondary, chooseFixedSecondaries, settleMove, canDetReroll, detReroll,
  beginMove, hasDeepStrike, setOathBackup, arrivalRound,
  pileDistance, endRedeploy, redeployCandidates, redeployUnit } from '../engine/game';
import {
  abilityChoices, acceptOffer, closeOffers, freeDiceNow, manualActs, pickAbilities, unitSelected, useActByKey, useFreeDie, type Trigger,
} from '../engine/activations';
import { activeLabels, unitFlags } from '../engine/effects';
import { detChoices, detSummary, pickDetChoice } from '../engine/detachments';
import { botAct, botShouldAct, botStep } from '../engine/bot';
import { applyStyle, setLookahead, styleChosen } from '../engine/botLook';
import LookWorker from './lookWorker?worker&inline';
import { actionOptions, startAction } from '../engine/missions';
import { Icon } from './Icon';
import { RollOverlay, SecondaryCard } from './RollOverlay';
import { secondaryDead, secondaryGoal, secondaryPreview } from '../engine/secondaries';
import { EFFECT_LABEL, stratagemBlock, stratagemsNow, applyDetachmentStratagem, answerReaction, stratCandidates, stratRuleFor } from '../engine/stratagems';
import { StratUseCard } from './StratUse';
import { endUnitShooting, rangedWeaponNames, rerollAttackCount, toggleRerollPick } from '../engine/attack';
import { polyCentroid } from '../engine/geometry';
import { smartPlacement } from '../engine/deploy';
import {
  alive, boardUnits, canUseStratagem, engagedEnemies, hasKw, isEngaged, onBoard, other, spendStratagem, stratCost, strength, unitById, unitDistance,
} from '../engine/state';
import type { BuffKind, GameState, ModelState, MoveKind, PlayerId, Pt, UnitState } from '../engine/types';
import { hasCover, hasLos, isHidden, modelVisible, unitVisibleTo } from '../engine/visibility';
import { baseDist } from '../engine/geometry';
import { Portrait, unitToken } from './Tokens';
import { isMelee, hasAbility } from '../engine/weapons';
import { Board, type Paths, type Ring } from './Board';
import { DiceTray } from './DiceTray';
import { UnitView } from './Sheet';
import { useGame } from './store';

type Mode =
  | { k: 'place'; unitId: string; how: 'deploy' | 'infiltrate' | 'ingress' | 'deepStrike' | 'disembark'; rapid?: boolean | 'free'; transportId?: string }
  | { k: 'move'; unitId: string; kind: 'normal' | 'advance' | 'fallback' | 'scout' | 'extra' | 'surge'; fly: boolean }
  | { k: 'shoot'; unitId: string; smode: ShootMode; target: string | null; useCQ: boolean; profile: Record<string, number>; overwatch?: boolean; skip?: string[] }
  | { k: 'charge'; unitId: string; targets: string[]; heroic?: 'leap' | 'fray' }
  | { k: 'pile'; unitId: string; kind: 'pileIn' | 'consolidate'; overrun?: boolean }
  | { k: 'fight'; unitId: string; target: string | null; weapon?: string; epic: boolean }
  | { k: 'explosives'; unitId: string; target: string | null }
  | { k: 'crush'; unitId: string };

const PHASE_TH: Record<string, string> = {
  deploy: 'DEPLOYMENT', command: 'COMMAND', movement: 'MOVEMENT', shooting: 'SHOOTING', charge: 'CHARGE', fight: 'FIGHT', gameover: 'GAME OVER', formations: 'FORMATIONS',
};

const BUFFS: { kind: BuffKind; label: string }[] = [
  { kind: 'hit+1', label: '+1 Hit' }, { kind: 'hit-1', label: '−1 Hit' }, { kind: 'rerollHits1', label: 'Re-roll Hit 1' }, { kind: 'rerollHits', label: 'Re-roll Hits' },
  { kind: 'wound+1', label: '+1 Wound' }, { kind: 'rerollWounds1', label: 'Re-roll Wound 1' }, { kind: 'rerollWounds', label: 'Re-roll Wounds' },
  { kind: 'ap+1', label: '+1 AP' }, { kind: 'lethal', label: 'Lethal Hits' }, { kind: 'sustained1', label: 'Sustained 1' }, { kind: 'devastating', label: 'Dev Wounds' },
  { kind: 'ignoresCover', label: 'Ignores Cover' }, { kind: 'save+1', label: '+1 Save' }, { kind: 'fnp5', label: 'FNP 5+' }, { kind: 'fnp6', label: 'FNP 6+' }, { kind: 'damage-1', label: '−1 Damage' },
];

const startPaths = (u: UnitState): Paths => new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));
const placePaths = (pos: Map<string, Pt>): Paths => new Map([...pos].map(([id, p]) => [id, [p]]));
const lastPos = (d: Paths): Map<string, Pt> => new Map([...d].map(([id, p]) => [id, p[p.length - 1]]));
const mergePaths = (base: Paths, add: Paths): Paths => { const o = new Map(base); for (const [k, v] of add) o.set(k, v); return o; };
const pName = (s: GameState, p: PlayerId) => s.players[p].name;

export function GameScreen({ initial, onExit }: { initial: GameState; onExit: () => void }) {
  const { state: s, act, undo, canUndo } = useGame(initial);
  const bots: PlayerId[] = s.bots ?? (s.botPlayer != null ? [s.botPlayer] : []);
  const spectate = bots.length === 2;
  const actingBot = bots.find((b) => botShouldAct(s, b)) ?? null;
  // the bot that matters for labels: the one acting now, else the single bot
  const bot: PlayerId | null = actingBot ?? (bots.length === 1 ? bots[0] : null);
  const [speed, setSpeed] = useState<0 | 1 | 2>(1); // bot-vs-bot: pause / normal / fast
  const [showMenu, setShowMenu] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [cardSide, setCardSide] = useState<PlayerId | null>(null); // whose cards the card viewer shows
  const [showGoals, setShowGoals] = useState(true);
  const [showMissions, setShowMissions] = useState(false);

  // engine errors become a message instead of a crash
  useEffect(() => {
    const onErr = (e: Event) => flash(`Not allowed: ${(e as CustomEvent).detail}`);
    window.addEventListener('game-error', onErr);
    return () => window.removeEventListener('game-error', onErr);
  });

  // single-player: let the bot take its steps one at a time so the board animates; caption what it just did
  const [botSays, setBotSays] = useState<string | null>(null);
  const [botWho, setBotWho] = useState<PlayerId | null>(null);
  const [rolling, setRolling] = useState(false); // a big dice roll is on screen: the bot waits for it
  // the bot looks ahead (plays its turn a few ways on copies) in a worker; the main thread never rolls out itself
  const [thinking, setThinking] = useState(false);
  const [stepping, setStepping] = useState(false); // the worker is working out the bot's next step
  const stepOnMain = useRef(false); // the worker failed once: the bot thinks on the main thread from then on
  const styleRef = useRef<{ p: PlayerId; name: string } | null>(null); // the style the bot picked for this turn
  const sRef = useRef(s);
  sRef.current = s;
  const worker = useMemo(() => {
    setLookahead(false);
    try { return new LookWorker(); } catch { return null; }
  }, []);
  useEffect(() => () => worker?.terminate(), [worker]);
  useEffect(() => {
    if (!bots.length || rolling || thinking || stepping || s.phase === 'gameover' || (spectate && speed === 0)) return;
    const who = actingBot;
    // start of a bot's Movement phase: pick how to play the turn before moving anything
    if (who !== null && s.phase === 'movement' && s.active === who && !styleChosen(s)) {
      const done = (name: string) => { setThinking(false); styleRef.current = { p: who, name }; act((g) => { if (!styleChosen(g)) applyStyle(g, who, name); }); };
      if (!worker) { done('steady'); return; }
      setThinking(true);
      setBotSays(`${pName(s, who)} is thinking ahead…`); setBotWho(who);
      const id = Math.random();
      const fallback = window.setTimeout(() => { worker.onmessage = null; done('steady'); }, 9000);
      worker.onmessage = (e: MessageEvent<{ id: number; name: string }>) => {
        if (e.data.id !== id) return;
        window.clearTimeout(fallback);
        worker.onmessage = null;
        done(e.data.name);
      };
      worker.onerror = () => { window.clearTimeout(fallback); worker.onmessage = null; done('steady'); };
      try { worker.postMessage({ state: s, p: who, id }); } catch { window.clearTimeout(fallback); done('steady'); }
      return;
    }
    // bot-vs-bot: nobody "has" the step (e.g. ending the fight phase) — let the driver move the game on
    const drive = who === null && spectate && !s.attack;
    if (who === null && !drive) {
      if (!botSays) return;
      const t = window.setTimeout(() => setBotSays(null), 2200);
      return () => window.clearTimeout(t);
    }
    const quick = s.phase === 'deploy' || s.phase === 'scouts' || s.phase === 'command';
    const delay = (quick ? 350 : 950) / (spectate && speed === 2 ? 3 : 1);
    const caption = (before: GameState, after: GameState) => {
      const fresh = after.log.slice(before.log.length).filter((e) => e.kind !== 'roll' || /charge|Advance/i.test(e.text));
      if (fresh.length) { setBotSays(fresh[fresh.length - 1].text); setBotWho(fresh[fresh.length - 1].player); }
    };
    const onMain = () => {
      const before = sRef.current;
      const after = act((g) => { if (who === null) botAct(g); else botStep(g, who); return g; });
      if (after) caption(before, after);
    };
    const t = window.setTimeout(() => {
      // the bot's thinking (a unit's move can take a second or more on a phone) runs in the worker: the screen stays live
      if (!worker || stepOnMain.current) { onMain(); return; }
      const sent = s;
      const id = Math.random();
      setStepping(true);
      const giveUp = window.setTimeout(() => { worker.onmessage = null; setStepping(false); stepOnMain.current = true; if (sRef.current === sent) onMain(); }, 20000);
      worker.onmessage = (e: MessageEvent<{ id: number; state: GameState | null; error?: string | null }>) => {
        if (e.data.id !== id) return;
        window.clearTimeout(giveUp);
        worker.onmessage = null;
        setStepping(false);
        if (sRef.current !== sent) return; // the game changed meanwhile (undo …): the next round of this effect asks again
        const next = e.data.state;
        if (!next) { stepOnMain.current = true; onMain(); return; }
        act((g) => { Object.assign(g, next); });
        caption(sent, next);
      };
      try { worker.postMessage({ kind: 'step', state: s, who, id, style: styleRef.current ?? undefined }); }
      catch { window.clearTimeout(giveUp); worker.onmessage = null; setStepping(false); stepOnMain.current = true; onMain(); }
    }, delay);
    return () => window.clearTimeout(t);
  }, [s, actingBot, act, botSays, rolling, thinking, stepping, worker, speed, spectate, bots.length]);
  // auto rules: the player only moves and shoots; the app takes every other decision of theirs as it comes up
  const autoWho = ([0, 1] as PlayerId[]).find((p) => autoDue(s, p)) ?? null;
  useEffect(() => {
    if (autoWho === null || rolling || thinking) return;
    const t = window.setTimeout(() => {
      let said: string | null = null;
      act((g) => {
        const last = g.log[g.log.length - 1];
        autoStep(g, autoWho);
        const fresh = g.log.slice(g.log.lastIndexOf(last) + 1).filter((e) => e.kind !== 'roll' && e.player === autoWho);
        said = fresh.length ? fresh[fresh.length - 1].text : null;
      });
      if (said) {
        const msg = `Auto: ${said}`;
        setBotSays(msg); setBotWho(autoWho);
        window.setTimeout(() => setBotSays((x) => (x === msg ? null : x)), 2600);
      }
    }, s.phase === 'fight' ? 700 : 300);
    return () => window.clearTimeout(t);
  }, [s, autoWho, rolling, thinking]); // eslint-disable-line react-hooks/exhaustive-deps
  // pile-in / consolidate on the player's side: every unit moves in by itself (as many models into the fight as
  // possible); the step ends by itself unless a fight-start ability is waiting to be used
  const pileKey = s.fight && (s.fight.step === 'pileIn' || s.fight.step === 'consolidate') ? `${s.turn}:${s.fight.step}:${s.fight.stepPlayer}` : null;
  useEffect(() => {
    if (!pileKey || s.manualPile || s.attack || s.window) return;
    const f = s.fight!;
    if (bots.includes(f.stepPlayer) || onAuto(s, f.stepPlayer)) return;
    const kind = f.step === 'pileIn' ? 'pileIn' : 'consolidate';
    const t = window.setTimeout(() => {
      const res = act((g) => {
        const gf = g.fight!;
        const units = boardUnits(g, gf.stepPlayer).filter((u) => !gf.movedThisStep.includes(u.id)
          && (kind === 'pileIn' ? pileInEligible(g, u) : consolidateEligible(g, u) && consolidateMode(g, u).mode));
        const moved = units.filter((u) => autoPileMove(g, u, kind)).map((u) => u.name);
        const waiting = kind === 'pileIn' && manualActs(g, gf.stepPlayer).some((m) => ['fightStartButton'].includes(m.def.spec.when));
        if (!waiting) { if (kind === 'pileIn') endPileInStep(g); else endConsolidateStep(g); }
        return { moved, waiting };
      });
      if (res.moved.length) flash(`${kind === 'pileIn' ? 'Pile-in' : 'Consolidate'} (auto): ${res.moved.join(', ')}`);
    }, 450);
    return () => window.clearTimeout(t);
  }, [pileKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sel, setSel] = useState<string | null>(null);
  const [mode, setModeRaw] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<Paths | null>(null);
  const [check, setCheck] = useState<MoveCheck | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showBuffs, setShowBuffs] = useState(false);
  const [fly, setFly] = useState(false);
  const [showStrats, setShowStrats] = useState(false);
  const [stratUnit, setStratUnit] = useState<string>('');
  const [stratPlayer, setStratPlayer] = useState<PlayerId | null>(null); // whose stratagems the sheet shows (null = who acts now)
  // the bot decides its own CP: against the bot the sheet always shows the player's own stratagems
  const human: PlayerId | null = bots.length === 1 ? (bots[0] === 0 ? 1 : 0) : null;
  const openStrats = (p: PlayerId | null = null) => {
    const who = p !== null && !bots.includes(p) ? p : human ?? p;
    setStratPlayer(who); setStratUnit(sel && s.units.find((u) => u.id === sel)?.owner === (who ?? actor) ? sel : ''); setShowStrats(true);
  };
  const [freeAdvRR, setFreeAdvRR] = useState<string | null>(null);

  const setMode = (m: Mode | null, d: Paths | null = null) => { setModeRaw(m); setDraft(d); setCheck(null); };
  // ending a phase where nothing was done needs a second tap (protects against mis-taps)
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => { if (!armed) return; const tm = window.setTimeout(() => setArmed(null), 3500); return () => window.clearTimeout(tm); }, [armed]);
  const endButton = (key: string, label: string, idle: boolean, why: string) => (
    <div className="sticky-act">
      <button className={`btn primary big wide ${armed === key ? 'armed' : ''}`} onClick={() => {
        if (idle && armed !== key) { setArmed(key); flash(`${why} — tap again to confirm`); return; }
        setArmed(null);
        act((g) => { if (g.phase === 'movement') autoEndMovement(g, g.active); endPhase(g); }); setSel(null); setMode(null);
      }}>{armed === key ? `Confirm ${label}?` : label} <Icon name="next" /></button>
    </div>
  );
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? null : x)), 2600); };
  const U = (id: string) => unitById(s, id);

  // Who has to act right now (hotseat hand-off).
  const fc = s.phase === 'fight' && s.fight?.step === 'fight' ? fightCandidates(s) : null;
  const actor: PlayerId = s.window ? s.window.player
    : s.phase === 'deploy' ? s.deployTurn
    : s.phase === 'fight' && s.fight ? (s.fight.step === 'fight' ? fc?.player ?? s.active : s.fight.stepPlayer)
    : s.active;

  const modeUnit = mode ? U(mode.unitId) : null;

  // ---------- board interaction ----------

  const chargeOpts = useMemo(() => {
    if (mode?.k !== 'charge') return [];
    const u = U(mode.unitId);
    return chargeTargetOptions(s, u, mode.heroic === 'leap' ? { onlyChargedThisPhase: true } : mode.heroic === 'fray' ? { within: 6 } : {}).map((x) => x.id);
  }, [s, mode]);

  const shootTargets = useMemo(() => {
    if (mode?.k !== 'shoot') return [];
    const u = U(mode.unitId);
    return boardUnits(s, other(u.owner)).filter((t) => {
      if (mode.smode === 'closeQuarters') return engagedEnemies(s, u).includes(t) || alive(u).some((m) => m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER'));
      if (mode.smode === 'indirect') return true;
      if (mode.smode === 'snap' && unitDistance(u, t) > RULES.snapShooting.range) return false;
      return alive(u).some((m) => unitVisibleTo(s, m, t));
    }).filter((t) => {
      const r = buildShootPools(s, u.id, t.id, { mode: mode.smode, useCloseQuarters: mode.useCQ, profile: mode.profile });
      return !r.error && r.pools.length > 0;
    }).map((t) => t.id);
  }, [s, mode]);

  const fightTargets = mode?.k === 'fight' ? engagedEnemies(s, U(mode.unitId)).map((t) => t.id) : [];
  const explosiveTargets = mode?.k === 'explosives'
    ? boardUnits(s, other(U(mode.unitId).owner)).filter((t) => !isEngaged(s, t) && unitDistance(U(mode.unitId), t) <= 8 && alive(U(mode.unitId)).some((m) => unitVisibleTo(s, m, t))).map((t) => t.id)
    : [];
  const crushTargets = mode?.k === 'crush' ? engagedEnemies(s, U(mode.unitId)).map((t) => t.id) : [];

  const targets = mode?.k === 'shoot' ? shootTargets : mode?.k === 'charge' ? chargeOpts : mode?.k === 'fight' ? fightTargets : mode?.k === 'explosives' ? explosiveTargets : mode?.k === 'crush' ? crushTargets : [];
  const picked = mode?.k === 'shoot' || mode?.k === 'fight' || mode?.k === 'explosives' ? (mode.target ? [mode.target] : []) : mode?.k === 'charge' ? mode.targets : [];

  const onTapUnit = (unitId: string, modelId?: string) => {
    if (tape.on) {
      const m = U(unitId).models.find((x) => x.id === modelId && !x.dead) ?? alive(U(unitId))[0];
      if (m) measureTap({ x: m.x, y: m.y }, { u: unitId, m: m.id });
      return;
    }
    if (mode && targets.includes(unitId)) {
      if (mode.k === 'charge') {
        // one tap: the unit charges that target and moves in by itself; only when no legal move is found does it
        // fall back to dragging the models
        const ch = mode;
        const ok = act((g) => autoCharge(g, unitById(g, ch.unitId), [unitId]));
        if (ok) {
          const cu = U(ch.unitId);
          flash(`${cu.name} charges ${U(unitId).name}!`);
          if (ch.heroic) act((g) => { g.window = heroicCandidates(g, cu.owner).length ? { kind: 'heroicIntervention', player: cu.owner } : null; });
          if (hasKw(cu, 'MONSTER') || hasKw(cu, 'VEHICLE')) setMode({ k: 'crush', unitId: cu.id }); else setMode(null);
        } else {
          const targetsNow = ch.targets.includes(unitId) ? ch.targets : [...ch.targets, unitId];
          setModeRaw({ ...ch, targets: targetsNow });
          setDraft(mergePaths(startPaths(U(ch.unitId)), autoApproach(s, U(ch.unitId), targetsNow.map(U), U(ch.unitId).chargeRoll ?? 0)));
          flash('Could not move in automatically (blocked / not enough distance): drag the models');
        }
      }
      else if (mode.k === 'crush') { const rolls = act((g) => crushingImpact(g, unitById(g, mode.unitId), unitId)); flash(`Crushing Impact: [${rolls.join(' ')}]`); setMode(null); }
      else if (mode.k === 'shoot' || mode.k === 'fight' || mode.k === 'explosives') setModeRaw({ ...mode, target: unitId });
      return;
    }
    if (!mode) setSel(unitId);
  };

  const measureTap = (p: Pt, ref?: { u: string; m: string }) => {
    setTape((tp) => (!tp.a || tp.b ? { on: true, a: p, ma: ref } : { ...tp, b: p, mb: ref }));
  };
  const onTapBoard = (p: Pt) => {
    if (tape.on) { measureTap(p); return; }
    if (mode?.k === 'place') {
      const u = U(mode.unitId);
      setDraft(placePaths(formationAt(u, p, s.players[u.owner].role === 'defender')));
      setCheck(null);
      return;
    }
    if (!mode) setSel(null);
  };

  const maxFor = (id: string) => {
    if (!mode || !modeUnit) return Infinity;
    const m = modeUnit.models.find((x) => x.id === id)!;
    if (mode.k === 'move') return maxMoveDistance(s, modeUnit, mode.kind, m, { fly: mode.fly });
    if (mode.k === 'charge') return modeUnit.chargeRoll ?? 0;
    if (mode.k === 'pile') return pileDistance(s, U(mode.unitId), mode.kind);
    return Infinity;
  };
  const draftKind: MoveKind | null = mode?.k === 'move' ? mode.kind : mode?.k === 'charge' ? 'charge' : mode?.k === 'pile' ? mode.kind : null;
  const draftOpts = mode?.k === 'move' ? { fly: mode.fly } : mode?.k === 'charge' ? { targets: mode.targets } : {};
  /** While dragging: a model walks its route — a wall it can't cross is gone around (the detour counts against its
   *  move) or it stops where it can't go on; it never jumps through. */
  const walkDraft = (id: string, path: Pt[]): Pt[] => {
    if (!modeUnit || !draftKind || path.length < 2) return path;
    const m = modeUnit.models.find((x) => x.id === id);
    if (!m) return path;
    const opt = { fly: mode?.k === 'move' ? mode.fly : undefined };
    if (!pathBlocked(s, modeUnit, draftKind, m, path, opt)) return path;
    return routeAround(s, modeUnit, draftKind, m, path[0], path[path.length - 1], maxFor(id), opt) ?? [path[0], path[0]];
  };
  /** After a drag: route around what can't be crossed and slide overlapping models back to base contact. */
  const settleDraft = (d: Paths): Paths => (modeUnit && draftKind
    ? settleMove(s, modeUnit, draftKind, d, { fly: mode?.k === 'move' ? mode.fly : undefined, targets: mode?.k === 'charge' ? mode.targets : undefined, maxFor: (m) => maxFor(m.id) })
    : d);
  const onDragEnd = (d: Paths) => {
    if (!modeUnit || !draftKind) return;
    const st = settleDraft(d);
    setDraft(st);
    const chk = validateMove(s, modeUnit, draftKind, st, draftOpts);
    setCheck(chk.ok ? null : chk);
  };
  // the last committed move can be reopened ("move further / fix it") while nothing else has happened since
  const [lastMove, setLastMove] = useState<{ mode: Mode; paths: Paths; after: GameState; label: string } | null>(null);
  const reopenMove = lastMove && lastMove.after === s && !s.window && U(lastMove.mode.unitId).owner === s.active ? lastMove : null;
  const redoButton = () => reopenMove && (
    <button className="btn small" onClick={() => { const lm = reopenMove; undo(); setLastMove(null); setSel(lm.mode.unitId); setMode(lm.mode, lm.paths); }}>
      <Icon name="undo" size={16} /> Adjust: {reopenMove.label}
    </button>
  );

  // Cover / Hidden badges and line-of-sight lines while choosing a shooting target
  const badges: Record<string, string[]> = {};
  // the cards of the player at the screen: what they want is drawn on the board, target units get a tag
  const me: PlayerId = human ?? actor;
  const goals = showGoals && s.phase !== 'deploy' ? s.players[me].secActive.map((id) => secondaryGoal(s, me, id)) : [];
  for (const g of goals) for (const id of g.units) (badges[id] ??= []).push(`Target: ${g.name}`);
  const losLines: { a: Pt; b: Pt; cover: boolean }[] = [];
  const noLos: string[] = [];
  if (mode?.k === 'shoot' && modeUnit) {
    const shooters = alive(modeUnit);
    for (const id of shootTargets.filter((x) => x === mode.target)) {
      const T = U(id);
      const b: string[] = [];
      if (shooters.some((m) => hasCover(s, m, T))) b.push('Cover −1 BS');
      if (alive(T).some((m) => isHidden(s, T, m))) b.push('Hidden');
      if (b.length) badges[id] = b;
    }
    // distance to every target the unit can pick, in inches (closest base to base)
    for (const id of shootTargets) badges[id] = [`${unitDistance(modeUnit, U(id)).toFixed(1)}"`, ...(badges[id] ?? [])];
    if (mode.target) {
      const T = U(mode.target);
      for (const m of shooters) {
        const vis = alive(T).filter((t) => modelVisible(s, m, T, t));
        if (!vis.length) { noLos.push(m.id); continue; }
        const t = vis.reduce((x, y) => (baseDist(m, x) <= baseDist(m, y) ? x : y));
        losLines.push({ a: m, b: t, cover: hasCover(s, m, T) });
      }
    }
  }
  if (modeUnit && (mode?.k === 'charge' || mode?.k === 'fight' || mode?.k === 'explosives')) {
    for (const id of targets) badges[id] = [`${unitDistance(modeUnit, U(id)).toFixed(1)}"`, ...(badges[id] ?? [])];
  }
  // tape measure: tap two points on the board
  const [tape, setTape] = useState<{ on: boolean; a?: Pt; b?: Pt; ma?: { u: string; m: string }; mb?: { u: string; m: string } }>({ on: false });
  // between two models the tape measures base to base (how ranges work) and checks line of sight through terrain
  const tapeInfo = (() => {
    if (!tape.a || !tape.b) return null;
    const mOf = (r?: { u: string; m: string }) => (r ? s.units.find((u) => u.id === r.u)?.models.find((x) => x.id === r.m && !x.dead) : undefined);
    const ma = mOf(tape.ma), mb = mOf(tape.mb);
    const centre = Math.hypot(tape.a.x - tape.b.x, tape.a.y - tape.b.y);
    if (!ma || !mb) {
      const pt = (p: Pt) => ({ ...p, r: 0.01, keywords: [] } as unknown as ModelState);
      return { text: `${centre.toFixed(1)}"`, line: `Distance ${centre.toFixed(1)}" (point to point) · ${hasLos(s, pt(tape.a), pt(tape.b)) ? 'clear of obscuring terrain' : 'crosses obscuring terrain'}`, los: hasLos(s, pt(tape.a), pt(tape.b)) };
    }
    const tu = U(tape.mb!.u);
    const los = hasLos(s, ma, mb);
    const vis = tape.ma!.u !== tape.mb!.u && modelVisible(s, ma, tu, mb);
    const why = !los ? 'Not visible: obscured by terrain' : vis || tape.ma!.u === tape.mb!.u ? 'Visible' : isHidden(s, tu, mb) ? 'In line of sight but Hidden: get within detection range' : 'Not visible';
    return { text: `${baseDist(ma, mb).toFixed(1)}"`, line: `Base to base ${baseDist(ma, mb).toFixed(1)}" (centre to centre ${centre.toFixed(1)}") · ${why}`, los: los && (vis || tape.ma!.u === tape.mb!.u) };
  })();
  const rings: Ring[] = [];
  if (mode?.k === 'charge' && modeUnit) {
    for (const m of alive(modeUnit)) if (alive(modeUnit).length <= 3) rings.push({ c: m, r: (modeUnit.chargeRoll ?? 0) + m.r, color: 'rgba(245,184,61,0.5)', dash: true });
  }

  // ---------- generic confirm helpers ----------

  const confirmMove = (kind: 'normal' | 'advance' | 'fallback' | 'scout' | 'extra' | 'surge' | 'charge' | 'pileIn' | 'consolidate', after?: () => void) => {
    if (!mode || !draft) return;
    const u = U(mode.unitId);
    const opts = mode.k === 'move' ? { fly: mode.fly } : mode.k === 'charge' ? { targets: mode.targets } : {};
    const d = settleDraft(draft);
    const chk = validateMove(s, u, kind, d, opts);
    if (!chk.ok) { setDraft(d); setCheck(chk); return; }
    const was = mode;
    const next = kind === 'charge'
      ? act((g) => { commitCharge(g, unitById(g, u.id), d, (was as { targets: string[] }).targets); return g; })
      : act((g) => { commitMove(g, unitById(g, u.id), kind, d); if (g.fight && (kind === 'pileIn' || kind === 'consolidate')) g.fight.movedThisStep.push(u.id); return g; });
    if (next) setLastMove({ mode: was, paths: d, after: next, label: `${u.name} (${kind})` });
    setMode(null);
    after?.();
  };

  const confirmPlace = () => {
    if (mode?.k !== 'place' || !draft) return;
    const pos = lastPos(draft);
    const u = U(mode.unitId);
    if (mode.how === 'disembark') {
      const t = U(mode.transportId!);
      const chk = validateDisembark(s, u, t, pos);
      if (!chk.ok) { setCheck(chk); return; }
      act((g) => disembarkUnit(g, unitById(g, u.id), unitById(g, t.id), pos));
      setMode(null);
      return;
    }
    if (mode.how === 'deploy' || mode.how === 'infiltrate') {
      const chk = act((g) => deployUnit(g, u.id, pos, mode.how as 'deploy' | 'infiltrate'));
      if (!chk.ok) { setCheck(chk); return; }
    } else {
      const chk = validatePlacement(s, u, pos, mode.how);
      if (!chk.ok) { setCheck(chk); return; }
      act((g) => {
        const gu = unitById(g, u.id);
        if (mode.rapid === true) spendStratagem(g, gu.owner, 'rapid-ingress', gu);
        if (mode.rapid) g.window = null;
        ingressUnit(g, gu, pos);
      });
    }
    setMode(null);
    setSel(null);
  };

  const autoPlace = () => {
    if (mode?.k !== 'place') return;
    if (mode.how === 'disembark') {
      const u = U(mode.unitId), t = U(mode.transportId!);
      const tm = alive(t)[0];
      // models hug the hull (wholly within 3"), starting on the side facing the closest enemy
      const foes = boardUnits(s, other(u.owner)).flatMap(alive);
      const near = foes.length ? foes.reduce((a, m) => (Math.hypot(m.x - tm.x, m.y - tm.y) < Math.hypot(a.x - tm.x, a.y - tm.y) ? m : a)) : null;
      const base = near ? Math.atan2(near.y - tm.y, near.x - tm.x) : 0;
      for (const arc of [Math.PI * 0.8, 2 * Math.PI]) {
        for (let a = 0; a < 16; a++) {
          const ang = base + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * (Math.PI / 8);
          const pos = ringFormation(u, tm, ang, arc);
          if (validateDisembark(s, u, t, pos).ok) { setDraft(placePaths(pos)); setCheck(null); return; }
        }
      }
      flash('No automatic disembark spot found: tap to place');
      return;
    }
    const near = draft ? polyCentroid([...lastPos(draft).values()]) : undefined;
    const pos = (mode.how === 'deploy' ? smartPlacement(s, U(mode.unitId), { near }) : null) ?? findPlacement(s, U(mode.unitId), mode.how, near);
    if (pos) { setDraft(placePaths(pos)); setCheck(null); } else flash('No automatic spot found: tap to place');
  };

  // ---------- attack tray ----------

  const onTrayClose = () => {
    const at = s.attack!;
    const attacker = U(at.attackerId);
    act((g) => {
      finishAttack(g);
      if (at.kind === 'overwatch') closeWindow(g);
      if (at.kind === 'fight') { markFought(g, unitById(g, attacker.id)); openCounteroffensive(g, attacker.owner); }
    });
    setMode(null);
  };

  const onReroll = (stage: 'hit' | 'wound' | 'save', i: number) => {
    act((g) => {
      const at = g.attack!;
      const u = unitById(g, stage === 'save' ? at.targetId : at.attackerId);
      spendStratagem(g, u.owner, 'command-reroll', u);
      rerollOne(g, stage, i);
    });
  };

  // ---------- render helpers ----------

  const unitPill = (u: UnitState, done: boolean, onClick?: () => void) => (
    <button key={u.id} className={`unit-pill ${done ? 'done' : ''} ${sel === u.id ? 'sel' : ''} ${u.battleShocked ? 'shock' : ''}`} onClick={onClick ?? (() => { setSel(u.id); })}>
      <span className={u.owner ? 'p1' : 'p0'}>●</span> {u.name.length > 26 ? u.name.slice(0, 25) + '…' : u.name}
      <span className="muted"> {alive(u).length}/{u.startingStrength}</span>{u.battleShocked ? ' ' : ''}
      {s.players[1 - u.owner].oathTarget === u.id && <span className="oath-tag">OATH</span>}
    </button>
  );

  const selUnit = sel ? s.units.find((u) => u.id === sel) ?? null : null;

  const unitCard = (u: UnitState) => {
    const m = alive(u)[0];
    if (!m) return null;
    const st = strength(u);
    const lead = u.models.find((x) => x.isCharacter && !x.dead) ?? m;
    const flags = [
      (st === 'half' || st === 'belowHalf') && (st === 'half' ? 'Half-strength' : 'Below half'),
      u.battleShocked && 'Battle-shocked',
      u.chargedTurn === s.turn && 'Fights First',
      isRiledUp(s, u) && 'Riled up 5++',
      s.players[other(u.owner)].oathTarget === u.id && 'Oath target',
      ...u.enhancements.map((e) => e.name),
      ...u.buffs.map((b) => (b.label && !BUFFS.some((x) => x.kind === b.kind) ? `${EFFECT_LABEL[b.kind] ?? b.kind} (${b.label})` : BUFFS.find((x) => x.kind === b.kind)?.label ?? EFFECT_LABEL[b.kind] ?? b.kind)),
    ].filter(Boolean) as string[];
    return (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }} onClick={() => setSheet(u.id)}>
        <Portrait kind={unitToken(u)} owner={u.owner} character={u.models.some((x) => x.isCharacter && !x.dead)} size={40} datasheet={lead.source} />
        <div className="grow">
          <div style={{ fontWeight: 700 }} className={u.owner ? 'p1' : 'p0'}>{u.name} <span className="muted tiny">{alive(u).length}/{u.startingStrength}</span></div>
          <div className="statline">
            M <b>{m.profile.M !== undefined && m.profile.M !== null ? m.profile.M + unitFlags(s, u).move : '-'}"</b> · T <b>{m.profile.T}</b> · Sv <b>{m.profile.Sv}+</b>{m.profile.InSv ? <> · <b>{m.profile.InSv}++</b></> : null} · W <b>{m.wounds}/{m.profile.W}</b> · Ld <b>{bestLd(u, s)}+</b> · OC <b>{u.battleShocked ? '-' : m.profile.OC ?? '-'}</b>
          </div>
          {flags.length > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}>{flags.join(' · ')}</div>}
          {(() => { const ls = activeLabels(s, u); return ls.length ? <div className="tiny fx-labels"><Icon name="ability" size={13} /> {ls.slice(0, 6).join(' · ')}{ls.length > 6 ? ` +${ls.length - 6}` : ''}</div> : null; })()}
        </div>
        <span className="muted">›</span>
      </div>
    );
  };

  const buffPanel = (u: UnitState) => (
    <div>
      <button className="btn small ghost" onClick={() => setShowBuffs((x) => !x)}><Icon name={showBuffs ? 'down' : 'next'} size={16} /> Ability buffs{u.buffs.length ? ` (${u.buffs.length})` : ''}</button>
      {showBuffs && (
        <div className="row" style={{ marginTop: 6 }}>
          {BUFFS.map((b) => {
            const on = u.buffs.some((x) => x.kind === b.kind);
            return (
              <button key={b.kind} className={`btn small ${on ? 'on' : ''}`} onClick={() => act((g) => {
                const gu = unitById(g, u.id);
                gu.buffs = on ? gu.buffs.filter((x) => x.kind !== b.kind) : [...gu.buffs, { kind: b.kind, until: 'phase', label: b.label }];
              })}>{b.label}</button>
            );
          })}
          <div className="tiny muted" style={{ width: '100%' }}>For datasheet / Detachment abilities the app does not automate (lasts until the end of the phase)</div>
        </div>
      )}
    </div>
  );

  const moveControls = (kind: string, onConfirm: () => void, extra?: React.ReactNode) => (
    <>
      <div className="row">
        <span className="tiny muted grow">Drag = whole unit · tap a model = move that model</span>
        <button className="btn small" onClick={() => { setDraft(modeUnit ? startPaths(modeUnit) : null); setCheck(null); }}>Reset</button>
        {extra}
      </div>
      {check && !check.ok && <div className="err">{check.errors.slice(0, 4).map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="row">
        <button className="btn" onClick={() => setMode(null)}>Cancel</button>
        <button className="btn primary grow" onClick={onConfirm}><Icon name="check" /> Confirm {kind}</button>
      </div>
    </>
  );

  // ---------- datasheet abilities you press ----------

  const [actPick, setActPick] = useState<string | null>(null); // ability whose target is being picked
  const shortName = (n: string) => n.replace(/\s*\((?:once|psychic|psyker|first)[^)]*\)\s*$/i, '').replace(/\s*\(Aura\)\s*$/i, '');
  /** Buttons for abilities player p can use right now ("Once per battle, in your Command phase …"). */
  const abilityBar = (p: PlayerId, only: { unitId?: string; whens?: Trigger[] } = {}) => {
    if (bots.includes(p)) return null;
    const list = manualActs(s, p).filter((m) => (!only.unitId || m.def.holder.id === only.unitId) && (!only.whens || only.whens.includes(m.def.spec.when)));
    if (!list.length) return null;
    return (
      <div className="ab-bar">
        <div className="tiny muted"><Icon name="ability" size={13} /> Abilities you can use now</div>
        {list.map((m) => {
          const k = `${m.def.holder.id}|${m.def.key}`;
          const t = m.def.spec.target;
          const pickOne = !!t && t.side !== 'self' && !t.each && m.targets.length > 1;
          const use = (targetId?: string) => {
            const res = act((g) => {
              const err = useActByKey(g, m.def.holder.id, m.def.key, targetId);
              const gu = unitById(g, m.def.holder.id);
              return { err, move: gu.extraMove && gu.extraMove.phase === `${g.turn}:${g.phase}` && !g.window ? gu.extraMove.kind : null };
            });
            setActPick(null);
            if (res.err) flash(res.err);
            else flash(`Used ${shortName(m.def.name)}`);
          };
          return (
            <div key={k} className="ab-item">
              <button className={`btn small ${actPick === k ? 'on' : ''}`} disabled={!!m.why} title={m.why ?? m.label} onClick={() => (pickOne ? setActPick(actPick === k ? null : k) : use(m.targets[0]?.id))}>
                <b>{shortName(m.def.name)}</b>{!only.unitId && <span className="tiny"> · {m.def.holder.name.length > 22 ? m.def.holder.name.slice(0, 21) + '…' : m.def.holder.name}</span>}
              </button>
              <span className="tiny muted">{m.why ?? m.label}{m.def.spec.limit === 'battle' ? ' (once per battle)' : m.def.spec.limit === 'round' ? ' (once per battle round)' : ''}</span>
              {actPick === k && <div className="unit-strip">{m.targets.map((x) => unitPill(x, false, () => use(x.id)))}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  /** A move granted by an ability (reaction move, surge move, move after shooting). */
  const extraMovePanel = () => {
    if (mode?.k !== 'move' || !modeUnit || (mode.kind !== 'extra' && mode.kind !== 'surge')) return null;
    const em = modeUnit.extraMove;
    return (
      <>
        <div className="small"><b>{modeUnit.name}</b> · {em?.label}: {mode.kind === 'surge' ? `Surge move ${em?.max ?? 0}" (towards the closest enemy, not ending within Engagement Range)` : `Move up to ${em?.max ?? 0}" (not ending within Engagement Range)`}</div>
        {moveControls(mode.kind === 'surge' ? 'surge move' : 'move', () => confirmMove(mode.kind as 'extra' | 'surge', () => setSel(null)))}
      </>
    );
  };

  // ---------- windows (reactions of the non-active player) ----------

  const windowPanel = () => {
    const w = s.window!;
    const p = w.player;
    const skip = <button className="btn" onClick={() => { act((g) => closeWindow(g)); setMode(null); }}>Decline</button>;
    if (w.kind === 'fireOverwatch') {
      if (mode?.k === 'shoot' && mode.overwatch) return shootPanel();
      return (
        <>
          <div className="handoff">{pName(s, p)}: use Fire Overwatch (1CP)? <span className="small muted">— Snap Shooting: a visible target within {RULES.snapShooting.range}", hits only on a 6 (not Critical), no hit re-rolls</span></div>
          <div className="tiny muted">{overwatchCandidates(s, p).map((u) => `${u.name}: closest enemy ${Math.min(...boardUnits(s, other(p)).map((e) => unitDistance(u, e))).toFixed(1)}"`).join(' · ')}</div>
          <div className="unit-strip">{overwatchCandidates(s, p).map((u) => unitPill(u, false, () => setMode({ k: 'shoot', unitId: u.id, smode: 'snap', target: null, useCQ: false, profile: {}, overwatch: true })))}</div>
          {skip}
        </>
      );
    }
    if (w.kind === 'rapidIngress') {
      if (mode?.k === 'place') return placePanel();
      return (
        <>
          <div className="handoff">{pName(s, p)}: use Rapid Ingress (1CP)?</div>
          <div className="unit-strip">{rapidIngressCandidates(s, p).map((u) => unitPill(u, false, () => setMode({ k: 'place', unitId: u.id, how: hasDeepStrike(s, u) ? 'deepStrike' : 'ingress', rapid: unitFlags(s, u).oppMoveIngress ? 'free' : true })))}</div>
          {rapidIngressCandidates(s, p).some((u) => unitFlags(s, u).oppMoveIngress) && <div className="tiny muted">Units with an ability (e.g. Deff from the Shadows) arrive free, no CP</div>}
          {skip}
        </>
      );
    }
    if (w.kind === 'abilityMove') {
      if (mode?.k === 'move') return extraMovePanel();
      return (
        <>
          <div className="handoff">{pName(s, p)}: reaction ability — {w.label}</div>
          {w.offers.map((o) => {
            const u = U(o.unitId);
            return (
              <div key={o.unitId + o.key} className="row card" style={{ padding: 8 }}>
                <div className="grow small"><b>{u.name}</b><div className="tiny muted">{o.label}</div></div>
                <button className="btn small primary" onClick={() => {
                  const res = act((g) => { const err = acceptOffer(g, o.unitId, o.key); return { err, kind: unitById(g, o.unitId).extraMove?.kind ?? 'extra' }; });
                  if (res.err) { flash(res.err); return; }
                  setSel(o.unitId);
                  setMode({ k: 'move', unitId: o.unitId, kind: res.kind, fly: false }, startPaths(u));
                }}>Move</button>
              </div>
            );
          })}
          <button className="btn" onClick={() => { act((g) => closeOffers(g)); setMode(null); }}>Decline / Done</button>
        </>
      );
    }
    if (w.kind === 'smokescreen') {
      return (
        <>
          <div className="handoff">{pName(s, p)}: use Smokescreen (1CP)?</div>
          <div className="unit-strip">{smokescreenCandidates(s, p).map((u) => unitPill(u, false, () => act((g) => {
            const gu = unitById(g, u.id);
            spendStratagem(g, p, 'smokescreen', gu);
            gu.buffs.push({ kind: 'smoke', until: 'phase', label: 'Smokescreen' });
            g.window = null;
          })))}</div>
          {skip}
        </>
      );
    }
    if (w.kind === 'heroicIntervention') {
      if (mode?.k === 'charge') return chargePanel();
      return (
        <>
          <div className="handoff">{pName(s, p)}: use Heroic Intervention?</div>
          {heroicCandidates(s, p).map((u) => (
            <div key={u.id} className="row">
              <span className="grow small">{u.name}</span>
              <button className="btn small" onClick={() => { act((g) => { const gu = unitById(g, u.id); spendStratagem(g, p, 'heroic-intervention', gu); declareCharge(g, gu); }); setMode({ k: 'charge', unitId: u.id, targets: [], heroic: 'leap' }, startPaths(u)); }}>Leap to Defend 1CP</button>
              <button className="btn small" disabled={!!canUseStratagem(s, p, 'heroic-intervention', u, 2)} onClick={() => { act((g) => { const gu = unitById(g, u.id); spendStratagem(g, p, 'heroic-intervention', gu, 2); declareCharge(g, gu, false, 6); }); setMode({ k: 'charge', unitId: u.id, targets: [], heroic: 'fray' }, startPaths(u)); }}>Into the Fray 2CP</button>
            </div>
          ))}
          {skip}
        </>
      );
    }
    if (w.kind === 'stratReaction') {
      const P = s.players[p];
      const strats = P.detachments.flatMap((d) => d.stratagems.map((st) => ({ st, d: d.name })));
      return (
        <>
          <div className="handoff">{pName(s, p)}: {w.label} — use a Stratagem? ({P.cp} CP)</div>
          {w.offers.map((o) => {
            const x = strats.find((q) => q.st.id === o.stratId);
            if (!x) return null;
            return (
              <StratUseCard key={o.stratId} s={s} p={p} st={x.st} rule={stratRuleFor(s, p, x.st)} detachment={x.d} react ctx={w.ctx}
                units={o.units.map((id) => U(id))}
                auto={P.autoStrats?.includes(o.stratId)}
                onAuto={() => act((g) => { const GP = g.players[p]; GP.autoStrats = GP.autoStrats?.includes(o.stratId) ? GP.autoStrats.filter((q) => q !== o.stratId) : [...(GP.autoStrats ?? []), o.stratId]; })}
                onUse={(unitId, use) => { act((g) => answerReaction(g, o.stratId, unitId, use)); flash(`Used ${x.st.name}`); }} />
            );
          })}
          <button className="btn" onClick={() => act((g) => answerReaction(g, null))}>Decline</button>
        </>
      );
    }
    if (w.kind === 'counteroffensive') {
      return (
        <>
          <div className="handoff">{pName(s, p)}: use Counteroffensive (2CP) so one of your units fights next?</div>
          <div className="unit-strip">{counteroffensiveCandidates(s, p).map((u) => unitPill(u, false, () => act((g) => useCounteroffensive(g, unitById(g, u.id)))))}</div>
          <button className="btn" onClick={() => act((g) => { g.window = null; })}>Decline</button>
        </>
      );
    }
    return null;
  };

  // ---------- phase panels ----------

  const placePanel = () => {
    if (mode?.k !== 'place') return null;
    const u = U(mode.unitId);
    return (
      <>
        <div className="small">Set up <b>{u.name}</b>: tap the battlefield{mode.how === 'deploy' ? ' in your deployment zone' : mode.how === 'disembark' ? ` within ${disembarkMode(s, U(mode.transportId!)) === 'combat' ? 6 : 3}" of the transport (${disembarkMode(s, U(mode.transportId!))} disembark)` : mode.how === 'deepStrike' ? ` (more than ${RULES.reserves.enemyDistance}" from enemies)` : ` (within ${RULES.reserves.edgeDistance}" of a battlefield edge, more than ${RULES.reserves.enemyDistance}" from enemies)`} then drag to adjust</div>
        <div className="row">
          <span className="tiny muted grow">Drag = whole unit · tap a model = move that model</span>
          <button className="btn small" onClick={autoPlace}>Auto place</button>
        </div>
        {check && !check.ok && <div className="err">{check.errors.slice(0, 4).map((e) => <div key={e}>{e}</div>)}</div>}
        <div className="row">
          <button className="btn" onClick={() => setMode(null)}>Cancel</button>
          <button className="btn primary grow" disabled={!draft} onClick={confirmPlace}><Icon name="check" /> Confirm{mode.rapid ? ' (Rapid Ingress 1CP)' : ''}</button>
        </div>
      </>
    );
  };

  const deployPanel = () => {
    if (mode?.k === 'place') return placePanel();
    const p = s.deployTurn;
    const pending = s.units.filter((u) => u.owner === p && u.status === 'pending');
    const rd = s.redeploy;
    if (rd && rd.player === p && !pending.length) {
      return (
        <>
          <div className="handoff">{rd.source}: {pName(s, p)} can redeploy {rd.left} more unit(s){rd.infantryOnly ? ' (INFANTRY)' : ''}</div>
          <div className="small muted">Pick a unit up to set it up again, or move it into Strategic Reserves (no limit), then tap Done</div>
          {rd.left > 0 && redeployCandidates(s).map((x) => (
            <div key={x.id} className="row">
              <span className="grow small">{x.name}{x.status === 'reserves' ? ' (Reserves)' : ''}</span>
              {x.status === 'board' && <button className="btn small" onClick={() => { const e = act((g) => redeployUnit(g, x.id, false)); if (e) flash(e); }}>Set up again</button>}
              {x.status === 'board' && <button className="btn small" onClick={() => { const e = act((g) => redeployUnit(g, x.id, true)); if (e) flash(e); }}>To Reserves</button>}
            </div>
          ))}
          <button className="btn primary" onClick={() => { const e = act((g) => endRedeploy(g)); if (e) flash(e); }}><Icon name="check" /> Done</button>
        </>
      );
    }
    const u = selUnit && pending.includes(selUnit) ? selUnit : null;
    return (
      <>
        <div className="handoff">{pName(s, p)} ({s.players[p].role === 'attacker' ? 'Attacker' : 'Defender'}) deploys: players alternate one unit at a time</div>
        <div className="unit-strip">{pending.map((x) => unitPill(x, false))}</div>
        {!bots.includes(p) && pending.length > 0 && !(s.autoDeploy ?? []).includes(p) && (
          <button className="btn" onClick={() => { act((g) => { g.autoDeploy = [...(g.autoDeploy ?? []), p]; }); setSel(null); }}>Deploy the rest for me</button>
        )}
        {u ? (
          <div className="row">
            <button className="btn primary" onClick={() => setMode({ k: 'place', unitId: u.id, how: 'deploy' })}>Set up in deployment zone</button>
            {u.core.infiltrators && <button className="btn" onClick={() => setMode({ k: 'place', unitId: u.id, how: 'infiltrate' })}>Infiltrate</button>}
            <button className="btn" onClick={() => { const e = act((g) => sendToReserves(g, u.id)); if (e) flash(e); else setSel(null); }}>Strategic Reserves{u.core.deepStrike ? ' / Deep Strike' : ''}</button>
            {s.units.filter((t) => t.owner === p && t.transport && (t.status === 'board' || t.status === 'pending') && !canEmbarkIn(s, u, t)).map((t) => (
              <button key={t.id} className="btn" onClick={() => { const e = act((g) => embarkUnit(g, unitById(g, u.id), unitById(g, t.id), true)); if (e) flash(e); else setSel(null); }}>Embark in {t.name} ({transportSpaceUsed(s, t)}/{t.transport!.capacity})</button>
            ))}
          </div>
        ) : <div className="muted small">Select a unit to set up</div>}
        {s.units.filter((t) => t.owner === p && t.transport && t.keywords.includes('DEDICATED TRANSPORT') && t.status !== 'destroyed' && !embarkedIn(s, t).length).map((t) => (
          <div key={t.id} className="tiny err"><Icon name="transport" size={14} /> {t.name} is empty: a Dedicated Transport must start the battle with a unit embarked or it is destroyed (select a unit and tap "Embark")</div>
        ))}
        {u && unitCard(u)}
      </>
    );
  };

  const [detPick, setDetPick] = useState<string[]>([]);
  const AUTO_LABEL: Record<string, React.ReactNode> = { full: <><Icon name="check" size={13} /> Automated</>, partial: <><Icon name="partial" size={13} /> Mostly automated</>, manual: <><Icon name="hand" size={13} /> Manual</>, none: <><Icon name="hand" size={13} /> Not supported (read the rule)</> };
  /** Detachment rules of player p: what the app applies, and "pick one" choices such as Combat Doctrines. */
  const detPanel = (p: PlayerId) => {
    const summary = detSummary(s, p);
    if (!summary.length) return null;
    const choices = detChoices(s, p);
    return (
      <div className="card det-card">
        {summary.map((d) => {
          const ch = choices.find((c) => c.rule === d.name);
          const need = ch?.choice.pick ?? 1;
          const pick = (ids: string[]) => { const e = act((g) => pickDetChoice(g, p, d.name, ids)); if (e) flash(e); else { setDetPick([]); flash(`${ch!.choice.name}: ${ids.map((id) => ch!.choice.options.find((o) => o.id === id)?.name).join(' + ')}`); } };
          return (
            <div key={d.name} className="det-row">
              <div className="small"><b>Detachment: {d.name}</b> <span className={`det-auto ${d.auto}`}>{AUTO_LABEL[d.auto]}</span></div>
              {d.active.length > 0 && <div className="small"><span className="chip on">Active: {d.active.join(' + ')}</span></div>}
              {ch && ch.open && (
                <div className="det-choice">
                  <div className="tiny muted">{ch.choice.name} — select {need}{ch.choice.when === 'command' ? ' (until your next Command phase)' : ch.choice.when === 'round' ? ' (for the battle round)' : ' (for the battle)'}{ch.choice.uses === 'eachOnce' ? ' · each once per battle' : ch.choice.uses === 'limit' ? ` · ${ch.choice.limit} uses (${(ch.choice.limit ?? 1) - ch.state.count} left)` : ''}</div>
                  <div className="det-opts">
                    {ch.options.map(({ o, why }) => (
                      <button key={o.id} className={`btn small ${detPick.includes(o.id) ? 'on' : ''}`} disabled={!!why} title={why ?? o.text}
                        onClick={() => (need === 1 ? pick([o.id]) : setDetPick((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id].slice(-need))))}>
                        <b>{o.name}</b><span className="tiny"> {why ?? o.text}</span>
                      </button>
                    ))}
                  </div>
                  {need > 1 && <button className="btn small primary" disabled={detPick.length !== need} onClick={() => pick(detPick)}>Confirm ({detPick.length}/{need})</button>}
                </div>
              )}
              {d.manual && <div className="tiny muted">Manual: {d.manual}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const commandPanel = () => {
    const tests = s.shockTests;
    const pending = tests.filter((t) => t.passed === null);
    return (
      <>
        <div className="handoff">Command phase · {pName(s, s.active)} · both players gain 1CP</div>
        {hasArmyRule(s, s.active, 'Oath of Moment') && (
          <div className="card" style={{ padding: 8 }}>
            <div className="small"><b>Oath of Moment</b> — select one enemy unit: attacks against it re-roll the Hit roll{s.players[s.active].oathWoundBonus ? ' and get +1 to wound' : ''} until your next Command phase</div>
            <div className="unit-strip" style={{ marginTop: 6 }}>
              {boardUnits(s, other(s.active)).map((e) => (
                <button key={e.id} className={`unit-pill ${s.players[s.active].oathTarget === e.id ? 'sel' : ''}`} onClick={() => { act((g) => setOathTarget(g, g.active, e.id)); setSel(e.id); flash(`Oath of Moment → ${e.name}`); }}>
                  <span className={e.owner ? 'p1' : 'p0'}>●</span> {e.name}
                  {s.players[s.active].oathTarget === e.id && <span className="oath-tag">OATH</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {hasArmyRule(s, s.active, 'Oath of Moment') && s.players[s.active].oathTarget && boardUnits(s, s.active).some((x) => unitFlags(s, x).oathBackup) && (
          <div className="card" style={{ padding: 8 }}>
            <div className="small"><b>Master of Battle</b> — backup target: if the Oath of Moment target is destroyed, this unit becomes the target</div>
            <div className="unit-strip" style={{ marginTop: 6 }}>
              {boardUnits(s, other(s.active)).filter((e) => e.id !== s.players[s.active].oathTarget).map((e) => (
                <button key={e.id} className={`unit-pill ${s.players[s.active].oathBackup === e.id ? 'sel' : ''}`} onClick={() => act((g) => setOathBackup(g, g.active, e.id))}>
                  <span className={e.owner ? 'p1' : 'p0'}>●</span> {e.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {abilityChoices(s, s.active).map((c) => (
          <div key={c.unit.id + c.name} className="card" style={{ padding: 8 }}>
            <div className="small"><b>{c.name}</b> · {c.unit.name} — select {c.pick} (until your next Command phase)</div>
            <div className="det-opts">
              {c.options.map((o) => (
                <button key={o} className={`btn small ${c.on.includes(o) ? 'on' : ''}`} onClick={() => {
                  const on = c.on.includes(o) ? c.on.filter((x) => x !== o) : [...c.on, o].slice(-c.pick);
                  act((g) => pickAbilities(g, c.unit.id, on));
                }}>{c.on.includes(o) ? '● ' : '○ '}{o}</button>
              ))}
            </div>
          </div>
        ))}
        {abilityBar(s.active, { whens: ['command', 'anyCommand', 'battleStart', 'opponentTurnEnd', 'anyPhase'] })}
        {hasArmyRule(s, s.active, 'Waaagh!') && (
          <div className="card row" style={{ padding: 8 }}>
            <div className="grow small"><b>WAAAGH!</b> (once per battle) — Orks are riled up: 5+ invulnerable save, ranged weapons have [ASSAULT], can charge after advancing, until the end of the next turn</div>
            {s.players[s.active].riledUntilTurn >= s.turn ? <span className="chip warn">WAAAGH! active</span>
              : <button className="btn small primary" disabled={s.players[s.active].waaaghUsed} onClick={() => act((g) => callWaaagh(g, g.active))}>{s.players[s.active].waaaghUsed ? 'Used' : 'WAAAGH!!!'}</button>}
          </div>
        )}
        {detPanel(s.active)}
        {tests.length === 0 && <div className="muted small">No Battle-shock tests needed</div>}
        {tests.map((t) => {
          const u = U(t.unitId);
          const ib = canUseStratagem(s, u.owner, 'insane-bravery', u);
          return (
            <div key={t.unitId} className="row card" style={{ padding: 8 }}>
              <div className="grow small"><b>{u.name}</b><div className="tiny muted">{u.battleShocked ? 'Battle-shocked' : 'Below Half-strength'} · needs 2D6 ≥ {bestLd(u, s)}</div></div>
              {t.passed === null ? (
                <>
                  <button className="btn small" disabled={!!ib} onClick={() => act((g) => rollBattleShock(g, u.id, true))}>Insane Bravery 1CP</button>
                  <button className="btn small primary" onClick={() => act((g) => rollBattleShock(g, u.id))}>Roll</button>
                </>
              ) : <span className={t.passed ? 'p0' : 'err'}>{t.auto ? 'Passed (Insane Bravery)' : `${t.result} ${t.passed ? 'Passed' : 'Battle-shocked!'}`}</span>}
            </div>
          );
        })}
        <div className="sticky-act"><button className="btn primary big wide" disabled={pending.length > 0} onClick={() => { act((g) => endPhase(g)); setSel(null); }}>{pending.length ? `Roll the Battle-shock tests first (${pending.length})` : 'To Movement'}</button></div>
      </>
    );
  };

  const movementPanel = () => {
    if (mode?.k === 'place') return placePanel();
    if (mode?.k === 'move' && modeUnit) {
      const advRR = mode.kind === 'advance' ? canUseStratagem(s, modeUnit.owner, 'command-reroll', modeUnit) : 'x';
      return (
        <>
          <div className="hint"><span><b>{modeUnit.name}</b> · {mode.kind === 'normal' ? 'Normal move' : mode.kind === 'advance' ? `Advance (M + ${modeUnit.advanceRoll})` : modeUnit.battleShocked ? 'Fall back – Desperate Escape (a hazard roll per model)' : 'Fall back – Ordered Retreat'} · drag the models (distance is limited for you), then confirm</span></div>
          {moveControls(mode.kind, () => confirmMove(mode.kind),
            mode.kind === 'advance' && unitHasAbility(modeUnit, 'Waaagh!') && freeAdvRR !== modeUnit.id ? <button className="btn small" onClick={() => { act((g) => rollAdvance(g, unitById(g, modeUnit.id))); setFreeAdvRR(modeUnit.id); setDraft(startPaths(modeUnit)); }}>Re-roll advance (Waaagh!, free)</button>
            : mode.kind === 'advance' && canDetReroll(s, modeUnit, 'advance') ? <button className="btn small" onClick={() => { act((g) => detReroll(g, unitById(g, modeUnit.id), 'advance')); setDraft(startPaths(modeUnit)); }}>Re-roll advance (Detachment, free)</button>
            : mode.kind === 'advance' && !advRR ? <button className="btn small" onClick={() => { act((g) => { const gu = unitById(g, modeUnit.id); spendStratagem(g, gu.owner, 'command-reroll', gu); rollAdvance(g, gu); }); setDraft(startPaths(modeUnit)); }}>Re-roll advance 1CP</button> : undefined)}
        </>
      );
    }
    const mine = s.units.filter((u) => u.owner === s.active && (onBoard(u) || u.status === 'reserves' || u.status === 'embarked'));
    const u = selUnit && mine.includes(selUnit) && !selUnit.move ? selUnit : null;
    const moved = selUnit && mine.includes(selUnit) && selUnit.move && ['normal', 'advance', 'fallback'].includes(selUnit.move) ? selUnit : null;
    const rides = moved ? s.units.filter((t) => t.owner === s.active && t.transport && onBoard(t) && !canEmbarkIn(s, moved, t)) : [];
    return (
      <>
        {!selUnit && <div className="hint"><span>Tap a unit below (or on the battlefield) to move it · units not moved Remain Stationary at the end of the phase</span></div>}
        <div className="unit-strip">{mine.map((x) => unitPill(x, !!x.move))}</div>
        {(() => {
          const rigs = s.units.filter((t) => t.owner === s.active && t.transport && onBoard(t));
          if (!rigs.length) return null;
          return (
            <div className="transport-box">
              {rigs.map((t) => {
                const pax = s.units.filter((x) => x.embarkedIn === t.id && x.status === 'embarked');
                const dm = disembarkMode(s, t);
                return (
                  <div key={t.id} className="small">
                    <b>{t.name}</b> <span className="muted">· capacity {transportSpaceUsed(s, t)}/{t.transport!.capacity}</span>
                    {pax.length ? pax.map((x) => (
                      <button key={x.id} className="btn small" disabled={!dm || !!x.move} onClick={() => { setSel(x.id); setMode({ k: 'place', unitId: x.id, how: 'disembark', transportId: t.id }); }}>
                        Disembark: {x.name}{dm ? ` (${dm})` : ''}
                      </button>
                    )) : <span className="muted"> · empty (units ending a move within 3" can embark)</span>}
                  </div>
                );
              })}
            </div>
          );
        })()}
        {u && u.status === 'embarked' && (() => {
          const t = U(u.embarkedIn!);
          const dm = disembarkMode(s, t);
          return dm
            ? <button className="btn primary" onClick={() => setMode({ k: 'place', unitId: u.id, how: 'disembark', transportId: t.id })}>Disembark from {t.name} ({dm === 'tactical' ? 'Tactical: can still move' : dm === 'rapid' ? 'Rapid: cannot charge' : 'Combat: hazard + Battle-shocked'})</button>
            : <div className="muted small">The transport Advanced / Fell Back: no disembarking this phase</div>;
        })()}
        {rides.map((t) => {
          // embark: after a Normal / Advance / Fall Back move, every model within 3" of the transport
          const far = alive(moved!).filter((m) => !alive(t).some((n) => baseDist(m, n) <= 3 + 1e-6)).length;
          return (
            <button key={t.id} className="btn" disabled={far > 0} onClick={() => { const e = act((g) => embarkUnit(g, unitById(g, moved!.id), unitById(g, t.id))); if (e) flash(e); else setSel(null); }}>
              Embark in {t.name} ({transportSpaceUsed(s, t)}/{t.transport!.capacity}){far ? ` — ${far} model(s) still more than 3" away` : ''}
            </button>
          );
        })}
        {u && u.status === 'reserves' && (
          canIngress(s, u)
            ? <button className="btn primary" onClick={() => setMode({ k: 'place', unitId: u.id, how: hasDeepStrike(s, u) ? 'deepStrike' : 'ingress' })}>Arrive ({hasDeepStrike(s, u) ? 'Deep Strike' : 'Ingress'})</button>
            : <div className="muted small">Can arrive from Battle Round {arrivalRound(s, u)}</div>
        )}
        {u && onBoard(u) && (() => {
          const canFly = hasKw(u, 'FLY') && !unitFlags(s, u).grounded;
          const flyNow = fly && canFly;
          const start = (kind: 'normal' | 'advance' | 'fallback') => {
            const ok = act((g) => {
              const gu = unitById(g, u.id);
              if (!beginMove(g, gu, kind)) return false;
              if (kind === 'advance') rollAdvance(g, gu);
              return true;
            });
            if (!ok) { flash(`${u.name} must Remain Stationary`); setSel(null); return; }
            setMode({ k: 'move', unitId: u.id, kind, fly: flyNow }, startPaths(u));
          };
          return (
            <>
              {unitCard(u)}
              <div className="row acts">
                {!isEngaged(s, u) && <button className="btn" onClick={() => start('normal')}><Icon name="move" /> Normal {(alive(u)[0].profile.M ?? 0) + unitFlags(s, u).move}"</button>}
                {!isEngaged(s, u) && <button className="btn" onClick={() => start('advance')}><Icon name="advance" /> Advance</button>}
                {isEngaged(s, u) && <button className="btn" onClick={() => start('fallback')}><Icon name="fallback" /> Fall back</button>}
                <button className="btn" onClick={() => { act((g) => remainStationary(g, unitById(g, u.id))); setSel(null); }}><Icon name="hold" /> Remain Stationary</button>
                {canFly && <button className={`btn small ${fly ? 'on' : ''}`} onClick={() => setFly(!fly)}>Fly (−2")</button>}
              </div>
            </>
          );
        })()}
        {abilityBar(s.active, { whens: ['movement', 'endOfNormalMove', 'anyPhase'] })}
        {selUnit && selUnit.owner !== s.active && unitCard(selUnit)}
        {redoButton()}
        {endButton('movement', 'End Movement', boardUnits(s, s.active).length > 0 && boardUnits(s, s.active).every((x) => !x.move) && !s.units.some((x) => x.owner === s.active && x.status === 'reserves' && x.move), 'No unit has moved yet')}
      </>
    );
  };

  const shootPanel = () => {
    if (mode?.k === 'explosives' && modeUnit) {
      return (
        <>
          <div className="small"><b>Explosives</b> ({modeUnit.name}): tap a visible, unengaged target within 8"</div>
          <div className="row">
            <button className="btn" onClick={() => setMode(null)}>Cancel</button>
            <button className="btn primary grow" disabled={!mode.target} onClick={() => {
              const res = act((g) => {
                const gu = unitById(g, modeUnit.id);
                spendStratagem(g, gu.owner, 'explosives', gu);
                const r = rollN(g, 6);
                const n = r.filter((x) => x >= 4).length;
                if (n) applyMortalWounds(g, unitById(g, mode.target!), n, 'Explosives');
                return r;
              });
              flash(`Explosives: [${res.join(' ')}] ${res.filter((x) => x >= 4).length} MW`);
              setMode(null);
            }}>Throw (6D6, 4+)</button>
          </div>
        </>
      );
    }
    if (mode?.k === 'shoot' && modeUnit) {
      const opt = { mode: mode.smode, useCloseQuarters: mode.useCQ, profile: mode.profile, skipWeapons: mode.skip };
      const remaining = rangedWeaponNames(modeUnit).filter((n) => !modeUnit.weaponsFired.includes(n));
      const res = mode.target ? buildShootPools(s, modeUnit.id, mode.target, opt) : null;
      const multi = alive(modeUnit)[0]?.weapons.filter((w) => !isMelee(w.profiles[0]) && w.profiles.length > 1) ?? [];
      const hasCQ = alive(modeUnit).some((m) => m.weapons.some((w) => hasAbility(w.profiles[0], 'close-quarters'))) && alive(modeUnit).some((m) => m.weapons.some((w) => !isMelee(w.profiles[0]) && !hasAbility(w.profiles[0], 'close-quarters')));
      return (
        <>
          <div className="small"><b>{modeUnit.name}</b> <span className="muted">· {mode.smode === 'snap' ? 'Snap Shooting' : mode.smode === 'normal' ? 'Shoot' : mode.smode}{mode.target ? ` › ${U(mode.target).name}` : ' · tap a target'}</span></div>
          {!mode.overwatch && remaining.length > 1 && (
            <div className="row">
              <span className="label">Weapons shooting this target</span>
              {remaining.map((n) => {
                const off = (mode.skip ?? []).includes(n);
                return <button key={n} className={`btn small ${off ? '' : 'on'}`} onClick={() => setModeRaw({ ...mode, skip: off ? (mode.skip ?? []).filter((x) => x !== n) : [...(mode.skip ?? []), n] })}>{off ? '○' : '●'} {n}</button>;
              })}
            </div>
          )}
          <div className="row">
            {hasCQ && mode.smode !== 'closeQuarters' && <button className={`btn small ${mode.useCQ ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, useCQ: !mode.useCQ })}>Use Pistol / Close-quarters</button>}
            {multi.map((w) => (
              <button key={w.name} className="btn small" onClick={() => setModeRaw({ ...mode, profile: { ...mode.profile, [w.name]: ((mode.profile[w.name] ?? 0) + 1) % w.profiles.length } })}>
                {w.name}: {w.profiles[mode.profile[w.name] ?? 0].name}
              </button>
            ))}
          </div>
          {!mode.overwatch && abilityBar(modeUnit.owner, { unitId: modeUnit.id, whens: ['selectedToShoot', 'shooting'] })}
          {!mode.overwatch && buffPanel(modeUnit)}
          {res?.error && <div className="err">{res.error}</div>}
          {res && !res.error && (() => {
            // one row per weapon profile; cover can differ per shooter, so pools are merged for display
            const T = U(mode.target!);
            const groups = new Map<string, typeof res.pools>();
            for (const p of res.pools) { const k = p.weapon + '|' + p.profile.name; groups.set(k, [...(groups.get(k) ?? []), p]); }
            let total = 0;
            const rows = [...groups.values()].map((ps) => {
              const p = ps[0];
              const ev = ps.reduce((a, x) => a + expectedDamage(s, x, T).unsaved, 0);
              total += ev;
              const models = ps.reduce((a, x) => a + x.models, 0);
              const covered = ps.filter((x) => x.skillNote.includes('Cover')).reduce((a, x) => a + x.models, 0);
              return (
                <div key={p.key} className="small">
                  <b>{p.weapon}{p.profile.name !== p.weapon ? ` – ${p.profile.name}` : ''}</b> <span className="muted">×{models}</span>
                  <div className="statline">
                    Hit <b>{p.autoHit ? 'auto' : p.hitOn6Only ? '6' : `${p.skill}+`}</b>{p.hitMod ? ` (${p.hitMod > 0 ? '+' : ''}${p.hitMod})` : ''} · Wound <b>{p.woundNeed}+</b>{p.woundMod ? ` (+${p.woundMod})` : ''} · AP <b>{p.ap}</b> · D <b>{p.damage}</b>
                    {covered ? ` · cover ${covered}/${models}` : ''}{p.rerollAllHits ? ' · Oath' : ''}
                  </div>
                </div>
              );
            });
            return (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows}
                <div className="tiny muted">Expected unsaved wounds: about {total.toFixed(1)}</div>
              </div>
            );
          })()}
          {res && !res.error && res.notes.map((n) => <div key={n} className="err">{n}</div>)}
          <div className="row">
            <button className="btn" onClick={() => setMode(null)}>Cancel</button>
            <button className="btn primary grow" disabled={!res || !!res.error || !res.pools.length} onClick={() => {
              const auto = onAuto(s, modeUnit.owner);
              act((g) => {
                const gu = unitById(g, modeUnit.id);
                if (mode.overwatch) spendStratagem(g, gu.owner, 'fire-overwatch', gu);
                if (auto) { autoShoot(g, gu.id, mode.target!, opt, !!mode.overwatch); return; }
                const r = buildShootPools(g, gu.id, mode.target!, opt);
                startAttack(g, mode.overwatch ? 'overwatch' : 'shoot', gu.id, mode.target!, r.pools);
              });
              if (auto) setMode(null);
            }}>Shoot!{mode.overwatch ? ' (1CP)' : ''}</button>
          </div>
        </>
      );
    }
    const mine = boardUnits(s, s.active);
    const u = selUnit && mine.includes(selUnit) ? selUnit : null;
    const modes = u ? shootingModes(s, u) : [];
    const canExplode = u && !u.selectedToShoot && !isEngaged(s, u) && u.move !== 'advance' && u.move !== 'fallback' && (hasKw(u, 'GRENADES') || hasKw(u, 'EXPLOSIVES')) && !canUseStratagem(s, u.owner, 'explosives', u);
    return (
      <>
        {!selUnit && <div className="hint"><span>1. Tap a unit to shoot with 2. Tap a target — range, line of sight and cover are checked for you</span></div>}
        <div className="unit-strip">{mine.map((x) => unitPill(x, x.selectedToShoot || shootingModes(s, x).length === 0))}</div>
        {u && (
          <>
            {unitCard(u)}
            <div className="row acts">
              {modes.map((m) => <button key={m} className="btn primary" onClick={() => { act((g) => autoSelectToShoot(g, unitById(g, u.id))); setMode({ k: 'shoot', unitId: u.id, smode: m, target: null, useCQ: false, profile: {} }); }}><Icon name="shoot" /> {m === 'normal' ? 'Shoot' : m === 'assault' ? 'Assault (after Advancing)' : m === 'closeQuarters' ? 'Close-quarters' : 'Indirect'}</button>)}
              {modes.length === 0 && <span className="muted small">{u.selectedToShoot ? 'Already shot' : u.move === 'fallback' ? 'Fell Back: cannot shoot' : u.move === 'advance' ? 'Advanced (no Assault weapons)' : 'Cannot shoot'}</span>}
              {canExplode && <button className="btn small" onClick={() => setMode({ k: 'explosives', unitId: u.id, target: null })}>Explosives 1CP</button>}
              {u.weaponsFired.length > 0 && !u.selectedToShoot && <button className="btn small ghost" onClick={() => act((g) => endUnitShooting(unitById(g, u.id)))}>Done shooting with this unit</button>}
            </div>
            {u.weaponsFired.length > 0 && !u.selectedToShoot && <div className="tiny muted">Already fired: {u.weaponsFired.join(', ')} · its other weapons can shoot another target</div>}
            {actionOptions(s).filter((o) => o.unitId === u.id).length > 0 && (
              <div className="action-box">
                <div className="tiny"><b>Mission action</b> — instead of shooting (this unit cannot shoot or charge this turn)</div>
                {actionOptions(s).filter((o) => o.unitId === u.id).map((o) => (
                  <button key={o.action + (o.objId ?? '') + (o.terrainId ?? '') + (o.targetId ?? '')} className="btn small" onClick={() => { act((g) => startAction(g, o)); flash(`${o.name}: started`); }}>{o.label}</button>
                ))}
              </div>
            )}
          </>
        )}
        {!u && actionOptions(s).length > 0 && <div className="tiny muted">{new Set(actionOptions(s).map((o) => o.unitId)).size} unit(s) can start a mission action ({[...new Set(actionOptions(s).map((o) => o.name))].join(', ')}) — tap a unit to see it</div>}
        {s.pendingActions.filter((a) => a.player === s.active).length > 0 && <div className="tiny"><Icon name="wait" size={13} /> Actions completing at the end of the turn: {s.pendingActions.filter((a) => a.player === s.active).map((a) => `${MISSIONS.actions[a.action].name} (${U(a.unitId).name})`).join(', ')}</div>}
        {abilityBar(s.active, { whens: ['shooting', 'afterShootingButton', 'anyPhase'] })}
        {selUnit && selUnit.owner !== s.active && unitCard(selUnit)}
        {endButton('shooting', 'End Shooting', mine.some((x) => shootingModes(s, x).length > 0) && !mine.some((x) => x.shotTurn === s.turn || x.selectedToShoot), 'No unit has shot yet')}
      </>
    );
  };

  const chargePanel = () => {
    if (mode?.k === 'charge' && modeUnit) {
      const roll = modeUnit.chargeRoll ?? 0;
      const cr = canUseStratagem(s, modeUnit.owner, 'command-reroll', modeUnit);
      const finish = () => {
        if (!mode.heroic) return;
        // Countercharge (Champions of Fenris) lets another CHARACTER intervene in the same phase
        act((g) => { const p = modeUnit.owner; g.window = heroicCandidates(g, p).length ? { kind: 'heroicIntervention', player: p } : null; });
      };
      return (
        <>
          <div className="big-result">Charge roll: {roll}"</div>
          {chargeOpts.length ? <div className="hint"><span>Tap a highlighted enemy unit: your unit charges it</span></div> : <div className="small">No target within the rolled distance: the charge fails</div>}
          {mode.targets.length > 0 && moveControls('charge', () => confirmMove('charge', () => {
            finish();
            if (hasKw(modeUnit, 'MONSTER') || hasKw(modeUnit, 'VEHICLE')) setTimeout(() => setModeRaw({ k: 'crush', unitId: modeUnit.id }), 0);
          }), <button className="btn small" onClick={() => { const add = autoApproach(s, modeUnit, mode.targets.map(U), roll); setDraft(mergePaths(startPaths(modeUnit), add)); setCheck(null); }}>Auto</button>)}
          {check && !check.ok && <div className="tiny muted">Doesn't fit? Tap Auto, or "Cancel charge" (counts as a failed charge), then End Charge → Fight</div>}
          <div className="row">
            {canDetReroll(s, modeUnit, 'charge') && <button className="btn small" onClick={() => { act((g) => detReroll(g, unitById(g, modeUnit.id), 'charge', false, mode.heroic === 'fray' ? 6 : undefined)); setModeRaw({ ...mode, targets: [] }); setDraft(startPaths(modeUnit)); }}>Re-roll charge (Detachment, free)</button>}
            {!cr && <button className="btn small" onClick={() => { act((g) => rerollCharge(g, unitById(g, modeUnit.id), false, mode.heroic === 'fray' ? 6 : undefined)); setModeRaw({ ...mode, targets: [] }); setDraft(startPaths(modeUnit)); }}>Re-roll charge 1CP</button>}
            <button className="btn grow" onClick={() => { setMode(null); finish(); flash(`${modeUnit.name}: charge failed`); }}>{mode.targets.length ? 'Cancel charge' : 'Charge failed / Continue'}</button>
          </div>
        </>
      );
    }
    if (mode?.k === 'crush' && modeUnit) {
      return (
        <>
          <div className="small"><b>Charge successful!</b> Use Crushing Impact (1CP)? Tap an engaged enemy unit — roll a D6 per T: 5+ deals a mortal wound, a 1 wounds your unit</div>
          <button className="btn primary" onClick={() => setMode(null)}>Decline → Continue</button>
        </>
      );
    }
    const mine = boardUnits(s, s.active);
    const u = selUnit && mine.includes(selUnit) ? selUnit : null;
    const why = u ? chargeEligibility(s, u) : null;
    return (
      <>
        {!selUnit && <div className="hint"><span>Units within 12" of the enemy can charge · roll 2D6 first, then pick targets within range</span></div>}
        <div className="unit-strip">{mine.map((x) => unitPill(x, !!chargeEligibility(s, x)))}</div>
        {u && (
          <>
            {unitCard(u)}
            {why ? <div className="muted small">Cannot charge: {why}</div> : (
              <div className="row">
                <button className="btn primary" onClick={() => { act((g) => autoDeclareCharge(g, unitById(g, u.id), fly)); setMode({ k: 'charge', unitId: u.id, targets: [] }, startPaths(u)); }}>Declare charge (2D6)</button>
                {hasKw(u, 'FLY') && <button className={`btn small ${fly ? 'on' : ''}`} onClick={() => setFly(!fly)}>Fly (−2")</button>}
              </div>
            )}
          </>
        )}
        {onAuto(s, s.active) && mine.some((x) => !chargeEligibility(s, x) && !x.declaredCharge) && (
          <button className="btn" onClick={() => { const n = act((g) => autoCharges(g)); flash(n ? 'Charges made for you' : 'No charge worth making'); setSel(null); }}>Charge for me</button>
        )}
        {abilityBar(s.active, { whens: ['anyPhase'] })}
        {selUnit && selUnit.owner !== s.active && unitCard(selUnit)}
        {redoButton()}
        {endButton('charge', 'End Charge → Fight', mine.some((x) => !chargeEligibility(s, x)) && !mine.some((x) => x.declaredCharge), 'Some units can still charge')}
      </>
    );
  };

  const pilePanel = () => {
    if (mode?.k !== 'pile' || !modeUnit) return null;
    const u = modeUnit;
    const cm = mode.kind === 'consolidate' ? consolidateMode(s, u) : null;
    const pileTargets = isEngaged(s, u) ? engagedEnemies(s, u) : boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= RULES.pileIn.targetRange);
    const auto = () => {
      let add: Paths;
      if (cm?.mode === 'objective' && cm.objective) add = autoApproach(s, u, [], pileDistance(s, u, 'consolidate'), { objective: polyCentroid(objectiveTerrain(s, cm.objective).poly) });
      else add = autoApproach(s, u, cm ? cm.enemies : pileTargets, pileDistance(s, u, mode.kind));
      setDraft(mergePaths(startPaths(u), add));
      setCheck(null);
    };
    return (
      <>
        <div className="small"><b>{u.name}</b> · {mode.kind === 'pileIn' ? `Pile-in ${pileDistance(s, u, 'pileIn')}"${mode.overrun ? ' (Overrun)' : ''}` : `Consolidate ${pileDistance(s, u, 'consolidate')}" — mode: ${cm?.mode ?? '-'}`}</div>
        {moveControls(mode.kind === 'pileIn' ? 'pile-in' : 'consolidate', () => confirmMove(mode.kind, () => {
          if (!mode.overrun) return;
          const eng = act((g) => {
            const gu = unitById(g, u.id);
            const e = engagedEnemies(g, gu).map((x) => x.id);
            if (!e.length) markFought(g, gu);
            return e;
          });
          if (eng.length) setModeRaw({ k: 'fight', unitId: u.id, target: eng.length === 1 ? eng[0] : null, epic: false });
        }), <button className="btn small" onClick={auto}>Auto</button>)}
      </>
    );
  };

  const fightPanel = () => {
    const f = s.fight!;
    if (mode?.k === 'pile') return pilePanel();
    if (f.step === 'pileIn' || f.step === 'consolidate') {
      const p = f.stepPlayer;
      const list = boardUnits(s, p).filter((u) => (f.step === 'pileIn' ? pileInEligible(s, u) : consolidateEligible(s, u) && consolidateMode(s, u).mode));
      return (
        <>
          <div className="handoff">{f.step === 'pileIn' ? 'Pile-in' : 'Consolidate'} · {pName(s, p)} {p === s.active ? '(active player first)' : ''}</div>
          {list.length === 0 && <div className="muted small">No units to move</div>}
          {list.some((u) => !f.movedThisStep.includes(u.id)) && <div className="hint"><span>Tap a unit to{f.step === 'pileIn' ? ' pile in' : ' consolidate'} automatically (to place it yourself: Undo in the menu, then drag)</span></div>}
          <div className="unit-strip">{list.map((u) => unitPill(u, f.movedThisStep.includes(u.id), () => {
            setSel(u.id);
            if (f.movedThisStep.includes(u.id)) return;
            const kind = f.step === 'pileIn' ? 'pileIn' : 'consolidate';
            if (act((g) => autoPileMove(g, unitById(g, u.id), kind))) flash(`${u.name}: ${kind === 'pileIn' ? 'Pile-in' : 'Consolidate'} done`);
            else setMode({ k: 'pile', unitId: u.id, kind }, startPaths(u));
          }))}</div>
          {list.filter((u) => !f.movedThisStep.includes(u.id)).length > 1 && (
            <button className="btn" onClick={() => {
              const kind = f.step === 'pileIn' ? 'pileIn' : 'consolidate';
              const n = act((g) => list.filter((u) => !g.fight!.movedThisStep.includes(u.id)).filter((u) => autoPileMove(g, unitById(g, u.id), kind)).length);
              flash(`${kind === 'pileIn' ? 'Pile-in' : 'Consolidate'}: ${n} unit(s)`);
            }}>{f.step === 'pileIn' ? 'Pile-in' : 'Consolidate'} all units automatically</button>
          )}
          {f.step === 'pileIn' && abilityBar(p, { whens: ['fightStartButton', 'anyPhase'] })}
          <button className="btn primary" onClick={() => { act((g) => (f.step === 'pileIn' ? endPileInStep(g) : endConsolidateStep(g))); setMode(null); setSel(null); }}>Done <Icon name="next" /></button>
        </>
      );
    }
    // fight step
    if (mode?.k === 'fight' && modeUnit) {
      const u = modeUnit;
      const weapons = [...new Map(alive(u).flatMap(meleeWeapons).filter((w) => !hasAbility(w.profiles[0], 'extra-attacks')).map((w) => [w.name, w])).values()];
      const chars = alive(u).filter((m) => m.isCharacter);
      const ec = canUseStratagem(s, u.owner, 'epic-challenge', u);
      const res = mode.target ? buildFightPools(s, u.id, mode.target, { weapon: mode.weapon, epicChallengeModel: mode.epic ? chars[0]?.id : undefined }) : null;
      return (
        <>
          <div className="small"><b>{u.name}</b> · {fightTargets.length > 1 ? 'tap a target' : ''} Weapons (one per model):</div>
          <div className="row">
            {weapons.map((w) => <button key={w.name} className={`btn small ${mode.weapon === w.name ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, weapon: w.name })}>{w.name}</button>)}
            {chars.length > 0 && !ec && <button className={`btn small ${mode.epic ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, epic: !mode.epic })}>Epic Challenge 1CP</button>}
          </div>
          {abilityBar(u.owner, { unitId: u.id, whens: ['selectedToFight', 'fightStartButton'] })}
          {buffPanel(u)}
          {res?.pools.map((p) => <div key={p.key} className="tiny">{p.weapon}: {p.attackNote} · Hit {p.skill}+ · Wound {p.woundNeed}+ ({p.woundNote}) · AP{p.ap} D{p.damage}</div>)}
          {res?.notes.map((n) => <div key={n} className="err">{n}</div>)}
          <div className="row">
            <button className="btn primary grow" disabled={!res || !res.pools.length} onClick={() => act((g) => {
              const gu = unitById(g, u.id);
              if (mode.epic) spendStratagem(g, gu.owner, 'epic-challenge', gu);
              const r = buildFightPools(g, gu.id, mode.target!, { weapon: mode.weapon, epicChallengeModel: mode.epic ? chars[0]?.id : undefined });
              startAttack(g, 'fight', gu.id, mode.target!, r.pools);
            })}>Fight!</button>
          </div>
        </>
      );
    }
    const cands = fc!;
    const pick = (u: UnitState) => {
      setSel(u.id);
      act((g) => unitSelected(g, unitById(g, u.id), 'fight'));
      const eng = engagedEnemies(s, u);
      if (eng.length) setMode({ k: 'fight', unitId: u.id, target: eng.length === 1 ? eng[0].id : null, epic: false });
      else setMode({ k: 'pile', unitId: u.id, kind: 'pileIn', overrun: true }, startPaths(u));
    };
    const overrunReady = selUnit && cands.units.includes(selUnit) && !isEngaged(s, selUnit);
    return (
      <>
        {cands.player !== null && <div className="handoff">{pName(s, cands.player)} selects a unit to fight{cands.units.some((u) => u.chargedTurn === s.turn || u.core.fightsFirst || u.foughtFirstUntilTurn === s.turn) ? ' (Fights First units first)' : ''}</div>}
        <div className="unit-strip">{cands.units.map((u) => unitPill(u, false, () => pick(u)))}</div>
        {overrunReady && (
          <div className="row">
            <span className="small grow">{selUnit!.name} is no longer engaged: Overrun (pile in 3" more)</span>
            {isEngaged(s, selUnit!) ? null : <button className="btn small" onClick={() => act((g) => markFought(g, unitById(g, selUnit!.id)))}>Skip (does not fight)</button>}
          </div>
        )}
        {cands.units.length === 0 && <div className="muted small">No units can fight</div>}
      </>
    );
  };

  const scoutsPanel = () => {
    if (mode?.k === 'move' && modeUnit) {
      return (
        <>
          <div className="small"><b>{modeUnit.name}</b> · Scout move up to {modeUnit.core.scouts}" · must end more than {RULES.reserves.enemyDistance}" from enemies</div>
          {moveControls('scout', () => confirmMove('scout'))}
        </>
      );
    }
    const p = s.deployTurn;
    const list = scoutUnits(s, p);
    return (
      <>
        <div className="handoff">Pre-battle · Scouts · {pName(s, p)}</div>
        <div className="unit-strip">{list.map((u) => unitPill(u, false, () => { setSel(u.id); setMode({ k: 'move', unitId: u.id, kind: 'scout', fly: false }, startPaths(u)); }))}</div>
        {!list.length && <div className="muted small">No Scouts units left to move</div>}
        <button className="btn primary" onClick={() => { act((g) => endScouts(g)); setSel(null); }}>Done <Icon name="next" /></button>
      </>
    );
  };

  const missionsSheet = () => {
    const L = deploymentById(s.deploymentId);
    const whenTh: Record<string, string> = { endOfYourTurn: 'end of your turn', endOfYourCommandPhase: 'end of your Command phase (round 5: end of turn)', endOfBattle: 'end of the battle', endOfAnyTurn: 'end of every turn' };
    return (
      <div className="tray-backdrop" onClick={() => setShowMissions(false)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-title">Mission</div>
          <div className="small muted">{L.name} · Layout {L.matchup.map((m) => dispositionById(m).name).join(' vs ')} #{L.number} · {s.objectives.length} objectives</div>
          {s.players.map((P, i) => {
            const p = i as PlayerId;
            const prim = primaryById(P.primaryId);
            const disp = dispositionById(P.disposition as DispositionId);
            const M = P.mission;
            const notes = [
              M.trapped.length && `trapped ${M.trapped.length}`, M.decoyed.length && `decoyed ${M.decoyed.length}`, M.consecrated.length && `consecrated ${M.consecrated.length}`,
              M.triangulated.length && `triangulated ${M.triangulated.length}`, M.condemned.length && `condemned: ${M.condemned.map((id) => U(id).name).join(', ')}`,
              s.markers.filter((m) => m.owner === p).length && `operation marker ${s.markers.filter((m) => m.owner === p).length}`,
            ].filter(Boolean);
            const act0 = prim.action ? MISSIONS.actions[prim.action] : undefined;
            return (
              <div key={i} className={`card side ${i ? 's1' : ''}`}>
                <div className="row">
                  <span className="disp-chip" style={{ background: disp.color }}>{disp.name}</span>
                  <b className="grow">{P.name}</b>
                  <span className="small">{P.vp} / 45 VP</span>
                </div>
                <div style={{ fontWeight: 700 }}>Primary: {prim.name}</div>
                {prim.scoring.map((r) => (
                  <div key={r.text + r.rounds} className="small prim-row">
                    <span className="tiny muted">{r.rounds[0] === r.rounds[1] ? `R${r.rounds[0]}` : r.rounds[0] === 1 && r.rounds[1] === 5 ? 'every round' : `R${r.rounds[0]}–${r.rounds[1]}`} · {whenTh[r.when]}</span>
                    <div>{r.text} <b>{r.tiers ? '' : `${r.vp}VP`}</b>{r.bonus ? <span className="muted"> {r.bonusText ?? ''} (+{r.bonus.vp})</span> : null}</div>
                  </div>
                ))}
                {act0 && <div className="tiny"><b>Action: {act0.name}</b> — {act0.text}</div>}
                {notes.length > 0 && <div className="tiny muted">Status: {notes.join(' · ')}</div>}
                {P.secMode !== 'none' && (() => {
                  const fixedPicking = P.secMode === 'fixed' && P.secActive.length < 2;
                  return (
                    <div className="sec-block">
                      <div className="row"><b className="grow">Secondary ({P.secMode === 'tactical' ? 'Tactical' : 'Fixed'})</b><span className="small">{P.secVp} VP</span></div>
                      {fixedPicking && !bots.includes(p) && (
                        <>
                          <div className="small muted">Select 2 Fixed Missions (for the whole battle)</div>
                          <div className="row wrap">
                            {MISSIONS.secondaries.filter((x) => x.fixed).map((x) => (
                              <button key={x.id} className="btn small" onClick={() => act((g) => chooseFixedSecondaries(g, p, [...g.players[p].secActive, x.id]))} disabled={P.secActive.includes(x.id)}>{x.name}</button>
                            ))}
                          </div>
                        </>
                      )}
                      {!fixedPicking && P.secActive.length === 0 && <div className="small muted">{P.secMode === 'tactical' ? 'Cards are drawn up to 2 at the start of your Command phase' : '—'}</div>}
                      {!fixedPicking && P.secActive.map((id) => {
                        const d = secondaryById(id);
                        const extra = id === 'beacon' && P.sec.beacon ? `beacon: ${U(P.sec.beacon).name}` : id === 'a-tempting-target' && P.sec.temptingTarget ? `tempting target: objective ${s.objectives.findIndex((o) => o.id === P.sec.temptingTarget) + 1}` : id === 'burden-of-trust' ? `guarding ${P.sec.guards.length} objective(s)` : '';
                        return (
                          <div key={id} className="sec-card">
                            <div className="row"><b className="grow">{d.name}</b><span className="tiny muted">{d.when}</span></div>
                            <div className="small"><Em text={d.text} /></div>
                            {extra && <div className="tiny muted">{extra}</div>}
                            <div className="row" style={{ marginTop: 6 }}>
                              <span className="tiny muted grow">Scored automatically{P.secMode === 'fixed' ? ` · ${P.secFixedVp[id] ?? 0}/20 so far` : ''}</span>
                              {P.secMode === 'tactical' && !bots.includes(p) && <button className="btn small ghost" onClick={() => act((g) => discardSecondary(g, p, id))}>Discard{s.active === p ? ' (+1CP)' : ''}</button>}
                              {P.secMode === 'tactical' && !bots.includes(p) && !P.secSwapUsed && s.active === p && s.phase === 'command' && P.cp >= 1 && <button className="btn small ghost" onClick={() => act((g) => swapSecondary(g, p, id))}>New Orders 1CP</button>}
                            </div>
                            {!bots.includes(p) && (
                              <details className="tiny">
                                <summary>Score manually (if the app could not check it)</summary>
                                <div className="row wrap">{[1, 2, 3, 4, 5].map((v) => <button key={v} className="btn small ghost" onClick={() => { const got = act((g) => claimSecondary(g, p, id, v)); flash(`+${got} VP`); }}>+{v}</button>)}</div>
                              </details>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          <div className="tiny muted">Primary: up to 15 VP per round, 45 total · Secondary: up to 15 VP per round, 45 total (Fixed: up to 20 per card)</div>
          <button className="btn" onClick={() => setShowMissions(false)}>Close</button>
        </div>
      </div>
    );
  };

  const panel = () => {
    if (s.phase === 'gameover') return null;
    if (spectate) return (
      <div className="row">
        <div className="handoff grow">Bot vs Bot · {actingBot !== null ? `${pName(s, actingBot)} is playing` : 'in progress'}</div>
        <div className="seg" style={{ minWidth: 170 }}>
          <button className={speed === 0 ? 'on' : ''} onClick={() => setSpeed(0)}>Pause</button>
          <button className={speed === 1 ? 'on' : ''} onClick={() => setSpeed(1)}>Normal</button>
          <button className={speed === 2 ? 'on' : ''} onClick={() => setSpeed(2)}>Fast</button>
        </div>
      </div>
    );
    if (actingBot !== null) return <div className="handoff">{pName(s, actingBot)} is playing…</div>;
    if (s.phase === 'scouts') return scoutsPanel();
    if (mode?.k === 'move' && (mode.kind === 'extra' || mode.kind === 'surge')) return extraMovePanel();
    if (s.window) return windowPanel();
    if (s.phase === 'deploy') return deployPanel();
    if (s.phase === 'command') return commandPanel();
    if (s.phase === 'movement') return movementPanel();
    if (s.phase === 'shooting') return shootPanel();
    if (s.phase === 'charge') return chargePanel();
    if (s.phase === 'fight') return fightPanel();
    return null;
  };

  const layoutName = deploymentById(s.deploymentId).name;
  const draftUnit = mode && (mode.k === 'move' || mode.k === 'place' || mode.k === 'charge' || mode.k === 'pile') ? mode.unitId : null;

  return (
    <>
      <div className="topbar">
        <button className="btn small ghost" onClick={() => setShowMenu(true)} aria-label="Menu"><Icon name="menu" size={24} /></button>
        <div className="grow">
          <div className="phase">{s.phase === 'deploy' ? 'Deployment' : s.phase === 'scouts' ? 'Pre-battle' : `Round ${s.round}/5`}</div>
          <div className="tiny muted">{s.phase === 'deploy' || s.phase === 'scouts' ? layoutName : `${pName(s, s.active)}'s turn`}</div>
        </div>
        <button className="score" onClick={() => setShowMissions(true)}>
          <span className="p0">{s.players[0].vp + s.players[0].secVp}<small> VP</small> {s.players[0].cp}<small> CP</small></span>
          <span className="p1">{s.players[1].vp + s.players[1].secVp}<small> VP</small> {s.players[1].cp}<small> CP</small></span>
        </button>
        {(s.players[0].secMode !== 'none' || s.players[1].secMode !== 'none') && (
          <button className="btn small cards-btn" onClick={() => setShowCards(true)} aria-label="Secondary Mission cards">
            <Icon name="objective" size={18} />Cards<span className="cards-n">{s.players[me].secActive.length}</span>
          </button>
        )}
        <button className="btn small" onClick={() => openStrats()}>Strat</button>
      </div>
      {['command', 'movement', 'shooting', 'charge', 'fight'].includes(s.phase) && (
        <div className="phasebar">
          {(['command', 'movement', 'shooting', 'charge', 'fight'] as const).map((ph) => (
            <span key={ph} className={s.phase === ph ? 'on' : ['command', 'movement', 'shooting', 'charge', 'fight'].indexOf(ph) < ['command', 'movement', 'shooting', 'charge', 'fight'].indexOf(s.phase) ? 'done' : ''}>{PHASE_TH[ph][0]}{PHASE_TH[ph].slice(1).toLowerCase()}</span>
          ))}
        </div>
      )}
      <div className="board-wrap">
        <Board
          s={s}
          viewer={actor}
          selected={sel}
          draftUnit={draftUnit}
          draft={draft}
          maxFor={mode?.k === 'place' ? undefined : maxFor}
          walk={mode?.k === 'place' ? undefined : walkDraft}
          animateMoves={bots.length ? bots : undefined}
          bad={check?.bad}
          targets={targets}
          picked={picked}
          rings={rings}
          badges={badges}
          goals={goals}
          losLines={losLines}
          noLos={noLos}
          onTapUnit={onTapUnit}
          measure={tape.on ? { a: tape.a, b: tape.b, label: tapeInfo?.text, los: tapeInfo?.los } : undefined}
          onTapBoard={onTapBoard}
          onDraft={(d) => { setDraft(d); setCheck(null); }}
          onDragEnd={onDragEnd}
        />
        {botSays && (() => { const nm = pName(s, botWho ?? bot ?? 1); return <div className="bot-caption">{botSays.includes(nm) ? botSays : <><b>{nm}</b> {botSays}</>}</div>; })()}
        {toast && <div className="toast">{toast}</div>}
        {tape.on && (
          <div className="tape-bar">
            <span>{tapeInfo ? tapeInfo.line : tape.a ? 'Tap the second point (tap a model = base to base + line of sight)' : 'Tape measure: tap a model or a first point'}</span>
            <button className="btn small" onClick={() => setTape({ on: false })}>Close</button>
          </div>
        )}
        {mode?.k === 'shoot' && !mode.target && <div className="toast">Tap a highlighted enemy unit to target it ({targets.length} targets)</div>}
      </div>
      <div className={`panel ${actor ? 's1' : ''}`}>
        {s.phase !== 'deploy' && s.phase !== 'gameover' && !s.window && <div className="label"><span className={actor ? 'p1' : 'p0'}>●</span> {pName(s, actor)} to act</div>}
        {panel()}
      </div>

      <RollOverlay s={s} onBusy={setRolling} quick={spectate} />
      {s.attack && (
        <DiceTray
          s={s}
          onStrat={(pl) => openStrats(pl)}
          stratFor={([0, 1] as PlayerId[]).filter((p) => !bots.includes(p))}
          botSides={bots}
          onStep={() => act((g) => stepAttack(g))}
          onReroll={onReroll}
          onFree={(k, i) => { const e = act((g) => useFreeDie(g, k, i)); if (e) flash(e); }}
          onSkip={() => act((g) => resolveAll(g))}
          onClose={onTrayClose}
          onPick={(i) => act((g) => toggleRerollPick(g, i))}
          onCR={(what) => {
            const e = act((g) => {
              const at = g.attack!;
              if (what === 'attacks') return rerollAttackCount(g, at.idx);
              const p = at.pools[at.idx];
              p.crDamage = !p.crDamage;
              return null;
            });
            if (e) flash(e);
          }}
          auto={!!s.attack.defenderRolls && bots.includes(U(s.attack.attackerId).owner)}
        />
      )}

      {sheet && (
        <div className="tray-backdrop" onClick={() => setSheet(null)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <UnitView u={U(sheet)} />
            {abilityBar(U(sheet).owner, { unitId: sheet })}
            <button className="btn" onClick={() => setSheet(null)}>Close</button>
          </div>
        </div>
      )}

      {showMissions && missionsSheet()}
      {showCards && (() => {
        const p = cardSide ?? me;
        const P = s.players[p];
        const prim = primaryById(P.primaryId);
        const disp = dispositionById(P.disposition as DispositionId);
        const act0 = prim.action ? MISSIONS.actions[prim.action] : undefined;
        const whenTh: Record<string, string> = { endOfYourTurn: 'end of your turn', endOfYourCommandPhase: 'end of your Command phase', endOfBattle: 'end of the battle', endOfAnyTurn: 'end of every turn' };
        const rounds = (r: number[]) => (r[0] === r[1] ? `Round ${r[0]}` : r[0] === 1 && r[1] === 5 ? 'Every round' : `Rounds ${r[0]}–${r[1]}`);
        return (
          <div className="tray-backdrop" onClick={() => setShowCards(false)}>
            <div className="tray mc" onClick={(e) => e.stopPropagation()}>
              <div className="row">
                <div className="sheet-title grow">Mission cards</div>
                <button className="btn small ghost" onClick={() => setShowCards(false)}>Close</button>
              </div>
              <div className="mc-tabs" role="tablist">
                {([me, other(me)] as PlayerId[]).map((q) => (
                  <button key={q} role="tab" aria-selected={q === p} className={`mc-tab ${q === p ? 'on' : ''} ${q ? 'p1' : 'p0'}`} onClick={() => setCardSide(q)}>
                    {s.players[q].name}<span className="mc-tab-vp">{s.players[q].vp + s.players[q].secVp} VP</span>
                  </button>
                ))}
              </div>
              <div className="mc-score">
                <div><span>Primary</span><b>{P.vp}<small>/45</small></b></div>
                <div><span>Secondary</span><b>{P.secVp}</b></div>
                <div><span>CP</span><b>{P.cp}</b></div>
              </div>

              <section className="mc-sec">
                <div className="mc-head"><span className="mc-kicker">Primary Mission</span><span className="disp-chip" style={{ background: disp.color }}>{disp.name}</span></div>
                <div className="mc-prim">
                  <div className="mc-prim-name">{prim.name}</div>
                  {prim.scoring.map((r) => (
                    <div key={r.text + r.rounds} className="mc-rule">
                      <div className="mc-rule-when"><span className="mc-round">{rounds(r.rounds)}</span> {whenTh[r.when] ?? r.when}</div>
                      <div className="mc-rule-body"><span className="grow">{r.text}{r.bonus ? <span className="muted"> · {r.bonusText ?? ''} (+{r.bonus.vp})</span> : null}</span>{!r.tiers && <span className="mc-vp">{r.vp} VP</span>}</div>
                    </div>
                  ))}
                  {act0 && <div className="mc-action"><b>Action · {act0.name}</b><div>{act0.text}</div></div>}
                </div>
              </section>

              {P.secMode !== 'none' && (
                <section className="mc-sec">
                  <div className="mc-head">
                    <span className="mc-kicker">Secondary · {P.secMode === 'tactical' ? 'Tactical' : 'Fixed'}{P.secMode === 'tactical' && <span className="mc-deck"> · {P.secDeck.length} left in deck</span>}</span>
                    <button className={`btn small mc-map ${showGoals ? 'on' : ''}`} onClick={() => setShowGoals((x) => !x)}><Icon name="objective" size={15} /> {showGoals ? 'Shown on map' : 'Hidden on map'}</button>
                  </div>
                  {P.secActive.length === 0 && <div className="small muted">{P.secMode === 'tactical' ? `No cards yet: ${P.name} draws up to 2 at the start of their Command phase` : 'Not selected yet'}</div>}
                  <div className="sec-list">
                    {P.secActive.map((id) => {
                      const vp = secondaryPreview(s, p, id);
                      const goal = secondaryGoal(s, p, id);
                      const dead = P.secMode === 'tactical' && secondaryDead(s, p, id);
                      return (
                        <div key={id} className="sec-slot">
                          <SecondaryCard id={id} owner={p} dead={dead} progress={dead ? 'Cannot be achieved any more: discard it' : vp ? `If the turn ended now: +${vp} VP` : `To do: ${goal.todo}`} />
                          {P.secMode === 'tactical' && !bots.includes(p) && (
                            <>
                              <button className="btn sec-discard" onClick={() => { act((g) => discardSecondary(g, p, id)); flash(s.active === p ? 'Card discarded, +1CP' : 'Card discarded (CP only in your own turn)'); }}>
                                <Icon name="delete" size={18} /> Discard{s.active === p ? ' (+1CP)' : ''}
                              </button>
                              {!P.secSwapUsed && s.active === p && s.phase === 'command' && P.cp >= 1 && (
                                <button className="btn small sec-discard" onClick={() => act((g) => swapSecondary(g, p, id))}><Icon name="reroll" size={16} /> New Orders (1CP, once)</button>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        );
      })()}
      {showMenu && (
        <div className="tray-backdrop" onClick={() => setShowMenu(false)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">Menu</div>
            <button className="btn" disabled={!canUndo} onClick={() => { undo(); setMode(null); setShowMenu(false); flash('Undone one step'); }}>Undo</button>
            <button className="btn" onClick={() => { setShowMenu(false); setShowMissions(true); }}>Mission & Secondary</button>
            <button className="btn" onClick={() => { setShowMenu(false); setTape({ on: true }); }}>Tape measure</button>
            <button className="btn" onClick={() => { setShowMenu(false); setShowLog(true); }}>Battle log & army rules</button>
            <button className="btn" onClick={() => { setShowMenu(false); openStrats(); }}>Stratagems</button>
            {([0, 1] as PlayerId[]).filter((p) => !bots.includes(p)).map((p) => (
              <button key={p} className={`btn ${(s.autoRules ?? []).includes(p) ? 'on' : ''}`} onClick={() => act((g) => { const a = g.autoRules ?? []; g.autoRules = a.includes(p) ? a.filter((x) => x !== p) : [...a, p]; })}>
                {bots.length ? 'Auto rules' : `${pName(s, p)}: auto rules`}: {(s.autoRules ?? []).includes(p) ? 'on (you only move and shoot)' : 'off (you take every decision)'}
              </button>
            ))}
            {bots.length === 1 && !(s.autoRules ?? []).includes(human ?? 0) && (
              <button className={`btn ${s.defenderRolls !== false ? 'on' : ''}`} onClick={() => act((g) => { g.defenderRolls = g.defenderRolls === false; })}>
                When the bot attacks: {s.defenderRolls !== false ? 'I roll my saves (Command Re-roll available)' : 'roll automatically'}
              </button>
            )}
            <button className="btn danger" onClick={onExit}>Exit to home (game saved)</button>
            <button className="btn ghost" onClick={() => setShowMenu(false)}>Close</button>
          </div>
        </div>
      )}
      {showStrats && (() => {
        const p = stratPlayer ?? actor;
        const P = s.players[p];
        const all = stratagemsNow(s, p);
        const tgtUnit = stratUnit ? s.units.find((u) => u.id === stratUnit && onBoard(u)) : undefined;
        const rows = all.map((x) => ({ ...x, why: stratagemBlock(s, p, x.st, tgtUnit) }));
        const timingOk = (why: string | null) => !why || /Select a target|Must be one of your units|Select an enemy unit|Not enough CP|TARGET|does not qualify|No enemy unit/.test(why);
        const now = rows.filter((r) => timingOk(r.why));
        const later = rows.filter((r) => !timingOk(r.why));
        const card = (r: typeof rows[number]) => (
          <StratUseCard key={r.st.id + (stratUnit || '')} s={s} p={p} st={r.st} rule={r.rule} detachment={r.detachment} bot={bots.includes(p)}
            units={(r.plan.target === 'own' ? stratCandidates(s, p, r.st) : r.plan.target === 'enemy' && !r.rule.enemy ? boardUnits(s, other(p)) : []).filter((u) => !tgtUnit || u.id === tgtUnit.id || u.owner !== tgtUnit.owner)}
            auto={P.autoStrats?.includes(r.st.id)}
            onAuto={r.rule.react ? () => act((g) => { const GP = g.players[p]; GP.autoStrats = GP.autoStrats?.includes(r.st.id) ? GP.autoStrats.filter((x) => x !== r.st.id) : [...(GP.autoStrats ?? []), r.st.id]; }) : undefined}
            onUse={(unitId, use) => {
              const eff = act((g) => applyDetachmentStratagem(g, p, r.st, unitId, use));
              flash(eff && eff.length ? `${r.st.name}: ${eff.map((k) => EFFECT_LABEL[k] ?? k).join(', ')}` : `Used ${r.st.name}`);
              setShowStrats(false);
            }} />
        );
        return (
          <div className="tray-backdrop" onClick={() => setShowStrats(false)}>
            <div className="tray" onClick={(e) => e.stopPropagation()}>
              <div className="row">
                <div className="sheet-title grow"><span className={p ? 'p1' : 'p0'}>Stratagems</span></div>
                <span className="chip">{P.cp} CP</span>
              </div>
              {bots.length === 0 && (
                <div className="seg">
                  {[0, 1].map((i) => <button key={i} className={p === i ? 'on' : ''} onClick={() => { setStratPlayer(i as PlayerId); setStratUnit(''); }}>{s.players[i].name}</button>)}
                </div>
              )}
              <div className="small muted">{PHASE_TH[s.phase] ?? s.phase} · {s.active === p ? 'your turn' : "opponent's turn"} — pick a unit and tap Use: the CP is spent and the effect applied for you (until the end of the phase / turn as written)</div>
              <div className="card-title">Usable now ({now.length})</div>
              {now.length ? now.map(card) : <div className="small muted">No Detachment Stratagems can be used right now</div>}
              {later.length > 0 && (
                <details>
                  <summary className="small">Not usable now ({later.length})</summary>
                  {later.map(card)}
                </details>
              )}
              <div className="card-title">Core Stratagems</div>
              <div className="tiny muted">Offered automatically when the moment comes (Command Re-roll in the dice tray, Fire Overwatch / Heroic Intervention / Smokescreen / Rapid Ingress at the end of a phase, Insane Bravery at Battle-shock …)</div>
              {RULES.coreStratagems.map((st) => <div key={st.id} className="small"><b>{st.name}</b> ({st.cp}CP) — {st.when}: <Em text={st.text} /></div>)}
              <button className="btn" onClick={() => setShowStrats(false)}>Close</button>
            </div>
          </div>
        );
      })()}

      {showLog && (
        <div className="tray-backdrop" onClick={() => setShowLog(false)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <h2>Battle Log</h2>
            <div className="log">
              {[...s.log].reverse().map((l, i) => <div key={i} className={l.kind}>{l.round ? `R${l.round} ` : ''}{l.text}</div>)}
            </div>
            <button className="btn small" onClick={() => { setShowLog(false); setShowMissions(true); }}>Both players' Primary / Secondary Missions</button>
            {s.players.map((p, i) => (
              <details key={i}>
                <summary className={i ? 'p1' : 'p0'}>{p.name}: Army rules & Detachments</summary>
                {chapterRules(p.armyRules, p.subfaction).map((r) => <div key={r.name} className="sheet rt-wrap"><b>{r.name}</b><RuleText text={r.text} /></div>)}
                {p.detachments.map((d) => (
                  <div key={d.id} className="sheet"><b>{d.name}</b> ({d.forceDisposition}){'\n'}{d.rules.map((r) => `• ${r.name}: ${r.text}`).join('\n')}{'\n'}<i>Stratagems:</i>{'\n'}{d.stratagems.map((st) => `• ${st.name} (${st.cp}CP) — ${st.text}`).join('\n')}</div>
                ))}
              </details>
            ))}
            <button className="btn" onClick={() => setShowLog(false)}>Close</button>
          </div>
        </div>
      )}

      {s.phase === 'gameover' && (
        <div className="tray-backdrop">
          <div className="tray">
            <div className="big-result">{s.winner === 'draw' ? 'Draw!' : `${pName(s, s.winner as PlayerId)} wins!`}</div>
            <div className="big-result">{s.players[0].vp + s.players[0].secVp} – {s.players[1].vp + s.players[1].secVp}</div>
            <div className="small muted" style={{ textAlign: 'center' }}>
              {([0, 1] as PlayerId[]).map((p) => `${pName(s, p)}: Primary ${s.players[p].vp} + Secondary ${s.players[p].secVp}`).join(' · ')}
            </div>
            <button className="btn primary" onClick={onExit}>Back to home</button>
          </div>
        </div>
      )}
    </>
  );
}
