// ============================================================================
// WARHAMMER WARBAND v2.0 — COMBAT ENGINE
// Archetypes, Combat Tokens, Tactical Ailments & Intrinsic Mechanics
// ============================================================================

import { addCombatMods, type AttackContext, type CombatMods } from './combatMods';
import { d6, rollExpr } from './dice';
import { alive, boardUnits, log, onBoard, pushFx, centreOf, other } from './state';
import type { CombatTokens, GameState, ModelState, TacticalAilments, UnitCombatRole, UnitCombatState, UnitState } from './types';

/**
 * Determine a unit's core combat role based on keywords, stats and profile.
 * Every unit belongs strictly to one of the 6 roles.
 */
export function determineCombatRole(keywords: string[], profile?: { M: number | null; T: number; Sv: number; W: number }, roleName?: string): UnitCombatRole {
  const kwUpper = keywords.map((k) => k.toUpperCase());
  const has = (k: string) => kwUpper.includes(k);

  // 1. CONDUIT: Leaders, Psykers, Officers, Priests
  if (has('CHARACTER') || has('PSYKER') || has('OFFICER') || has('TECHPRIEST') || has('WARSMITH') || (roleName && /character|leader/i.test(roleName))) {
    return 'CONDUIT';
  }

  // 2. BEHEMOTH: Giant Monsters, Titanic war machines, Daemon lords
  if (has('MONSTER') || has('TITANIC') || has('GREAT UNCLEAN ONE') || has('BLOODTHIRSTER') || has('LORD OF CHANGE') || has('KEEPER OF SECRETS') || (profile && profile.T >= 9 && profile.W >= 12)) {
    return 'BEHEMOTH';
  }

  // 3. BREACHER: Terminators, Gravis, Meganobz, heavy shields, resilient anchors
  if (has('TERMINATOR') || has('GRAVIS') || has('MEGA ARMOUR') || has('BULLGRYN') || has('WRAITHGUARD') || has('CUSTODIAN') || (profile && profile.Sv <= 2 && profile.T >= 5)) {
    return 'BREACHER';
  }

  // 4. SKIRMISHER: Jump packs, jetbikes, bikes, beasts, fast attack
  if (has('JUMP PACK') || has('FLY') || has('MOUNTED') || has('BEAST') || has('CAVALRY') || has('BIKER') || has('OUTRIDERS') || has('RAVENWING') || (profile && profile.M !== null && profile.M >= 10)) {
    return 'SKIRMISHER';
  }

  // 5. GUNSHIP: Tanks, Walkers, Artillery, Dreadnoughts, armored gun platforms
  if (has('VEHICLE') || has('WALKER') || has('DREADNOUGHT') || has('ARTILLERY') || has('SQUADRON')) {
    return 'GUNSHIP';
  }

  // 6. VANGUARD: Default line troops, Battleline, tactical spotters
  return 'VANGUARD';
}

/** Initialize a fresh UnitCombatState */
export function initCombatState(role: UnitCombatRole): UnitCombatState {
  return {
    tokens: { auspex: 0, fervour: 0, bastion: 0 },
    maxTokenCaps: { auspex: 3, fervour: 3, bastion: 3 },
    ailments: { soulfire: 0, bleeding: 0, corroded: 0, pinned: 0 },
    isExposed: false,
    warpWardHP: 0,
    maxWarpWardHP: 0,
    overheated: false,
    enraged: false,
    savesPassedCount: 0,
    distanceMovedThisTurn: 0,
  };
}

/** Ensure a unit has a valid combatState initialized */
export function ensureCombatState(u: UnitState): UnitCombatState {
  if (!u.combatRole) {
    const leaderProfile = u.models[0]?.profile;
    u.combatRole = determineCombatRole(u.keywords, leaderProfile);
  }
  if (!u.combatState) {
    u.combatState = initCombatState(u.combatRole);
  }
  return u.combatState;
}

