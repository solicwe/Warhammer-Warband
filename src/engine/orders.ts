import { addTimed, type Effect, activeRules } from './effects';
import { alive, boardUnits, centreOf, log, onBoard, pushFx, unitById, unitDistance } from './state';
import type { GameState, PlayerId, UnitState } from './types';

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

export function isOfficer(u: UnitState): boolean {
  return u.keywords.includes('OFFICER') || u.abilities.some((a) => a.name === 'Voice of Command');
}

export function officerOrderCapacity(u: UnitState): number {
  if (!isOfficer(u)) return 0;
  let n = 1;
  const name = u.name;
  if (name.includes('Lord Solar') || name.includes('Creed') || name.includes('Lord Marshal Dreir')) n = 3;
  else if (name.includes('Castellan') || name.includes('Gaunt') || name.includes('Yarrick') || name.includes('Commander')) n = 2;
  else if (name.includes('Militarum Tempestus Command Squad') && u.abilities.some((a) => a.name.toLowerCase().includes('command rod'))) n = 2;
  if (u.enhancements.some((e) => e.name === 'Grand Strategist')) n += 1;
  return n;
}

export function officerAllowedOrders(u: UnitState): OrderName[] {
  const name = u.name;
  if (name === 'Commissar') return ['Duty and Honour!', 'Fix Bayonets!'];
  if (name.startsWith('Commissar Graves')) return ['Move! Move! Move!', 'Duty and Honour!', 'Fix Bayonets!'];
  return ORDER_NAMES;
}

export function officerOrderRange(u: UnitState): number {
  const hasMasterVox = u.abilities.some((a) => a.name.toLowerCase() === 'master vox' || a.name === 'Vox-net');
  return hasMasterVox ? 24 : 6;
}

export function canOfficerTarget(officer: UnitState, target: UnitState, s?: GameState): boolean {
  if (officer.owner !== target.owner) return false;
  if (!onBoard(target) || !alive(target).length) return false;
  if (target.battleShocked) return false;
  if (unitDistance(officer, target) > officerOrderRange(officer) + 1e-6) return false;

  const det = s ? activeRules(s, officer.owner) : [];
  const armouredInfantry = det.includes('Squadron Command') || det.includes('Armoured Infantry');

  const name = officer.name;
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

  return target.keywords.includes('REGIMENT') || (armouredInfantry && target.keywords.includes('SQUADRON'));
}

export function currentOrders(u: UnitState): string[] {
  return (u.timed ?? []).filter((t) => t.label.startsWith('Order: ')).map((t) => t.label.slice(7));
}

export function ordersRemaining(s: GameState, officer: UnitState): number {
  const cap = officerOrderCapacity(officer);
  const used = (s.ordersUsed ?? {})[officer.id] ?? 0;
  return Math.max(0, cap - used);
}

export function issueOrder(s: GameState, officerId: string, targetId: string, order: OrderName): string | null {
  const officer = unitById(s, officerId);
  const target = unitById(s, targetId);
  if (!officer || !target) return 'Unit not found';
  if (ordersRemaining(s, officer) <= 0) return `${officer.name} has no orders remaining this turn`;
  if (!officerAllowedOrders(officer).includes(order)) return `${officer.name} cannot issue ${order}`;
  if (!canOfficerTarget(officer, target, s)) return `${target.name} is not an eligible target for ${officer.name}`;

  // Unless Creed's Lord Castellan allows 2 orders to a Regiment unit, clear existing orders
  const creedAllowance = officer.name.includes('Creed') && target.keywords.includes('REGIMENT') && currentOrders(target).length === 1;
  if (!creedAllowance) {
    target.timed = (target.timed ?? []).filter((t) => !t.label.startsWith('Order: '));
  }

  const effects = ORDER_EFFECTS[order];
  for (const e of effects) {
    addTimed(s, target, { e, label: `Order: ${order}`, until: 'nextCommand', by: officer.owner });
  }

  pushFx(s, { kind: 'skill', unitId: officer.id, owner: officer.owner, at: centreOf(target), name: 'Voice of Command', who: `${officer.name} → ${order}`, style: 'tech', epic: false });
  log(s, `[Order] Voice of Command (Army Rule): ${officer.name} issued order: ${order} to ${target.name}`, 'info', officer.owner);
  return null;
}

/** Auto-issues orders for a player (called for AI bot during Command phase). */
export function autoIssueOrders(s: GameState, p: PlayerId) {
  const officers = boardUnits(s, p).filter(isOfficer);
  if (!officers.length) return;

  for (const officer of officers) {
    while (ordersRemaining(s, officer) > 0) {
      const allowed = officerAllowedOrders(officer);
      const targets = boardUnits(s, p).filter((t) => canOfficerTarget(officer, t, s));
      // prioritize targets that don't have an order yet
      const unissued = targets.filter((t) => currentOrders(t).length === 0);
      const pool = unissued.length ? unissued : targets.filter((t) => officer.name.includes('Creed') && currentOrders(t).length === 1);
      if (!pool.length) break;

      // Score targets: most valuable units near the enemy first
      const bestTarget = pool.sort((a, b) => b.pts - a.pts)[0];

      // Pick best order
      let pick: OrderName = 'Take Aim!';
      if (bestTarget.keywords.includes('MOUNTED') || bestTarget.keywords.includes('BULLGRYN') || bestTarget.keywords.includes('OGRYN')) {
        pick = allowed.includes('Fix Bayonets!') ? 'Fix Bayonets!' : 'Move! Move! Move!';
      } else if (bestTarget.models[0].profile.Sv >= 4 && allowed.includes('Take Cover!')) {
        pick = 'Take Cover!';
      } else if (allowed.includes('Take Aim!')) {
        pick = 'Take Aim!';
      } else if (allowed.includes('Duty and Honour!')) {
        pick = 'Duty and Honour!';
      } else {
        pick = allowed[0];
      }

      issueOrder(s, officer.id, bestTarget.id, pick);
    }
  }
}
