import { addTimed, type Effect, activeRules, unitFlags } from '../rules-engine/effects';
import { alive, boardUnits, centreOf, log, onBoard, pushFx, unitById, unitDistance } from '../engine/state';
import type { GameState, PlayerId, UnitState } from '../engine/types';

export type OrderName =
  | 'Move! Move! Move!'
  | 'Fix Bayonets!'
  | 'Take Aim!'
  | 'First Rank, Fire! Second Rank, Fire!'
  | 'Take Cover!'
  | 'Duty and Honour!';

export const ORDER_NAMES: OrderName[] = [
  'Take Aim!',
  'Move! Move! Move!',
  'First Rank, Fire! Second Rank, Fire!',
  'Take Cover!',
  'Fix Bayonets!',
  'Duty and Honour!',
];

export const ORDER_EFFECTS: Record<OrderName, Effect[]> = {
  'Take Aim!': [{ attack: 'ranged', skill: 1 }],
  'Fix Bayonets!': [{ attack: 'melee', skill: 1 }],
  'Move! Move! Move!': [{ move: 3 }],
  'First Rank, Fire! Second Rank, Fire!': [{ rapidFireAttacks: 1 }],
  'Take Cover!': [{ defend: { save: 1, saveMax3: true } }],
  'Duty and Honour!': [{ ld: 1, oc: 1 }],
};

const hasEnh = (u: UnitState, n: string) => !!u.enhancements?.some((e) => e.name === n);

export function isOfficer(u: UnitState): boolean {
  return u.keywords.includes('OFFICER') || u.abilities.some((a) => a.name === 'Voice of Command') || hasEnh(u, 'Battalion Commander');
}

/** Where an Officer's Orders are measured from: itself, or (embarked) its TRANSPORT with Mobile Command Vehicle (one
 *  Officer per transport, in the Command phase) or when VOX-RELAY was used on it. */
export function orderOrigin(s: GameState, officer: UnitState): UnitState | null {
  if (onBoard(officer)) return officer;
  if (officer.status !== 'embarked' || !officer.embarkedIn) return null;
  const t = unitById(s, officer.embarkedIn);
  if (!t || !onBoard(t)) return null;
  if ((officer.timed ?? []).some((x) => x.mark === 'VOX-RELAY')) return t;
  const first = s.units.find((x) => x.embarkedIn === t.id && x.status === 'embarked' && isOfficer(x));
  return t.abilities.some((a) => a.name === 'Mobile Command Vehicle') && first?.id === officer.id && s.phase === 'command' ? t : null;
}

/** Officers of a player that can issue Orders now (on the battlefield, or from inside a command transport). */
export const officersOf = (s: GameState, p: PlayerId) => s.units.filter((u) => u.owner === p && isOfficer(u) && alive(u).length > 0 && !!orderOrigin(s, u));

export function officerOrderCapacity(u: UnitState, s?: GameState): number {
  if (!isOfficer(u)) return 0;
  let n = 1;
  const name = u.name;
  if (name.includes('Lord Solar') || name.includes('Creed') || name.includes('Lord Marshal Dreir')) n = 3;
  else if (name.includes('Castellan') || name.includes('Gaunt') || name.includes('Yarrick') || name.includes('Commander')) n = 2;
  else if (name.includes('Militarum Tempestus Command Squad') && u.abilities.some((a) => a.name.toLowerCase().includes('command rod'))) n = 2;
  if (hasEnh(u, 'Battalion Commander')) n = Math.max(n, 2);
  if (u.enhancements?.some((e) => e.name === 'Grand Strategist' && e.text?.includes('additional Order'))) n += 1;
  // Ruthless Discipline (Grizzled Company): one more Order
  if (s && activeRules(s, u.owner).includes('Grizzled Company')) n += 1;
  return n;
}

export function officerAllowedOrders(u: UnitState, s?: GameState): OrderName[] {
  const name = u.name;
  // Absolutist Principles (Abhuman Auxiliaries): Commissars can also issue Take Aim!
  if (name === 'Commissar') return s && activeRules(s, u.owner).includes('Absolutist Principles') ? ['Duty and Honour!', 'Fix Bayonets!', 'Take Aim!'] : ['Duty and Honour!', 'Fix Bayonets!'];
  if (name.startsWith('Commissar Graves')) return ['Move! Move! Move!', 'Duty and Honour!', 'Fix Bayonets!'];
  return ORDER_NAMES;
}