// ============================================================================
// TOKEN MANAGEMENT (Auspex, Fervour, Bastion)
// ============================================================================

/** Add tokens to a unit, respecting maxTokenCaps */
export function addCombatToken(u: UnitState, token: keyof CombatTokens, amount = 1): number {
  const cs = ensureCombatState(u);
  const cap = cs.maxTokenCaps[token];
  const old = cs.tokens[token];
  cs.tokens[token] = Math.min(cap, old + amount);
  return cs.tokens[token] - old;
}

type TokenExpendHook = (s: GameState, u: UnitState, token: keyof CombatTokens, amount: number) => void;
let tokenExpendHook: TokenExpendHook | null = null;
export function setTokenExpendHook(fn: TokenExpendHook) {
  tokenExpendHook = fn;
}

/** Spend/expend tokens if available */
export function expendCombatToken(u: UnitState, token: keyof CombatTokens, amount = 1, s?: GameState): boolean {
  const cs = ensureCombatState(u);
  if (cs.tokens[token] >= amount) {
    cs.tokens[token] -= amount;
    if (s && tokenExpendHook) {
      tokenExpendHook(s, u, token, amount);
    }
    return true;
  }
  return false;
}

/** Clear all tokens (e.g. on Battle-shock) */
export function clearCombatTokens(u: UnitState) {
  const cs = ensureCombatState(u);
  cs.tokens.auspex = 0;
  cs.tokens.fervour = 0;
  cs.tokens.bastion = 0;
}

// ============================================================================
// TACTICAL AILMENTS (Soulfire, Bleeding, Corroded, Pinned)
// ============================================================================

/** Apply an ailment to a target unit, triggering overloads at 5 stacks */
export function applyAilment(s: GameState, target: UnitState, ailment: keyof TacticalAilments, stacks = 1) {
  const cs = ensureCombatState(target);
  const oldVal = cs.ailments[ailment];
  const newVal = Math.min(5, oldVal + stacks);
  cs.ailments[ailment] = newVal;

  log(s, `${target.name} afflicted with [${ailment.toUpperCase()}] (+${stacks}, now ${newVal})`, 'info');

  // Check Overload threshold at 5 stacks
  if (newVal >= 5) {
    triggerAilmentOverload(s, target, ailment);
  }
}

/** Trigger the 5-stack maximum overload effect for an ailment */
function triggerAilmentOverload(s: GameState, target: UnitState, ailment: keyof TacticalAilments) {
  const cs = ensureCombatState(target);
  const pos = centreOf(target);

  switch (ailment) {
    case 'soulfire': {
      // Conflagration: 3 Mortal Wounds and spread to all enemies within 4"
      log(s, `[CONFLAGRATION] ${target.name} soulfire overloaded! Dealing 3 Mortal Wounds and spreading flame.`, 'info');
      pushFx(s, { kind: 'explosion', at: pos, range: 4, radius: 4, hits: 3, title: 'CONFLAGRATION' });
      applyMortalWounds(s, target, 3, 'Conflagration');
      cs.ailments.soulfire = 0; // consumed on explosion

      // Spread 1 stack to all other units of target's owner within 4"
      for (const otherUnit of boardUnits(s, target.owner)) {
        if (otherUnit.id === target.id) continue;
        const oPos = centreOf(otherUnit);
        const dist = Math.hypot(pos.x - oPos.x, pos.y - oPos.y);
        if (dist <= 4.0) {
          applyAilment(s, otherUnit, 'soulfire', 1);
        }
      }
      break;
    }
    case 'bleeding': {
      // Exsanguinate: cannot advance, taking +1 to wound
      log(s, `🩸 EXSANGUINATE! ${target.name} is hemorrhaging: unable to Advance and takes +1 to Wound!`, 'info');
      break;
    }
    case 'corroded': {
      // Armor Shatter: Invulnerable save disabled for 1 turn
      log(s, `[ARMOR SHATTER] ${target.name} defenses shattered: Invulnerable saves disabled!`, 'info');
      break;
    }
    case 'pinned': {
      // Staggered: forced Fights Last, cannot fire Overwatch
      log(s, `[STAGGERED] ${target.name} pinned down: Overwatch disabled, Fights Last!`, 'info');
      break;
    }
  }
}

