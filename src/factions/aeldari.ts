// Aeldari army rules: Strands of Fate & Battle Focus.
//
// Strands of Fate (Faction Rule):
//  - At the start of the battle, roll six D6: the Fate dice pool.
//  - Once per phase, before making a dice roll for a unit with Strands of Fate,
//    substitute 1 Fate die for an unmodified roll:
//    Advance, Battle-shock, Charge, Damage, Hit, Save, Wound.
//
// Battle Focus (Faction Rule):
//  - At the start of the battle round, receive 2 / 4 / 6 Battle Focus tokens (Incursion / Strike Force / Onslaught).
//  - Spend one to let an eligible unit perform an Agile Manoeuvre: the manoeuvres are the rule's `acts` in
//    data/detachment-rules.json, using the `focusReady:<manoeuvre>` condition and the `ae: "focus:<manoeuvre>"` action.
import { d6, rollN } from '../engine/dice';
import { alive, boardUnits, hasKw, log, onBoard, phaseKey, pushFx } from '../engine/state';
import type { Active } from '../rules-engine/effects';
import type { CombatMods } from '../engine/combatMods';
import type { GameState, PlayerId, UnitState } from '../engine/types';

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
  log(s, `[Fate] Strands of Fate (Army Rule): ${s.players[p].name} gained Fate dice: [${gained.join(', ')}] (${reason}) — Pool: [${s.players[p].fateDice!.join(', ')}]`, 'info', p);
  pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: 'Strands of Fate', who: `+${count} Fate Die: ${gained.join(', ')}`, style: 'psychic', epic: false });
  return gained;
}

/** Start of the battle: the Strands of Fate roll (six D6; the bot keeps its first roll). */
export function aeldariBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!isAeldariArmy(s, p) || s.players[p].fateDice?.length) continue;
    s.players[p].fateDice = rollN(s, 6).sort((a, b) => b - a);
    log(s, `[Fate] Strands of Fate: ${s.players[p].name} rolled the Fate dice pool: [${s.players[p].fateDice!.join(', ')}]`, 'info', p);
    pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: 'Strands of Fate', who: `Pool: [${s.players[p].fateDice!.join(', ')}]`, style: 'psychic', epic: true });
  }
}

const FOCUS_TOKENS: Record<string, number> = { incursion: 2, 'strike-force': 4, strike: 4, onslaught: 6 };
const SEER_DICE: Record<string, number> = { incursion: 3, 'strike-force': 6, strike: 6, onslaught: 9 };
const hasDet = (s: GameState, p: PlayerId, n: string) => !!s.players[p].detachments?.some((d) => d.name === n);

/** Start of the battle round: Battle Focus tokens (unspent ones are lost); Seer Council's Fate dice in round 1. */
export function aeldariRoundStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    if (P.armyRules?.some((r) => r.name === 'Battle Focus')) {
      let n = FOCUS_TOKENS[P.battleSize ?? ''] ?? 4;
      if (hasDet(s, p, 'Warhost')) n += 1; // Martial Grace
      // Timeless Strategist: the bearer on the battlefield (or in a transport that is)
      if (s.units.some((u) => u.owner === p && u.enhancements?.some((e) => e.name === 'Timeless Strategist') && (onBoard(u) || (u.status === 'embarked' && s.units.some((t) => t.id === u.embarkedIn && onBoard(t)))))) n += 1;
      P.battleFocusTokens = n;
      P.focusUsed = {};
      log(s, `Battle Focus: ${P.name} has ${n} tokens this battle round`, 'info', p);
    }
    if (s.round === 1 && hasDet(s, p, 'Seer Council') && !P.seerFate) {
      P.seerFate = rollN(s, SEER_DICE[P.battleSize ?? ''] ?? 6).sort((a, b) => a - b);
      log(s, `Strands of Fate (Seer Council): Fate dice [${P.seerFate.join(', ')}]`, 'info', p);
    }
  }
}

/** Adrenal Infusions, Fleet of Foot: Fade Back without a token. */
const freeFadeBack = (u: UnitState) => !!u.enhancements?.some((e) => e.name === 'Adrenal Infusions') || u.abilities.some((a) => a.name === 'Fleet of Foot');

/** A unit that can perform this Agile Manoeuvre now: it has Battle Focus (or Spirit Guides gives it it) and has not
 *  performed one this phase; a token is left; the manoeuvre was not used this phase (Swift as the Wind: by another unit). */
