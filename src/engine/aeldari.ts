// Aeldari army rules: Strands of Fate & Battle Focus.
//
// Strands of Fate (Faction Rule):
//  - At the start of the battle, roll 6 D6 (or +3 if Eldrad Ulthran is in the army).
//  - These form the player's Fate dice pool (fateDice).
//  - Once per phase, before making a dice roll for a unit with Strands of Fate,
//    substitute 1 Fate die for an unmodified roll:
//    Advance, Battle-shock, Charge, Damage, Hit, Save, Wound.
//  - Farseer (Branching Fates): Once per turn, change 1 Fate die to a 6.
//  - Guardian Defenders (Defenders of the Shrines): on 4+ while holding an objective at end of Command phase, gain 1 Fate die.
//  - Weeping Stones enhancement: roll 3+ when bearer destroys an enemy unit to gain 1 Fate die.
//
// Battle Focus (Faction Rule):
//  - At the start of the battle round, receive Battle Focus tokens:
//    Incursion: 2, Strike Force: 4. (Warhost detachment grants +1 token).
import { d6, rollN } from './dice';
import { alive, boardUnits, hasKw, log, onBoard, pushFx } from './state';
import type { GameState, PlayerId, UnitState } from './types';

export function isAeldariArmy(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return false;
  return P.factionId === 'AE'
    || P.factionName?.toLowerCase().includes('aeldari')
    || P.factionName?.toLowerCase().includes('asuryani')
    || s.units.some((u) => u.owner === p && (u.factionKeywords?.includes('AELDARI') || u.keywords?.includes('AELDARI')));
}

export function getFateDice(s: GameState, p: PlayerId): number[] {
  return s.players[p]?.fateDice ?? [];
}

/** Gain one or more Fate dice into the player's pool. */
export function gainFateDice(
  s: GameState,
  p: PlayerId,
  count = 1,
  fixedValue?: number,
  reason = 'Strands of Fate',
): number[] {
  if (!isAeldariArmy(s, p)) return [];
  s.players[p].fateDice ??= [];
  const gained: number[] = [];

  for (let i = 0; i < count; i++) {
    const val = fixedValue !== undefined ? fixedValue : d6(s);
    s.players[p].fateDice!.push(val);
    gained.push(val);
  }

  s.players[p].fateDice!.sort((a, b) => b - a);
  log(s, `🔮 Strands of Fate (Army Rule): ${s.players[p].name} gained Fate dice: [${gained.join(', ')}] (${reason}) — Pool: [${s.players[p].fateDice!.join(', ')}]`, 'info', p);
  pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: 'Strands of Fate', who: `+${count} Fate Die: ${gained.join(', ')}`, style: 'psychic', epic: false });
  return gained;
}

/** Called at the start of the battle: initialize the Fate dice pool and Battle Focus tokens. */
export function aeldariBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (isAeldariArmy(s, p)) {
      if (!s.players[p].fateDice || s.players[p].fateDice!.length === 0) {
        // Base Fate pool: 6 D6
        let numDice = 6;
        // Eldrad Ulthran (Diviner of Futures): +3 Fate dice at start of battle
        const hasEldrad = s.units.some((u) => u.owner === p && u.name.includes('Eldrad Ulthran'));
        if (hasEldrad) numDice += 3;

        s.players[p].fateDice = [];
        const rolled = rollN(s, numDice);
        s.players[p].fateDice = [...rolled].sort((a, b) => b - a);
        log(s, `🔮 Strands of Fate: ${s.players[p].name} rolled initial Fate dice pool (${numDice} dice${hasEldrad ? ' including +3 from Eldrad' : ''}): [${s.players[p].fateDice.join(', ')}]`, 'info', p);
        pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: 'Strands of Fate', who: `Initial Pool: [${s.players[p].fateDice.join(', ')}]`, style: 'psychic', epic: true });
      }

      // Initialize Battle Focus tokens (Incursion = 2 tokens, Warhost detachment +1)
      const isWarhost = s.players[p].detachments?.some((d) => d.name === 'Warhost');
      const baseTokens = 2; // Incursion (1000 pts)
      const bonusWarhost = isWarhost ? 1 : 0;
      s.players[p].battleFocusTokens = baseTokens + bonusWarhost;
    }
  }
}