/** Apply mortal wounds directly to a unit */
export function applyMortalWounds(s: GameState, u: UnitState, amount: number, source: string) {
  if (amount <= 0 || !onBoard(u)) return;
  const aliveModels = alive(u);
  if (!aliveModels.length) return;

  let remaining = amount;
  for (const m of aliveModels) {
    if (remaining <= 0) break;
    const dmg = Math.min(m.wounds, remaining);
    m.wounds -= dmg;
    remaining -= dmg;
    if (m.wounds <= 0) {
      m.dead = true;
      log(s, `${m.name} destroyed by ${source} (${dmg} MW)`, 'kill');
    }
  }
  if (!alive(u).length) {
    u.status = 'destroyed';
  }
}

/** Process start of turn/phase ailments (e.g. Soulfire DoT in Command Phase) */
export function processCommandPhaseAilments(s: GameState, player: 0 | 1) {
  for (const u of boardUnits(s, player)) {
    const cs = ensureCombatState(u);
    // Soulfire ticks: 1 MW per stack at start of owner's command phase
    if (cs.ailments.soulfire > 0) {
      const dmg = cs.ailments.soulfire;
      log(s, `[SOULFIRE] burns ${u.name} for ${dmg} Mortal Wound(s)`, 'info');
      applyMortalWounds(s, u, dmg, 'Soulfire');
    }
    // Clean up temporary exposed mark at the start of new turn
    cs.isExposed = false;
    cs.distanceMovedThisTurn = 0;
  }
}

/** Process movement-based ailments (e.g. Bleeding on move) */
export function processMovementAilments(s: GameState, u: UnitState, distanceInches: number) {
  const cs = ensureCombatState(u);
  cs.distanceMovedThisTurn = (cs.distanceMovedThisTurn ?? 0) + distanceInches;

  if (cs.ailments.bleeding > 0 && distanceInches > 0) {
    let mw = cs.ailments.bleeding;
    if (distanceInches > 6) mw *= 2; // Double damage for fast movement!
    log(s, `🩸 [BLEEDING] ${u.name} moves ${distanceInches.toFixed(1)}" and suffers ${mw} Mortal Wound(s)!`, 'info');
    applyMortalWounds(s, u, mw, 'Bleeding');
  }
}

// ============================================================================
// ARCHETYPE INTRINSIC MECHANICS
// ============================================================================

/**
 * 1. Vanguard Intrinsic: Tactical Spotter
 * When Vanguard hits a target, target gets [Exposed].
 * When a non-Vanguard attacks an [Exposed] target, gains +1 Auspex or Fervour token!
 */
export function onVanguardHit(s: GameState, attacker: UnitState, target: UnitState) {
  const aCs = ensureCombatState(attacker);
  if (aCs && attacker.combatRole === 'VANGUARD') {
    const tCs = ensureCombatState(target);
    if (!tCs.isExposed) {
      tCs.isExposed = true;
      log(s, `[TACTICAL SPOTTER] ${attacker.name} marks ${target.name} as [EXPOSED]!`, 'info');
      pushFx(s, { kind: 'skill', unitId: attacker.id, owner: attacker.owner, at: centreOf(target), name: 'EXPOSED', who: attacker.name, style: 'command', epic: false });
    }
  }
}

/**
 * 2. Breacher Intrinsic: Kinetic Absorption
 * Triggers when saving throws are passed. Every 3 passed saves generates +1 Bastion token.
 * On charge completion: deals mortal wounds equal to Bastion tokens to engaged enemies!
 */