export function canFocus(s: GameState, u: UnitState, which: string): boolean {
  const P = s.players[u.owner];
  if (u.used?.focus === phaseKey(s)) return false;
  const free = which === 'fadeBack' && freeFadeBack(u);
  if (!free && !(P.battleFocusTokens ?? 0)) return false;
  if (which !== 'swift' && !free && P.focusUsed?.[which] === phaseKey(s)) return false;
  if (u.abilities.some((a) => a.name === 'Battle Focus')) return true;
  // Spirit Guides (Spirit Conclave): Wraith units within 12" of an ASURYANI PSYKER model
  return hasDet(s, u.owner, 'Spirit Conclave') && ['WRAITHBLADES', 'WRAITHGUARD', 'WRAITHLORD'].some((k) => hasKw(u, k))
    && boardUnits(s, u.owner).some((f) => alive(f).some((m) => m.keywords.includes('PSYKER') && alive(u).some((n) => Math.hypot(m.x - n.x, m.y - n.y) - m.r - n.r <= 12)));
}

/** Spend a Battle Focus token on an Agile Manoeuvre (Indomitable Strength of Will / Pirate Prince: 3+ gets it back). */
export function spendFocus(s: GameState, u: UnitState, which: string, label: string) {
  const P = s.players[u.owner];
  (u.used ??= {}).focus = phaseKey(s);
  if (which === 'fadeBack' && freeFadeBack(u)) return;
  P.battleFocusTokens = Math.max(0, (P.battleFocusTokens ?? 0) - 1);
  (P.focusUsed ??= {})[which] = phaseKey(s);
  const refund = u.abilities.some((a) => a.name === 'Indomitable Strength of Will') || !!u.enhancements?.some((e) => e.name === 'Pirate Prince');
  const r = refund ? d6(s) : 0;
  if (r >= 3) P.battleFocusTokens += 1;
  log(s, `${label}: ${u.name} spends a Battle Focus token (${P.battleFocusTokens} left)${refund ? ` · rolled ${r}${r >= 3 ? ': token back' : ''}` : ''}`, 'info', u.owner);
}

/** Seer Council's Strands of Fate: the stratagems a Fate die of the right value makes 1CP cheaper. */
const SEER_STRATS: Record<string, number> = { 'PRESENTIMENT OF DREAD': 1, FOREWARNED: 2, 'UNSHROUDED TRUTH': 3, 'FATE INESCAPABLE': 4, 'ISHA’S FURY': 5, "ISHA'S FURY": 5, 'PSYCHIC SHIELD': 6 };
export function seerDiscounts(s: GameState, u: UnitState): Active[] {
  const P = s.players[u.owner];
  if (!P.seerFate?.length || !hasDet(s, u.owner, 'Seer Council')) return [];
  const sts = P.detachments.find((d) => d.name === 'Seer Council')?.stratagems ?? [];
  return sts.flatMap((st) => {
    const v = SEER_STRATS[st.name.toUpperCase()];
    return v && P.seerFate!.includes(v) ? [{ e: { stratDiscount: { ids: [st.id], cp: 1, fateValue: v } }, label: 'Strands of Fate', holder: u }] : [];
  });
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

  log(s, `[Fate] Strands of Fate: ${u.name} substituted a ${rollType} die with Fate die [${val}] — Pool left: [${pool.join(', ')}]`, 'roll', u.owner);
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
    if (need <= 12) {
      const minNeeded = Math.min(6, Math.max(2, Math.ceil(need / 2)));
      if (pool.some((v) => v >= minNeeded)) {
        return useFateDie(s, u, undefined, minNeeded, 'Charge roll');
      }
    }
  } else if (rollType === 'save') {
    const need = context?.need ?? 4;
    const dmg = context?.damage ?? 1;
    if ((dmg >= 2 || context?.isCharacter || pool.length >= 3) && pool.some((v) => v >= need)) {
      return useFateDie(s, u, undefined, need, 'Saving throw');
    }
  } else if (rollType === 'damage') {
    if (pool.some((v) => v >= 5)) {
      return useFateDie(s, u, 6, 5, 'Damage roll');
    } else if (pool.some((v) => v >= 4) && pool.length >= 3) {
      return useFateDie(s, u, 4, 4, 'Damage roll');
    }
  } else if (rollType === 'advance') {
    const need = context?.need ?? 4;
    if (pool.some((v) => v >= need) && pool.length >= 2) {
      return useFateDie(s, u, undefined, need, 'Advance roll');
    }
  } else if (rollType === 'hit') {
    const need = context?.need ?? 3;
    if (context?.best && pool.some((v) => v === 6)) {
      return useFateDie(s, u, 6, 6, 'Hit roll (Critical)');
    }
    if (pool.some((v) => v >= need) && (pool.length >= 3 || context?.isCharacter || (context?.damage ?? 1) >= 2)) {
      return useFateDie(s, u, undefined, need, 'Hit roll');
    }
  } else if (rollType === 'wound') {
    const need = context?.need ?? 4;
    if (context?.best && pool.some((v) => v === 6)) {
      return useFateDie(s, u, 6, 6, 'Wound roll (Critical)');
    }
    if (pool.some((v) => v >= need) && (pool.length >= 3 || context?.isCharacter || (context?.damage ?? 1) >= 2)) {
      return useFateDie(s, u, undefined, need, 'Wound roll');
    }
  } else if (rollType === 'shock') {
    const need = context?.need ?? 4;
    if (need <= 6 && pool.some((v) => v >= need)) {
      return useFateDie(s, u, undefined, need, 'Battle-shock test');
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

// ---------- Corsair Coterie ----------

/** Relentless Raiders: an enemy unit ends a Normal, Advance, Fall Back or Charge move on an objective you control: 2+ → D3 mortal wounds. */
export function relentlessRaiders(s: GameState, u: UnitState, mortals: (u: UnitState, n: number, why: string) => void) {
  const p = (1 - u.owner) as PlayerId;
  if (!hasDet(s, p, 'Corsair Coterie') || !onBoard(u)) return;
  for (const o of s.objectives) {
    if (o.controller !== p || !alive(u).some((m) => Math.hypot(m.x - o.x, m.y - o.y) - m.r <= 3 + 1e-6)) continue;
    const r = d6(s);
    const n = r >= 2 ? rollN(s, 1).map((x) => Math.ceil(x / 2))[0] : 0;
    log(s, `Relentless Raiders: ${u.name} ended a move on objective ${o.id} — rolled ${r}${n ? ` → ${n} mortal wounds` : ''}`, 'roll', p);
    if (n) mortals(u, n, 'Relentless Raiders');
    return;
  }
}

/** Void Thieves: at the end of a phase, objectives you control that an ANHRATHE unit is on stay yours. */
export function voidThieves(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!hasDet(s, p, 'Corsair Coterie')) continue;
    for (const o of s.objectives) {
      if (o.controller !== p || o.secured === p) continue;
      if (boardUnits(s, p).some((u) => hasKw(u, 'ANHRATHE') && alive(u).some((m) => Math.hypot(m.x - o.x, m.y - o.y) - m.r <= 3 + 1e-6))) {
        o.secured = p;
        log(s, `Void Thieves: objective ${o.id} stays under ${s.players[p].name}'s control`, 'info', p);
      }
    }
  }
}

