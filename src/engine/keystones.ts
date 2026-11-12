// ============================================================================
// WARHAMMER WARBAND v2.0 — 12 TRANSFORMATIVE KEYSTONES ENGINE
// Path of Exile-inspired rule-bending keystones and extreme game-changers
// ============================================================================

import { addCombatMods, addPoolFinisher, type AttackContext, type CombatMods } from './combatMods';
import { addCombatToken, applyAilment, applyMortalWounds, ensureCombatState } from './combatEngine';
import { d6, rollExpr } from './dice';
import { alive, boardUnits, centreOf, log, onBoard, other, pushFx } from './state';
import type { GameState, ModelState, PlayerId, UnitState } from './types';

export interface KeystoneDef {
  id: string;
  name: string;
  poeInspiration: string;
  description: string;
}

export const TRANSFORMATIVE_KEYSTONES: Record<string, KeystoneDef> = {
  warp_inoculation: {
    id: 'warp_inoculation',
    name: 'Warp Inoculation',
    poeInspiration: 'Chaos Inoculation (CI)',
    description: 'Max HP reduced to 1! Gain 150% Max HP as Warp Ward (Energy Shield). Fully regenerates if no damage taken for 1 turn. Immune to ailment Mortal Wounds.',
  },
  blood_pact: {
    id: 'blood_pact',
    name: 'Blood Pact Munitions',
    poeInspiration: 'Blood Magic / Eldritch Battery',
    description: 'Stratagems cost 0 CP! Instead, burn 1d3 Wounds from own unit per 1 CP. Burned unit gains 3 Fervour Tokens.',
  },
  point_blank: {
    id: 'point_blank',
    name: 'Point Blank Doctrines',
    poeInspiration: 'Point Blank',
    description: 'Ranged attacks within half range gain +1 Damage and +1 AP! Beyond half range, damage halved and cannot Crit.',
  },
  avatar_of_warp: {
    id: 'avatar_of_warp',
    name: 'Avatar of the Warp',
    poeInspiration: 'Avatar of Fire / Elemental Overload',
    description: 'Cannot score Critical Wounds normally. Hit/wound rolls of 6 inflict 2 [Soulfire] stacks, and Soulfire max cap increased to 10!',
  },
  machine_instability: {
    id: 'machine_instability',
    name: 'Machine Instability',
    poeInspiration: 'Minion Instability',
    description: 'When GUNSHIP or BEHEMOTH HP drops <= 25%, automatically detonates for 100% of original Max HP as Mortal Wounds to all enemies within 6"!',
  },
  lone_wolf: {
    id: 'lone_wolf',
    name: 'Lone Wolf Protocol',
    poeInspiration: 'Supreme Ego / Lone Messenger',
    description: 'Max 4 units allowed in your army! All 4 units become Apex Bosses: 2x HP, 2 Actions per turn, and 3x OC!',
  },
  unwavering_stance: {
    id: 'unwavering_stance',
    name: 'Unwavering Stance',
    poeInspiration: 'Unwavering Stance / Iron Reflexes',
    description: 'Cannot Advance or Fall Back, cannot use Invulnerable Saves. Invulnerable save converted to +2 Toughness, counts as Remained Stationary always!',
  },
  necromantic_conduit: {
    id: 'necromantic_conduit',
    name: 'Necromantic Conduit',
    poeInspiration: 'Flesh Offering / Corpse Pact',
    description: 'Slain models leave Corpse Markers. CONDUIT units can detonate corpses within 12" to revive infantry or siphon corpses for +2 Strength.',
  },
  glass_cannon: {
    id: 'glass_cannon',
    name: 'Glass Cannon Overdrive',
    poeInspiration: 'Pain Attunement / Abyssus',
    description: 'Armor Save worsened by 2 (e.g. 3+ -> 5+). All attacks score Critical Hit on 4+ (instead of 6+)!',
  },
  hive_mind: {
    id: 'hive_mind',
    name: 'Synchronized Hive-Mind',
    poeInspiration: 'The Agnostic / Shared Suffering',
    description: 'All units within 6" of CONDUIT share a unified HP pool!',
  },
  temporal_distortion: {
    id: 'temporal_distortion',
    name: 'Temporal Distortion',
    poeInspiration: 'Temporal Chains / Trickster',
    description: 'Battle lasts 7 rounds. Rounds 1-2 deal half damage, but from Round 4 onwards get Full Re-roll Hits & Wounds and regenerate 2 HP per turn.',
  },
  vaal_harvester: {
    id: 'vaal_harvester',
    name: 'Vaal Soul-Harvester',
    poeInspiration: 'Vaal Skills Mechanic',
    description: 'Normal CP generation disabled. Gain 1 Soul Charge per killed enemy model. At 10 Souls, trigger [Unleash Warp Storm] for a free extra turn activation!',
  },
};

/**
 * Checks if a player has an active keystone by id or name
 */
