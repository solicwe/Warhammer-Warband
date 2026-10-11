// The first battle against the bot, taught as it is played: at each new thing to do, a ring lights up the control
// that does it and a few words say why. Each tip shows once; the player can put them away at any time and bring them
// back from the menu (or "How to play" on the home screen).
import { useEffect, useLayoutEffect, useState } from 'react';
import type { GameState, PlayerId } from '../engine/types';
import { Icon } from './Icon';

const KEY = 'coach';

interface CoachPrefs { off: boolean; seen: string[] }

export function loadCoach(): CoachPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CoachPrefs> | null;
    return { off: !!v?.off, seen: Array.isArray(v?.seen) ? v!.seen : [] };
  } catch { return { off: false, seen: [] }; }
}
export function saveCoach(c: CoachPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private window: this session only */ }
}
/** Start the tips again from the first one (How to play). */
export function resetCoach() { saveCoach({ off: false, seen: [] }); }

export interface Tip { id: string; at: string; title: string; text: string }

/** What the screen shows right now, as far as the tips care. */
export interface CoachView {
  s: GameState;
  me: PlayerId;
  /** the bot is playing its turn */
  botActing: boolean;
  mode: { k: string; kind?: string; target?: string | null } | null;
  /** one of the player's own units is selected and has not acted in this phase */
  selFresh: boolean;
  /** … and it can shoot / declare a charge now */
  selCanShoot: boolean;
  selCanCharge: boolean;
  /** the "Enemy plan" button is on screen */
  planReady: boolean;
}

/** Tips that fit this moment, most pressing first: the first one not yet seen is shown. */
export function tipsNow(v: CoachView): Tip[] {
  const { s, me, mode } = v;
  if (s.phase === 'gameover') return [];
  const out: Tip[] = [];
  if (s.attack) {
    const mine = s.units.find((u) => u.id === s.attack!.attackerId)?.owner === me;
    out.push(mine
      ? { id: 'dice', at: '.dice-tray', title: 'Rolling the dice', text: 'Hits, then wounds, then the enemy\'s saves. Tap to roll each step — or Skip to jump to the result.' }
      : { id: 'dice-save', at: '.dice-tray', title: 'Your saves', text: 'The bot is attacking you: roll your saving throws here. Each failed save costs a model wounds.' });
    return out;
  }
  if (v.botActing) {
    if (s.phase !== 'deploy' && s.phase !== 'scouts') out.push({ id: 'bot-turn', at: '.bot-act .ff', title: 'The bot\'s turn', text: 'Its commander says what it is thinking. Tap Faster to hurry it along.' });
    return out;
  }
  if (s.phase === 'deploy') {
    if (s.deployTurn !== me) return out;
    if (mode?.k === 'place') out.push({ id: 'deploy-place', at: '.board-wrap', title: 'Place the unit', text: 'Tap inside your deployment zone (your coloured strip), drag to adjust, then Confirm.' });
    else out.push({ id: 'deploy', at: '[data-coach="deploy-auto"]', title: 'Set up your army', text: 'Pick a unit and place it in your zone — or let the app set up the rest for you here.' });
    return out;
  }
  if (s.active !== me || s.window) return out;
  const own = s.units.filter((u) => u.owner === me && u.status === 'board');
  switch (s.phase) {
    case 'command':
      if (s.round >= 2) out.push({ id: 'score', at: '.side-score.s0', title: 'Your score', text: 'VP so far and your Command Points (the gems). Tap it to read your mission cards: what scores, and when.' });
      out.push({ id: 'command', at: '.sticky-act', title: 'Command phase', text: 'Both players gain 1 CP to spend on Stratagems. From round 2 the objectives you hold score VP at the end of this phase.' });
      break;
    case 'movement':
      if (mode?.k === 'move') out.push({ id: 'move-drag', at: '[data-coach="joy"]', title: 'Move it', text: 'Push the stick (or drag a model on the board). The count shows how far it has gone. Then Confirm.' });
      else if (v.selFresh) out.push({ id: 'move-kind', at: '[data-coach="normal"]', title: 'How to move', text: 'Normal: up to its Move. Advance: further by a dice roll, but then it cannot shoot (except Assault weapons) or charge.' });
      else {
        if (v.planReady && s.round >= 2) out.push({ id: 'plan', at: '.plan-toggle', title: 'The bot\'s plan', text: 'While you played, the bot planned its next turn. Tap to see which of your units it means to attack.' });
        if (own.some((u) => u.move)) out.push({ id: 'move-end', at: '.end-btn', title: 'Done moving?', text: 'Units you leave stay where they are. Tap End Movement when you are ready.' });
        out.push({ id: 'move', at: '.unit-strip', title: 'Your turn: move', text: 'Tap a unit here or on the board. Head for the objectives (the circles): holding them scores VP.' });
      }
      break;
    case 'shooting':
      if (mode?.k === 'shoot' && !mode.target) out.push({ id: 'shoot-target', at: '.board-wrap', title: 'Pick a target', text: 'Tap a highlighted enemy. Range, line of sight and cover are worked out for you.' });
      else if (mode?.k === 'shoot') out.push({ id: 'shoot-fire', at: '[data-coach="fire"]', title: 'Fire', text: 'Above: how many models it slays on average. Tap Shoot! to roll.' });
      else if (v.selFresh && v.selCanShoot) out.push({ id: 'shoot-pick', at: '[data-coach="shoot"]', title: 'Shoot', text: 'Pick this unit\'s guns. Weapons with different targets can split their fire.' });
      else {
        if (own.some((u) => u.shotTurn === s.turn || u.selectedToShoot)) out.push({ id: 'shoot-end', at: '.end-btn', title: 'Done shooting?', text: 'Tap End Shooting once every unit that can has fired.' });
        out.push({ id: 'shoot', at: '.unit-strip', title: 'Shooting phase', text: 'Pick a unit to shoot with. Greyed units cannot (out of range, Advanced or Fell Back).' });
      }
      break;
    case 'charge':
      if (mode?.k === 'charge') out.push({ id: 'charge-move', at: '.board-wrap', title: 'Charge!', text: 'Tap a highlighted enemy in reach: your unit moves into it and fights first.' });
      else if (v.selFresh && v.selCanCharge) out.push({ id: 'charge-declare', at: '[data-coach="charge"]', title: 'Declare a charge', text: 'Roll 2D6: if that is enough inches to reach the enemy, your unit charges and strikes first in the Fight phase.' });
      else out.push({ id: 'charge', at: '.end-btn', title: 'Charge phase', text: 'A unit within 12" of the enemy can charge. Nothing in reach? End Charge to go on to the fights.' });
      break;
    case 'fight':
      out.push({ id: 'fight', at: '.panel', title: 'Fight phase', text: 'Units in combat pile in, strike and consolidate. Chargers fight first, then the players take turns.' });
      break;
  }
  return out;
}