export function onBreacherSavePassed(s: GameState, u: UnitState) {
  const cs = ensureCombatState(u);
  if (u.combatRole === 'BREACHER') {
    cs.savesPassedCount = (cs.savesPassedCount ?? 0) + 1;
    if (cs.savesPassedCount >= 3) {
      cs.savesPassedCount = 0;
      const gained = addCombatToken(u, 'bastion', 1);
      if (gained > 0) {
        log(s, `[KINETIC ABSORPTION] ${u.name} absorbs impact: +1 Bastion Token (${cs.tokens.bastion}/${cs.maxTokenCaps.bastion})`, 'info');
      }
    }
  }
}

export function onBreacherChargeComplete(s: GameState, u: UnitState, target: UnitState) {
  const cs = ensureCombatState(u);
  if (u.combatRole === 'BREACHER' && cs.tokens.bastion > 0) {
    const mw = cs.tokens.bastion;
    log(s, `[KINETIC DISCHARGE] ${u.name} rams ${target.name} for ${mw} Mortal Wound(s) from Bastion charge!`, 'info');
    applyMortalWounds(s, target, mw, 'Kinetic Discharge');
  }
}

/**
 * 3. Skirmisher Intrinsic: Velocity Scaling
 * Every 4" moved grants +1 AP to attacks or applies Bleeding!
 */
export function getSkirmisherVelocityBonus(u: UnitState): { apBonus: number; applyBleed: boolean } {
  const cs = ensureCombatState(u);
  if (u.combatRole !== 'SKIRMISHER') return { apBonus: 0, applyBleed: false };
  const dist = cs.distanceMovedThisTurn ?? 0;
  const tiers = Math.floor(dist / 4);
  return { apBonus: tiers, applyBleed: tiers > 0 };
}

/**
 * 4. Gunship Intrinsic: Overcharge Reactor
 * Active action during Shooting phase.
 */
export function triggerGunshipOverclock(s: GameState, u: UnitState): { success: boolean; bonusAttacksPercent: number; overheated: boolean } {
  const cs = ensureCombatState(u);
  if (u.combatRole !== 'GUNSHIP' || cs.overheated) return { success: false, bonusAttacksPercent: 0, overheated: false };

  const heatRoll = d6(s);
  log(s, `[OVERCLOCK REACTOR] ${u.name} overclocks weapons (Heat roll: ${heatRoll})`, 'info');
  if (heatRoll <= 2) {
    cs.overheated = true;
    const mw = rollExpr(s, '1d3').total;
    log(s, `[REACTOR OVERHEAT] ${u.name} takes ${mw} Mortal Wound(s) and systems lock down!`, 'info');
    applyMortalWounds(s, u, mw, 'Reactor Overheat');
    return { success: true, bonusAttacksPercent: 0.5, overheated: true };
  }
  return { success: true, bonusAttacksPercent: 0.5, overheated: false };
}

/**
 * 5. Behemoth Intrinsic: Apex Rampage
 * When HP drops <= 50%, triggers Enraged shockwave + max Fervour!
 */
export function checkBehemothRampage(s: GameState, u: UnitState) {
  const cs = ensureCombatState(u);
  if (u.combatRole !== 'BEHEMOTH' || cs.enraged) return;

  const totalMaxW = u.models.reduce((sum, m) => sum + m.profile.W, 0);
  const currentW = alive(u).reduce((sum, m) => sum + m.wounds, 0);

  if (currentW <= totalMaxW * 0.5 && currentW > 0) {
    cs.enraged = true;
    log(s, `[APEX RAMPAGE] ${u.name} is ENRAGED! Unleashing devastating shockwave!`, 'info');
    pushFx(s, { kind: 'explosion', at: centreOf(u), range: 3, radius: 3, hits: 1, title: 'APEX RAMPAGE' });

    // 3" shockwave of 1d3 MW to all nearby enemies
    const pos = centreOf(u);
    for (const foe of boardUnits(s, other(u.owner))) {
      const fPos = centreOf(foe);
      if (Math.hypot(pos.x - fPos.x, pos.y - fPos.y) <= 3.0) {
        const mw = rollExpr(s, '1d3').total;
        log(s, `Shockwave hits ${foe.name} for ${mw} Mortal Wound(s)!`, 'info');
        applyMortalWounds(s, foe, mw, 'Apex Rampage');
      }
    }
    // Gain max Fervour tokens!
    cs.tokens.fervour = cs.maxTokenCaps.fervour;
  }
}

