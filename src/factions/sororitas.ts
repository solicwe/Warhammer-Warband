// Adepta Sororitas army rule Acts of Faith: Miracle dice (one at the start of each turn, one each time an ADEPTA
// SORORITAS unit is destroyed) substitute an Advance, Battle-shock, Charge, Damage, Hit, save or Wound roll, one Act
// of Faith per unit per phase (two in Army of Faith or near the Simulacrum of the Ebon Chalice). The abilities and
// enhancements that gain, spend or change Miracle dice are worked out here; the rest is data.
import { d6, rollExpr } from '../engine/dice';
import { dist } from '../engine/geometry';
import { alive, centreOf, log, onBoard, pushFx, unitDistance } from '../engine/state';
import { abilityOff, addTimed } from '../rules-engine/effects';
import { ldTest } from '../rules-engine/activations';
import type { GameState, PlayerId, UnitState } from '../engine/types';

export const isSororitasArmy = (s: GameState, p: PlayerId) => !!s.players[p]?.armyRules?.some((r) => r.name === 'Acts of Faith');
const isAS = (u: UnitState) => u.factionKeywords.includes('ADEPTA SORORITAS');
const hasAb = (u: UnitState, n: string) => u.abilities.some((a) => a.name === n && !abilityOff(u, a));
const hasEnh = (u: UnitState, n: string) => !!u.enhancements?.some((e) => e.name === n);
const det = (s: GameState, p: PlayerId, n: string) => (s.players[p].detachments ?? []).some((d) => d.name === n);

export function getMiracleDice(s: GameState, p: PlayerId): number[] {
  return s.players[p]?.miracleDice ?? [];
}

/** Gain one or more Miracle dice into the player's pool. */
export function gainMiracleDice(s: GameState, p: PlayerId, count = 1, fixedValue?: number, reason = 'Acts of Faith'): number[] {
  if (!isSororitasArmy(s, p)) return [];
  s.players[p].miracleDice ??= [];
  const gained: number[] = [];

  for (let i = 0; i < count; i++) {
    let val = fixedValue;
    if (val === undefined) {
      if (reason === 'Start of turn') {
        // Solemn Procession (Triumph of Saint Katherine)
        if (s.units.some((u) => u.owner === p && onBoard(u) && hasAb(u, 'Solemn Procession'))) val = 6;
      }
      val ??= d6(s);
    }
    s.players[p].miracleDice!.push(val);
    gained.push(val);
  }

  s.players[p].miracleDice!.sort((a, b) => b - a);
  log(s, `[Miracle] Acts of Faith (Army Rule): ${s.players[p].name} gained Miracle dice: [${gained.join(', ')}] (${reason}) — Pool: [${s.players[p].miracleDice!.join(', ')}]`, 'info', p);
  pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: 'Acts of Faith', who: `+${count} Miracle Die: ${gained.join(', ')}`, style: 'holy', epic: false });
  return gained;
}

/** Called at the start of each turn: any Sororitas player gains 1 Miracle die. */
export function sororitasTurnStart(s: GameState, _activePlayer: PlayerId) {
  for (const p of [0, 1] as PlayerId[]) {
    if (isSororitasArmy(s, p)) {
      gainMiracleDice(s, p, 1, undefined, 'Start of turn');
    }
  }
}

/** An ADEPTA SORORITAS unit is destroyed: 1 Miracle dice (Litany of Deeds: re-rolled when low within 12" of an
 *  Imagifier; Saintly Example: D3 more). */
export function sororitasUnitDestroyed(s: GameState, victim: UnitState, killerId?: string) {
  if (!isAS(victim) || !isSororitasArmy(s, victim.owner)) return;
  // Storm of Retribution: the enemy unit that destroyed an ADEPTA SORORITAS unit is remembered
  const killer = killerId ? s.units.find((u) => u.id === killerId) : undefined;
  if (killer && !(killer.timed ?? []).some((t) => t.mark === 'Avenged')) addTimed(s, killer, { e: {}, label: 'Destroyed an ADEPTA SORORITAS unit', until: 'battle', by: victim.owner, mark: 'Avenged' });
  const near = s.units.some((u) => u.owner === victim.owner && u.id !== victim.id && onBoard(u) && hasAb(u, 'Litany of Deeds')
    && alive(u).some((m) => victim.models.some((v) => dist(m, v) <= 12 + 1e-6)));
  let roll = d6(s);
  if (near && roll <= 3) {
    const again = d6(s);
    log(s, `Litany of Deeds: Miracle dice ${roll} re-rolled → ${again}`, 'roll', victim.owner);
    roll = again;
  }
  gainMiracleDice(s, victim.owner, 1, roll, `${victim.name} destroyed`);
  if (hasEnh(victim, 'Saintly Example')) gainMiracleDice(s, victim.owner, rollExpr(s, 'D3').total, undefined, 'Saintly Example');
}