export function hasActiveKeystone(s: GameState, player: PlayerId, nameOrId: string): boolean {
  const norm = nameOrId.toLowerCase().replace(/[^a-z0-9]/g, '');
  // 1. Check in campaign rules array
  if (s.campaign?.rules) {
    for (const r of s.campaign.rules) {
      const rNorm = r.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (rNorm.includes(norm) || norm.includes(rNorm)) return true;
    }
  }

  // 2. Check in army units timed effects / keystones
  for (const u of s.units) {
    if (u.owner !== player) continue;
    if (u.timed?.some((t) => t.label.toLowerCase().replace(/[^a-z0-9]/g, '').includes(norm))) {
      return true;
    }
  }

  return false;
}

/**
 * Initialize / apply keystone modifications at battle start
 */
export function applyKeystoneBattleSetup(s: GameState, player: PlayerId) {
  const units = boardUnits(s, player);

  // 1. Warp Inoculation
  if (hasActiveKeystone(s, player, 'warp_inoculation') || hasActiveKeystone(s, player, 'Warp Inoculation')) {
    log(s, `[WARP INOCULATION] All units convert biological life to Warp Energy Shield!`, 'info');
    for (const u of units) {
      const cs = ensureCombatState(u);
      let totalOriginalWounds = 0;
      for (const m of u.models) {
        totalOriginalWounds += m.profile.W;
        m.wounds = 1; // Base life reduced to 1!
        m.profile.W = 1;
      }
      cs.maxWarpWardHP = Math.ceil(totalOriginalWounds * 1.5);
      cs.warpWardHP = cs.maxWarpWardHP;
    }
  }

  // 2. Lone Wolf Protocol
  if (hasActiveKeystone(s, player, 'lone_wolf') || hasActiveKeystone(s, player, 'Lone Wolf Protocol')) {
    if (units.length <= 4) {
      log(s, `[LONE WOLF PROTOCOL] Small strike force empowered as APEX BOSSES!`, 'info');
      for (const u of units) {
        for (const m of u.models) {
          m.profile.W *= 2;
          m.wounds *= 2;
          if (m.profile.OC !== null) m.profile.OC *= 3;
        }
      }
    }
  }

  // 3. Temporal Distortion
  if (hasActiveKeystone(s, player, 'temporal_distortion') || hasActiveKeystone(s, player, 'Temporal Distortion')) {
    s.maxRounds = 7;
    log(s, `[TEMPORAL DISTORTION] Space-time warped: Battle extended to 7 Battle Rounds!`, 'info');
  }

  // 4. Glass Cannon Overdrive
  if (hasActiveKeystone(s, player, 'glass_cannon') || hasActiveKeystone(s, player, 'Glass Cannon Overdrive')) {
    log(s, `[GLASS CANNON OVERDRIVE] Armor cracked (+2 Sv penalty) for lethal 4+ Critical Strike!`, 'info');
    for (const u of units) {
      for (const m of u.models) {
        m.profile.Sv = Math.min(6, m.profile.Sv + 2);
      }
    }
  }

  // 5. Unwavering Stance
  if (hasActiveKeystone(s, player, 'unwavering_stance') || hasActiveKeystone(s, player, 'Unwavering Stance')) {
    log(s, `[UNWAVERING STANCE] Solid as granite: Invulnerable saves converted into +2 Toughness!`, 'info');
    for (const u of units) {
      for (const m of u.models) {
        m.profile.T += 2;
        m.profile.InSv = null; // Invulnerable disabled
      }
    }
  }
}

/**
 * Combat Mods hook registration for keystones
 */
export function registerKeystoneModifiers() {
  addCombatMods((ctx: AttackContext): CombatMods | null => {
    const { s, A, T, mode, d, p } = ctx;
    const mods: CombatMods = { notes: [] };

    // 1. Glass Cannon Overdrive: Critical Hit on 4+
    if (hasActiveKeystone(s, A.owner, 'glass_cannon') || hasActiveKeystone(s, A.owner, 'Glass Cannon Overdrive')) {
      mods.critHitOn = 4;
      mods.notes!.push('Glass Cannon: Crit on 4+');
    }

    // 2. Point Blank Doctrines
    if (mode === 'ranged' && (hasActiveKeystone(s, A.owner, 'point_blank') || hasActiveKeystone(s, A.owner, 'Point Blank Doctrines'))) {
      const weaponRange = typeof p.range === 'number' ? p.range : 24;
      const halfRange = weaponRange / 2;
      if (d <= halfRange) {
        mods.damageBonus = (mods.damageBonus ?? 0) + 1;
        mods.apBonus = (mods.apBonus ?? 0) + 1;
        mods.notes!.push('Point Blank: +1 AP, +1 Dmg (Within Half Range)');
      } else {
        mods.notes!.push('Point Blank: Distant fire (Damage halved)');
      }
    }

    // 3. Avatar of the Warp: Soulfire on attacks
    if (hasActiveKeystone(s, A.owner, 'avatar_of_warp') || hasActiveKeystone(s, A.owner, 'Avatar of the Warp')) {
      mods.notes!.push('Avatar of the Warp (+1 Soulfire)');
    }

    return Object.keys(mods).length > 1 ? mods : null;
  });

  addPoolFinisher((ctx: AttackContext) => {
    const { s, A, T } = ctx;
    if (hasActiveKeystone(s, A.owner, 'avatar_of_warp') || hasActiveKeystone(s, A.owner, 'Avatar of the Warp')) {
      applyAilment(s, T, 'soulfire', 1);
    }
  });
}

