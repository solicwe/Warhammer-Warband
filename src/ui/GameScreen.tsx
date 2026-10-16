import { autoCharges, autoDeclareCharge, autoDue, autoEndMovement, autoSelectToShoot, autoShoot, autoStep, decides, onAuto } from '../engine/autoPlay';
import { pathBlocked, routeAround } from '../engine/pathing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { chapterRules } from '../engine/army';
import { RuleText } from './RuleText';
import { modelPortraitKey } from './portraits';
import { loadoutSummary } from './loadout';
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
  formationAt, heroicCandidates, heroicMode, hullSpots, ingressUnit, markFought, maxMoveDistance, nudgePlacement, objectiveTerrain, openCounteroffensive, overwatchCandidates, pileInEligible,
  rapidIngressCandidates, remainStationary, rerollCharge, rollAdvance, rollBattleShock, sendToReserves, smokescreenCandidates, useCounteroffensive,
  validateMove, validatePlacement, chargeReach, type MoveCheck, hasArmyRule, markRuleLabel, markRuleName, setOathTarget, callWaaagh, isRiledUp, unitHasAbility,
  canEmbarkIn, embarkUnit, disembarkMode, disembarkUnit, validateDisembark, embarkedIn, scoutUnits, endScouts, transportSpaceUsed,
  claimSecondary, discardSecondary, swapSecondary, chooseFixedSecondaries, settleMove, canDetReroll, detReroll,
  beginMove, hasDeepStrike, setOathBackup, arrivalRound,
  pileDistance, endRedeploy, redeployCandidates, redeployUnit, zoneOf } from '../engine/game';
import {
  abilityChoices, acceptOffer, closeOffers, manualActs, pickAbilities, resolvePickUnit, unitSelected, useActByKey, useFreeDie, type Trigger,
} from '../engine/activations';
import { activeLabels, effectsFor, isRiled, unitFlags, withRuleCache, type Effect } from '../engine/effects';
import { activeIds, applyPick, BLESSINGS, blessingById, rerollBlessings } from '../engine/blessings';
import { botPledge, setPledge } from '../engine/emperorsChildren';
import { BlessingsPanel } from './Blessings';
import { detChoices, detSummary, pickDetChoice } from '../engine/detachments';
import { botAct, botShouldAct, botStep } from '../engine/bot';
import { advantage, applyStyle, boardSig, lookBudget, lookSig, setLookahead, styleChosen, type Intent } from '../engine/botLook';
import LookWorker from './lookWorker?worker&inline';
import { actionOptions, startAction } from '../engine/missions';
import { Icon } from './Icon';
import { Joystick } from './Joystick';
import { RollOverlay, roundsText, SecondaryCard } from './RollOverlay';
import { attemptRitual, casters, endRituals, RITUALS, ritualsLeft, ritualsPending, ritualTargets, testOdds } from '../engine/rituals';
const RITUAL_NAMES = new Set(RITUALS.map((r) => r.name));
import { secondaryDead, secondaryGoal, secondaryPreview } from '../engine/secondaries';
import { EFFECT_LABEL, stratagemBlock, stratagemsNow, applyDetachmentStratagem, answerReaction, stratCandidates, stratRuleFor } from '../engine/stratagems';
import { StratUseCard } from './StratUse';
import { endUnitShooting, rerollAttackCount, toggleRerollPick, unfiredWeaponNames } from '../engine/attack';
import { isOfficer, ordersRemaining, canOfficerTarget, officerAllowedOrders, currentOrders, issueOrder } from '../engine/orders';
import { isTauArmy } from '../engine/tau';
import { dist, polyCentroid } from '../engine/geometry';
import { smartPlacement } from '../engine/deploy';
import {
  alive, boardUnits, canUseStratagem, engagedEnemies, hasKw, isEngaged, lastRound, onBoard, other, spendStratagem, strength, unitById, unitDistance,
} from '../engine/state';
import type { BuffKind, GameState, ModelState, MoveKind, PlayerId, Pt, UnitState } from '../engine/types';
import { hasCover, hasLos, isHidden, modelVisible, unitVisibleTo } from '../engine/visibility';
import { baseDist } from '../engine/geometry';
import { Portrait, unitToken } from './Tokens';
import { isMelee, hasAbility } from '../engine/weapons';
import { Board, type Paths, type Ring } from './Board';
import { DiceTray } from './DiceTray';
import { Coach, loadCoach, saveCoach, tipsNow } from './Coach';
import { canMakePact, madePact, makeDarkPact, type PactPick } from '../engine/darkPacts';
import { RelicStrip } from './Relics';
import { UnitView } from './Sheet';
import { useGame } from './store';
import { AttackReport } from './AttackReport';
import { AdvantageBar, Commander, RoundSummary, SideScore, tally, type RoundTally, type ThinkView } from './Hud';
import { play, setSoundOn, soundOn } from './sfx';
import { line, type VoiceEvent } from './voice';

type FxLevel = 'full' | 'short' | 'off';
const FX_PREF = 'fx-level';
const loadFxLevel = (): FxLevel => { try { const v = localStorage.getItem(FX_PREF); return v === 'short' || v === 'off' ? v : 'full'; } catch { return 'full'; } };

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
/** What the look worker answers: progress while it plays the ways out, then the style (and, pondering, the board it starts from). */
type LookMsg = { id: number; sig?: string | null; name?: string; values?: Record<string, number>; intents?: Intent[]; progress?: { name: string; value: number; done: number; total: number } };

const sg = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
/** Short "+1 Hit" tags for an effect on a unit, and whether it helps that unit. */
function fxTags(e: Effect): [string, boolean][] {
  const o: [string, boolean][] = [];
  const att = e.attack === 'melee' ? ' melee' : e.attack === 'ranged' ? ' shoot' : '';
  const num = (v: number | undefined, name: string, goodUp = true) => { if (v) o.push([`${sg(v)} ${name}`, (v > 0) === goodUp]); };
  num(e.hit, `Hit${att}`); num(e.wound, `Wound${att}`); num(e.ap, 'AP'); num(e.strength, 'S'); num(e.attacks, 'A'); num(e.damage, 'D');
  num(e.move, 'M'); num(e.ld, 'Ld'); num(e.oc, 'OC'); num(e.toughness, 'T'); num(e.chargeBonus, 'Charge');
  if (e.reroll) o.push([`Re-roll${att}`, true]);
  for (const a of e.abilities ?? []) if (a !== 'psychic') o.push([a.replace(/\b\w/g, (c) => c.toUpperCase()), true]);
  const d = e.defend;
  if (d) {
    if (d.hit) o.push([`${sg(d.hit)} to be hit`, d.hit < 0]);
    if (d.wound) o.push([`${sg(d.wound)} to be wounded`, d.wound < 0]);
    if (d.ap) o.push([`AP ${sg(-d.ap)} vs it`, d.ap > 0]);
    if (d.damage) o.push(['−1 D vs it', true]);
    if (d.inv) o.push([`${d.inv}+ inv`, true]);
    if (d.fnp) o.push([`FNP ${d.fnp}+`, true]);
    if (d.save) o.push([`+${d.save} Sv`, true]);
    if (d.cover) o.push(['Cover', true]);
  }
  if (e.fightsFirst) o.push(['Fights first', true]);
  if (e.stealth) o.push(['Stealth', true]);
  if (e.loneOperative) o.push(['Lone Op', true]);
  if (e.cannotFallBack) o.push(['No Fall Back', false]);
  if (e.noOverwatch) o.push(['No Overwatch', false]);
  if (e.grounded) o.push(['Grounded', false]);
  if (e.fightOnDeath) o.push([`Fight on death ${e.fightOnDeath}+`, true]);
  if (e.pileIn) o.push([`Pile in ${e.pileIn}"`, true]);
  if (e.critHitOn) o.push([`Crit hit ${e.critHitOn}+`, true]);
  return o;
}
const PACT_BONUSES = 'Pact bonuses: 1+ re-roll Hit 1s · 3+ re-roll Wound 1s · 5+ [LETHAL HITS] + [SUSTAINED HITS 1] in melee · 7+ Critical Hits on 5+';
const BUFF_TAG: Partial<Record<BuffKind, [string, boolean]>> = {
  'hit+1': ['+1 Hit', true], 'hit-1': ['−1 Hit', false], 'wound+1': ['+1 Wound', true], 'wound-1': ['−1 Wound', false],
  rerollHits1: ['Re-roll Hit 1s', true], rerollHits: ['Re-roll Hits', true], rerollWounds1: ['Re-roll Wound 1s', true], rerollWounds: ['Re-roll Wounds', true],
  'ap+1': ['+1 AP', true], lethal: ['Lethal Hits', true], sustained1: ['Sustained 1', true], devastating: ['Dev Wounds', true], ignoresCover: ['Ignores Cover', true],
  fnp4: ['FNP 4+', true], fnp5: ['FNP 5+', true], fnp6: ['FNP 6+', true], 'save+1': ['+1 Sv', true], 'damage-1': ['−1 D vs it', true], smoke: ['Smoke', true],
  'enemyHit-1': ['−1 to be hit', true], 'enemyWound-1': ['−1 to be wounded', true], 'enemyAp-1': ['AP −1 vs it', true], cover: ['Cover', true],
  fightsFirst: ['Fights first', true], 'advanceCharge+1': ['+1 Adv/Charge', true],
};