/** Lucid Eye: +1 or -1 to one Seer Council Fate die, making a value the pool lacks out of a spare one. */
export function lucidEye(s: GameState, p: PlayerId, label: string) {
  const pool = s.players[p].seerFate;
  if (!pool?.length) return;
  const count = (v: number) => pool.filter((x) => x === v).length;
  for (let v = 1; v <= 6; v++) {
    if (count(v)) continue;
    const from = [v - 1, v + 1].find((w) => count(w) > 1) ?? [v - 1, v + 1].find((w) => count(w) > 0);
    if (!from) continue;
    pool[pool.indexOf(from)] = v;
    pool.sort((a, b) => a - b);
    log(s, `${label}: a Fate die ${from} becomes ${v} — [${pool.join(', ')}]`, 'info', p);
    return;
  }
}

// ---------- Sonic Destruction (Vibro Cannon Platforms) and Shadow Field ----------

/** Which Vibro Cannon Platform units shot which enemy unit this phase. */
export function noteVibro(s: GameState, A: UnitState, T: UnitState) {
  if (!A.sources.includes('Vibro Cannon Platform') || s.phase !== 'shooting') return;
  const P = s.players[A.owner];
  const k = `${phaseKey(s)}:${T.id}`;
  const now = Object.entries(P.vibroShots ?? {}).filter(([key]) => key.startsWith(`${phaseKey(s)}:`));
  P.vibroShots = { ...Object.fromEntries(now), [k]: [...new Set([...(P.vibroShots?.[k] ?? []), A.id])] };
}

/** +1 S, AP and D for each other Vibro Cannon Platform that shot the target this phase. */
export function sonicDestruction(s: GameState, A: UnitState, T: UnitState, weapon: string | undefined): CombatMods | null {
  if (!A.sources.includes('Vibro Cannon Platform') || !/vibro cannon/i.test(weapon ?? '') || s.phase !== 'shooting' || s.active !== A.owner) return null;
  const n = (s.players[A.owner].vibroShots?.[`${phaseKey(s)}:${T.id}`] ?? []).filter((id) => id !== A.id).length;
  return n ? { strengthBonus: n, apBonus: n, damageBonus: n, notes: [`Sonic Destruction: +${n} S, AP and D`] } : null;
}

/** Shadow Field: the 2+ invulnerable save is gone once the bearer has lost wounds to an attack. */
export function shadowFieldCheck(s: GameState, T: UnitState) {
  for (const m of T.models) {
    if (m.shadowFieldDown || !T.abilities.some((a) => a.name === 'Shadow Field' && a.sheet === m.source)) continue;
    if (m.dead || m.wounds < m.profile.W) { m.shadowFieldDown = true; log(s, `Shadow Field: ${m.name}'s field fails for the rest of the battle`, 'info', T.owner); }
  }
}