// Register keystone modifiers
registerKeystoneModifiers();

/**
 * Absorbs incoming damage using Warp Ward (Energy Shield)
 */
export function absorbWarpWardDamage(u: UnitState, incomingDmg: number): { absorbed: number; remainingDmg: number } {
  const cs = ensureCombatState(u);
  if (!cs.warpWardHP || cs.warpWardHP <= 0 || incomingDmg <= 0) {
    return { absorbed: 0, remainingDmg: incomingDmg };
  }

  const absorbed = Math.min(cs.warpWardHP, incomingDmg);
  cs.warpWardHP -= absorbed;
  const remainingDmg = incomingDmg - absorbed;
  return { absorbed, remainingDmg };
}

/**
 * Check Machine Instability when a vehicle/monster drops <= 25% HP
 */
export function checkMachineInstability(s: GameState, u: UnitState) {
  if (u.combatRole !== 'GUNSHIP' && u.combatRole !== 'BEHEMOTH') return;
  if (!hasActiveKeystone(s, u.owner, 'machine_instability') && !hasActiveKeystone(s, u.owner, 'Machine Instability')) return;

  const cs = ensureCombatState(u);
  if (cs.overheated) return; // already exploded

  const totalMaxW = u.models.reduce((sum, m) => sum + m.profile.W, 0);
  const currentW = alive(u).reduce((sum, m) => sum + m.wounds, 0);

  if (currentW > 0 && currentW / totalMaxW <= 0.25) {
    cs.overheated = true;
    log(s, `[MACHINE INSTABILITY] ${u.name} core breached at <= 25% HP! CATACLYSMIC EXPLOSION!`, 'info');
    const uPos = centreOf(u);
    pushFx(s, { kind: 'explosion', at: uPos, range: 6, radius: 6, hits: 5, title: 'REACTOR OVERLOAD' });

    for (const foe of boardUnits(s, other(u.owner))) {
      const foePos = centreOf(foe);
      const d = Math.hypot(uPos.x - foePos.x, uPos.y - foePos.y);
      if (d <= 6.0) {
        applyMortalWounds(s, foe, totalMaxW, 'Machine Instability Detonation');
      }
    }

    // Destroy the unit from its own cataclysmic reactor overload
    for (const m of u.models) {
      m.dead = true;
      m.wounds = 0;
    }
    u.status = 'destroyed';
  }
}

/**
 * Blood Pact Munitions: pay CP with self-inflicted wounds
 */
export function handleBloodPactSpend(s: GameState, u: UnitState, cpNeeded: number): boolean {
  if (!hasActiveKeystone(s, u.owner, 'blood_pact') && !hasActiveKeystone(s, u.owner, 'Blood Pact Munitions')) return false;

  const totalWoundsBurned = rollExpr(s, `${cpNeeded}d3`).total;
  log(s, `[BLOOD PACT MUNITIONS] ${u.name} sacrifices ${totalWoundsBurned} Wounds to fuel stratagems for 0 CP!`, 'info');

  applyMortalWounds(s, u, totalWoundsBurned, 'Blood Pact Munitions');
  addCombatToken(u, 'fervour', 3);
  return true;
}

/**
 * Start of turn keystone upkeep:
 * - Regenerate Warp Ward if undamaged
 * - Temporal Distortion buffs from round 4+
 */
export function processKeystoneTurnStart(s: GameState, player: PlayerId) {
  for (const u of boardUnits(s, player)) {
    const cs = ensureCombatState(u);

    // Warp Inoculation recharge
    if ((cs.maxWarpWardHP ?? 0) > 0 && (cs.warpWardHP ?? 0) < (cs.maxWarpWardHP ?? 0)) {
      cs.warpWardHP = cs.maxWarpWardHP ?? 0;
      log(s, `[WARP INOCULATION] ${u.name} Warp Ward fully recharged (${cs.warpWardHP}/${cs.maxWarpWardHP})`, 'info');
      pushFx(s, { kind: 'heal', unitId: u.id, owner: u.owner, at: centreOf(u), n: cs.warpWardHP ?? 0 });
    }

    // Temporal Distortion: from Round 4+, regenerate 2 Wounds to all models
    if (s.round >= 4 && (hasActiveKeystone(s, player, 'temporal_distortion') || hasActiveKeystone(s, player, 'Temporal Distortion'))) {
      for (const m of alive(u)) {
        if (m.wounds < m.profile.W) {
          m.wounds = Math.min(m.profile.W, m.wounds + 2);
        }
      }
    }
  }
}