/**
 * The ring round the control to use and the tip next to it. `onSeen` marks a tip as done (it is never shown again);
 * a tip whose moment passes (the player did the thing) counts as seen too.
 */
export function Coach({ tip, onSeen, onOff }: { tip: Tip | null; onSeen: (id: string) => void; onOff: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [shown, setShown] = useState<{ id: string; at: number } | null>(null);

  // the tip on screen gives way to the next one: the one before counts as seen (if it was up long enough to read)
  useEffect(() => {
    if (shown && shown.id !== tip?.id && Date.now() - shown.at > 1500) onSeen(shown.id);
    setShown(tip ? { id: tip.id, at: Date.now() } : null);
  }, [tip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow the control as the layout moves (panels open, the page scrolls)
  useLayoutEffect(() => {
    if (!tip) { setRect(null); return; }
    let live = true;
    const find = () => {
      if (!live) return;
      const el = document.querySelector(tip.at);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((old) => (r && r.width > 0 ? (old && Math.abs(old.x - r.x) < 1 && Math.abs(old.y - r.y) < 1 && Math.abs(old.width - r.width) < 1 && Math.abs(old.height - r.height) < 1 ? old : r) : null));
    };
    find();
    const t = window.setInterval(find, 250);
    window.addEventListener('resize', find);
    return () => { live = false; window.clearInterval(t); window.removeEventListener('resize', find); };
  }, [tip?.id, tip?.at]);

  if (!tip) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const big = rect && rect.height > vh * 0.4;
  const width = Math.min(320, vw - 24);
  // the tip sits above the control when it is low on the screen, below it otherwise, and inside a big area's top
  let top: number, left: number;
  if (!rect) { top = vh - 200; left = (vw - width) / 2; }
  else {
    left = Math.max(12, Math.min(vw - width - 12, rect.left + rect.width / 2 - width / 2));
    top = big ? rect.top + 12 : rect.top > vh * 0.5 ? rect.top - 12 : rect.bottom + 12;
  }
  const above = !!rect && !big && rect.top > vh * 0.5;
  const pad = 5;
  return (
    <>
      {rect && <div className="coach-ring" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} aria-hidden="true" />}
      <div key={tip.id} className={`coach-tip slate ${above ? 'above' : ''}`} role="dialog" aria-label={`Tip: ${tip.title}`} style={{ left, top, width }}>
        <div className="slate-in">
          <div className="coach-head"><Icon name="hint" size={16} /> <b>{tip.title}</b></div>
          <div className="coach-text">{tip.text}</div>
          <div className="coach-acts">
            <button className="linkish" onClick={onOff}>No more tips</button>
            <button className="btn small primary" onClick={() => onSeen(tip.id)}>Got it</button>
          </div>
        </div>
      </div>
    </>
  );
}
