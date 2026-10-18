// Adepta Sororitas (Sisters of Battle) army rule: Acts of Faith & Miracle Dice.
// Gaining Miracle Dice:
//  - 1 Miracle die at the start of each turn.
//  - 1 Miracle die each time an ADEPTA SORORITAS unit from your army is destroyed.
//  - Triumph of Saint Katherine: Miracle die at start of turn has value 6 if on battlefield.
//  - Simulacrum Imperialis: on 4+ per objective controlled at end of Command phase.
//  - Cherub: once per battle after performing an Act of Faith.
// Performing an Act of Faith:
//  - 1 per phase per unit (2 for JUMP PACK in Army of Faith detachment).
//  - Substitute a die before making a roll: Advance, Battle-shock, Charge, Damage, Hit, Save, Wound.
import { d6, rollN } from '../engine/dice';
import { alive, boardUnits, hasKw, log, onBoard, other, pushFx } from '../engine/state';
import type { GameState, PlayerId, UnitState } from '../engine/types';

export function isSororitasArmy(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return false;
  return P.factionId === 'AS'
    || P.factionName?.toLowerCase().includes('sororitas')
    || s.units.some((u) => u.owner === p && (u.factionKeywords?.includes('ADEPTA SORORITAS') || u.keywords?.includes('ADEPTA SORORITAS')));
}

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
        const hasTriumph = s.units.some((u) => u.owner === p && onBoard(u) && u.name.includes('Triumph Of Saint Katherine'));
        if (hasTriumph) val = 6;
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
export function sororitasTurnStart(s: GameState, activePlayer: PlayerId) {
  for (const p of [0, 1] as PlayerId[]) {
    if (isSororitasArmy(s, p)) {
      gainMiracleDice(s, p, 1, undefined, 'Start of turn');
    }
  }
}

/** Called when a unit is destroyed: if ADEPTA SORORITAS, gains 1 Miracle die. */
export function sororitasUnitDestroyed(s: GameState, victim: UnitState) {
  if (!victim.factionKeywords?.includes('ADEPTA SORORITAS') && !victim.keywords?.includes('ADEPTA SORORITAS')) return;
  if (!isSororitasArmy(s, victim.owner)) return;

  // Imagifier within 12": Litany of Deeds allows re-rolling the gained Miracle die
  const imagifierNear = s.units.some((u) => u.owner === victim.owner && u.id !== victim.id && onBoard(u) && u.name.includes('Imagifier') && alive(u).length > 0);
  let roll = d6(s);
  if (imagifierNear && roll <= 3) {
    const rerolled = d6(s);
    log(s, `Imagifier Litany of Deeds: re-rolled Miracle die ${roll} → ${rerolled}`, 'roll', victim.owner);
    roll = rerolled;
  }

  gainMiracleDice(s, victim.owner, 1, roll, `${victim.name} destroyed`);

  // Saintly Example Enhancement: gain D3 additional Miracle dice
  if (victim.enhancements?.some((e) => e.name === 'Saintly Example')) {
    const extra = Math.ceil(d6(s) / 2);
    gainMiracleDice(s, victim.owner, extra, undefined, 'Saintly Example');
  }
}

/** End of Command phase triggers: Simulacrum Imperialis, Healing Tears, Salvationist Medikit. */
export function sororitasCommandEnd(s: GameState, p: PlayerId) {
  if (!isSororitasArmy(s, p)) return;

  // Simulacrum Imperialis: roll D6 on 4+ for each objective controlled with a unit in range
  const simUnits = s.units.filter((u) => u.owner === p && onBoard(u) && (u.abilities?.some((a) => a.name === 'Simulacrum Imperialis') || u.models.some((m) => (m.gear ?? []).some((g: string) => g.toLowerCase().includes('simulacrum')))));
  if (simUnits.length) {
    for (const obj of s.objectives.filter((o) => o.controller === p)) {
      const hasSim = simUnits.some((u) => alive(u).some((m) => {
        const dx = m.x - obj.x, dy = m.y - obj.y;
        return Math.sqrt(dx * dx + dy * dy) <= 3 + m.r;
      }));
      if (hasSim) {
        const roll = d6(s);
        if (roll >= 4) {
          log(s, `Simulacrum Imperialis: rolled ${roll} (4+) on objective ${obj.id} → gained Miracle die!`, 'roll', p);
          gainMiracleDice(s, p, 1, roll, 'Simulacrum Imperialis');
        }
      }
    }
  }

  // Saint Celestine Healing Tears: return 1 destroyed Geminae Superia
  for (const cel of s.units.filter((u) => u.owner === p && onBoard(u) && u.name.includes('Saint Celestine'))) {
    const gem = cel.models.find((m) => m.name.includes('Geminae') && m.dead);
    if (gem) {
      gem.dead = false;
      gem.wounds = gem.profile.W;
      const anchor = alive(cel)[0];
      if (anchor) { gem.x = anchor.x + 0.5; gem.y = anchor.y + 0.5; }
      log(s, `Saint Celestine Healing Tears: returned Geminae Superia to the battlefield`, 'info', p);
    }
  }

  // Salvationist Medikit (Sanctifiers): return up to D3 destroyed models
  for (const sanct of s.units.filter((u) => u.owner === p && onBoard(u) && u.abilities?.some((a) => a.name === 'Salvationist Medikit'))) {
    const deadModels = sanct.models.filter((m) => m.dead && !m.isCharacter);
    if (deadModels.length > 0) {
      const numToReturn = Math.min(deadModels.length, Math.ceil(d6(s) / 2));
      for (let i = 0; i < numToReturn; i++) {
        const m = deadModels[i];
        m.dead = false;
        m.wounds = m.profile.W;
        const anchor = alive(sanct)[0];
        if (anchor) { m.x = anchor.x + 0.5; m.y = anchor.y + 0.5; }
      }
      log(s, `Salvationist Medikit: returned ${numToReturn} models to ${sanct.name}`, 'info', p);
    }
  }
}

/** Check if a unit is eligible to perform an Act of Faith this phase. */
export function canPerformActOfFaith(s: GameState, u: UnitState): boolean {
  if (!isSororitasArmy(s, u.owner)) return false;
  const pool = s.players[u.owner].miracleDice ?? [];
  if (pool.length === 0) return false;

  const used = s.players[u.owner].actsOfFaithUsed ?? [];
  const unitUsedCount = used.filter((id) => id === u.id).length;

  // Army of Faith detachment: JUMP PACK units can perform two Acts of Faith per phase
  const isJumpPack = hasKw(u, 'JUMP PACK') || u.keywords?.includes('JUMP PACK');
  const isArmyOfFaith = s.players[u.owner].detachments?.some((d) => d.name === 'Army of Faith');
  const maxAllowed = isJumpPack && isArmyOfFaith ? 2 : 1;

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
  const hasDialogus = u.models.some((m) => m.name.includes('Dialogus') && !m.dead);

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
  pushFx(s, { kind: 'skill', unitId: u.id, owner: u.owner, at: alive(u)[0] ?? { x: 22, y: 15 }, name: 'Act of Faith', who: `${rollType}: ${val}`, style: 'holy', epic: false });

  // Cherub ability: once per battle, after performing an Act of Faith, gain 1 Miracle die
  if ((u.abilities?.some((a) => a.name === 'Cherub') || u.abilities?.some((a) => a.name === 'Cherubs')) && !u.cherubUsed) {
    u.cherubUsed = true;
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