const decisive = (s: GameState | undefined, u: UnitState) => !!s && u.abilities.some((a) => a.name === 'Decisive Command') && (s.decisiveTurn ?? -1) !== s.turn;

export function officerOrderRange(u: UnitState, s?: GameState): number {
  if (decisive(s, u)) return 12;
  if (u.abilities.some((a) => a.name.toLowerCase() === 'master vox')) return 24;
  if (hasEnh(u, 'Laud Hailer')) return 12;
  return u.abilities.some((a) => a.name === 'Vox-net') ? 12 : 6;
}

export function canOfficerTarget(officer: UnitState, target: UnitState, s?: GameState): boolean {
  if (officer.owner !== target.owner) return false;
  if (!onBoard(target) || !alive(target).length) return false;
  if (target.battleShocked) return false;
  const from = s ? orderOrigin(s, officer) : officer;
  if (!from) return false;
  // VOX-RELAY: Orders to TRANSPORT units (not TITANIC) at any distance
  const relay = (officer.timed ?? []).some((x) => x.mark === 'VOX-RELAY') && target.keywords.includes('TRANSPORT') && !target.keywords.includes('TITANIC');
  if (!relay && unitDistance(from, target) > officerOrderRange(officer, s) + 1e-6) return false;

  const det = s ? activeRules(s, officer.owner) : [];
  const armouredInfantry = det.includes('Squadron Command') || det.includes('Armoured Infantry');

  const name = officer.name;
  // Abhuman Detail; Absolutist Principles: a Commissar can order OGRYN (ABHUMAN) units
  if (name.startsWith('Commissar') && (hasEnh(officer, 'Abhuman Detail') ? hasKwAny(target, ['OGRYN', 'BULLGRYN']) : false)) return true;
  if (name.startsWith('Commissar') && det.includes('Absolutist Principles') && hasKwAny(target, ['OGRYN SQUAD', 'BULLGRYN SQUAD', 'RATLINGS', 'OGRYN', 'BULLGRYN'])) return true;
  if (hasEnh(officer, 'Battalion Commander')) return target.keywords.includes('TITANIC') || target.keywords.includes('SQUADRON');
  if (name.includes('Lord Solar') || name.includes('Yarrick')) {
    return target.keywords.includes('REGIMENT') || target.keywords.includes('SQUADRON') || target.keywords.includes('TITANIC');
  }
  if (name.includes('Leman Russ Commander') || name.includes('Rogal Dorn Commander')) {
    return target.keywords.includes('SQUADRON');
  }
  if (name.startsWith('Commissar Graves')) {
    return target.keywords.includes('REGIMENT') || target.keywords.includes('SQUADRON');
  }
  if (name.includes('Gaunt’s Ghosts') || name.includes("Gaunt's Ghosts")) {
    return target.keywords.includes('REGIMENT') || target.keywords.includes('GAUNT’S GHOSTS') || target.keywords.includes("GAUNT'S GHOSTS");
  }

  // Flexible Command: SQUADRON units too, this phase
  const flexible = (officer.timed ?? []).some((t) => t.mark === 'Flexible Command');
  return target.keywords.includes('REGIMENT') || ((armouredInfantry || flexible) && target.keywords.includes('SQUADRON'));
}

const hasKwAny = (u: UnitState, ks: string[]) => ks.some((k) => u.keywords.includes(k));

export function currentOrders(u: UnitState): string[] {
  return (u.timed ?? []).filter((t) => t.label.startsWith('Order: ')).map((t) => t.label.slice(7));
}

export function ordersRemaining(s: GameState, officer: UnitState): number {
  const cap = officerOrderCapacity(officer, s);
  const used = (s.ordersUsed ?? {})[officer.id] ?? 0;
  return Math.max(0, cap - used);
}