const back = (u: UnitState, n: number, label: string) => {
  const dead = u.models.filter((m) => m.dead && !m.isCharacter).slice(0, n);
  const anchor = alive(u)[0];
  for (const m of dead) { m.dead = false; m.wounds = m.profile.W; if (anchor) { m.x = anchor.x + 0.5; m.y = anchor.y + 0.5; } }
  return dead.length;
};

/** End of the Command phase: Simulacrum Imperialis, Chaplet of Sacrifice. */
export function sororitasCommandEnd(s: GameState, p: PlayerId) {
  if (!isSororitasArmy(s, p)) return;
  const sims = s.units.filter((u) => u.owner === p && onBoard(u) && hasAb(u, 'Simulacrum Imperialis'));
  for (const o of s.objectives.filter((x) => x.controller === p)) {
    if (!sims.some((u) => alive(u).some((m) => dist(m, o) - m.r <= 3 + 1e-6))) continue;
    const r = d6(s);
    log(s, `Simulacrum Imperialis: objective ${o.id} rolled ${r}`, 'roll', p);
    if (r >= 4) gainMiracleDice(s, p, 1, r, 'Simulacrum Imperialis');
  }
  // Chaplet of Sacrifice: re-roll the lowest Miracle dice (up to 3 while the bearer's unit is below Starting Strength)
  const pool = s.players[p].miracleDice ?? [];
  for (const u of s.units.filter((x) => x.owner === p && onBoard(x) && hasEnh(x, 'Chaplet of Sacrifice'))) {
    const n = alive(u).length < u.startingStrength ? 3 : 1;
    for (let i = 0; i < n; i++) {
      pool.sort((a, b) => b - a);
      if (!pool.length || pool[pool.length - 1] >= 4) break;
      const old = pool.pop()!; const v = d6(s); pool.push(v);
      log(s, `Chaplet of Sacrifice: Miracle dice ${old} re-rolled → ${v}`, 'roll', p);
    }
    pool.sort((a, b) => b - a);
  }
}

/** Command phase: Healing Tears, Sacred Healing, Salvationist Medikit, Litanies of Faith, Fiery Conviction, Manual of Saint Griselda. */
export function sororitasCommandStart(s: GameState, p: PlayerId) {
  if (!isSororitasArmy(s, p)) return;
  const P = s.players[p];
  P.miracleDice ??= [];
  for (const u of s.units.filter((x) => x.owner === p && onBoard(x))) {
    if (hasAb(u, 'Healing Tears') && alive(u).some((m) => /celestine/i.test(m.name))) {
      const gem = u.models.find((m) => m.dead && /geminae/i.test(m.name));
      if (gem) { gem.dead = false; gem.wounds = gem.profile.W; const a = alive(u)[0]; gem.x = a.x + 0.5; gem.y = a.y + 0.5; log(s, 'Healing Tears: a Geminae Superia returns', 'info', p); }
    }
    if (hasAb(u, 'Sacred Healing') && u.models.some((m) => m.dead && !m.isCharacter)) {
      // a low Miracle dice is worth D3+1 models when several are missing
      const lots = u.models.filter((m) => m.dead && !m.isCharacter).length >= 3 && P.miracleDice.length && P.miracleDice[P.miracleDice.length - 1] <= 3;
      if (lots) P.miracleDice.pop();
      const n = back(u, lots ? rollExpr(s, 'D3').total + 1 : 1, 'Sacred Healing');
      log(s, `Sacred Healing: ${n} model${n === 1 ? '' : 's'} return${n === 1 ? 's' : ''} to ${u.name}${lots ? ' (a Miracle dice discarded)' : ''}`, 'info', p);
    }
    if (hasAb(u, 'Salvationist Medikit') && u.models.some((m) => m.dead && !m.isCharacter)) {
      const n = back(u, rollExpr(s, 'D3').total, 'Salvationist Medikit');
      log(s, `Salvationist Medikit: ${n} model${n === 1 ? '' : 's'} return to ${u.name}`, 'info', p);
    }
    if (hasEnh(u, 'Litanies of Faith') && ldTest(s, u, 'Litanies of Faith')) gainMiracleDice(s, p, 1, undefined, 'Litanies of Faith');
    if (hasAb(u, 'Fiery Conviction')) {
      if (P.miracleDice.length >= 3) { P.miracleDice.pop(); P.cp += 1; log(s, 'Fiery Conviction: a Miracle dice discarded, +1CP', 'info', p); }
      else if (ldTest(s, u, 'Fiery Conviction')) { P.cp += 1; log(s, 'Fiery Conviction: +1CP', 'info', p); }
    }
    // Manual of Saint Griselda: two low Miracle dice become one of their sum (to a maximum of 6)
    if (hasEnh(u, 'Manual of Saint Griselda') && P.miracleDice.length >= 2) {
      P.miracleDice.sort((a, b) => b - a);
      const [a, b] = P.miracleDice.slice(-2);
      if (a + b > Math.max(a, b) && a <= 3) { P.miracleDice.splice(-2, 2); gainMiracleDice(s, p, 1, Math.min(6, a + b), 'Manual of Saint Griselda'); }
    }
  }
}

