// The detachment stratagems no other bot routine plays: mortal wounds and Battle-shock tests on an enemy unit, wounds
// and models back, a Battle-shocked unit recovering, an extra Order / Miracle dice / CP, a mark on an enemy unit that
// the bot's other units will shoot at, and a debuff on the enemy unit that threatens it most. At the start and end of
// every phase each one is worth its CP or it is kept.
import { on } from '../engine/events';
import { exprAverage } from '../engine/dice';
import { alive, boardUnits, log, onBoard, other, stratCost, unitDistance } from '../engine/state';
import { applyDetachmentStratagem, stratagemBlock, stratChoices, stratEnemies, stratRule, withChoice, type StratRule } from '../rules-engine/stratagems';
import { perModel } from './botEval';
import { cpWorth, isBot, surplus } from './botStrats';
import { ordersRemaining, isOfficer, orderOrigin, currentOrders } from '../factions/orders';
import type { GameState, PlayerId, StratagemData, UnitState } from '../engine/types';

const wounds = (u: UnitState) => alive(u).reduce((a, m) => a + m.wounds, 0);
const perWound = (u: UnitState) => u.pts / Math.max(1, u.models.reduce((a, m) => a + m.profile.W, 0));

/** Points this stratagem is worth on unit u now (and the enemy unit to pick), or 0. */
function worth(s: GameState, p: PlayerId, rule: StratRule, u: UnitState): { v: number; enemyId?: string } {
  const dos = rule.do ?? [];
  const es = rule.enemy ? stratEnemies(s, p, rule, u) : [];
  if (rule.enemy && !rule.enemy.all && !es.length) return { v: 0 };
  let best = { v: 0, enemyId: es[0]?.id as string | undefined };
  const consider = (v: number, e?: UnitState) => { if (v > best.v) best = { v, enemyId: e?.id ?? best.enemyId }; };
  const targets = es.length ? (rule.enemy?.all ? [null] : es) : [null];
  for (const e of targets) {
    const foes = e ? [e] : rule.enemy?.all ? es : [];
    let v = 0;
    for (const a of dos) {
      if (a.if?.length) continue; // conditional actions: their own conditions are checked when used
      if (a.on === 'target') for (const f of foes) {
        if (a.mortals) v += Math.min(wounds(f), exprAverage(a.mortals)) * perWound(f);
        if (a.mortalRoll) {
          const q = a.mortalRoll;
          const n = q.n ?? (q.allOn ? alive(f).length : alive(u).length);
          const hit = Math.max(0, 7 - q.on) / 6;
          v += Math.min(wounds(f), q.max ?? 99, n * hit * (q.dmg ? exprAverage(q.dmg) : 1)) * perWound(f);
        }
        if (a.mortalsTable) v += Math.min(wounds(f), exprAverage(a.mortalsTable[0].expr) * (7 - a.mortalsTable[0].min) / 6) * perWound(f);
        if (a.shock !== undefined && !f.battleShocked) v += s.objectives.some((o) => alive(f).some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= 4)) ? 25 : 6;
      }
      if (a.on !== 'target') {
        if (a.heal) v += Math.min(u.models.reduce((x, m) => x + (m.dead ? 0 : m.profile.W - m.wounds), 0), exprAverage(a.heal)) * perWound(u);
        if (a.revive) v += Math.min(u.models.filter((m) => m.dead && !m.isCharacter).length, a.revive) * perModel(u);
        if (a.unshock && u.battleShocked) v += 20;
        if (a.unshockNear && boardUnits(s, p).some((x) => x.battleShocked && unitDistance(x, u) <= a.unshockNear!)) v += 18;
        if (a.order && isOfficer(u) && ordersRemaining(s, u) === 0) v += 12;
        if ((a.miracle ?? 0) > 0) v += 12 * a.miracle!;
        if ((a.cp ?? 0) > 0) v += 15 * a.cp!;
        // SYNERGISTIC EMPOWERMENT: another unit with guns gets the CRYPTEK detachment abilities before it shoots
        if (a.buffNear?.effects.some((x) => x.addKeywords) && s.active === p && s.phase === 'shooting'
          && boardUnits(s, p).some((x) => x.id !== u.id && !x.selectedToShoot && unitDistance(x, u) <= a.buffNear!.range && !(a.buffNear!.effects[0].addKeywords ?? []).every((k) => x.keywords.includes(k)))) v += 8;
        // SOLAR PULSE: enemy units in cover on an objective it can reach
        if (a.solarPulse && s.active === p && s.phase === 'shooting' && s.objectives.some((o) => alive(u).some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= a.solarPulse!)
          && boardUnits(s, other(p)).some((e) => alive(e).some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= 4)))) v += 10;
        // INFOSLAVE SKULL: a second objective to reward
        if (a.infoslave && s.phase === 'command' && s.active === p && !s.players[p].acquisitionExtra) v += 8;
        // IMPOSSIBLE ECLIPSE: the bot's battle-shock tests and Daemonic Terror reach further this phase
        if (a.cd && a.cd !== 'flux' && s.phase === 'command') v += 6;
        // ADAPTABLE AVARICE: Hostile Acquisition for the bot's own shooting and fighting
        if (a.lovHostile && s.active === p && (s.phase === 'shooting' || s.phase === 'fight')) v += 10;
        // Coordinated Action: worth it when this unit or a SQUADRON next to it has an Order the other lacks
        if (a.copyOrders && boardUnits(s, p).some((x) => x.id !== u.id && x.keywords.includes(a.copyOrders!) && unitDistance(u, x) <= 6 && currentOrders(x).length !== currentOrders(u).length)) v += 10;
      }
    }
    // marks that help the bot's other units shoot or fight that enemy unit
    for (const fx of rule.enemyEffects ?? []) for (const f of foes) {
      if (fx.incoming) {
        const helpers = boardUnits(s, p).filter((x) => x.id !== u.id && x.shotTurn !== s.turn && !x.battleShocked && unitDistance(x, f) <= 24);
        if (s.active === p) v += helpers.length * Math.max(4, f.pts / 25);
      }
      // a debuff on an enemy unit that is close enough to hurt
      if ((fx.hit ?? 0) < 0 || (fx.wound ?? 0) < 0 || (fx.chargeBonus ?? 0) < 0 || (fx.move ?? 0) < 0 || (fx.skill ?? 0) < 0 || (fx.detection ?? 0) > 0 || fx.abilities?.includes('hazardous') || fx.moveHalve || fx.noSnapTarget) {
        if (boardUnits(s, p).some((x) => unitDistance(x, f) <= 14)) v += Math.max(6, f.pts / 20);
      }
    }
    // FIRES OF COVENANT: enemy units likely to move near this unit this phase
    if ((rule.effects ?? []).some((x) => x.moveNearMortals) && s.active !== p)
      v += 5 * boardUnits(s, other(p)).filter((e) => unitDistance(e, u) <= 14).length;
    // FICKLEFIRE / CALLOUS SACRIFICE: an engaged unit with guns gets to shoot in its own Shooting phase
    if ((rule.effects ?? []).some((x) => x.ignoreEngaged) && s.active === p && s.phase === 'shooting' && !u.selectedToShoot
      && alive(u).some((m) => m.weapons.some((w) => typeof w.profiles[0]?.range === 'number' && w.profiles[0].range > 0))) v += 8;
    // STALWART PROTECTOR: friendly INFANTRY next to this vehicle get cover from it this phase
    if ((rule.effects ?? []).some((x) => x.coverBehind?.friendly) && s.active !== p)
      v += 4 * boardUnits(s, p).filter((x) => x.id !== u.id && x.keywords.includes('INFANTRY') && unitDistance(x, u) <= 6).length;
    // ADAPTIVE OPTIMISATION: a SYNAPSE unit among the swarm that has none nearby
    if ((rule.effects ?? []).some((x) => x.addKeywords?.includes('SYNAPSE')) && !u.keywords.includes('SYNAPSE') && s.phase === 'command'
      && boardUnits(s, p).some((x) => x.id !== u.id && unitDistance(x, u) <= 6 && !boardUnits(s, p).some((y) => y.keywords.includes('SYNAPSE') && unitDistance(y, x) <= 6))) v += 8;
    // PSI SURGE: Catalyst reaches 9" around this Tyranid while GENESTEALER CULTS units are about to attack
    if (rule.mark === 'PSI SURGE' && s.active === p && (s.phase === 'shooting' || s.phase === 'fight') && boardUnits(s, other(p)).some((e) => { const d = unitDistance(e, u); return d > 6 && d <= 9; })) v += 8;
    // OVERRUN: a longer consolidation into the next enemy unit, or a free move out of combat
    if ((rule.effects ?? []).some((x) => (x.consolidate ?? 0) > 3) && s.phase === 'fight' && s.fight?.fought.includes(u.id)
      && boardUnits(s, other(p)).some((e) => unitDistance(e, u) > 1.05 && unitDistance(e, u) <= 6)) v += 7;
    // THE GRISLY FEAST: Battle-shock tests for the enemy units around it next Command phase
    if (rule.mark === 'grislyFeast') v += 6 * boardUnits(s, other(p)).filter((e) => unitDistance(e, u) <= 6).length;
    // VOX-RELAY: an Officer inside a transport gets to issue its Orders
    if (rule.mark === 'VOX-RELAY' && isOfficer(u) && !orderOrigin(s, u) && ordersRemaining(s, u) > 0) v += 12;
    // the unit's own effects that keep enemy reserves away (Scramble Field, Circle of Sanctuary)
    if (!foes.length && (rule.effects ?? []).some((x) => x.omniScrambler) && s.active !== p && s.units.some((x) => x.owner !== p && x.status === 'reserves')) v += 10;
    consider(v, e ?? undefined);
  }
  return best;
}