export function issueOrder(s: GameState, officerId: string, targetId: string, order: OrderName): string | null {
  const officer = unitById(s, officerId);
  const target = unitById(s, targetId);
  if (!officer || !target) return 'Unit not found';
  if (ordersRemaining(s, officer) <= 0) return `${officer.name} has no orders remaining this turn`;
  if (!officerAllowedOrders(officer, s).includes(order)) return `${officer.name} cannot issue ${order}`;
  if (!canOfficerTarget(officer, target, s)) return `${target.name} is not an eligible target for ${officer.name}`;

  // Unless Creed's Lord Castellan allows 2 orders to a Regiment unit, clear existing orders
  const creedAllowance = officer.name.includes('Creed') && target.keywords.includes('REGIMENT') && currentOrders(target).length === 1;
  if (!creedAllowance) {
    target.timed = (target.timed ?? []).filter((t) => !t.label.startsWith('Order: '));
  }

  const firstOfArmy = !boardUnits(s, officer.owner).some((u) => (s.ordersUsed ?? {})[u.id]);
  const dc = decisive(s, officer);
  (s.ordersUsed ??= {})[officer.id] = ((s.ordersUsed ?? {})[officer.id] ?? 0) + 1;
  applyOrder(s, officer, target, order);
  // Decisive Command: the first Order of the army this phase also affects every eligible unit within 6" of the target
  if (dc) {
    if (firstOfArmy) boardUnits(s, officer.owner).filter((u) => u.id !== target.id && !u.battleShocked && unitDistance(u, target) <= 6 + 1e-6 && canOfficerTarget(officer, u, s) && !currentOrders(u).length).forEach((u) => applyOrder(s, officer, u, order));
    s.decisiveTurn = s.turn;
  }
  // the same Order to more units: Exemplary Officer (own unit → two PLATOON units within 3"), Calm Under Fire
  // (once per turn, SQUADRON → another SQUADRON), Bombast-class Vox-array (Master Vox: up to three REGIMENT units)
  const more = (n: number, ok: (u: UnitState) => boolean) => boardUnits(s, officer.owner)
    .filter((u) => u.id !== target.id && !u.battleShocked && ok(u) && !currentOrders(u).length).sort((a, b) => b.pts - a.pts).slice(0, n)
    .forEach((u) => applyOrder(s, officer, u, order));
  // Over the Top: Move! Move! Move! to every INFANTRY REGIMENT unit, at any range
  if (order === 'Move! Move! Move!' && (officer.timed ?? []).some((t) => t.mark === 'Over the Top')) more(99, (u) => u.keywords.includes('INFANTRY') && u.keywords.includes('REGIMENT'));
  if (hasEnh(officer, 'Exemplary Officer') && target.id === officer.id) more(2, (u) => u.keywords.includes('PLATOON') && unitDistance(officer, u) <= 3 + 1e-6);
  if (hasEnh(officer, 'Calm Under Fire') && target.keywords.includes('SQUADRON') && s.calmUnderFireTurn !== s.turn) { s.calmUnderFireTurn = s.turn; more(1, (u) => u.keywords.includes('SQUADRON')); }
  if (hasEnh(officer, 'Bombast-class Vox-array') && officer.abilities.some((a) => a.name.toLowerCase() === 'master vox') && target.keywords.includes('REGIMENT'))
    more(2, (u) => u.keywords.includes('REGIMENT') && canOfficerTarget(officer, u, s));
  return null;
}

function applyOrder(s: GameState, officer: UnitState, target: UnitState, order: OrderName) {
  for (const e of ORDER_EFFECTS[order]) {
    // Independent Operatives: the Order lasts until a new one replaces it (or the unit is Battle-shocked)
    addTimed(s, target, { e, label: `Order: ${order}`, mark: `order:${order}`, until: target.abilities.some((a) => a.name === 'Independent Operatives') ? 'battle' : 'nextCommand', by: officer.owner });
  }

  pushFx(s, { kind: 'skill', unitId: officer.id, owner: officer.owner, at: centreOf(target), name: 'Voice of Command', who: `${officer.name} → ${order}`, style: 'tech', epic: false });
  log(s, `[Order] Voice of Command (Army Rule): ${officer.name} issued order: ${order} to ${target.name}`, 'info', officer.owner);
}