/** Spend (discard) one Miracle dice, the lowest: Rapturous Blows, Righteous Repugnance, Righteous Rage. */
export function discardMiracle(s: GameState, p: PlayerId, n = 1): boolean {
  const pool = s.players[p].miracleDice ?? [];
  if (pool.length < n) return false;
  pool.sort((a, b) => b - a).splice(-n, n);
  log(s, `${n} Miracle dice discarded — Pool left: [${pool.join(', ')}]`, 'info', p);
  return true;
}

/** Check if a unit is eligible to perform an Act of Faith this phase. */
export function canPerformActOfFaith(s: GameState, u: UnitState): boolean {
  if (!isSororitasArmy(s, u.owner)) return false;
  const pool = s.players[u.owner].miracleDice ?? [];
  if (pool.length === 0) return false;

  const used = s.players[u.owner].actsOfFaithUsed ?? [];
  const unitUsedCount = used.filter((id) => id === u.id).length;

  // Sacred Rites (Army of Faith) / Simulacrum of the Ebon Chalice (Aura): two Acts of Faith per phase
  const chalice = s.units.some((f) => f.owner === u.owner && onBoard(f) && hasAb(f, 'Simulacrum of the Ebon Chalice (Aura)') && unitDistance(f, u) <= 6 + 1e-6);
  const maxAllowed = det(s, u.owner, 'Army of Faith') || chalice ? 2 : 1;

  return unitUsedCount < maxAllowed;
}

/** Perform an Act of Faith by substituting a die from the pool. */
export function performActOfFaith(
  s: GameState,
  u: UnitState,
  preferredVal?: number,
  minVal?: number,
  rollType = 'roll',
): number | null {
  if (!canPerformActOfFaith(s, u)) return null;
  const pool = s.players[u.owner].miracleDice ?? [];
  if (!pool.length) return null;

  // Dialogus: "Stirring Rhetoric: While leading a unit, you can change the value of that Miracle dice to a 6!"
  const hasDialogus = hasAb(u, 'Stirring Rhetoric') && u.models.some((m) => /dialogus/i.test(m.name) && !m.dead);

  let pickIdx = -1;
  if (preferredVal !== undefined) {
    pickIdx = pool.indexOf(preferredVal);
    if (pickIdx < 0 && minVal !== undefined) {
      pickIdx = pool.findIndex((v) => v >= minVal);
    }
  } else if (minVal !== undefined) {
    // Pick the lowest die that still meets minVal (conserve higher dice)
    const valid = pool.map((v, i) => ({ v, i })).filter((x) => x.v >= minVal);
    if (valid.length > 0) {
      valid.sort((a, b) => a.v - b.v);
      pickIdx = valid[0].i;
    }
  }

  // Default: take highest die
  if (pickIdx < 0) pickIdx = 0;

  let val = pool[pickIdx];
  pool.splice(pickIdx, 1);
  if (hasDialogus) {
    val = 6;
    log(s, `Dialogus Stirring Rhetoric: substituted Miracle die boosted to 6!`, 'info', u.owner);
  }

  s.players[u.owner].actsOfFaithUsed ??= [];
  s.players[u.owner].actsOfFaithUsed!.push(u.id);

  log(s, `[Miracle] Act of Faith: ${u.name} substituted a ${rollType} die with Miracle die [${val}] — Pool left: [${pool.join(', ')}]`, 'roll', u.owner);
  // shown over the unit, or over the transport it rides in; a unit that is not on the table (reserves) gets no effect
  // (its models keep stale coordinates, which put the effect somewhere in mid-field)
  const host = onBoard(u) ? u : u.embarkedIn ? s.units.find((x) => x.id === u.embarkedIn && onBoard(x)) : undefined;
  if (host) pushFx(s, { kind: 'skill', unitId: host.id, owner: u.owner, at: centreOf(host), name: 'Act of Faith', who: `${rollType}: ${val}`, style: 'holy', epic: false });

  // Cherub ability: once per battle, after performing an Act of Faith, gain 1 Miracle die
  // Cherub: once per battle; Cherubs: twice
  const cherubs = hasAb(u, 'Cherubs') ? 2 : hasAb(u, 'Cherub') ? 1 : 0;
  if ((u.cherubUses ?? 0) < cherubs) {
    u.cherubUses = (u.cherubUses ?? 0) + 1;
    gainMiracleDice(s, u.owner, 1, undefined, `${u.name} Cherub`);
  }

  return val;
}