/** Called at the start of each battle round to refresh Battle Focus tokens. */
export function aeldariTurnStart(s: GameState, activePlayer: PlayerId) {
  // Battle round start is player 0's turn of each round (turn 1, 3, 5...)
  if (s.turn % 2 === 1) {
    for (const p of [0, 1] as PlayerId[]) {
      if (isAeldariArmy(s, p)) {
        const isWarhost = s.players[p].detachments?.some((d) => d.name === 'Warhost');
        let tokens = 2; // Incursion
        if (isWarhost) tokens += 1;
        // Timeless Strategist enhancement: +1 Battle Focus token
        const hasStrategist = s.units.some((u) => u.owner === p && onBoard(u) && u.enhancements?.some((e) => e.name === 'Timeless Strategist'));
        if (hasStrategist) tokens += 1;

        s.players[p].battleFocusTokens = tokens;
        log(s, `⚡ Battle Focus: ${s.players[p].name} received ${tokens} Battle Focus tokens for Battle Round ${Math.ceil(s.turn / 2)}`, 'info', p);
      }
    }
  }
}

/** End of Command phase triggers: Guardian Defenders Fate generation, Farseer Branching Fates. */
export function aeldariCommandEnd(s: GameState, p: PlayerId) {
  if (!isAeldariArmy(s, p)) return;

  // Guardian Defenders: Defenders of the Shrines
  // While within range of an objective marker you control, roll D6: on 4+, gain 1 Fate die
  const guardianUnits = s.units.filter((u) => u.owner === p && onBoard(u) && (u.name.includes('Guardian Defender') || u.abilities?.some((a) => a.name === 'Defenders of the Shrines')));
  if (guardianUnits.length > 0) {
    for (const obj of s.objectives.filter((o) => o.controller === p)) {
      const hasGuardiansOnObj = guardianUnits.some((u) => alive(u).some((m) => {
        const dx = m.x - obj.x, dy = m.y - obj.y;
        return Math.sqrt(dx * dx + dy * dy) <= 3 + m.r;
      }));
      if (hasGuardiansOnObj) {
        const roll = d6(s);
        if (roll >= 4) {
          log(s, `Defenders of the Shrines: rolled ${roll} (4+) on objective ${obj.id} → gained Fate die!`, 'roll', p);
          gainFateDice(s, p, 1, undefined, 'Defenders of the Shrines');
        }
      }
    }
  }

  // Farseer: Branching Fates (Psychic)
  // Once per turn, change the result of one Fate die to a 6
  const farseer = s.units.find((u) => u.owner === p && onBoard(u) && (u.name.includes('Farseer') || u.abilities?.some((a) => a.name.includes('Branching Fates'))));
  if (farseer && s.players[p].fateDice && s.players[p].fateDice!.length > 0) {
    const pool = s.players[p].fateDice!;
    let minVal = 6;
    let minIdx = -1;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i] < minVal) {
        minVal = pool[i];
        minIdx = i;
      }
    }
    if (minIdx >= 0) {
      const oldVal = pool[minIdx];
      pool[minIdx] = 6;
      pool.sort((a, b) => b - a);
      log(s, `🔮 Farseer Branching Fates: changed lowest Fate die ${oldVal} to 6! — Pool: [${pool.join(', ')}]`, 'info', p);
      pushFx(s, { kind: 'skill', unitId: farseer.id, owner: p, at: alive(farseer)[0] ?? { x: 22, y: 15 }, name: 'Branching Fates', who: `${oldVal} → 6`, style: 'psychic', epic: false });
    }
  }
}