/** Coordinated Action: Orders on this unit and on one friendly `kw` unit within 6" (visible) affect both, this phase. */
export function copyOrders(s: GameState, u: UnitState, kw: string) {
  const o = boardUnits(s, u.owner).filter((x) => x.id !== u.id && x.keywords.includes(kw) && unitDistance(u, x) <= 6 + 1e-6)
    .sort((a, b) => Number(!!currentOrders(a).length) - Number(!!currentOrders(b).length) || b.pts - a.pts)[0];
  if (!o) return;
  const share = (from: UnitState, to: UnitState) => {
    for (const t of (from.timed ?? []).filter((x) => x.label.startsWith('Order: ')))
      if (!currentOrders(to).includes(t.label.slice(7))) addTimed(s, to, { ...t, until: 'phase' });
  };
  share(u, o); share(o, u);
  log(s, `Coordinated Action: ${u.name} and ${o.name} share their Orders this phase`, 'info', u.owner);
}

/** A unit that becomes Battle-shocked loses its Orders (not with Grim Determination). */
export function ordersShockFailed(s: GameState, u: UnitState) {
  if (!u.timed?.some((t) => t.label.startsWith('Order: ')) || unitFlags(s, u).ordersStayShocked) return;
  u.timed = u.timed.filter((t) => !t.label.startsWith('Order: '));
  log(s, `${u.name} is Battle-shocked: its Orders end`, 'info', u.owner);
}

/** Auto-issues orders for a player (called for AI bot during Command phase). */
export function autoIssueOrders(s: GameState, p: PlayerId) {
  for (const officer of officersOf(s, p)) autoIssueFor(s, officer);
}

/** An Order issued outside the usual count (Inspired Command, Snap To It, Servo-scribes): the bot's pick, for either player. */
export function extraOrder(s: GameState, officer: UnitState, n = 1) {
  if (!isOfficer(officer) || !orderOrigin(s, officer)) return;
  const used = (s.ordersUsed ??= {});
  const before = ordersRemaining(s, officer);
  used[officer.id] = Math.min(used[officer.id] ?? 0, officerOrderCapacity(officer, s)) - n;
  autoIssueFor(s, officer, before);
}

/** The Order the bot gives this unit. */
function pickOrder(officer: UnitState, target: UnitState, s: GameState): OrderName {
  const allowed = officerAllowedOrders(officer, s);
  let pick: OrderName = 'Take Aim!';
  if (target.keywords.includes('MOUNTED') || target.keywords.includes('BULLGRYN') || target.keywords.includes('OGRYN')) {
    pick = allowed.includes('Fix Bayonets!') ? 'Fix Bayonets!' : 'Move! Move! Move!';
  } else if (target.models[0].profile.Sv >= 4 && allowed.includes('Take Cover!')) {
    pick = 'Take Cover!';
  } else if (allowed.includes('Take Aim!')) {
    pick = 'Take Aim!';
  } else if (allowed.includes('Duty and Honour!')) {
    pick = 'Duty and Honour!';
  } else {
    pick = allowed[0];
  }

  return pick;
}

/** Mechanised Spearhead: one Order to this unit outside the count. */
export function orderTo(s: GameState, officer: UnitState, target: UnitState) {
  target.timed = (target.timed ?? []).filter((t) => !t.label.startsWith('Order: '));
  applyOrder(s, officer, target, pickOrder(officer, target, s));
}

function autoIssueFor(s: GameState, officer: UnitState, keep = 0) {
  const p = officer.owner;
  {
    while (ordersRemaining(s, officer) > keep) {
      const allowed = officerAllowedOrders(officer, s);
      const targets = boardUnits(s, p).filter((t) => canOfficerTarget(officer, t, s));
      // prioritize targets that don't have an order yet
      const unissued = targets.filter((t) => currentOrders(t).length === 0);
      const pool = unissued.length ? unissued : targets.filter((t) => officer.name.includes('Creed') && currentOrders(t).length === 1);
      if (!pool.length) break;

      // Score targets: most valuable units near the enemy first
      const bestTarget = pool.sort((a, b) => b.pts - a.pts)[0];

      const pick = pickOrder(officer, bestTarget, s);
      issueOrder(s, officer.id, bestTarget.id, pick);
    }
  }
}