export function GameScreen({ initial, onExit }: { initial: GameState; onExit: () => void }) {
  const { state: s, act, undo, canUndo } = useGame(initial);
  const bots: PlayerId[] = s.bots ?? (s.botPlayer != null ? [s.botPlayer] : []);
  const spectate = bots.length === 2;
  const actingBot = bots.find((b) => botShouldAct(s, b)) ?? null;
  const [speed, setSpeed] = useState<0 | 1 | 2>(1); // bot-vs-bot: pause / normal / fast
  // the player hurries the bot's turn along: shorter pauses between its steps, results-only reports
  const [rush, setRush] = useState(false);
  const [coach, setCoachRaw] = useState(loadCoach);
  const setCoach = (c: ReturnType<typeof loadCoach>) => { setCoachRaw(c); saveCoach(c); };
  const [showMenu, setShowMenu] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [cardSide, setCardSide] = useState<PlayerId | null>(null); // whose cards the card viewer shows
  const [showGoals, setShowGoals] = useState(true);
  const [showMissions, setShowMissions] = useState(false);
  // how much the screen tells about each attack (the player's choice, kept on this device), and sound on/off
  const [fxLevel, setFxLevelRaw] = useState<FxLevel>(loadFxLevel);
  const setFxLevel = (v: FxLevel) => { setFxLevelRaw(v); try { localStorage.setItem(FX_PREF, v); } catch { /* this session only */ } };
  const [sound, setSound] = useState(soundOn());
  const [shake, setShake] = useState(0);
  const [reporting, setReporting] = useState(false); // an attack is being told on screen: the bot waits for it
  const [summary, setSummary] = useState<RoundTally | null>(null); // the round just played, in numbers
  const [think, setThink] = useState<ThinkView | null>(null); // the bot weighing its ways of playing the turn
  const [ponderProg, setPonderProg] = useState<{ done: number; total: number } | null>(null); // … during the player's turn
  // what the bot means to attack in its coming turn (from thinking during the player's turn), shown on request
  const [plan, setPlan] = useState<{ turn: number; p: PlayerId; intents: Intent[] } | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  // the bot's commander: what it last said
  const [says, setSays] = useState<{ p: PlayerId; text: string; k: number } | null>(null);
  // on a phone the commander steps aside 6 s after speaking (during the player's turn): redraw at that moment
  const [, setSaysTick] = useState(0);
  useEffect(() => { if (!says) return; const t = window.setTimeout(() => setSaysTick((x) => x + 1), 6100); return () => window.clearTimeout(t); }, [says]);
  const speak = (p: PlayerId, ev: VoiceEvent, names: { u?: string; t?: string } = {}) => {
    if (!bots.includes(p)) return;
    setSays({ p, text: line(s.players[p].factionId, ev, names), k: Date.now() });
  };

  // engine errors become a message instead of a crash
  useEffect(() => {
    const onErr = (e: Event) => flash(`Not allowed: ${(e as CustomEvent).detail}`);
    const onSave = () => flash('This battle could not be saved on this device (storage full or blocked): finish it before closing');
    window.addEventListener('game-error', onErr);
    window.addEventListener('save-error', onSave);
    return () => { window.removeEventListener('game-error', onErr); window.removeEventListener('save-error', onSave); };
  });

  // single-player: let the bot take its steps one at a time so the board animates; caption what it just did
  const [botSays, setBotSays] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false); // a big dice roll is on screen: the bot waits for it
  // the bot looks ahead (plays its turn a few ways on copies) in a worker; the main thread never rolls out itself
  const [thinking, setThinking] = useState(false);
  const [explain, setExplain] = useState<string | null>(null); // the ability whose rule text is open
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
  // thinking during the player's turn: a second worker plays the board on to where the bot's next turn starts and looks
  // ahead from there; when the real board gets there the same, the bot's turn starts at once instead of thinking again
  const ponder = useRef<{ w: Worker | null; id: number; p: PlayerId; turn: number; board: string; sig?: string | null; name?: string; intents?: Intent[]; view?: ThinkView; wait?: (name: string) => void } | null>(null);
  const stopPonder = () => { ponder.current?.w?.terminate(); ponder.current = null; setPonderProg(null); };
  useEffect(() => stopPonder, []);
  const ponderFor = !s.campaign && bots.length === 1 && s.active !== bots[0] && (s.phase === 'shooting' || s.phase === 'charge' || s.phase === 'fight') ? bots[0] : null;
  useEffect(() => {
    if (ponderFor === null || lookBudget(s, ponderFor) <= 0) return;
    // the same board as the thinking started from (the player only ended a phase): it stands
    const board = boardSig(s);
    if (ponder.current && ponder.current.turn === s.turn && ponder.current.board === board) return;
    // the board settled for a moment: start again from it (a busy worker can't be told to stop, so it is replaced)
    const t = window.setTimeout(() => {
      stopPonder();
      let w: Worker;
      try { w = new LookWorker(); } catch { return; }
      const id = Math.random();
      const job: NonNullable<typeof ponder.current> = { w, id, p: ponderFor, turn: s.turn, board };
      ponder.current = job;
      w.onmessage = (e: MessageEvent<LookMsg>) => {
        if (e.data.id !== id || ponder.current !== job) return;
        if (e.data.sig !== undefined) job.sig = e.data.sig;
        if (e.data.progress) {
          const pr = e.data.progress;
          job.view = { values: { ...job.view?.values, [pr.name]: pr.value }, done: pr.done, total: pr.total };
          if (job.wait) setThink(job.view); else setPonderProg({ done: pr.done, total: pr.total });
        }
        if (e.data.sig === null || e.data.name) { w.terminate(); job.w = null; setPonderProg(null); }
        if (e.data.name) {
          job.name = e.data.name;
          job.intents = e.data.intents ?? [];
          setPlan({ turn: job.turn, p: job.p, intents: job.intents });
          job.wait?.(e.data.name);
        }
      };
      w.onerror = () => { w.terminate(); job.w = null; job.wait?.('steady'); };
      try { w.postMessage({ kind: 'ponder', state: s, p: ponderFor, id }); } catch { stopPonder(); }
    }, 800);
    return () => window.clearTimeout(t);
  }, [s, ponderFor]); // eslint-disable-line react-hooks/exhaustive-deps
  // the player is reading (mission cards, the menu, a rule): the game waits instead of moving under them
  const viewing = showCards || showMissions || showMenu || !!explain || !!summary;
  useEffect(() => {
    if (!bots.length || rolling || reporting || thinking || stepping || viewing || s.phase === 'gameover' || (spectate && speed === 0)) return;
    const who = actingBot;
    // start of a bot's Movement phase: pick how to play the turn before moving anything
    if (who !== null && s.phase === 'movement' && s.active === who && !styleChosen(s)) {
      const done = (name: string, intents: Intent[] = []) => {
        setThinking(false); setThink(null);
        styleRef.current = { p: who, name };
        act((g) => { if (!styleChosen(g)) applyStyle(g, who, name); });
        // the commander says how it plays the turn, then what it goes for first
        speak(who, name as VoiceEvent);
        const first = intents.find((x) => s.units.some((u) => u.id === x.targetId && onBoard(u)));
        if (first) window.setTimeout(() => speak(who, 'target', { t: unitById(sRef.current, first.targetId).name }), 2400);
      };
      if (rush || lookBudget(s, who) <= 0) {
        stopPonder();
        done('steady');
        return;
      }
      // it thought this turn out during the player's: the same board, so the same answer (or wait for it to finish)
      const pre = ponder.current;
      if (pre && pre.p === who && pre.sig && pre.sig === lookSig(s)) {
        if (pre.name) { const it = pre.intents; stopPonder(); done(pre.name, it); return; }
        if (pre.w) {
          setThinking(true);
          speak(who, 'think');
          if (pre.view) setThink(pre.view);
          const fallback = window.setTimeout(() => { stopPonder(); done('steady'); }, lookBudget(s, who) + 10000);
          pre.wait = (name) => { window.clearTimeout(fallback); const it = pre.intents; stopPonder(); done(name, it); };
          return;
        }
      }
      stopPonder();
      if (!worker) { done('steady'); return; }
      setThinking(true);
      speak(who, 'think');
      setBotSays(null);
      const id = Math.random();
      // the worker stops looking by itself when the level's thinking time is up; this only catches a worker that hangs
      // (a shorter wait would give up while it is still thinking, and leave it busy for the bot's next steps)
      const fallback = window.setTimeout(() => { worker.onmessage = null; done('steady'); }, lookBudget(s, who) + 10000);
      worker.onmessage = (e: MessageEvent<LookMsg>) => {
        if (e.data.id !== id) return;
        if (e.data.progress) {
          const pr = e.data.progress;
          setThink((v) => ({ values: { ...v?.values, [pr.name]: pr.value }, done: pr.done, total: pr.total }));
          play('think', pr.done % 6);
          return;
        }
        window.clearTimeout(fallback);
        worker.onmessage = null;
        done(e.data.name ?? 'steady', e.data.intents);
      };
      worker.onerror = () => { window.clearTimeout(fallback); worker.onmessage = null; done('steady'); };
      try { worker.postMessage({ state: s, p: who, id }); } catch { window.clearTimeout(fallback); done('steady'); }
      return;
    }
    // bot-vs-bot: nobody "has" the step (e.g. ending the fight phase) — let the driver move the game on
    const drive = who === null && spectate && !s.attack;
    if (who === null && !drive) return;
    const quick = s.phase === 'deploy' || s.phase === 'scouts' || s.phase === 'command' || s.window != null;
    const delay = (quick ? 100 : 650) / (spectate && speed === 2 ? 3 : 1) / (rush ? 5 : 1);
    const caption = (before: GameState, after: GameState) => {
      const fresh = after.log.slice(before.log.length).filter((e) => e.kind !== 'roll' || /charge|Advance/i.test(e.text));
      if (fresh.length) { setBotSays(fresh[fresh.length - 1].text); }
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
      const giveUp = window.setTimeout(() => { worker.onmessage = null; setStepping(false); stepOnMain.current = true; if (sRef.current === sent) onMain(); }, 5000);
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
  }, [s, actingBot, act, botSays, rolling, reporting, thinking, stepping, viewing, worker, speed, spectate, bots.length, rush]); // eslint-disable-line react-hooks/exhaustive-deps
  // the hurry lasts for the bot's turn only
  useEffect(() => { if (actingBot === null && !spectate) setRush(false); }, [actingBot, spectate]);
  useEffect(() => { stepOnMain.current = false; }, [s.turn, s.phase]);
  // what happens on the table, in the bot commander's words: kills and losses, objectives changing hands, charges
  const heard = useRef({ fx: s.fxSeq ?? 0, log: s.log.length, ctrl: s.objectives.map((o) => o.controller) });
  useEffect(() => {
    const h = heard.current;
    if (!bots.length) return;
    if ((s.fxSeq ?? 0) < h.fx) h.fx = s.fxSeq ?? 0;
    if (s.log.length < h.log) h.log = s.log.length;
    for (const e of s.fx ?? []) {
      if (e.seq <= h.fx || e.kind !== 'attack' || !e.report?.destroyed) continue;
      const victim = (1 - e.owner) as PlayerId;
      if (bots.includes(e.owner)) speak(e.owner, 'kill', { t: e.report.target });
      else if (bots.includes(victim)) speak(victim, 'loss', { u: e.report.target });
    }
    h.fx = Math.max(h.fx, s.fxSeq ?? 0);
    s.objectives.forEach((o, i) => {
      const was = h.ctrl[i];
      if (o.controller === was || o.type === 'home' || s.round < 1 || s.phase === 'deploy' || s.phase === 'scouts') return;
      if (o.controller !== null && bots.includes(o.controller)) speak(o.controller, 'objective');
      else if (was !== null && was !== undefined && bots.includes(was)) speak(was, 'objectiveLost');
    });
    h.ctrl = s.objectives.map((o) => o.controller);
    for (const l of s.log.slice(h.log)) {
      const m = /^(.+?) charges successfully/.exec(l.text);
      if (m && l.player !== null && bots.includes(l.player)) speak(l.player, 'charge', { u: m[1] });
    }
    h.log = s.log.length;
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  // between battle rounds: the round just played, in numbers (and the commander sizes up the battle)
  const vpNow = (): [number, number] => [s.players[0].vp + s.players[0].secVp, s.players[1].vp + s.players[1].secVp];
  const roundStart = useRef<{ round: number; vp: [number, number] }>({ round: s.round, vp: vpNow() });
  useEffect(() => {
    const r = roundStart.current;
    if (s.round < r.round) { roundStart.current = { round: s.round, vp: vpNow() }; return; }
    if (s.phase === 'gameover' || s.round <= r.round || (s.phase !== 'command' && s.phase !== 'movement')) return;
    if (r.round >= 1 && fxLevel !== 'off') setSummary(tally(s, r.round, r.vp));
    roundStart.current = { round: s.round, vp: vpNow() };
    for (const b of bots) speak(b, (advantage(s) >= 0.5) === (b === 0) ? 'ahead' : 'behind');
  }, [s.round, s.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // bot against bot: the summary goes away by itself
  useEffect(() => { if (!summary || !spectate) return; const tm = window.setTimeout(() => setSummary(null), 4000); return () => window.clearTimeout(tm); }, [summary, spectate]);
  const [finalSeen, setFinalSeen] = useState(false);
  useEffect(() => {
    if (s.phase !== 'gameover') return;
    for (const b of bots) speak(b, s.winner === b ? 'win' : 'lose');
    play(s.winner !== null && s.winner !== 'draw' && !bots.includes(s.winner) ? 'vp' : 'turn');
  }, [s.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // a caption of what the bot did goes away once the player has the turn (it is in the log)
  useEffect(() => {
    if (!botSays || actingBot !== null || spectate) return;
    const tm = window.setTimeout(() => setBotSays(null), 2600);
    return () => window.clearTimeout(tm);
  }, [botSays, actingBot, spectate]);

  // auto rules: the player only moves and shoots; the app takes every other decision of theirs as it comes up
  const autoWho = ([0, 1] as PlayerId[]).find((p) => autoDue(s, p)) ?? null;
  useEffect(() => {
    if (autoWho === null || rolling || thinking || viewing) return;
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
        setBotSays(msg);
        window.setTimeout(() => setBotSays((x) => (x === msg ? null : x)), 2600);
      }
    }, s.phase === 'fight' ? 700 : 300);
    return () => window.clearTimeout(t);
  }, [s, autoWho, rolling, thinking, viewing]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [orderOfficerId, setOrderOfficerId] = useState<string | null>(null);
  const [orderTargetId, setOrderTargetId] = useState<string | null>(null);
  const [mode, setModeRaw] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<Paths | null>(null);
  // the joystick's loop outlives a render: it settles the latest draft when let go
  const draftRef = useRef<Paths | null>(null);
  draftRef.current = draft;
  const [check, setCheck] = useState<MoveCheck | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [sheetModel, setSheetModel] = useState<string | undefined>();
  const taps = useRef<{ id?: string; t: number[] }>({ t: [] });
  const [showBuffs, setShowBuffs] = useState(false);
  const [fly, setFly] = useState(false);
  const [showStrats, setShowStrats] = useState(false);
  const [stratUnit, setStratUnit] = useState<string>('');
  const [stratPick, setStratPick] = useState<{ p: PlayerId; ids: string[] } | null>(null); // choosing a stratagem's unit on the map
  const [stratPlayer, setStratPlayer] = useState<PlayerId | null>(null); // whose stratagems the sheet shows (null = who acts now)
  // the bot decides its own CP: against the bot the sheet always shows the player's own stratagems
  const human: PlayerId | null = bots.length === 1 ? (bots[0] === 0 ? 1 : 0) : null;
  const openStrats = (p: PlayerId | null = null) => {
    const who = p !== null && !bots.includes(p) ? p : human ?? p;
    setStratPlayer(who); setStratUnit(sel && s.units.find((u) => u.id === sel)?.owner === (who ?? actor) ? sel : ''); setShowStrats(true);
  };
  const [freeAdvRR, setFreeAdvRR] = useState<string | null>(null);
  const [actPick, setActPick] = useState<string | null>(null);

  const setMode = (m: Mode | null, d: Paths | null = null) => { setModeRaw(m); setDraft(d); setCheck(null); joyOff.current = { x: 0, y: 0 }; };
  // moving without a finger over the models: the joystick walks the unit (how far it has gone from where it stood)
  const joyOff = useRef<Pt>({ x: 0, y: 0 });
  // ending a phase where nothing was done needs a second tap (protects against mis-taps)
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => { if (!armed) return; const tm = window.setTimeout(() => setArmed(null), 3500); return () => window.clearTimeout(tm); }, [armed]);
  /** The phase's way out: what is left undone shows under it, and ending with nothing done asks once more. */
  const endButton = (key: string, label: string, idle: boolean, why: string, note?: string) => (
    <div className="sticky-act">
      <button className={`btn primary big wide end-btn ${armed === key ? 'armed' : ''}`} onClick={() => {
        if (idle && armed !== key) { setArmed(key); flash(`${why} — tap again to confirm`); return; }
        setArmed(null);
        play('turn');
        act((g) => { if (g.phase === 'movement') autoEndMovement(g, g.active); endPhase(g); }); setSel(null); setMode(null);
      }}>
        <span className="end-l">{armed === key ? `Confirm ${label}?` : label} <Icon name="next" /></span>
        {note && armed !== key && <span className="end-note">{note}</span>}
      </button>
    </div>
  );
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? null : x)), 2600); };
  // on a computer: Escape closes the sheet on top (or cancels what is being done), Ctrl+Z undoes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        if (summary) setSummary(null);
        else if (showMenu) setShowMenu(false);
        else if (showStrats) setShowStrats(false);
        else if (showCards) setShowCards(false);
        else if (showMissions) setShowMissions(false);
        else if (sheet) setSheet(null);
        else if (tape.on) setTape({ on: false });
        else if (mode) setMode(null);
        else if (sel) setSel(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && canUndo) {
        e.preventDefault();
        undo(); setMode(null); flash('Undone one step');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
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
    ? (() => {
        const u = U(mode.unitId);
        const flags = unitFlags(s, u);
        const maxRange = flags.gheistskull && !u.used?.['Gheistskull'] ? 18 : 8;
        return boardUnits(s, other(u.owner)).filter((t) => !isEngaged(s, t) && unitDistance(u, t) <= maxRange && alive(u).some((m) => unitVisibleTo(s, m, t))).map((t) => t.id);
      })()
    : [];
  const crushTargets = mode?.k === 'crush' ? engagedEnemies(s, U(mode.unitId)).map((t) => t.id) : [];

  // Thousand Sons: the player picks their Rituals at the start of the Shooting phase (sorcerer, Ritual, target, Channel)
  const [rit, setRit] = useState<{ model?: string; ritual?: string; target?: string; channel: boolean }>({ channel: false });
  const ritualOn = !mode && s.phase === 'shooting' && decides(s, s.active) && !bots.includes(s.active) && ritualsPending(s, s.active);
  // on the map: the sorcerers glow until one is picked, then the units its Ritual can target
  const ritMap = (() => {
    if (!ritualOn) return null;
    const cs = casters(s, s.active);
    const c = cs.find((x) => x.model.id === rit.model);
    const r = c ? ritualsLeft(s, s.active, c).find((x) => x.id === rit.ritual) : undefined;
    const tg = c && r ? ritualTargets(s, c, r).map((t) => t.id) : [];
    return { cs, c, tg, targets: c && r ? tg : [...new Set(cs.map((x) => x.unit.id))], picked: c && r ? (rit.target ? [rit.target] : []) : c ? [c.unit.id] : [] };
  })();
  const heroicWindow = !mode && s.window?.kind === 'heroicIntervention' ? s.window : null;
  const heroicSelection = heroicWindow !== null;
  const heroicPick = heroicWindow ? heroicCandidates(s, heroicWindow.player) : [];
  const heroicNumbers = Object.fromEntries(heroicPick.map((u, i) => [u.id, i + 1]));
  const actTargets = actPick ? (manualActs(s, actor).find((m) => `${m.def.holder.id}|${m.def.key}` === actPick)?.targets.map((t) => t.id) ?? []) : [];
  const targets = s.window?.kind === 'pickUnit' ? s.window.units
    : stratPick ? stratPick.ids
    : actPick ? actTargets
    : (!mode && s.window?.kind === 'fireOverwatch' && s.window.player === actor) ? overwatchCandidates(s, s.window.player).map((u) => u.id)
    : ritMap ? ritMap.targets
    : heroicPick.length ? heroicPick.map((u) => u.id)
    : mode?.k === 'shoot' ? shootTargets
    : mode?.k === 'charge' ? chargeOpts
    : mode?.k === 'fight' ? fightTargets
    : mode?.k === 'explosives' ? explosiveTargets
    : mode?.k === 'crush' ? crushTargets
    : [];
  const picked = ritMap ? ritMap.picked : mode?.k === 'shoot' || mode?.k === 'fight' || mode?.k === 'explosives' ? (mode.target ? [mode.target] : []) : mode?.k === 'charge' ? mode.targets : [];

  const onTapUnit = (unitId: string, modelId?: string) => {
    // three quick taps on a model: its datasheet with the weapons it carries
    const now = performance.now(), tp = taps.current;
    tp.t = tp.id === modelId ? [...tp.t.filter((t) => now - t < 700), now] : [now];
    tp.id = modelId;
    if (tp.t.length >= 3) { tp.t = []; setSheetModel(modelId); setSheet(unitId); return; }
    if (tape.on) {
      const m = U(unitId).models.find((x) => x.id === modelId && !x.dead) ?? alive(U(unitId))[0];
      if (m) measureTap({ x: m.x, y: m.y }, { u: unitId, m: m.id });
      return;
    }
    if (actPick) {
      const actEntry = manualActs(s, actor).find((m) => `${m.def.holder.id}|${m.def.key}` === actPick);
      if (actEntry && actEntry.targets.some((t) => t.id === unitId)) {
        const hid = actEntry.def.holder.id;
        const res = act((g) => {
          const err = useActByKey(g, hid, actEntry.def.key, unitId);
          const gu = unitById(g, hid);
          return { err, move: gu.extraMove && gu.extraMove.phase === `${g.turn}:${g.phase}` && !g.window ? gu.extraMove.kind : null };
        });
        setActPick(null);
        if (res.err) flash(res.err);
        else flash(`${actEntry.def.holder.name}: ${actEntry.label}`);
        return;
      }
    }
    if (s.window?.kind === 'fireOverwatch' && s.window.player === actor) {
      const ows = overwatchCandidates(s, s.window.player);
      if (ows.some((c) => c.id === unitId)) {
        setSel(unitId);
        setMode({ k: 'shoot', unitId, smode: 'snap', target: null, useCQ: false, profile: {}, overwatch: true });
        flash(`Fire Overwatch: select target for ${U(unitId).name}`);
        return;
      }
    }
    if (stratPick) {
      if (stratPick.ids.includes(unitId)) { setSel(unitId); setStratPlayer(stratPick.p); setStratUnit(unitId); setShowStrats(true); setStratPick(null); }
      else flash('Tap a highlighted unit (or Cancel)');
      return;
    }
    if (ritMap) {
      // a Ritual target, or a sorcerer (tapping its unit again cycles through the sorcerers in it)
      if (ritMap.tg.includes(unitId)) { setRit({ ...rit, target: unitId }); setSel(unitId); return; }
      const inUnit = ritMap.cs.filter((x) => x.unit.id === unitId);
      if (inUnit.length) {
        const c = inUnit.find((x) => x.model.id === modelId) ?? inUnit[(inUnit.findIndex((x) => x.model.id === rit.model) + 1) % inUnit.length];
        setRit({ model: c.model.id, channel: rit.channel });
        setSel(unitId);
        return;
      }
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
          const canCrush = canUseStratagem(s, cu.owner, 'crushing-impact', cu) === null && isEngaged(s, cu);
          if (canCrush) setMode({ k: 'crush', unitId: cu.id }); else setMode(null);
        } else {
          const targetsNow = ch.targets.includes(unitId) ? ch.targets : [...ch.targets, unitId];
          setModeRaw({ ...ch, targets: targetsNow });
          setDraft(mergePaths(startPaths(U(ch.unitId)), autoApproach(s, U(ch.unitId), targetsNow.map(U), chargeReach(s, U(ch.unitId), targetsNow))));
          flash('Could not move in automatically (blocked / not enough distance): drag the models');
        }
      }
      else if (mode.k === 'crush') {
        const blocked = canUseStratagem(s, U(mode.unitId).owner, 'crushing-impact', U(mode.unitId));
        if (blocked) flash(blocked);
        else { const rolls = act((g) => crushingImpact(g, unitById(g, mode.unitId), unitId)); flash(`Crushing Impact: [${rolls.join(' ')}]`); setMode(null); }
      }
      else if (mode.k === 'shoot' || mode.k === 'fight' || mode.k === 'explosives') setModeRaw({ ...mode, target: unitId });
      return;
    }
    if (!mode) {
      if (s.phase === 'shooting') {
        const targetU = U(unitId);
        const smodes = shootingModes(s, targetU);
        if (targetU.owner === s.active && !targetU.selectedToShoot && smodes.length > 0) {
          setSel(unitId);
          act((g) => autoSelectToShoot(g, unitById(g, unitId)));
          setMode({ k: 'shoot', unitId, smode: smodes[0], target: null, useCQ: false, profile: {} });
          return;
        }
      }
      setSel(sel === unitId ? null : unitId);
    }
  };

  const measureTap = (p: Pt, ref?: { u: string; m: string }) => {
    setTape((tp) => (!tp.a || tp.b ? { on: true, a: p, ma: ref } : { ...tp, b: p, mb: ref }));
  };
  const onTapBoard = (p: Pt) => {
    if (tape.on) { measureTap(p); return; }
    if (mode?.k === 'place') {
      const u = U(mode.unitId);
      let pos = formationAt(u, p, s.players[u.owner].role === 'defender');
      if (mode.how === 'ingress' || mode.how === 'deepStrike' || mode.how === 'infiltrate') pos = nudgePlacement(s, u, pos, mode.how);
      setDraft(placePaths(pos));
      const chk = mode.how === 'deepStrike' || mode.how === 'infiltrate' ? validatePlacement(s, u, pos, mode.how) : null;
      setCheck(chk?.ok ? null : chk);
      return;
    }
    if (!mode) setSel(null);
  };

  const maxFor = (id: string) => {
    if (!mode || !modeUnit) return Infinity;
    const m = modeUnit.models.find((x) => x.id === id)!;
    if (mode.k === 'move') return maxMoveDistance(s, modeUnit, mode.kind, m, { fly: mode.fly });
    if (mode.k === 'charge') return chargeReach(s, modeUnit, mode.targets);
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
    if (mode?.k === 'place' && modeUnit && (mode.how === 'ingress' || mode.how === 'deepStrike' || mode.how === 'infiltrate')) {
      const pos = nudgePlacement(s, modeUnit, lastPos(d), mode.how);
      setDraft(placePaths(pos));
      const chk = validatePlacement(s, modeUnit, pos, mode.how);
      setCheck(chk.ok ? null : chk);
      return;
    }
    if (!modeUnit || !draftKind) return;
    const st = settleDraft(d);
    setDraft(st);
    const chk = validateMove(s, modeUnit, draftKind, st, draftOpts);
    setCheck(chk.ok ? null : chk);
  };
  /** The furthest every model of the moving unit may go. */
  const slideMax = () => (modeUnit ? Math.min(...alive(modeUnit).map((m) => maxFor(m.id))) : 0);
  /**
   * Joystick: the unit walks the way the knob is pushed, never further than it may move. Pushed all the way it crosses
   * its whole move in about half a second (at least 14" a second); a light push creeps, for fine placing.
   */
  const joyMove = (x: number, y: number, dt: number) => {
    if (!modeUnit || !draftKind) return;
    const max = slideMax();
    const push = Math.min(1, Math.hypot(x, y));
    if (push <= 0) return;
    const speed = Math.max(14, max / 0.5) * Math.pow(push, 1.6);
    let o = { x: joyOff.current.x + (x / push) * speed * dt, y: joyOff.current.y + (y / push) * speed * dt };
    const L = Math.hypot(o.x, o.y);
    if (L > max) o = { x: (o.x / L) * max, y: (o.y / L) * max };
    joyOff.current = o;
    const paths: Paths = new Map(alive(modeUnit).map((m) => [m.id, walkDraft(m.id, [{ x: m.x, y: m.y }, { x: m.x + o.x, y: m.y + o.y }])]));
    setDraft(paths);
    setCheck(null);
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
  // Rituals on a unit this phase (Destiny's Ruin, Twist of Fate): a tag so the player sees who is marked
  for (const u of s.units) for (const t of u.timed ?? []) if (t.mark && RITUAL_NAMES.has(t.mark) && onBoard(u)) (badges[u.id] ??= []).push(t.mark);
  // Astra Militarum Orders (Voice of Command): a prominent order badge above the unit so the active skill is immediately clear
  for (const u of s.units) {
    if (!onBoard(u)) continue;
    for (const t of u.timed ?? []) {
      if (t.label.startsWith('Order: ')) (badges[u.id] ??= []).push(`[Order: ${t.label.slice(7)}]`);
    }
  }
  // T’au Empire For the Greater Good: prominent observer/spotted/guided badges
  if (s.phase === 'shooting') {
    for (const pair of s.ftggPairs ?? []) {
      if (pair.turn === s.turn && pair.phase === s.phase) {
        (badges[pair.spottedId] ??= []).push('[SPOTTED +1 BS]');
        (badges[pair.observerId] ??= []).push('[OBSERVER]');
        (badges[pair.guidedId] ??= []).push('[GUIDED]');
      }
    }
  }
  // Stratagems in effect: a tag on the unit that got it, so it is clear the CP went to that unit only
  const stratNames = new Set(s.players.flatMap((P) => P.detachments.flatMap((d) => d.stratagems.map((st) => st.name))));
  for (const u of s.units) {
    if (!onBoard(u)) continue;
    const ls = new Set([...u.buffs.map((b) => b.label), ...(u.timed ?? []).map((x) => x.label)].filter((l): l is string => !!l && stratNames.has(l)));
    for (const l of ls) (badges[u.id] ??= []).push(l);
  }
  // temporary buffs / debuffs (abilities, stratagems, marks) as "+1 Hit" / "−2\" M" tags under each unit
  // worked out once per game state (every unit's rules are read: costly to redo on each render)
  const { buffTags, riled, armyChips } = useMemo(() => withRuleCache(() => {
    const buffTags: Record<string, [string, boolean][]> = {};
    const riled: string[] = [];
    // buffs every unit of an army has (detachment rules, WAAAGH!) go on one card above the map, not on each unit
    const armyChips: [Map<string, string[]>, Map<string, string[]>] = [new Map(), new Map()];
    const chip = (p: PlayerId, label: string, tags: string[]) => { const m = armyChips[p]; m.set(label, [...new Set([...(m.get(label) ?? []), ...tags])]); };
    for (const u of s.units) {
      if (!onBoard(u)) continue;
      // plus auras of other units that always apply (a conditional one only matters at the moment it holds)
      const auras = effectsFor(s, u).filter((a) => a.from && a.holder.id !== u.id && !a.e.if?.length).flatMap((a) => fxTags(a.e));
      // army-wide buffs on this unit: detachment rules and choices, doctrines, Blessings of Khorne (always-on parts)
      const own = new Set(u.abilities.map((a) => a.name));
      for (const a of effectsFor(s, u)) {
        if (a.from || a.holder.id !== u.id || own.has(a.label) || BLESSINGS.some((b) => b.name === a.label) || u.timed?.some((t) => t.label === a.label) || a.e.if?.length) continue;
        const t = fxTags(a.e).map(([x]) => x);
        if (t.length) chip(u.owner, a.label, t);
      }
      const waaagh = u.abilities.some((a) => a.name === 'Waaagh!') && s.players[u.owner].riledUntilTurn >= s.turn;
      if (waaagh) chip(u.owner, 'WAAAGH!', ['5+ inv', 'Assault', 'Adv & Charge']);
      const riledTags: [string, boolean][] = isRiled(s, u) && !waaagh ? [['5+ inv', true], ['Assault', true], ['Adv & Charge', true]] : [];
      if (s.players[u.owner].favoured === u.id) riledTags.push(['Favoured: re-roll Wounds', true]);
      const tags = [...riledTags, ...u.buffs.map((b) => BUFF_TAG[b.kind]).filter((x): x is [string, boolean] => !!x), ...(u.timed ?? []).flatMap((t) => fxTags(t.e)), ...auras];
      const seen = new Set<string>();
      const uniq = tags.filter(([t]) => !seen.has(t) && !!seen.add(t));
      if (uniq.length) buffTags[u.id] = uniq;
      if (u.abilities.some((a) => a.name === 'Waaagh!') || u.riledUntil !== undefined || u.timed?.some((t) => t.e.riled)) if (isRiled(s, u)) riled.push(u.id);
    }
    return { buffTags, riled, armyChips };
  }), [s]);
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
    const au = U(tape.ma!.u);
    const los = hasLos(s, ma, mb);
    const diffUnit = tape.ma!.u !== tape.mb!.u;
    const vis = diffUnit && modelVisible(s, ma, tu, mb);
    const otherVisibleInUnit = diffUnit && !vis && alive(tu).some((om) => om.id !== mb.id && (modelVisible(s, ma, tu, om) || alive(au).some((oa) => modelVisible(s, oa, tu, om))));
    let why = '';
    if (!los) {
      why = 'Not visible: obscured by terrain/wall';
      if (otherVisibleInUnit) why += ' · (Unit is targetable via other visible squadmates)';
    } else if (vis || !diffUnit) {
      why = 'Visible (in line of sight)';
    } else if (isHidden(s, tu, mb)) {
      why = 'In line of sight but Hidden: get within detection range';
      if (otherVisibleInUnit) why += ' · (Unit is targetable via other visible squadmates)';
    } else {
      why = 'Not visible';
      if (otherVisibleInUnit) why += ' · (Unit is targetable via other visible squadmates)';
    }
    return { text: `${baseDist(ma, mb).toFixed(1)}"`, line: `Base to base ${baseDist(ma, mb).toFixed(1)}" (centre to centre ${centre.toFixed(1)}") · ${why}`, los: los && (vis || !diffUnit) };
  })();
  const rings: Ring[] = [];
  if (mode?.k === 'charge' && modeUnit) {
    for (const m of alive(modeUnit)) if (alive(modeUnit).length <= 3) rings.push({ c: m, r: (modeUnit.chargeRoll ?? 0) + m.r, color: 'rgba(245,184,61,0.5)', dash: true });
  }
  // Keep-out distance while arriving or infiltrating: model circles mark enemy ranges.
  if (mode?.k === 'place' && modeUnit && (mode.how === 'deepStrike' || mode.how === 'ingress' || mode.how === 'infiltrate')) {
    const keep = mode.how === 'deepStrike' ? unitFlags(s, modeUnit).deepStrikeRange : RULES.reserves.enemyDistance;
    for (const e of boardUnits(s, other(modeUnit.owner))) for (const n of alive(e)) rings.push({ c: n, r: n.r + keep, color: 'rgba(239,68,68,0.55)', dash: true });
  }
  const zoneGuide = mode?.k === 'place' && mode.how === 'infiltrate' && modeUnit
    ? { poly: zoneOf(s, other(modeUnit.owner)), distance: RULES.reserves.enemyDistance }
    : undefined;

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
    let pos = lastPos(draft);
    const u = U(mode.unitId);
    let nudged = false;
    if (mode.how === 'ingress' || mode.how === 'deepStrike' || mode.how === 'infiltrate') {
      const original = pos;
      const adjusted = nudgePlacement(s, u, original, mode.how);
      nudged = [...adjusted].some(([id, p]) => dist(p, original.get(id) ?? p) > 0.001);
      if (nudged) { pos = adjusted; setDraft(placePaths(pos)); }
    }
    // a spot that breaks a rule (against a board edge, on a wall, too close to an enemy): slide to the nearest legal one
    if (mode.how !== 'disembark' && !validatePlacement(s, u, pos, mode.how).ok) {
      const mid = (m: Map<string, Pt>) => { const q = [...m.values()]; return { x: q.reduce((a, p) => a + p.x, 0) / q.length, y: q.reduce((a, p) => a + p.y, 0) / q.length }; };
      const near = mid(pos);
      const fit = findPlacement(s, u, mode.how, near);
      // only a small slide: a spot far away is not what the player chose
      if (fit && dist(mid(fit), near) <= 6) {
        pos = fit;
        setDraft(placePaths(fit));
        flash(nudged ? 'Moved models to a legal position' : 'Moved to the nearest legal spot');
      }
    } else if (nudged) flash('Moved models to keep the required distance');
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
      for (const pos of hullSpots(s, u, tm, base, disembarkMode(s, t) === 'combat' ? 6 : 3, disembarkMode(s, t) === 'combat')) {
        if (validateDisembark(s, u, t, pos).ok) { setDraft(placePaths(pos)); setCheck(null); return; }
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
    const targetId = at.targetId;
    act((g) => {
      finishAttack(g);
      if (at.kind === 'overwatch') closeWindow(g);
      if (at.kind === 'fight') { markFought(g, unitById(g, attacker.id)); openCounteroffensive(g, attacker.owner); }
    });
    setMode(null);
    // If target was destroyed in melee and attacker is human player, allow them to consolidate/move normally
    if (at.kind === 'fight' && !bots.includes(attacker.owner)) {
      const targetAfter = s.units.find((x) => x.id === targetId);
      const attackerAfter = s.units.find((x) => x.id === attacker.id);
      if (attackerAfter && attackerAfter.status === 'board' && (!targetAfter || targetAfter.status === 'destroyed' || !isEngaged(s, attackerAfter))) {
        if (consolidateEligible(s, attackerAfter) && consolidateMode(s, attackerAfter).mode) {
          setMode({ k: 'pile', unitId: attackerAfter.id, kind: 'consolidate' }, startPaths(attackerAfter));
          setSel(attackerAfter.id);
          flash(`${attackerAfter.name}: Squad destroyed! Consolidate move up to 3"`);
        }
      }
    }
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

  const unitPill = (u: UnitState, done: boolean, onClick?: () => void) => {
    const canMove = s.phase === 'movement' && !done && u.owner === s.active && !u.move;
    return (
      <button key={u.id} className={`unit-pill ${done ? 'done' : ''} ${sel === u.id ? 'sel' : ''} ${canMove ? 'can-move' : ''} ${u.battleShocked ? 'shock' : ''}`} onClick={onClick ?? (() => { setSel(u.id); })}>
      {(() => {
        // the unit's picture (its leader's when it has one), so a unit is found by sight, not by name
        const lead = u.models.find((m) => m.isCharacter) ?? u.models[0];
        return lead ? <span className="pill-face" aria-hidden="true"><Portrait kind={unitToken(u)} owner={u.owner} character={u.models.some((m) => m.isCharacter)} size={26}
          datasheet={lead.name && lead.name !== lead.source ? modelPortraitKey(lead.source, lead.name) : lead.source} fallback={lead.source} /></span>
          : <span className={`side-dot s${u.owner}`} aria-hidden="true" />;
      })()} {u.name.length > 26 ? u.name.slice(0, 25) + '…' : u.name}
      <span className="muted"> {alive(u).length}/{u.startingStrength}</span>
      {canMove && <span className="muted" style={{ color: '#38bdf8', fontWeight: 600 }}> · {(alive(u)[0]?.profile.M ?? 0) + unitFlags(s, u).move}"</span>}
      {u.battleShocked ? ' ' : ''}
      {s.players[1 - u.owner].oathTarget === u.id && <span className="oath-tag">{markRuleLabel(s, u.owner === 0 ? 1 : 0)}</span>}
      {s.ftggPairs?.some((p) => p.spottedId === u.id && p.turn === s.turn && p.phase === s.phase) && <span className="oath-tag spotted-tag">SPOTTED</span>}
      {s.ftggPairs?.some((p) => p.observerId === u.id && p.turn === s.turn && p.phase === s.phase) && <span className="oath-tag observer-tag">OBSERVER</span>}
      {s.ftggPairs?.some((p) => p.guidedId === u.id && p.turn === s.turn && p.phase === s.phase) && <span className="oath-tag guided-tag">GUIDED</span>}
      {s.players[1 - u.owner].machineVengeanceTarget === u.id && <span className="oath-tag" style={{ background: '#7f1d1d', color: '#fca5a5' }}>MACHINE VENGEANCE</span>}
      {s.players[u.owner].empoweredUnits?.includes(u.id) && <span className="oath-tag" style={{ background: '#134e4a', color: '#5eead4' }}>EMPOWERED</span>}
    </button>
  ); };

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
      s.players[other(u.owner)].oathTarget === u.id && `${markRuleName(s, other(u.owner)) ?? 'Marked'} target`,
      ...u.enhancements.map((e) => e.name),
      ...u.buffs.map((b) => (b.label && !BUFFS.some((x) => x.kind === b.kind) ? `${EFFECT_LABEL[b.kind] ?? b.kind} (${b.label})` : BUFFS.find((x) => x.kind === b.kind)?.label ?? EFFECT_LABEL[b.kind] ?? b.kind)),
    ].filter(Boolean) as string[];
    return (
      <div className="row unit-card" style={{ flexWrap: 'nowrap', gap: 10 }} onClick={() => { setSheetModel(undefined); setSheet(u.id); }}>
        <Portrait kind={unitToken(u)} owner={u.owner} character={u.models.some((x) => x.isCharacter && !x.dead)} size={40} datasheet={lead.name && lead.name !== lead.source ? modelPortraitKey(lead.source, lead.name) : lead.source} fallback={lead.source} />
        <div className="grow">
          <div style={{ fontWeight: 700 }} className={u.owner ? 'p1' : 'p0'}>{u.name} <span className="muted tiny">{alive(u).length}/{u.startingStrength}</span></div>
          <div className="statline">
            M <b>{m.profile.M !== undefined && m.profile.M !== null ? m.profile.M + unitFlags(s, u).move : '-'}"</b> · T <b>{m.profile.T}</b> · Sv <b>{m.profile.Sv}+</b>{m.profile.InSv ? <> · <b>{m.profile.InSv}++</b></> : null} · W <b>{m.wounds}/{m.profile.W}</b> · Ld <b>{bestLd(u, s)}+</b> · OC <b>{u.battleShocked ? '-' : m.profile.OC ?? '-'}</b>
          </div>
          {flags.length > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}>{flags.join(' · ')}</div>}
          {(() => { const kit = loadoutSummary(u); return kit.length ? <div className="tiny loadout-line"><Icon name="shoot" size={13} /> {kit.join(' · ')}</div> : null; })()}
          {(() => { const ls = activeLabels(s, u); return ls.length ? <div className="tiny fx-labels"><Icon name="ability" size={13} /> {ls.slice(0, 6).join(' · ')}{ls.length > 6 ? ` +${ls.length - 6}` : ''}</div> : null; })()}
        </div>
        <Icon name="next" size={18} className="muted" />
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

  const joystick = () => {
    if (mode?.k !== 'move' || !modeUnit) return null;
    const max = slideMax();
    if (!Number.isFinite(max) || max <= 0) return null;
    const moved = draft ? Math.max(0, ...[...draft.values()].map((p) => (p.length > 1 ? Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y) : 0))) : 0;
    return (
      <div className="move-joy" data-coach="joy">
        <Joystick onMove={joyMove} onEnd={() => { if (draftRef.current) onDragEnd(draftRef.current); }} />
        <div className="move-joy-info">
          <span className="move-joy-d">{moved.toFixed(1)}" <span className="tiny muted">/ {max.toFixed(1)}"</span></span>
          <span className="tiny muted">Hold the stick and push the way to go · or drag the models</span>
        </div>
      </div>
    );
  };

  const moveControls = (kind: string, onConfirm: () => void, extra?: React.ReactNode) => (
    <>
      {joystick()}
      <div className="row">
        <span className="tiny muted grow">{mode?.k === 'move' ? '' : 'Drag = whole unit · tap a model = move that model'}</span>
        <button className="btn small" onClick={() => { setDraft(modeUnit ? startPaths(modeUnit) : null); setCheck(null); joyOff.current = { x: 0, y: 0 }; }}>Reset</button>
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

  /** "Assault Doctrine: charge after Advancing (this unit)" → "Assault Doctrine" */
  const optLabel = (l: string) => (l.split(':')[0] || l).replace(/\s*\(.*\)\s*$/, '').trim();
  const shortName = (n: string) => n.replace(/\s*\((?:once|psychic|psyker|first)[^)]*\)\s*$/i, '').replace(/\s*\(Aura\)\s*$/i, '');
  /** Buttons for abilities player p can use right now ("Once per battle, in your Command phase …"). */
  /** The full rule text behind an ability button: the datasheet / enhancement ability, else the army or detachment rule. */
  const actRuleText = (u: UnitState, name: string): string => {
    const a = u.abilities.find((x) => x.name === name);
    if (a?.text) return a.text;
    const P = s.players[u.owner];
    const det = P.detachments.flatMap((d) => d.rules ?? []).find((r) => r.name === name);
    if (det?.text) return det.text;
    const army = P.armyRules.find((r) => r.name === name);
    if (army?.text) return army.text;
    // a granted ability ("friendly CHAPLAIN units have the following ability: Name: …"): the paragraph that names it
    const src = [...P.detachments.flatMap((d) => d.rules ?? []), ...P.armyRules].map((r) => r.text ?? '').find((t) => t.includes(name));
    if (src) { const i = src.indexOf(name); return src.slice(i, src.indexOf('\n\n', i) > 0 ? src.indexOf('\n\n', i) : undefined); }
    return '';
  };
  const abilityBar = (p: PlayerId, only: { unitId?: string; whens?: Trigger[] } = {}) => {
    if (bots.includes(p)) return null;
    const list = manualActs(s, p).filter((m) => (!only.unitId || m.def.holder.id === only.unitId) && (!only.whens || only.whens.includes(m.def.spec.when)));
    if (!list.length) return null;
    return (
      <div className="ab-bar">
        <div className="tiny muted"><Icon name="ability" size={13} /> Abilities you can use now</div>
        {[...new Set(list.map((m) => m.def.holder.id))].map((hid) => {
          const mine = list.filter((m) => m.def.holder.id === hid);
          const holder = mine[0].def.holder;
          const names = [...new Set(mine.map((m) => m.def.name))];
          return (
            <div key={hid} className="ab-unit">
              {!only.unitId && <div className="ab-unit-name"><b>{holder.name}</b></div>}
              {names.map((name) => {
                const opts = mine.filter((m) => m.def.name === name);
                const ek = `${hid}|${name}`;
                const text = actRuleText(holder, name);
                const limit = opts[0].def.spec.limit;
                return (
                  <div key={ek} className="ab-item">
                    <span className="ab-name">{shortName(name)}</span>
                    {opts.map((m) => {
                      const k = `${hid}|${m.def.key}`;
                      const t = m.def.spec.target;
                      const pickOne = !!t && t.side !== 'self' && !t.each && m.targets.length > 1;
                      const use = (targetId?: string) => {
                        const res = act((g) => {
                          const err = useActByKey(g, hid, m.def.key, targetId);
                          const gu = unitById(g, hid);
                          return { err, move: gu.extraMove && gu.extraMove.phase === `${g.turn}:${g.phase}` && !g.window ? gu.extraMove.kind : null };
                        });
                        setActPick(null);
                        if (res.err) flash(res.err);
                        else flash(`${holder.name}: ${opts.length > 1 ? optLabel(m.label) : shortName(name)}`);
                      };
                      return (
                        <span key={k} className="ab-opt">
                          <button className={`btn small ${actPick === k ? 'on' : ''}`} disabled={!!m.why} title={m.why ?? m.label} onClick={() => (pickOne ? setActPick(actPick === k ? null : k) : use(m.targets[0]?.id))}>
                            {opts.length > 1 ? optLabel(m.label) : 'Use'}
                          </button>
                          {actPick === k && <div className="unit-strip">{m.targets.map((x) => unitPill(x, false, () => use(x.id)))}</div>}
                        </span>
                      );
                    })}
                    <button className={`ab-info ${explain === ek ? 'on' : ''}`} aria-label={`What is ${shortName(name)}?`} onClick={() => setExplain(explain === ek ? null : ek)}>?</button>
                    {explain === ek && (
                      <div className="ab-explain">
                        <div className="ab-explain-title">{name} <span className="tiny muted">· {holder.name}</span></div>
                        {text ? <RuleText text={text} /> : null}
                        {opts.map((m) => <div key={m.def.key} className="tiny muted">• {m.why ? `${m.label} — now: ${m.why}` : m.label}</div>)}
                        {limit && <div className="tiny muted">{limit === 'battle' ? 'Once per battle' : limit === 'round' ? 'Once per battle round' : limit === 'turn' ? 'Once per turn' : 'Once per phase'}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
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
    if (w.kind === 'blessings') {
      return (
        <BlessingsPanel title={`${pName(s, p)}: ${w.extra?.label ?? 'Blessings of Khorne'}`} dice={w.dice} picks={w.picks} rerolls={w.rerolls ?? 0} rerollFrom={w.rerollFrom}
          onReroll={(idx) => { const e = act((g) => rerollBlessings(g, idx)); if (e) flash(e); }}
          onPick={(pk) => act((g) => { if (g.window?.kind === 'blessings') applyPick(g, g.window.player, pk, g.window.extra); })} />
      );
    }
    if (w.kind === 'pledge') {
      const pp = s.players[p].pactPoints ?? 0;
      return (
        <>
          <div className="handoff">{pName(s, p)}: Pledges to the Dark Prince</div>
          <div className="tiny muted">How many enemy units will be destroyed this battle round? Kept: that many Pact points (now {pp}). Broken: your Warlord suffers D3 mortal wounds.</div>
          <div className="tiny muted">{PACT_BONUSES}</div>
          <div className="row wrap">{Array.from({ length: w.max + 1 }, (_, n) => <button key={n} type="button" className={`btn ${n === botPledge(s, p) ? 'primary' : ''}`} onClick={() => act((g) => setPledge(g, p, n))}>{n}</button>)}</div>
        </>
      );
    }
    if (w.kind === 'pickUnit') {
      return (
        <>
          <div className="handoff">{pName(s, p)}: {w.label}</div>
          <div className="unit-strip">{w.units.map((id) => unitPill(U(id), false, () => act((g) => resolvePickUnit(g, id))))}</div>
          <button className="btn" onClick={() => act((g) => resolvePickUnit(g, null))}>Skip</button>
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
          <div className="tiny muted">The game picks the right option: <b>Leap to Defend</b> (1CP) when a unit that just charged is in reach, else <b>Into the Fray</b> (2CP, enemy within 6", charge roll at most 6).</div>
          {heroicPick.map((u, i) => {
            const how = heroicMode(s, p, u);
            const go = () => {
              act((g) => { const gu = unitById(g, u.id); spendStratagem(g, p, 'heroic-intervention', gu, how === 'fray' ? 2 : undefined); declareCharge(g, gu, false, how === 'fray' ? 6 : undefined); });
              setMode({ k: 'charge', unitId: u.id, targets: [], heroic: how! }, startPaths(u));
            };
            return (
              <div key={u.id} className="row">
                <span className="grow small"><b>{i + 1}. {u.name}</b></span>
                <button className="btn small" disabled={!how} onClick={go}>{how === 'leap' ? 'Leap to Defend · 1CP' : how === 'fray' ? 'Into the Fray · 2CP' : 'No target in reach'}</button>
              </div>
            );
          })}
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
        <div className="small">Set up <b>{u.name}</b>: tap the battlefield{mode.how === 'deploy' ? ' in your deployment zone' : mode.how === 'disembark' ? ` within ${disembarkMode(s, U(mode.transportId!)) === 'combat' ? 6 : 3}" of the transport (${disembarkMode(s, U(mode.transportId!))} disembark)` : mode.how === 'deepStrike' ? ` (more than ${unitFlags(s, u).deepStrikeRange}" from enemies)` : mode.how === 'infiltrate' ? ` (more than ${RULES.reserves.enemyDistance}" from the enemy deployment zone)` : ` (within ${RULES.reserves.edgeDistance}" of a battlefield edge, more than ${RULES.reserves.enemyDistance}" from enemies)`} then drag to adjust</div>
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
          <div className="row wrap" style={{ gap: '0.5rem', marginBottom: '0.4rem' }}>
            <button
              className="btn"
              data-coach="deploy-all"
              onClick={() => {
                act((g) => {
                  g.autoDeploy = [...(g.autoDeploy ?? []), p];
                  g.deployAllOnField = [...(g.deployAllOnField ?? []), p];
                });
                setSel(null);
              }}
            >
              <Icon name="move" size={14} /> ลงสนามทั้งหมด (Deploy all on field)
            </button>
            <button
              className="btn"
              data-coach="deploy-auto"
              onClick={() => {
                act((g) => {
                  g.autoDeploy = [...(g.autoDeploy ?? []), p];
                  g.deployAllOnField = (g.deployAllOnField ?? []).filter((x) => x !== p);
                });
                setSel(null);
              }}
            >
              <Icon name="reserves" size={14} /> ตามเดิม (Deploy with Reserves)
            </button>
          </div>
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
          const pick = (ids: string[]) => { const e = act((g) => pickDetChoice(g, p, d.name, ids)); if (e) flash(e); else { setDetPick([]); flash(`${ch!.choice.name}: ${ids.map((id) => { const o = ch!.choice.options.find((x) => x.id === id); return o ? `${o.name} — ${o.text}` : id; }).join(' · ')}`); } };
          return (
            <div key={d.name} className="det-row">
              <div className="small"><b>Detachment: {d.name}</b> <span className={`det-auto ${d.auto}`}>{AUTO_LABEL[d.auto]}</span></div>
              {d.active.length > 0 && <div className="small"><span className="chip on">Active: {d.active.join(' + ')}</span>{(() => { const txt = d.active.map((n) => ch?.choice.options.find((o) => o.name === n)?.text).filter(Boolean); return txt.length ? <span className="tiny"> — {txt.join(' · ')}</span> : null; })()}</div>}
              {ch && ch.open && (
                <div className="det-choice">
                  <div className="tiny muted">{ch.choice.name} — select {need}{ch.choice.when === 'command' ? ' (until your next Command phase)' : ch.choice.when === 'round' ? ' (for the battle round)' : ' (for the battle)'}{ch.choice.uses === 'eachOnce' ? ' · each once per battle' : ch.choice.uses === 'limit' ? ` · ${ch.choice.limit} uses (${(ch.choice.limit ?? 1) - ch.state.count} left)` : ''}</div>
                  <div className="det-opts">
                    {ch.options.map(({ o, why }) => (
                      <button key={o.id} className={`btn small ${detPick.includes(o.id) ? 'on' : ''}`} disabled={!!why} title={why ?? o.text}
                        onClick={() => (need === 1 ? pick([o.id]) : setDetPick((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id].slice(-need))))}>
                        <b>{o.name}</b><span className="tiny"> {why ?? (ch.state.used.includes(o.id) ? `extra use (${d.name}) — ${o.text}` : o.text)}</span>
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
        {markRuleName(s, s.active) && (
          <div className="card" style={{ padding: 8 }}>
            <div className="small"><b>{markRuleName(s, s.active)}</b> — select one enemy unit: attacks against it re-roll the Hit roll{s.players[s.active].oathWoundBonus ? ' and get +1 to wound' : ''}{markRuleName(s, s.active) !== 'Oath of Moment' ? ' (HERETIC ASTARTES, not DAMNED)' : ''} until your next Command phase</div>
            <div className="unit-strip" style={{ marginTop: 6 }}>
              {boardUnits(s, other(s.active)).map((e) => (
                <button key={e.id} className={`unit-pill ${s.players[s.active].oathTarget === e.id ? 'sel' : ''}`} onClick={() => { act((g) => setOathTarget(g, g.active, e.id)); setSel(e.id); flash(`${markRuleName(s, s.active)} → ${e.name}`); }}>
                  <span className={`side-dot s${e.owner}`} aria-hidden="true" /> {e.name}
                  {s.players[s.active].oathTarget === e.id && <span className="oath-tag">{markRuleLabel(s, s.active)}</span>}
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
                  <span className={`side-dot s${e.owner}`} aria-hidden="true" /> {e.name}
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
                }}><span className={`radio-mark ${c.on.includes(o) ? 'on' : ''}`} aria-hidden="true" />{o}</button>
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
        {hasArmyRule(s, s.active, 'Voice of Command') && (() => {
          const officers = boardUnits(s, s.active).filter(isOfficer);
          if (!officers.length) return null;
          const activeOfficer = officers.find((o) => o.id === orderOfficerId) ?? officers.find((o) => ordersRemaining(s, o) > 0) ?? officers[0];
          const targets = activeOfficer ? boardUnits(s, s.active).filter((t) => canOfficerTarget(activeOfficer, t, s)) : [];
          const activeTarget = targets.find((t) => t.id === orderTargetId) ?? targets[0];
          const allowed = activeOfficer ? officerAllowedOrders(activeOfficer) : [];
          return (
            <div className="card" style={{ padding: 8 }}>
              <div className="small"><b>Voice of Command</b> — select an Officer, an eligible friendly unit, and an Order to issue until your next Command phase</div>
              <div style={{ marginTop: 6, marginBottom: 4 }} className="tiny muted">Officers:</div>
              <div className="unit-strip">
                {officers.map((o) => {
                  const rem = ordersRemaining(s, o);
                  return (
                    <button key={o.id} className={`unit-pill ${activeOfficer?.id === o.id ? 'sel' : ''}`} onClick={() => { setOrderOfficerId(o.id); setOrderTargetId(null); }}>
                      <span className={`side-dot s${o.owner}`} aria-hidden="true" /> {o.name} {rem > 0 ? `(${rem} left)` : '(done)'}
                    </button>
                  );
                })}
              </div>
              {activeOfficer && ordersRemaining(s, activeOfficer) > 0 && targets.length > 0 && (
                <>
                  <div style={{ marginTop: 8, marginBottom: 4 }} className="tiny muted">Eligible Targets ({activeOfficer.name}):</div>
                  <div className="unit-strip">
                    {targets.map((t) => {
                      const cur = currentOrders(t);
                      return (
                        <button key={t.id} className={`unit-pill ${activeTarget?.id === t.id ? 'sel' : ''}`} onClick={() => setOrderTargetId(t.id)}>
                          <span className={`side-dot s${t.owner}`} aria-hidden="true" /> {t.name} {cur.length ? `[${cur.join(', ')}]` : ''}
                        </button>
                      );
                    })}
                  </div>
                  {activeTarget && (
                    <>
                      <div style={{ marginTop: 8, marginBottom: 4 }} className="tiny muted">Issue Order to {activeTarget.name}:</div>
                      <div className="det-opts">
                        {allowed.map((ord) => (
                          <button key={ord} className="btn small" onClick={() => {
                            act((g) => issueOrder(g, activeOfficer.id, activeTarget.id, ord));
                            flash(`${activeOfficer.name} issued ${ord} to ${activeTarget.name}`);
                          }}>
                            {ord}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })()}
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
        {!selUnit && <div className="hint"><span>Pick a unit to move — below or on the battlefield</span></div>}
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
          // embark: after a Normal / Advance / Fall Back move, every model内的 3" of the transport
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
                {!isEngaged(s, u) && <button className="btn" data-coach="normal" onClick={() => start('normal')}><Icon name="move" /> Normal {(alive(u)[0].profile.M ?? 0) + unitFlags(s, u).move}"</button>}
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
        {(() => {
          const board = boardUnits(s, s.active);
          const moved = board.filter((x) => x.move).length;
          const left = board.length - moved;
          return endButton('movement', 'End Movement', board.length > 0 && board.every((x) => !x.move) && !s.units.some((x) => x.owner === s.active && x.status === 'reserves' && x.move), 'No unit has moved yet',
            left ? `${moved} of ${board.length} moved · the rest stay where they are` : 'Every unit has moved');
        })()}
      </>
    );
  };

  // Dark Pacts for a player who decides: before the attacks, Lethal Hits or Sustained Hits 1 (a Leadership test first)
  const pactRow = (u: UnitState) => {
    if (madePact(s, u)) return <div className="tiny pact-made"><Icon name="check" size={13} /> Dark Pact made this phase</div>;
    if (!decides(s, u.owner) || bots.includes(u.owner) || !canMakePact(s, u)) return null;
    const pact = (pick: PactPick) => act((g) => makeDarkPact(g, unitById(g, u.id), pick));
    return (
      <div className="row pact-row">
        <span className="tiny grow"><b>Dark Pact</b> · Leadership test (failed: D3 mortal wounds)</span>
        <button className="btn small" onClick={() => pact('lethal hits')}>Lethal Hits</button>
        <button className="btn small" onClick={() => pact('sustained hits 1')}>Sustained Hits 1</button>
      </div>
    );
  };

  const ritualPanel = () => {
    const p = s.active;
    const cs = casters(s, p);
    const c = cs.find((x) => x.model.id === rit.model) ?? null;
    const left = c ? ritualsLeft(s, p, c) : [];
    const r = left.find((x) => x.id === rit.ritual) ?? null;
    const targets = c && r ? ritualTargets(s, c, r) : [];
    const odds = c && r ? testOdds(rit.channel ? 3 : 2, c.bonus, r.wc) : null;
    return (
      <>
        <div className="handoff">Rituals · start of the Shooting phase</div>
        <div className="rit-help small muted">Choose caster → Ritual → target. Each caster and Ritual can be used once per phase. Test: 2D6, or 3D6 with Channel; doubles cause D3 MW.</div>
        <div className="unit-strip rit-casters">
          {cs.map((x) => (
            <button key={x.model.id} className={`unit-pill ${rit.model === x.model.id ? 'sel' : ''}`} onClick={() => { setRit({ model: x.model.id, channel: rit.channel }); setSel(x.unit.id); }}>
              <span className="side-dot s0" aria-hidden="true" /> {x.model.name}{x.bonus ? ` +${x.bonus}` : ''}{x.tries > 1 ? ` ×${x.tries}` : ''}
            </button>
          ))}
        </div>
        {c && (
          <div className="rit-list">
            {left.map((x) => (
              <button key={x.id} className={`rit-opt ${rit.ritual === x.id ? 'on' : ''}`} onClick={() => setRit({ ...rit, ritual: x.id, target: undefined })}>
                <span className="rit-opt-head"><b>{x.name}</b><span className="rit-wc">WC {x.wc}</span></span>
                {rit.ritual === x.id && <small>{x.text}</small>}
              </button>
            ))}
          </div>
        )}
        {r && (
          <>
            <div className="label rit-target-head">{r.side === 'enemy' ? 'Enemy target' : 'Friendly unit'} · within {c!.range}"</div>
            {targets.length ? (
              <div className="unit-strip rit-targets">{targets.map((t) => <button key={t.id} className={`unit-pill ${rit.target === t.id ? 'sel' : ''}`} onClick={() => setRit({ ...rit, target: t.id })}>{t.name}</button>)}</div>
            ) : <div className="small muted">No unit in range and in sight (a ruin or wall in between blocks sight; a ruin your unit stands in does not)</div>}
            <div className="row">
              <button className={`btn small ${rit.channel ? 'on' : ''}`} aria-pressed={rit.channel} onClick={() => setRit({ ...rit, channel: !rit.channel })}>Channel the Warp (3D6)</button>
              {odds && <span className="tiny muted grow">{Math.round(odds.pass * 100)}% to manifest · {Math.round(odds.perils * 100)}% perils</span>}
            </div>
          </>
        )}
        <div className="row">
          <button className="btn" onClick={() => { act((g) => endRituals(g, p)); setRit({ channel: false }); }}>Done with Rituals</button>
          <button className="btn primary grow" disabled={!c || !r || !rit.target} onClick={() => {
            const res = act((g) => attemptRitual(g, p, c!.model.id, r!.id, rit.target, { channel: rit.channel }));
            if (res?.error) flash(res.error);
            setRit({ channel: rit.channel });
          }}>Attempt {r ? r.name : 'Ritual'}</button>
        </div>
      </>
    );
  };

  const shootPanel = () => {
    if (ritualOn) return ritualPanel();
    if (mode?.k === 'explosives' && modeUnit) {
      const flags = unitFlags(s, modeUnit);
      const gheist = flags.gheistskull && !modeUnit.used?.['Gheistskull'];
      const maxRange = gheist ? 18 : 8;
      const threshold = flags.esotericExplosives ? 3 : 4;
      return (
        <>
          <div className="small"><b>Explosives</b> ({modeUnit.name}): tap a visible, unengaged target within {maxRange}"{gheist ? ' (Gheistskull)' : ''}</div>
          <div className="row">
            <button className="btn" onClick={() => setMode(null)}>Cancel</button>
            <button className="btn primary grow" disabled={!mode.target} onClick={() => {
              const res = act((g) => {
                const gu = unitById(g, modeUnit.id);
                spendStratagem(g, gu.owner, 'explosives', gu);
                const tgt = unitById(g, mode.target!);
                if (gheist && unitDistance(gu, tgt) > 8) {
                  (gu.used ??= {})['Gheistskull'] = `battle|${g.round}`;
                }
                const r = rollN(g, 6);
                const n = r.filter((x) => x >= threshold).length;
                if (n) applyMortalWounds(g, tgt, n, 'Explosives');
                return { r, n };
              });
              flash(`Explosives: [${res.r.join(' ')}] ${res.n} MW`);
              setMode(null);
            }}>Throw (6D6, {threshold}+)</button>
          </div>
        </>
      );
    }
    if (mode?.k === 'shoot' && modeUnit) {
      const opt = { mode: mode.smode, useCloseQuarters: mode.useCQ, profile: mode.profile, skipWeapons: mode.skip };
      const remaining = unfiredWeaponNames(modeUnit);
      const firedAny = modeUnit.weaponsFired.length > 0;
      const res = mode.target ? buildShootPools(s, modeUnit.id, mode.target, opt) : null;
      const multi = alive(modeUnit)[0]?.weapons.filter((w) => !isMelee(w.profiles[0]) && w.profiles.length > 1) ?? [];
      const hasCQ = alive(modeUnit).some((m) => m.weapons.some((w) => hasAbility(w.profiles[0], 'close-quarters'))) && alive(modeUnit).some((m) => m.weapons.some((w) => !isMelee(w.profiles[0]) && !hasAbility(w.profiles[0], 'close-quarters')));
      return (
        <>
          {pactRow(modeUnit)}
          <div className="small"><b>{modeUnit.name}</b> <span className="muted">· {mode.smode === 'snap' ? 'Snap Shooting' : mode.smode === 'normal' || mode.smode === 'assault' ? 'Shoot' : mode.smode === 'closeQuarters' ? 'Close-quarters' : mode.smode}{mode.target ? <> <Icon name="target" size={14} /> {U(mode.target).name}</> : targets.length ? ` · tap a target (${targets.length} in reach)` : ' · no enemy in range and sight'}</span></div>
          {!mode.overwatch && remaining.length > 1 && (
            <div className="row">
              <span className="label">Weapons shooting this target</span>
              {remaining.map((n) => {
                const off = (mode.skip ?? []).includes(n);
                return <button key={n} className={`btn small ${off ? '' : 'on'}`} aria-pressed={!off} onClick={() => setModeRaw({ ...mode, skip: off ? (mode.skip ?? []).filter((x) => x !== n) : [...(mode.skip ?? []), n] })}>{!off && <Icon name="check" size={16} />}{n}</button>;
              })}
            </div>
          )}
          <div className="row">
            {hasCQ && mode.smode !== 'closeQuarters' && !firedAny && (
              // each model fires its pistols or its other guns, not both
              <div className="seg grow" role="radiogroup" aria-label="Weapons to fire">
                <button type="button" role="radio" aria-checked={!mode.useCQ} className={!mode.useCQ ? 'on' : ''} onClick={() => setModeRaw({ ...mode, useCQ: false })}>Guns</button>
                <button type="button" role="radio" aria-checked={!!mode.useCQ} className={mode.useCQ ? 'on' : ''} onClick={() => setModeRaw({ ...mode, useCQ: true })}>Pistols</button>
              </div>
            )}
            {multi.map((w) => {
              // the profile in use and what it shoots with, so a tap shows what changed
              const stats = (q: (typeof w.profiles)[number]) => `${q.range ?? '-'}${typeof q.range === 'number' ? '"' : ''} A${q.A} ${q.skill ? `${q.skill}+` : 'N/A'} S${q.S ?? '-'} AP${q.AP} D${q.D}${q.abilities.length ? ` [${q.abilities.join(', ')}]` : ''}`;
              const cur = w.profiles[mode.profile[w.name] ?? 0];
              return (
                <button key={w.name} className="btn small prof-btn" onClick={() => {
                  const i = ((mode.profile[w.name] ?? 0) + 1) % w.profiles.length;
                  setModeRaw({ ...mode, profile: { ...mode.profile, [w.name]: i } });
                  flash(`${w.name} → ${w.profiles[i].name}: ${stats(w.profiles[i])}`);
                }}>
                  <span>{w.name}: <b>{cur.name}</b> <Icon name="reroll" size={13} /></span>
                  <small className="muted">{stats(cur)}</small>
                </button>
              );
            })}
          </div>
          {!mode.overwatch && abilityBar(modeUnit.owner, { unitId: modeUnit.id, whens: ['selectedToShoot', 'shooting'] })}
          {res?.error && <div className="err">{res.error}</div>}
          {res && !res.error && (() => {
            // one row per weapon profile; cover can differ per shooter, so pools are merged for display
            const T = U(mode.target!);
            const groups = new Map<string, typeof res.pools>();
            for (const p of res.pools) { const k = p.weapon + '|' + p.profile.name; groups.set(k, [...(groups.get(k) ?? []), p]); }
            let total = 0, slain = 0;
            const rows = [...groups.values()].map((ps) => {
              const p = ps[0];
              const ev = ps.reduce((a, x) => a + expectedDamage(s, x, T).unsaved, 0);
              slain += ps.reduce((a, x) => a + expectedDamage(s, x, T).models, 0);
              total += ev;
              const models = ps.reduce((a, x) => a + x.models, 0);
              const covered = ps.filter((x) => x.skillNote.includes('Cover')).reduce((a, x) => a + x.models, 0);
              return (
                <div key={p.key} className="small">
                  <b>{p.weapon}{p.profile.name !== p.weapon ? ` – ${p.profile.name}` : ''}</b> <span className="muted">×{models}</span>
                  <div className="statline">
                    Hit <b>{p.autoHit ? 'auto' : p.hitOn6Only ? '6' : `${p.skill}+`}</b>{p.hitMod ? ` (${p.hitMod > 0 ? '+' : ''}${p.hitMod})` : ''} · Wound <b>{p.woundNeed}+</b>{p.woundMod ? ` (+${p.woundMod})` : ''} · AP <b>{p.ap}</b> · D <b>{p.damage}</b>
                    {covered ? ` · cover ${covered}/${models}` : ''}{p.rerollAllHits ? ' · Oath' : ''}
                    {p.skillNote?.includes('For the Greater Good +1 BS') && <span className="oath-tag guided-tag"><Icon name="crosshair" size={12} /> Guided +1 BS</span>}
                    {p.skillNote?.includes('For the Greater Good (non-spotted)') && <span className="oath-tag" style={{ background: '#c62828' }}><Icon name="shock" size={12} /> Non-spotted −1 BS</span>}
                    {p.rerollHits1 && p.rerollWounds1 && <span className="oath-tag observer-tag"><Icon name="radar" size={12} /> Spotter 1s</span>}
                  </div>
                </div>
              );
            });
            return (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows}
                <div className="expect"><b className="num">≈ {slain < 0.95 ? slain.toFixed(1) : Math.round(slain)}</b> of {alive(T).length} {alive(T).length === 1 ? 'model' : 'models'} slain on average <span className="muted">({total.toFixed(1)} wounds through the saves)</span></div>
              </div>
            );
          })()}
          {res && !res.error && res.notes.map((n) => <div key={n} className="err">{n}</div>)}
          <div className="row">
            <button className="btn" onClick={() => setMode(null)}>Cancel</button>
            <button className="btn primary grow" data-coach="fire" disabled={!res || !res.pools.length} onClick={() => {
              const auto = onAuto(s, modeUnit.owner);
              act((g) => {
                const gu = unitById(g, modeUnit.id);
                if (mode.overwatch) spendStratagem(g, gu.owner, 'fire-overwatch', gu);
                if (auto) { autoShoot(g, gu.id, mode.target!, opt, !!mode.overwatch); return; }
                const r = buildShootPools(g, gu.id, mode.target!, opt);
                startAttack(g, mode.overwatch ? 'overwatch' : 'shoot', gu.id, mode.target!, r.pools);
              });
              // the unit has shot: its buttons go away so the board (and the shot) can be seen
              if (auto) { setMode(null); setSel(null); }
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
        <div className="unit-strip">
          {mine.map((x) => {
            const smodes = shootingModes(s, x);
            const canShoot = !x.selectedToShoot && smodes.length > 0;
            return unitPill(x, !canShoot, () => {
              setSel(x.id);
              if (canShoot) {
                act((g) => autoSelectToShoot(g, unitById(g, x.id)));
                setMode({ k: 'shoot', unitId: x.id, smode: smodes[0], target: null, useCQ: false, profile: {} });
              }
            });
          })}
        </div>
        {actionOptions(s).length > 0 && (
          <div style={{ background: 'rgba(37, 99, 235, 0.15)', border: '1px solid rgba(59, 130, 246, 0.5)', borderRadius: 8, padding: '8px 12px', margin: '6px 0' }}>
            <div style={{ fontWeight: 700, color: '#93c5fd', fontSize: '0.85rem', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="objective" size={15} /> Mission Actions Available:
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {actionOptions(s).map((o) => {
                const performer = s.units.find((x) => x.id === o.unitId);
                return (
                  <button
                    key={o.unitId + o.action + (o.objId ?? '') + (o.terrainId ?? '') + (o.targetId ?? '')}
                    className="btn small primary"
                    onClick={() => {
                      act((g) => startAction(g, o));
                      flash(`${o.name}: started (${performer?.name ?? ''})`);
                      setSel(o.unitId);
                    }}
                  >
                    <b>{performer?.name}</b>: {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {u && (
          <>
            {unitCard(u)}
            <div className="row acts">
              {modes.length > 0 && (
                <button className="btn primary" data-coach="shoot" onClick={() => {
                  act((g) => autoSelectToShoot(g, unitById(g, u.id)));
                  setMode({ k: 'shoot', unitId: u.id, smode: modes[0], target: null, useCQ: false, profile: {} });
                }}>
                  <Icon name="shoot" /> Shoot
                </button>
              )}
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
        {(() => {
          const can = mine.filter((x) => shootingModes(s, x).length > 0).length;
          return endButton('shooting', 'End Shooting', can > 0 && !mine.some((x) => x.shotTurn === s.turn || x.selectedToShoot), 'No unit has shot yet',
            can ? `${can} unit${can > 1 ? 's' : ''} can still shoot` : 'No unit left to shoot');
        })()}
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
          {(hasKw(modeUnit, 'MONSTER') || hasKw(modeUnit, 'VEHICLE')) && canUseStratagem(s, modeUnit.owner, 'crushing-impact', modeUnit) === null && (
            <div className="small" style={{ color: '#fca5a5', marginTop: '0.2rem' }}>
              Crushing Impact (1CP) available: rolls T{alive(modeUnit)[0]?.profile.T ?? 4}D6 on impact
            </div>
          )}
          {mode.targets.length > 0 && moveControls('charge', () => confirmMove('charge', () => {
            finish();
            const canCrush = (hasKw(modeUnit, 'MONSTER') || hasKw(modeUnit, 'VEHICLE')) && canUseStratagem(s, modeUnit.owner, 'crushing-impact', modeUnit) === null && isEngaged(s, modeUnit);
            if (canCrush) setTimeout(() => setModeRaw({ k: 'crush', unitId: modeUnit.id }), 0);
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
      const blocked = canUseStratagem(s, modeUnit.owner, 'crushing-impact', modeUnit);
      const tVal = alive(modeUnit)[0]?.profile.T ?? 4;
      return (
        <div style={{ padding: '0.4rem 0' }}>
          <div className="small" style={{ marginBottom: '0.35rem' }}>
            <b style={{ color: '#fca5a5' }}>Charge successful!</b> Use <b>Crushing Impact (1CP)</b>?
          </div>
          <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginBottom: '0.5rem' }}>
            Roll {tVal}D6 for {modeUnit.name} (T{tVal}): each 5+ deals 1 mortal wound to target (max 6), each 1 deals 1 mortal wound to {modeUnit.name}.
          </div>
          {crushTargets.length > 0 && (
            <div className="row wrap" style={{ gap: '0.4rem', marginBottom: '0.6rem' }}>
              {crushTargets.map((id) => {
                const target = U(id);
                return (
                  <button
                    key={id}
                    className="btn primary"
                    disabled={!!blocked}
                    onClick={() => {
                      const rolls = act((g) => crushingImpact(g, unitById(g, modeUnit.id), id));
                      flash(`Crushing Impact vs ${target.name}: [${rolls.join(' ')}]`);
                      setMode(null);
                    }}
                  >
                    Crush {target.name} ({tVal}D6)
                  </button>
                );
              })}
            </div>
          )}
          {blocked && <div className="tiny muted" style={{ marginBottom: '0.4rem' }}>{blocked}</div>}
          {!crushTargets.length && <div className="tiny muted" style={{ marginBottom: '0.4rem' }}>No engaged enemy unit can be targeted.</div>}
          <button className="btn ghost" onClick={() => setMode(null)}>Decline (save 1CP) → Continue</button>
        </div>
      );
    }
    const mine = boardUnits(s, s.active);
    const u = selUnit && mine.includes(selUnit) ? selUnit : null;
    const why = u ? chargeEligibility(s, u) : null;
    return (
      <>
        {!selUnit && <div className="hint"><span>Pick a unit within 12" of the enemy: roll 2D6, then tap a target in reach</span></div>}
        <div className="unit-strip">{mine.map((x) => unitPill(x, !chargeEligibility(s, x)))}</div>
        {u && (
          <>
            {unitCard(u)}
            {why ? <div className="muted small">Cannot charge: {why}</div> : (
              <div className="row">
                <button className="btn primary" data-coach="charge" onClick={() => { act((g) => autoDeclareCharge(g, unitById(g, u.id), fly)); setMode({ k: 'charge', unitId: u.id, targets: [] }, startPaths(u)); }}>Declare charge (2D6)</button>
                {hasKw(u, 'FLY') && <button className={`btn small ${fly ? 'on' : ''}`} onClick={() => setFly(!fly)}>Fly (−2")</button>}
              </div>
            )}
            {u.declaredCharge && isEngaged(s, u) && (hasKw(u, 'MONSTER') || hasKw(u, 'VEHICLE')) && (() => {
              const blocked = canUseStratagem(s, u.owner, 'crushing-impact', u);
              const enemies = engagedEnemies(s, u);
              const tVal = alive(u)[0]?.profile.T ?? 4;
              return (
                <div style={{ marginTop: '0.5rem', padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontWeight: 800, color: '#fca5a5', fontSize: '0.9rem' }}>Crushing Impact (1CP)</span>
                    <span style={{ fontSize: '0.8rem', color: '#fecaca' }}>T{tVal} ({tVal}D6)</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '0.45rem' }}>
                    Roll {tVal}D6: each 5+ deals 1 mortal wound to target (max 6), each 1 deals 1 mortal wound to {u.name}.
                  </div>
                  {blocked ? (
                    <div className="tiny muted">{blocked}</div>
                  ) : (
                    <div className="row wrap" style={{ gap: '0.4rem' }}>
                      {enemies.map((t) => (
                        <button
                          key={t.id}
                          className="btn small primary"
                          onClick={() => {
                            const rolls = act((g) => crushingImpact(g, unitById(g, u.id), t.id));
                            flash(`Crushing Impact vs ${t.name}: [${rolls.join(' ')}]`);
                          }}
                        >
                          Crush {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
        {onAuto(s, s.active) && mine.some((x) => !chargeEligibility(s, x) && !x.declaredCharge) && (
          <button className="btn" onClick={() => {
            // what happened, unit by unit: who made it in, who rolled too short
            const res = act((g) => {
              const before = new Set(boardUnits(g, g.active).filter((x) => x.declaredCharge).map((x) => x.id));
              autoCharges(g);
              const now = boardUnits(g, g.active).filter((x) => x.declaredCharge && !before.has(x.id));
              const madeUnits = now.filter((x) => isEngaged(g, x)).map((x) => x.id);
              return { n: now.length, made: madeUnits, short: now.filter((x) => !isEngaged(g, x)).map((x) => `${x.name} rolled ${x.chargeRoll}"`) };
            });
            if (res?.made.length === 1 && canUseStratagem(s, s.active, 'crushing-impact', unitById(s, res.made[0])) === null) {
              setMode({ k: 'crush', unitId: res.made[0] });
            } else {
              setSel(res?.made[0] ?? null);
            }
            if (res) flash(!res.n ? 'No unit has a fair chance to reach an enemy' : `${res.made.length} of ${res.n} charge${res.n > 1 ? 's' : ''} made it in${res.short.length ? ` · ${res.short.join(', ')}` : ''}`);
          }}>Charge for me</button>
        )}
        {abilityBar(s.active, { whens: ['anyPhase'] })}
        {selUnit && selUnit.owner !== s.active && unitCard(selUnit)}
        {redoButton()}
        {(() => {
          const can = mine.filter((x) => !chargeEligibility(s, x)).length;
          return endButton('charge', 'End Charge → Fight', can > 0 && !mine.some((x) => x.declaredCharge), 'Some units can still charge',
            can ? `${can} unit${can > 1 ? 's' : ''} can still charge` : 'No unit in charge range');
        })()}
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
    if (f.step === 'pileIn') {
      setTimeout(() => act((g) => {
        if (!g.fight) return;
        for (const p of [g.active, other(g.active)]) {
          for (const u of boardUnits(g, p).filter((x) => pileInEligible(g, x))) {
            autoPileMove(g, u, 'pileIn');
          }
        }
        endPileInStep(g);
        endPileInStep(g);
      }), 0);
      return null;
    }
    if (f.step === 'consolidate') {
      setTimeout(() => act((g) => {
        if (!g.fight) return;
        for (const p of [g.active, other(g.active)]) {
          for (const u of boardUnits(g, p).filter((x) => consolidateEligible(g, x) && consolidateMode(g, x).mode)) {
            autoPileMove(g, u, 'consolidate');
          }
        }
        endPhase(g);
      }), 0);
      return null;
    }
    // fight step
    if (mode?.k === 'fight' && modeUnit) {
      const u = modeUnit;
      // a choice only for models that carry more than one melee weapon; every other model just fights with its own
      const own = (m: ModelState) => meleeWeapons(m).filter((w) => !hasAbility(w.profiles[0], 'extra-attacks'));
      const weapons = [...new Map(alive(u).filter((m) => own(m).length > 1).flatMap(own).map((w) => [w.name, w])).values()];
      const chars = alive(u).filter((m) => m.isCharacter);
      const ec = canUseStratagem(s, u.owner, 'epic-challenge', u);
      const res = mode.target ? buildFightPools(s, u.id, mode.target, { weapon: mode.weapon, epicChallengeModel: mode.epic ? chars[0]?.id : undefined }) : null;
      return (
        <>
          <div className="small"><b>{u.name}</b>{fightTargets.length > 1 ? ' · tap a target' : ''}{weapons.length > 1 ? ' · pick the weapon for models that carry several' : ''}</div>
          {pactRow(u)}
          <div className="row">
            {weapons.length > 1 && weapons.map((w) => <button key={w.name} className={`btn small ${mode.weapon === w.name ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, weapon: w.name })}>{w.name}</button>)}
            {chars.length > 0 && !ec && <button className={`btn small ${mode.epic ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, epic: !mode.epic })}>Epic Challenge 1CP</button>}
          </div>
          {abilityBar(u.owner, { unitId: u.id, whens: ['selectedToFight', 'fightStartButton'] })}
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
    const whenTh: Record<string, string> = { endOfYourTurn: 'end of your turn', endOfYourCommandPhase: 'end of your Command phase (last round: end of turn)', endOfBattle: 'end of the battle', endOfAnyTurn: 'end of every turn' };
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
                    <span className="tiny muted">{roundsText(r.rounds, lastRound(s))} · {whenTh[r.when]}</span>
                    <div>{r.text} {r.tiers ? '' : r.vp > 0 ? <b>{r.vp}VP</b> : null}{r.bonus ? <span className="muted"> {r.bonusText ?? ''} (+{r.bonus.vp})</span> : null}</div>
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
    if (s.phase === 'gameover') return (
      <div className="row">
        <div className="handoff grow">{s.winner === 'draw' ? 'The battle ends in a draw' : `${pName(s, s.winner as PlayerId)} wins`}</div>
        <button className="btn" onClick={() => setFinalSeen(false)}>Result</button>
        <button className="btn primary" onClick={onExit}>{s.campaign ? 'Campaign' : 'Home'}</button>
      </div>
    );
    if (spectate) return (
      <div className="row">
        <div className="bot-act grow"><span className={`bot-dot s${actingBot ?? 0}`} />{botSays ?? (actingBot !== null ? `${pName(s, actingBot)} is playing` : 'Between turns')}</div>
        <div className="seg" role="radiogroup" aria-label="Speed" style={{ minWidth: 170 }}>
          <button role="radio" aria-checked={speed === 0} className={speed === 0 ? 'on' : ''} onClick={() => setSpeed(0)}>Pause</button>
          <button role="radio" aria-checked={speed === 1} className={speed === 1 ? 'on' : ''} onClick={() => setSpeed(1)}>Normal</button>
          <button role="radio" aria-checked={speed === 2} className={speed === 2 ? 'on' : ''} onClick={() => setSpeed(2)}>Fast</button>
        </div>
      </div>
    );
    if (s.window && (!actingBot || s.window.player !== actingBot)) return windowPanel();
    // the bot's turn: what it just did, in a line (the commander above says why)
    if (actingBot !== null) return (
      <div className="bot-act">
        <span className={`bot-dot s${actingBot}`} />
        <span className="grow">{thinking ? `${pName(s, actingBot)} is weighing its turn…` : botSays ?? `${pName(s, actingBot)} is playing…`}</span>
        <button className={`btn small ff ${rush ? 'on' : ''}`} aria-pressed={rush} onClick={() => setRush((v) => !v)} title="Speed up the bot's turn: shorter pauses, results only">
          <Icon name="advance" size={16} /> {rush ? 'Fast' : 'Faster'}
        </button>
      </div>
    );
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
  // the sides as the player thinks of them: "You" and "Bot" against the bot, else the players' names
  const sideLabel = (p: PlayerId) => (bots.length === 1 ? (bots.includes(p) ? 'Bot' : 'You') : s.players[p].name.replace(/ Bot$/, ''));
  const turnText = s.phase === 'deploy' ? `${layoutName} · ${pName(s, s.deployTurn)} sets up`
    : s.phase === 'scouts' ? 'Scouts moves'
    : s.phase === 'gameover' ? 'Battle over'
    : bots.length === 1 ? (bots.includes(s.active) ? `${pName(s, s.active)}'s turn` : 'Your turn') : `${pName(s, s.active)}'s turn`;
  // the commander on screen: whoever spoke last, else the bot whose turn it is
  const commanderP: PlayerId | null = bots.length ? (actingBot ?? (says && bots.includes(says.p) ? says.p : bots[0])) : null;
  // the enemy's likely attacks next turn, drawn on request while it is the player's turn
  const planArrows = useMemo(() => {
    if (!showPlan || !plan || plan.turn !== s.turn || s.active === plan.p) return [];
    const done = new Set<string>();
    const out: { from: Pt; to: Pt; melee: boolean; label: string }[] = [];
    for (const x of plan.intents) {
      const key = `${x.attackerId}>${x.targetId}`;
      if (done.has(key)) continue;
      done.add(key);
      const a = s.units.find((u) => u.id === x.attackerId), tg = s.units.find((u) => u.id === x.targetId);
      if (!a || !tg || !onBoard(tg) || !alive(a).length) continue;
      out.push({ from: onBoard(a) ? polyCentroid(alive(a)) : x.from, to: polyCentroid(alive(tg)), melee: x.kind === 'fight', label: x.kind === 'fight' ? 'charge' : 'shoot' });
    }
    return out.slice(0, 10);
  }, [showPlan, plan, s]);
  const planReady = !!plan && plan.turn === s.turn && s.active !== plan.p && plan.intents.length > 0;
  if (showPlan && planReady) for (const a of plan!.intents) if (onBoard(U(a.targetId)) && U(a.targetId).owner !== plan!.p) (badges[a.targetId] ??= []).includes('Threatened') || (badges[a.targetId] ??= []).push('Threatened');
  const final = s.phase === 'gameover' && !finalSeen;
  // first battles against the bot: a tip at each new thing to do, with the control to use ringed
  const ownSel = !!selUnit && selUnit.owner === human && onBoard(selUnit);
  const tip = human !== null && !coach.off && !viewing && !sheet && !showStrats && !reporting && !rolling && !final && !tape.on
    ? tipsNow({
      s, me: human, botActing: actingBot !== null, planReady,
      mode: mode ? { k: mode.k, kind: 'kind' in mode ? String(mode.kind) : undefined, target: 'target' in mode ? (mode.target as string | null) : undefined } : null,
      selFresh: ownSel && (s.phase !== 'movement' || !selUnit!.move) && (s.phase !== 'shooting' || !selUnit!.selectedToShoot),
      selCanShoot: ownSel && s.phase === 'shooting' && shootingModes(s, selUnit!).length > 0,
      selCanCharge: ownSel && s.phase === 'charge' && !chargeEligibility(s, selUnit!),
    }).find((t) => !coach.seen.includes(t.id)) ?? null
    : null;

  // army-wide buff cards of one side
  const buffCards = (p: PlayerId) => [
    ...[...armyChips[p]].map(([label, tags]) => <div key={`a${p}${label}`} className={`buffcard p${p}`}><b>{label}</b><span>Every unit: {tags.join(' · ')}</span></div>),
    ...activeIds(s, p).map((id) => { const b = blessingById(id)!; return <div key={`${p}${id}`} className={`buffcard p${p}`}><b>{b.name}</b><span>{b.text}</span></div>; }),
    ...(s.players[p].pledge?.round === s.round || s.players[p].pactPoints
      ? [<div key={`pact${p}`} className={`buffcard p${p}`}><b>{s.players[p].pledge?.round === s.round ? `Pledge ${s.players[p].pledge!.n} · ` : ''}Pact {s.players[p].pactPoints ?? 0}</b><span>{PACT_BONUSES}</span></div>]
      : []),
    ...(s.players[p].miracleDice && s.players[p].miracleDice!.length > 0
      ? [<div key={`miracle${p}`} className={`buffcard p${p}`}><b>Miracle Dice ({s.players[p].miracleDice!.length})</b><span>Pool: {s.players[p].miracleDice!.slice().sort((a, b) => b - a).map((d) => `[${d}]`).join(' ')}</span></div>]
      : []),
    ...(s.players[p].fateDice && s.players[p].fateDice!.length > 0
      ? [<div key={`fate${p}`} className={`buffcard p${p}`}><b>Fate Dice ({s.players[p].fateDice!.length})</b><span>Pool: {s.players[p].fateDice!.slice().sort((a, b) => b - a).map((d) => `[${d}]`).join(' ')}</span></div>]
      : []),
    ...(s.players[p].battleFocusTokens !== undefined && s.players[p].battleFocusTokens! > 0
      ? [<div key={`bf${p}`} className={`buffcard p${p}`}><b>Battle Focus</b><span>Tokens: {s.players[p].battleFocusTokens}</span></div>]
      : []),
    ...(s.players[p].votannAbility
      ? [<div key={`votann${p}`} className={`buffcard p${p}`}><b>Prioritised Efficiency ({s.players[p].yieldPoints ?? 0} YP)</b><span>Active: <b>{s.players[p].votannAbility}</b>{s.players[p].votannAbility === 'Hostile Acquisition' ? ' (+1 Hit vs objective targets, re-roll Advance & Charge)' : ' (+1 Hit from controlled objectives, −1 to Wound if S > T)'}</span></div>]
      : []),
    ...(s.players[p].admechImperative
      ? [<div key={`admech${p}`} className={`buffcard p${p}`}><b>Doctrina Imperatives</b><span>Active: <b>{s.players[p].admechImperative}</b>{s.players[p].admechImperative.startsWith('Protector') ? ' (Ranged [HEAVY], +1 BS; near Battleline: −1 to be hit in melee)' : ' (Ranged [ASSAULT], +1 WS; near Battleline: +1 AP to all attacks)'}</span></div>]
      : []),
    ...(s.players[p].painTokens !== undefined
      ? [<div key={`drukhari${p}`} className={`buffcard p${p}`}><b>Power from Pain ({s.players[p].painTokens} Tokens)</b><span>Spend 1 Pain token to Empower a unit{s.players[p].drukhariWagerWinning ? ` · Reaper's Wager: ${s.players[p].drukhariWagerWinning} winning` : ''}</span></div>]
      : []),
  ];
  // where an army's buff column goes: beside its own deployment zone (left / right, or top / bottom of the left side)
  const buffSide = (p: PlayerId): 'left' | 'right' | 'top' | 'bottom' => {
    const mid = (q: PlayerId) => { const z = zoneOf(s, q); return { x: z.reduce((a, v) => a + v.x, 0) / z.length, y: z.reduce((a, v) => a + v.y, 0) / z.length }; };
    const a = mid(p), o = mid((1 - p) as PlayerId);
    return Math.abs(a.x - o.x) > Math.abs(a.y - o.y) ? (a.x < o.x ? 'left' : 'right') : a.y < o.y ? 'top' : 'bottom';
  };
  // army-wide buffs lie on the table beside the battlefield, next to each army's deployment zone
  const sideCards = s.phase === 'deploy' ? [] : ([0, 1] as PlayerId[]).map((p) => ({ p, at: buffSide(p), cards: buffCards(p) }));

  return (
    <div className={`game ${(reporting || rolling) && actingBot === null ? 'telling' : ''}`}>
      <header className="game-top">
        <div className="topbar">
          <button className="icon-btn" onClick={() => setShowMenu(true)} aria-label="Menu"><Icon name="menu" size={24} /></button>
          <SideScore s={s} p={0} label={sideLabel(0)} onOpen={() => { setCardSide(0); setShowCards(true); }} />
          <div className="round-box" aria-label="Battle status">
            <span className="rb-round">{s.phase === 'deploy' ? 'Deployment' : s.phase === 'scouts' ? 'Pre-battle' : `Round ${s.round}/${lastRound(s)}`}</span>
            <span className={`rb-turn ${s.active ? 'p1' : 'p0'}`}>{turnText}</span>
          </div>
          <SideScore s={s} p={1} label={sideLabel(1)} onOpen={() => { setCardSide(1); setShowCards(true); }} />
          <button className="tb-tool" onClick={() => { setCardSide(null); setShowCards(true); }} aria-label="Mission cards">
            <span className="tb-ico"><Icon name="cards" size={22} />{s.players[me].secActive.length > 0 && <i className="tb-badge">{s.players[me].secActive.length}</i>}</span>
            <span className="tb-lbl">Mission</span>
          </button>
          <button className="tb-tool" onClick={() => openStrats()} aria-label="Stratagems">
            <span className="tb-ico"><Icon name="strat" size={22} /></span>
            <span className="tb-lbl">Strat</span>
          </button>
        </div>
        {s.phase !== 'deploy' && <AdvantageBar share={advantage(s)} names={[s.players[0].name, s.players[1].name]} />}
        {['command', 'movement', 'shooting', 'charge', 'fight'].includes(s.phase) && (
          <div className={`phasebar a${s.active}`}>
            {(['command', 'movement', 'shooting', 'charge', 'fight'] as const).map((ph) => (
              <span key={ph} className={s.phase === ph ? 'on' : ['command', 'movement', 'shooting', 'charge', 'fight'].indexOf(ph) < ['command', 'movement', 'shooting', 'charge', 'fight'].indexOf(s.phase) ? 'done' : ''}>{PHASE_TH[ph][0]}{PHASE_TH[ph].slice(1).toLowerCase()}</span>
            ))}
          </div>
        )}
      </header>
      <div className={`board-wrap shake-${shake}`}>
        <Board
          s={s}
          viewer={actor}
          selected={sel}
          movable={
            s.phase === 'movement' && !mode ? s.units.filter((u) => u.owner === s.active && onBoard(u) && !u.move).map((u) => u.id)
            : (!mode && s.window?.kind === 'fireOverwatch' && s.window.player === actor) ? overwatchCandidates(s, s.window.player).map((u) => u.id)
            : undefined
          }
          draftUnit={draftUnit}
          draft={draft}
          unitNumbers={heroicNumbers}
          edgeGuide={mode?.k === 'place' && mode.how === 'ingress' ? RULES.reserves.edgeDistance : undefined}
          zoneGuide={zoneGuide}
          maxFor={mode?.k === 'place' ? undefined : maxFor}
          walk={mode?.k === 'place' ? undefined : walkDraft}
          animateMoves={bots.length ? bots : undefined}
          bad={check?.bad}
          targets={targets}
          picked={picked}
          rings={rings}
          badges={badges}
          buffTags={buffTags}
          riled={riled}
          goals={goals}
          losLines={losLines}
          noLos={noLos}
          onTapUnit={onTapUnit}
          measure={tape.on ? { a: tape.a, b: tape.b, label: tapeInfo?.text, los: tapeInfo?.los } : undefined}
          onTapBoard={onTapBoard}
          onDraft={(d) => {
            if (mode?.k === 'place' && modeUnit && (mode.how === 'ingress' || mode.how === 'deepStrike' || mode.how === 'infiltrate')) {
              const pos = nudgePlacement(s, modeUnit, lastPos(d), mode.how);
              setDraft(placePaths(pos));
              const chk = validatePlacement(s, modeUnit, pos, mode.how);
              setCheck(chk.ok ? null : chk);
            } else { setDraft(d); setCheck(null); }
          }}
          onDragEnd={onDragEnd}
          plan={planArrows}
          side={sideCards}
        />
        <AttackReport s={s} level={((spectate && speed === 2) || (rush && actingBot !== null)) && fxLevel === 'full' ? 'short' : fxLevel} quick={(o) => spectate || rush || bots.includes(o)} onBusy={setReporting}
          onShake={(lv) => { if (!lv) return; setShake(lv); window.setTimeout(() => setShake(0), 420 + lv * 80); }} />
        {botSays && actingBot === null && !spectate && <div className="bot-caption">{botSays}</div>}
        {toast && <div className="toast">{toast}</div>}
        {s.campaign && <RelicStrip relics={s.campaign.relics} rules={s.campaign.rules} relicLevels={s.campaign.relicLevels} onInfo={flash} />}
        {tape.on && (
          <div className="tape-bar">
            <span>{tapeInfo ? tapeInfo.line : tape.a ? 'Tap the second point (tap a model = base to base + line of sight)' : 'Tape measure: tap a model or a first point'}</span>
            <button className="btn small" onClick={() => setTape({ on: false })}>Close</button>
          </div>
        )}
        {stratPick && (
          <div className="tape-bar">
            <span>Stratagem: tap the unit that uses it</span>
            <button className="btn small" onClick={() => setStratPick(null)}>Cancel</button>
          </div>
        )}
        {planReady && !mode && (
          <button className={`plan-toggle ${showPlan ? 'on' : ''}`} aria-pressed={showPlan} onClick={() => setShowPlan((v) => !v)}>
            <Icon name="bot" size={16} /> {showPlan ? 'Hide enemy plan' : 'Enemy plan'}
          </button>
        )}
      </div>
      <aside className={`game-side ${(reporting || rolling) && actingBot === null ? 'tucked' : ''}`}>
        {commanderP !== null && (
          <Commander quiet={actingBot === null && !thinking && !(says && Date.now() - says.k < 6000)} s={s} p={commanderP} says={says && says.p === commanderP ? says.text : null}
            think={thinking && actingBot === commanderP ? think ?? { values: {}, done: 0, total: 0 } : null}
            planning={!actingBot && ponderProg ? ponderProg : null} />
        )}
        <div className={`panel ${actor ? 's1' : ''}`}>
          {bots.length === 0 && s.phase !== 'deploy' && s.phase !== 'gameover' && !s.window && <div className="label"><span className={`side-dot s${actor}`} aria-hidden="true" /> {pName(s, actor)} to act</div>}
          {panel()}
        </div>
      </aside>

      <Coach tip={tip} onSeen={(id) => setCoachRaw((c) => { if (c.seen.includes(id)) return c; const n = { ...c, seen: [...c.seen, id] }; saveCoach(n); return n; })} onOff={() => setCoach({ ...coach, off: true })} />
      <RollOverlay s={s} onBusy={setRolling} quick={spectate || (rush && actingBot !== null)} />
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
            <div className="tray-head"><span className="grow" /><button className="icon-btn" aria-label="Close" onClick={() => setSheet(null)}><Icon name="close" /></button></div>
            <UnitView u={U(sheet)} model={sheetModel} />
            {abilityBar(U(sheet).owner, { unitId: sheet })}
            {/* for rules the app does not apply by itself: switch an effect on for this phase */}
            {!bots.includes(U(sheet).owner) && onBoard(U(sheet)) && buffPanel(U(sheet))}
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
        const rounds = (r: number[]) => roundsText(r, lastRound(s));
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
                      <div className="mc-rule-body"><span className="grow">{r.text}{r.bonus ? <span className="muted"> · {r.bonusText ?? ''} (+{r.bonus.vp})</span> : null}</span>{!r.tiers && r.vp > 0 && <span className="mc-vp">{r.vp} VP</span>}</div>
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
            <div className="tray-head"><span className="sheet-title grow">Menu</span><button className="icon-btn" aria-label="Close menu" onClick={() => setShowMenu(false)}><Icon name="close" /></button></div>
            <div className="menu-grid">
              <button className="menu-item" disabled={!canUndo} onClick={() => { undo(); setMode(null); setShowMenu(false); flash('Undone one step'); }}>
                <Icon name="undo" size={22} /><span><b>Undo</b><small>Take back the last step{typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches ? ' · Ctrl+Z' : ''}</small></span>
              </button>
              <button className="menu-item" onClick={() => { setShowMenu(false); setTape({ on: true }); }}>
                <Icon name="ruler" size={22} /><span><b>Tape measure</b><small>Distance and line of sight</small></span>
              </button>
              <button className="menu-item" onClick={() => { setShowMenu(false); setShowMissions(true); }}>
                <Icon name="objective" size={22} /><span><b>Mission rules</b><small>Scoring for both sides, manual scoring</small></span>
              </button>
            </div>
            <div className="field">
              <span id="fx-level">Attack reports</span>
              <div className="seg" role="radiogroup" aria-labelledby="fx-level">
                {([['full', 'Full'], ['short', 'Result only'], ['off', 'Off']] as const).map(([k, l]) => (
                  <button key={k} role="radio" aria-checked={fxLevel === k} className={fxLevel === k ? 'on' : ''} onClick={() => setFxLevel(k)}>{l}</button>
                ))}
              </div>
              <span className="field-note">{fxLevel === 'full' ? 'Each attack counts up: shots, hits, wounds, through the saves — and what changed the odds' : fxLevel === 'short' ? 'Only what each attack destroyed' : 'No reports (the board still shows the shots)'}</span>
            </div>
            {bots.length === 1 && (
              <div className="field">
                <span id="tips">Tips for a first battle</span>
                <div className="seg" role="radiogroup" aria-labelledby="tips">
                  <button role="radio" aria-checked={!coach.off} className={!coach.off ? 'on' : ''} onClick={() => setCoach({ ...coach, off: false })}>On</button>
                  <button role="radio" aria-checked={coach.off} className={coach.off ? 'on' : ''} onClick={() => setCoach({ ...coach, off: true })}>Off</button>
                </div>
                {coach.seen.length > 0 && <button className="linkish small" onClick={() => { setCoach({ off: false, seen: [] }); setShowMenu(false); }}>Show every tip again</button>}
              </div>
            )}
            <div className="field">
              <span id="snd">Sound</span>
              <div className="seg" role="radiogroup" aria-labelledby="snd">
                <button role="radio" aria-checked={sound} className={sound ? 'on' : ''} onClick={() => { setSoundOn(true); setSound(true); play('gem'); }}>On</button>
                <button role="radio" aria-checked={!sound} className={!sound ? 'on' : ''} onClick={() => { setSoundOn(false); setSound(false); }}>Off</button>
              </div>
            </div>
            <button className="btn danger" onClick={onExit}>Exit to home <span className="muted small">· the battle is saved</span></button>
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
            onAuto={r.rule.react ? () => act((g) => { const GP = g.players[p]; GP.autoStrats = GP.autoStrats?.includes(r.st.id) ? GP.autoStrats.filter((q) => q !== r.st.id) : [...(GP.autoStrats ?? []), r.st.id]; }) : undefined}
            onUse={(unitId, use) => {
              const eff = act((g) => applyDetachmentStratagem(g, p, r.st, unitId, use));
              const on = unitId ? s.units.find((u) => u.id === unitId)?.name : undefined;
              flash(`${r.st.name}${on ? ` → ${on}` : ''}${eff && eff.length ? `: ${eff.map((k) => EFFECT_LABEL[k] ?? k).join(', ')}` : ''}`);
              if (unitId) setSel(unitId);
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
              {!bots.includes(p) && (
                <div className="row">
                  <span className="small grow">{tgtUnit ? <>For <b>{tgtUnit.name}</b> (only this unit gets it)</> : 'Any unit'}</span>
                  <button className="btn small" onClick={() => { setShowStrats(false); setStratPick({ p, ids: boardUnits(s, p).map((u) => u.id) }); }}>Pick a unit on the map</button>
                  {tgtUnit && <button className="btn small" onClick={() => setStratUnit('')}>All units</button>}
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

      {summary && !final && <RoundSummary s={s} t={summary} onClose={() => setSummary(null)} />}
      {final && (
        <RoundSummary s={s} t={tally(s, null)} final onClose={() => setFinalSeen(true)}
          actions={<>
            <button className="btn" onClick={(e) => { e.stopPropagation(); setFinalSeen(true); }}>See the board</button>
            <button className="btn primary" onClick={(e) => { e.stopPropagation(); onExit(); }}>{s.campaign ? 'Back to the campaign' : 'Back to home'}</button>
          </>} />
      )}
    </div>
  );
}