export function botUtilityStratagems(s: GameState, p: PlayerId, midAttack = false, fallback = false) {
  if (!isBot(s, p) || s.phase === 'deploy' || s.phase === 'gameover' || s.window || (s.attack && !midAttack)) return;
  const P = s.players[p];
  for (const d of P.detachments) for (const st of d.stratagems as StratagemData[]) {
    const rule = stratRule(st, P.factionId, d.name);
    if (rule.react || rule.code || rule.status === 'manual' || rule.bot === 'attack' || rule.bot === 'defend' || (rule.targetFrom && rule.targetFrom !== 'embarked')) continue;
    let best: { u: UnitState; v: number; enemyId?: string; choice?: number } | null = null;
    for (const u of rule.targetFrom === 'embarked' ? s.units.filter((x) => x.owner === p && x.status === 'embarked') : boardUnits(s, p)) {
      const cost = stratCost(s, st.id, u, st.cp);
      if (P.cp - cost < (s.round >= 5 ? 0 : 1) || stratagemBlock(s, p, st, u)) continue;
      // "select either …": each option the unit may take is a separate candidate
      const opts = rule.choice?.length ? stratChoices(s, rule, u).map(({ i }) => i as number | undefined) : [undefined];
      for (const choice of opts) {
        const w = worth(s, p, choice === undefined ? rule : withChoice(rule, choice), u);
        if (w.v > (best?.v ?? 0)) best = { u, ...w, choice };
      }
    }
    if (!best || best.v < cpWorth(s, p) * st.cp) continue;
    if (!onBoard(best.u) && rule.targetFrom !== 'embarked') continue;
    applyDetachmentStratagem(s, p, st, best.u.id, { enemyId: best.enemyId, choice: best.choice });
    log(s, `${P.name} uses ${st.name} (${Math.round(best.v)} pts of value)`, 'info', p);
  }
  if (fallback && !midAttack && surplus(s, p)) spendSurplus(s, p);
}