/** Check if a unit is eligible to use a Fate die this phase. */
export function canUseFateDie(s: GameState, u: UnitState): boolean {
  if (!isAeldariArmy(s, u.owner)) return false;
  const pool = s.players[u.owner].fateDice ?? [];
  if (pool.length === 0) return false;

  // Rule: Once per phase per army
  const used = s.players[u.owner].strandsOfFateUsed ?? [];
  return used.length === 0;
}

/** Use a Fate die from the pool to substitute a dice roll. */
export function useFateDie(
  s: GameState,
  u: UnitState,
  preferredVal?: number,
  minVal?: number,
  rollType = 'roll',
): number | null {
  if (!canUseFateDie(s, u)) return null;
  const pool = s.players[u.owner].fateDice ?? [];
  if (!pool.length) return null;

  let pickIdx = -1;
  if (preferredVal !== undefined) {
    pickIdx = pool.indexOf(preferredVal);
    if (pickIdx < 0 && minVal !== undefined) {
      pickIdx = pool.findIndex((v) => v >= minVal);
    }
  } else if (minVal !== undefined) {
    // Pick the lowest die that meets minVal to conserve high dice
    const valid = pool.map((v, i) => ({ v, i })).filter((x) => x.v >= minVal);
    if (valid.length > 0) {
      valid.sort((a, b) => a.v - b.v);
      pickIdx = valid[0].i;
    }
  }

  // Default: take highest die
  if (pickIdx < 0) pickIdx = 0;

  const val = pool[pickIdx];
  pool.splice(pickIdx, 1);

  s.players[u.owner].strandsOfFateUsed ??= [];
  s.players[u.owner].strandsOfFateUsed!.push(u.id);

  log(s, `🔮 Strands of Fate: ${u.name} substituted a ${rollType} die with Fate die [${val}] — Pool left: [${pool.join(', ')}]`, 'roll', u.owner);
  pushFx(s, { kind: 'skill', unitId: u.id, owner: u.owner, at: alive(u)[0] ?? { x: 22, y: 15 }, name: 'Strands of Fate', who: `${rollType}: ${val}`, style: 'psychic', epic: false });

  return val;
}

/** Bot / automated evaluation to substitute a Fate die. */
export function tryFateDie(
  s: GameState,
  u: UnitState,
  rollType: 'charge' | 'advance' | 'shock' | 'hit' | 'wound' | 'save' | 'damage',
  context?: { need?: number; best?: boolean; damage?: number; isCharacter?: boolean },
): number | null {
  if (!canUseFateDie(s, u)) return null;
  const pool = s.players[u.owner].fateDice ?? [];
  if (!pool.length) return null;

  if (rollType === 'charge') {
    const need = context?.need ?? 7;
    const minNeeded = Math.min(6, Math.max(5, need - 3));
    if (pool.some((v) => v >= minNeeded)) {
      return useFateDie(s, u, undefined, minNeeded, 'Charge roll');
    }
  } else if (rollType === 'save') {
    const need = context?.need ?? 4;
    const dmg = context?.damage ?? 1;
    if ((dmg >= 3 || context?.isCharacter) && pool.some((v) => v >= need)) {
      return useFateDie(s, u, undefined, need, 'Saving throw');
    }
  } else if (rollType === 'damage') {
    if (pool.some((v) => v >= 5)) {
      return useFateDie(s, u, 6, 5, 'Damage roll');
    }
  } else if (rollType === 'advance') {
    if (context?.need && context.need >= 5 && pool.some((v) => v >= 5)) {
      return useFateDie(s, u, 6, 5, 'Advance roll');
    }
  }

  return null;
}

/** Reset per-phase Strands of Fate tracking. */
export function resetPhaseStrandsOfFate(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (s.players[p]) {
      s.players[p].strandsOfFateUsed = [];
    }
  }
}