// ============================================================================
// COMBAT MODS HOOK REGISTRATION
// Seamlessly injects Token and Ailment modifiers into every attack resolution
// ============================================================================

export function registerCombatEngineModifiers() {
  addCombatMods((ctx: AttackContext): CombatMods | null => {
    const { A, T, mode } = ctx;
    const aCs = ensureCombatState(A);
    const tCs = ensureCombatState(T);
    const mods: CombatMods = { notes: [] };

    // --- 1. Attacker Token Effects ---
    // Auspex Tokens: Expands Critical Hit threshold (At 3+ stacks, Crit on 5+)
    if (aCs.tokens.auspex >= 3) {
      mods.critHitOn = 5;
      mods.notes!.push(`Auspex (${aCs.tokens.auspex}): Crit on 5+`);
    }

    // Fervour Tokens: At max stacks (3+), grants +1 Attack to all weapons
    if (aCs.tokens.fervour >= aCs.maxTokenCaps.fervour) {
      mods.attacksBonus = (mods.attacksBonus ?? 0) + 1;
      mods.notes!.push(`Fervour Max (${aCs.tokens.fervour}): +1 Attack`);
    }

    // Skirmisher Velocity: +1 AP per 4" moved
    if (A.combatRole === 'SKIRMISHER') {
      const { apBonus } = getSkirmisherVelocityBonus(A);
      if (apBonus > 0) {
        mods.apBonus = (mods.apBonus ?? 0) + apBonus;
        mods.notes!.push(`Velocity Scaling (+${apBonus} AP)`);
      }
    }

    // Vanguard Synergy: Non-Vanguard attacking [Exposed] target gains +1 Auspex
    if (tCs.isExposed && A.combatRole !== 'VANGUARD') {
      addCombatToken(A, 'auspex', 1);
      mods.notes!.push(`Exposed Target Synergy (+1 Auspex Token)`);
    }

    // --- 2. Defender Token & Ailment Effects ---
    // Bastion Tokens: At 3+ stacks, worsens incoming AP by 1
    if (tCs.tokens.bastion >= 3) {
      mods.apWorsen = (mods.apWorsen ?? 0) + 1;
      mods.notes!.push(`Bastion Defense: Worsen AP by 1`);
    }

    // Corroded Ailment: Every 2 stacks worsens armor save by 1 (modeled as incoming +1 AP bonus)
    if (tCs.ailments.corroded >= 2) {
      const extraAp = Math.floor(tCs.ailments.corroded / 2);
      mods.apBonus = (mods.apBonus ?? 0) + extraAp;
      mods.notes!.push(`Corroded (${tCs.ailments.corroded} stacks): +${extraAp} AP`);
    }

    // Bleeding Ailment: At 5 stacks (Exsanguinate), attacker gets +1 to Wound
    if (tCs.ailments.bleeding >= 5) {
      mods.woundMod = (mods.woundMod ?? 0) + 1;
      mods.notes!.push(`Exsanguinate: +1 to Wound`);
    }

    // Pinned Ailment: Target cannot use Overwatch
    // (Checked separately in overwatch resolution)

    return Object.keys(mods).length > 1 ? mods : null;
  });
}

// Auto-register on module load
registerCombatEngineModifiers();