/** Automatic evaluation for Bot/AI to use an Act of Faith when helpful. */
export function tryActOfFaith(
  s: GameState,
  u: UnitState,
  rollType: 'charge' | 'advance' | 'shock' | 'hit' | 'wound' | 'save' | 'damage',
  context?: { need?: number; best?: boolean; damage?: number; isCharacter?: boolean },
): number | null {
  if (!canPerformActOfFaith(s, u)) return null;
  const pool = s.players[u.owner].miracleDice ?? [];
  if (!pool.length) return null;

  if (rollType === 'charge') {
    const need = context?.need ?? 7;
    if (need <= 12) {
      const minNeeded = Math.min(6, Math.max(2, Math.ceil(need / 2)));
      if (pool.some((v) => v >= minNeeded)) {
        return performActOfFaith(s, u, undefined, minNeeded, 'Charge roll');
      }
    }
  } else if (rollType === 'save') {
    const need = context?.need ?? 4;
    // Triptych of the Macharian Crusade: a saving throw substituted by an Act of Faith is successful
    if (hasEnh(u, 'Triptych of the Macharian Crusade') && ((context?.damage ?? 1) >= 2 || context?.isCharacter)) {
      return performActOfFaith(s, u, pool[pool.length - 1], undefined, 'Saving throw (Triptych)') === null ? null : 6;
    }
    const dmg = context?.damage ?? 1;
    if ((dmg >= 2 || context?.isCharacter || pool.length >= 3) && pool.some((v) => v >= need)) {
      return performActOfFaith(s, u, undefined, need, 'Saving throw');
    }
  } else if (rollType === 'damage') {
    if (pool.some((v) => v >= 5)) {
      return performActOfFaith(s, u, 6, 5, 'Damage roll');
    } else if (pool.some((v) => v >= 4) && pool.length >= 3) {
      return performActOfFaith(s, u, 4, 4, 'Damage roll');
    }
  } else if (rollType === 'advance') {
    const need = context?.need ?? 4;
    if (pool.some((v) => v >= need) && pool.length >= 2) {
      return performActOfFaith(s, u, undefined, need, 'Advance roll');
    }
  } else if (rollType === 'hit') {
    const need = context?.need ?? 3;
    if (context?.best && pool.some((v) => v === 6)) {
      return performActOfFaith(s, u, 6, 6, 'Hit roll (Critical)');
    }
    if (pool.some((v) => v >= need) && (pool.length >= 3 || context?.isCharacter || (context?.damage ?? 1) >= 2)) {
      return performActOfFaith(s, u, undefined, need, 'Hit roll');
    }
  } else if (rollType === 'wound') {
    const need = context?.need ?? 4;
    if (context?.best && pool.some((v) => v === 6)) {
      return performActOfFaith(s, u, 6, 6, 'Wound roll (Critical)');
    }
    if (pool.some((v) => v >= need) && (pool.length >= 3 || context?.isCharacter || (context?.damage ?? 1) >= 2)) {
      return performActOfFaith(s, u, undefined, need, 'Wound roll');
    }
  } else if (rollType === 'shock') {
    const need = context?.need ?? 4;
    if (need <= 6 && pool.some((v) => v >= need)) {
      return performActOfFaith(s, u, undefined, need, 'Battle-shock test');
    }
  }

  return null;
}

/** Reset per-phase tracking at phase transition. */
export function resetPhaseActsOfFaith(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (s.players[p]?.actsOfFaithUsed) {
      s.players[p].actsOfFaithUsed = [];
    }
  }
}