/** CP the rounds left cannot spend on priced plays: one stratagem the bot can't put a number on (an eligibility, a
 *  move through terrain, a mark), the one used least so far, on the most valuable unit it can go on. */
function spendSurplus(s: GameState, p: PlayerId) {
  const P = s.players[p];
  const times = (id: string) => P.stratagemsUsed.filter((x) => x.split(':').pop() === id).length;
  const cands = P.detachments.flatMap((d) => (d.stratagems as StratagemData[]).map((st) => ({ st, rule: stratRule(st, P.factionId, d.name) })))
    .filter(({ rule }) => !rule.react && !rule.code && rule.status !== 'manual' && !rule.targetFrom && rule.bot !== 'attack' && rule.bot !== 'defend'
      && !!(rule.effects?.length || rule.do?.length || rule.buffs?.length || rule.enemyEffects?.length || rule.choice?.length || rule.mark))
    .sort((a, b) => times(a.st.id) - times(b.st.id));
  for (const { st, rule } of cands) {
    const u = boardUnits(s, p).filter((x) => !x.battleShocked && P.cp >= stratCost(s, st.id, x, st.cp) && !stratagemBlock(s, p, st, x)
      && (!rule.enemy || rule.enemy.all || stratEnemies(s, p, rule, x).length > 0)
      // a rule the bot can price (healing, mortal wounds …) only when it does something here
      && !((rule.do ?? []).concat((rule.choice ?? []).flatMap((o) => o.do ?? [])).some((a) => a.heal || a.revive || a.unshock || a.mortals || a.mortalRoll) && Math.max(worth(s, p, rule, x).v, ...(rule.choice ?? []).map((_o, i) => worth(s, p, withChoice(rule, i), x).v)) <= 0))
      .sort((a, b) => b.pts - a.pts)[0];
    if (!u) continue;
    applyDetachmentStratagem(s, p, st, u.id, { enemyId: rule.enemy ? stratEnemies(s, p, rule, u)[0]?.id : undefined, choice: stratChoices(s, rule, u)[0]?.i });
    log(s, `${P.name} uses ${st.name} (spare CP)`, 'info', p);
    return;
  }
}

// every phase, for both players (the stratagem's own timing rules say which one may use it now)
const both = (s: GameState, fallback = true) => { for (const p of [s.active, other(s.active)] as PlayerId[]) botUtilityStratagems(s, p, false, fallback); };
on('commandStart', (s) => both(s));
on('movementStart', (s) => both(s));
on('movementEnd', (s) => both(s));
on('shootingStart', (s) => both(s));
on('fightStart', (s) => both(s));
on('phaseEnd', (s) => both(s, false)); // a phase-long effect bought now would be wasted
// a unit has just shot: marks on the enemy unit it hit, for the units still to shoot
on('attackDone', (s, e) => { if (s.phase === 'shooting' && e.A.owner === s.active) botUtilityStratagems(s, e.A.owner, true); });
