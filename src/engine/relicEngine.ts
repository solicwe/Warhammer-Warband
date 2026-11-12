// ============================================================================
// WARHAMMER WARBAND v2.0 — RELIC SOCKETS & TRIGGER PROCS ENGINE
// Skill & Support Gems, Socket Management, Mutators, and On-Event Procs
// ============================================================================

import { addCombatMods, type AttackContext, type CombatMods } from './combatMods';
import { applyAilment, applyMortalWounds, ensureCombatState, setTokenExpendHook } from './combatEngine';
import { d6, rollExpr } from './dice';
import { alive, boardUnits, centreOf, log, onBoard, other, pushFx } from './state';
import type { GameState, ModelState, RelicCategory, SocketedRelicCard, TriggerEventType, UnitState } from './types';

// ============================================================================
// 1. RELIC GEMS CATALOG (Mutators, Trigger Procs, Utility Auras)
// ============================================================================

export const SOCKETED_RELIC_CATALOG: Record<string, Omit<SocketedRelicCard, 'level' | 'isCorrupted'>> = {
  // --- Category 1: Keystone Mutator Relics ---
  gem_devastation: {
    id: 'gem_devastation',
    name: 'Core of Devastation',
    category: 'MUTATOR',
    grantedWeaponKeywords: ['DEVASTATING_WOUNDS'],
    description: 'Grants [DEVASTATING WOUNDS]. Lv.1: -1 Attacks. Lv.2: Normal Attacks. Lv.3: Devastating Wounds also inflict [Soulfire].',
  },
  gem_sustained: {
    id: 'gem_sustained',
    name: 'Echoing Chamber',
    category: 'MUTATOR',
    grantedWeaponKeywords: ['SUSTAINED_HITS'],
    description: 'Grants [SUSTAINED HITS 1] (Lv.2: [SUSTAINED HITS 2], Lv.3: Extra hits bounce to enemies within 6").',
  },
  gem_lethal: {
    id: 'gem_lethal',
    name: 'Bio-Acid Injector',
    category: 'MUTATOR',
    grantedWeaponKeywords: ['LETHAL_HITS'],
    triggerEvent: 'ON_CRIT_HIT',
    description: 'Grants [LETHAL HITS]. Critical Hits apply [Corroded] (1 / 2 / 3 stacks).',
  },
  gem_scatter: {
    id: 'gem_scatter',
    name: 'Fragmentation Splitter',
    category: 'MUTATOR',
    description: 'Ranged attacks increased by +50% / +75% / +100%, range halved, -1 Strength.',
  },
  gem_singularity: {
    id: 'gem_singularity',
    name: 'Graviton Condenser',
    category: 'MUTATOR',
    grantedWeaponKeywords: ['BLAST'],
    description: 'Concentrates fire: 1 attack per model, +50% Strength, +2 Damage. Lv.2: [BLAST]. Lv.3: Pulls nearby enemies 3".',
  },

  // --- Category 2: Trigger & Proc Relics ---
  proc_arc_lightning: {
    id: 'proc_arc_lightning',
    name: 'Tesla Arc Coil',
    category: 'TRIGGER_PROC',
    triggerEvent: 'ON_CRIT_HIT',
    procPayloadId: 'ARC_LIGHTNING',
    description: 'On Critical Hit: Unleashes chain lightning on nearby enemies for 1 / 2 / 3 hits at S4 AP-1 D1.',
  },
  proc_corpse_bloom: {
    id: 'proc_corpse_bloom',
    name: 'Volatile Spores / Detonator',
    category: 'TRIGGER_PROC',
    triggerEvent: 'ON_MODEL_KILL',
    procPayloadId: 'CORPSE_BLOOM',
    description: 'On Model Kill: Corpses explode on 4+ / 3+ / 2+, dealing 1 Mortal Wound to the target unit.',
  },
  proc_vampiric: {
    id: 'proc_vampiric',
    name: 'Haemovore Fang',
    category: 'TRIGGER_PROC',
    triggerEvent: 'ON_MELEE_KILL',
    procPayloadId: 'VAMPIRIC_HEAL',
    description: 'On Melee Kill: Regenerates 1 / 2 / 3 Wounds to bearer unit (or revives fallen models).',
  },
  proc_nova_shield: {
    id: 'proc_nova_shield',
    name: 'Reactive Aegis',
    category: 'TRIGGER_PROC',
    triggerEvent: 'ON_TOKEN_EXPEND',
    procPayloadId: 'NOVA_SHIELD',
    description: 'On Expending Bastion: 4" shockwave deals 1 / 2 / 3 Mortal Wounds to nearby enemies.',
  },
  proc_warp_step: {
    id: 'proc_warp_step',
    name: 'Flickerjump Module',
    category: 'TRIGGER_PROC',
    triggerEvent: 'ON_MELEE_KILL',
    procPayloadId: 'FLICKER_STEP',
    description: 'On Melee Kill wipe: Teleports bearer within 1" of another enemy within 9" (12" at Lv.3) and engages.',
  },

  // --- Category 3: Utility & Aura Relics ---
  util_gravity_well: {
    id: 'util_gravity_well',
    name: 'Null-Gravity Tether',
    category: 'UTILITY_AURA',
    description: 'Enemies within 6" / 8" / 10" cannot Fall Back and suffer -2" to Charge rolls.',
  },
  util_phase_cloak: {
    id: 'util_phase_cloak',
    name: 'Wraith-Slip Generator',
    category: 'UTILITY_AURA',
    description: 'Move through terrain and enemy models; moving over enemy applies 1 / 2 / 3 [Soulfire].',
  },
  util_autoloader: {
    id: 'util_autoloader',
    name: 'Munitorum Servitor-Link',
    category: 'UTILITY_AURA',
    description: '50% / 75% / 100% chance to gain +1 extra Auspex token; Overwatch hits on 4+ instead of 6+.',
  },
};

/**
 * Instantiate a SocketedRelicCard from definition ID and Level
 */
export function createSocketedRelic(id: string, level: 1 | 2 | 3 | 4 = 1, isCorrupted = false): SocketedRelicCard {
  const base = SOCKETED_RELIC_CATALOG[id] ?? {
    id,
    name: id,
    category: 'MUTATOR' as RelicCategory,
    description: 'Ancient artefact socketed into warrior harness.',
  };
  return {
    ...base,
    level,
    isCorrupted,
  };
}

// ============================================================================
// 2. SOCKET MANAGEMENT (Units & Gems)
// ============================================================================

/**
 * Get all socketed relic cards currently equipped on a unit.
 * Accounts for CONDUIT intrinsic link:
 * If a CONDUIT unit is attached or within 6", it shares its 1st relic to this unit!
 */
export function getUnitSocketedRelics(u: UnitState, s?: GameState): SocketedRelicCard[] {
  const ids = u.socketedRelics ?? [];
  const cards: SocketedRelicCard[] = ids.map((id) => {
    // Check if level is tracked in game state campaign
    const lvl = (s?.campaign?.relicLevels?.[id] as (1 | 2 | 3 | 4)) ?? 1;
    return createSocketedRelic(id, lvl);
  });

  // Check Conduit Command Link
  if (s && u.combatRole !== 'CONDUIT') {
    const pos = centreOf(u);
    for (const friend of boardUnits(s, u.owner)) {
      if (friend.id === u.id || friend.combatRole !== 'CONDUIT') continue;
      const fPos = centreOf(friend);
      if (Math.hypot(pos.x - fPos.x, pos.y - fPos.y) <= 6.0) {
        const conduitFirstRelicId = friend.socketedRelics?.[0];
        if (conduitFirstRelicId && !cards.some((c) => c.id === conduitFirstRelicId)) {
          const cLvl = (s.campaign?.relicLevels?.[conduitFirstRelicId] as (1 | 2 | 3 | 4)) ?? 1;
          cards.push(createSocketedRelic(conduitFirstRelicId, cLvl));
        }
        break; // Max 1 conduit aura link
      }
    }
  }

  return cards;
}

/** Socket a relic into a unit's available socket */
export function socketRelicToUnit(u: { socketedRelics?: string[]; maxSockets?: number }, relicId: string): boolean {
  u.socketedRelics ??= [];
  const cap = u.maxSockets ?? 2;
  if (u.socketedRelics.length < cap && !u.socketedRelics.includes(relicId)) {
    u.socketedRelics.push(relicId);
    return true;
  }
  return false;
}

/** Remove a relic from a unit's socket */
export function unsocketRelicFromUnit(u: { socketedRelics?: string[] }, relicId: string): boolean {
  if (!u.socketedRelics) return false;
  const idx = u.socketedRelics.indexOf(relicId);
  if (idx >= 0) {
    u.socketedRelics.splice(idx, 1);
    return true;
  }
  return false;
}

// ============================================================================
// 3. COMBAT MODS INTEGRATION (Mutator Gems)
// ============================================================================

export function registerRelicModifiers() {
  addCombatMods((ctx: AttackContext): CombatMods | null => {
    const { A, mode } = ctx;
    const cards = getUnitSocketedRelics(A);
    if (!cards.length) return null;

    const mods: CombatMods = { notes: [] };

    for (const relic of cards) {
      const lvl = relic.level;

      switch (relic.id) {
        case 'gem_devastation': {
          mods.devastating = true;
          if (lvl === 1) {
            mods.attacksBonus = (mods.attacksBonus ?? 0) - 1;
            mods.notes!.push('Core of Devastation: [DEVASTATING WOUNDS], -1 Atk');
          } else {
            mods.notes!.push(`Core of Devastation Lv.${lvl}: [DEVASTATING WOUNDS]`);
          }
          break;
        }

        case 'gem_sustained': {
          mods.sustained = lvl >= 2 ? '2' : '1';
          mods.notes!.push(`Echoing Chamber Lv.${lvl}: [SUSTAINED HITS ${lvl >= 2 ? '2' : '1'}]`);
          break;
        }

        case 'gem_lethal': {
          mods.lethal = true;
          mods.notes!.push(`Bio-Acid Injector Lv.${lvl}: [LETHAL HITS]`);
          break;
        }

        case 'gem_scatter': {
          if (mode === 'ranged') {
            const extraAttacks = lvl;
            mods.attacksBonus = (mods.attacksBonus ?? 0) + extraAttacks;
            mods.strengthBonus = (mods.strengthBonus ?? 0) - 1;
            mods.notes!.push(`Fragmentation Splitter: +${extraAttacks} Attacks, -1 Str`);
          }
          break;
        }

        case 'gem_singularity': {
          if (mode === 'ranged') {
            mods.strengthBonus = (mods.strengthBonus ?? 0) + 2;
            mods.damageBonus = (mods.damageBonus ?? 0) + 2;
            mods.notes!.push(`Graviton Condenser: Concentrated Blast (+2S, +2D)`);
          }
          break;
        }
      }
    }

    return Object.keys(mods).length > 1 ? mods : null;
  });
}

// Auto-register combat mods
registerRelicModifiers();

// ============================================================================
// 4. TRIGGER & PROC ENGINE (On Event Handlers)
// ============================================================================

/**
 * Central event trigger dispatcher for relic procs:
 * Detects ON_CRIT_HIT, ON_MODEL_KILL, ON_MELEE_KILL, ON_CHARGE_COMPLETE, ON_TOKEN_EXPEND
 */
export function triggerRelicEvent(
  s: GameState,
  event: TriggerEventType,
  sourceUnit: UnitState,
  targetUnit?: UnitState,
  data?: { critCount?: number; killedModelsCount?: number; tokenKind?: string }
) {
  if (!onBoard(sourceUnit)) return;
  const relics = getUnitSocketedRelics(sourceUnit, s);
  const matching = relics.filter((r) => r.triggerEvent === event || (event === 'ON_MELEE_KILL' && r.triggerEvent === 'ON_MODEL_KILL'));

  for (const relic of matching) {
    const lvl = relic.level;
    const pos = centreOf(sourceUnit);

    switch (relic.id) {
      // 1. Arc Lightning on Critical Hit
      case 'proc_arc_lightning': {
        if (!targetUnit) break;
        const hits = lvl; // 1 / 2 / 3 hits
        const tPos = centreOf(targetUnit);

        // Find another enemy within 6" of target
        const nearbyFoes = boardUnits(s, other(sourceUnit.owner)).filter(
          (u) => u.id !== targetUnit.id && Math.hypot(tPos.x - centreOf(u).x, tPos.y - centreOf(u).y) <= 6.0
        );
        const arcTarget = nearbyFoes.length > 0 ? nearbyFoes[0] : targetUnit;

        log(s, `[TESLA ARC COIL] Critical Hit arcs lightning into ${arcTarget.name}! (${hits} hits S4 AP-1 D1)`, 'info');
        pushFx(s, {
          kind: 'skill',
          unitId: sourceUnit.id,
          owner: sourceUnit.owner,
          at: centreOf(arcTarget),
          name: 'ARC LIGHTNING',
          who: sourceUnit.name,
          style: 'tech',
          epic: false,
        });
        applyMortalWounds(s, arcTarget, hits, 'Tesla Arc Coil');
        break;
      }

      // 2. Corroded application on Bio-Acid Crit Hit
      case 'gem_lethal': {
        if (targetUnit) {
          const stacks = lvl;
          log(s, `[BIO-ACID INJECTOR] Acid seeps into wounds: +${stacks} [Corroded]!`, 'info');
          applyAilment(s, targetUnit, 'corroded', stacks);
        }
        break;
      }

      // 3. Corpse Bloom on Model Kill
      case 'proc_corpse_bloom': {
        if (!targetUnit) break;
        const kills = data?.killedModelsCount ?? 1;
        const threshold = lvl === 1 ? 4 : lvl === 2 ? 3 : 2;
        let bloomMortal = 0;

        for (let i = 0; i < kills; i++) {
          const roll = d6(s);
          if (roll >= threshold) bloomMortal++;
        }

        if (bloomMortal > 0) {
          log(s, `[VOLATILE DETONATOR] Enemy corpses detonate for ${bloomMortal} Mortal Wound(s)!`, 'info');
          pushFx(s, { kind: 'explosion', at: centreOf(targetUnit), range: 3, radius: 3, hits: bloomMortal, title: 'CORPSE BLOOM' });
          applyMortalWounds(s, targetUnit, bloomMortal, 'Volatile Detonator');
        }
        break;
      }

      // 4. Vampiric Heal on Melee Kill
      case 'proc_vampiric': {
        const healAmt = lvl;
        let healed = 0;
        for (const m of alive(sourceUnit)) {
          if (m.wounds < m.profile.W && healed < healAmt) {
            const need = m.profile.W - m.wounds;
            const h = Math.min(need, healAmt - healed);
            m.wounds += h;
            healed += h;
          }
        }

        // Revive dead model if all alive are full and heal capacity remains
        if (healed < healAmt) {
          const deadModels = sourceUnit.models.filter((m) => m.dead);
          if (deadModels.length > 0) {
            const revived = deadModels[0];
            revived.dead = false;
            revived.wounds = Math.min(revived.profile.W, healAmt - healed);
            healed += revived.wounds;
            log(s, `[HAEMOVORE FANG] Vampiric essence revives fallen warrior ${revived.name}!`, 'info');
            pushFx(s, { kind: 'heal', unitId: sourceUnit.id, owner: sourceUnit.owner, at: pos, n: revived.wounds, revive: true });
          }
        }

        if (healed > 0) {
          log(s, `[HAEMOVORE FANG] ${sourceUnit.name} siphons life: +${healed} Wound(s) restored`, 'info');
          pushFx(s, { kind: 'heal', unitId: sourceUnit.id, owner: sourceUnit.owner, at: pos, n: healed });
        }
        break;
      }

      // 5. Nova Shield on Expending Bastion
      case 'proc_nova_shield': {
        if (data?.tokenKind === 'bastion') {
          const mw = lvl;
          log(s, `[REACTIVE AEGIS] Bastion discharge triggers 4" kinetic shockwave (${mw} MW)!`, 'info');
          pushFx(s, { kind: 'explosion', at: pos, range: 4, radius: 4, hits: mw, title: 'REACTIVE AEGIS' });
          for (const foe of boardUnits(s, other(sourceUnit.owner))) {
            const fPos = centreOf(foe);
            if (Math.hypot(pos.x - fPos.x, pos.y - fPos.y) <= 4.0) {
              applyMortalWounds(s, foe, mw, 'Reactive Aegis');
            }
          }
        }
        break;
      }

      // 6. Flickerjump on Melee Wipe
      case 'proc_warp_step': {
        if (targetUnit && !alive(targetUnit).length) {
          const maxDist = lvl >= 3 ? 12.0 : 9.0;
          const otherFoes = boardUnits(s, other(sourceUnit.owner)).filter((u) => u.id !== targetUnit.id);
          let nearestFoe: UnitState | null = null;
          let nearestDist = maxDist;

          for (const foe of otherFoes) {
            const fPos = centreOf(foe);
            const d = Math.hypot(pos.x - fPos.x, pos.y - fPos.y);
            if (d <= nearestDist) {
              nearestDist = d;
              nearestFoe = foe;
            }
          }

          if (nearestFoe) {
            const dest = centreOf(nearestFoe);
            // Teleport models around target
            for (const m of alive(sourceUnit)) {
              m.x = dest.x + (Math.random() - 0.5) * 1.5;
              m.y = dest.y + (Math.random() - 0.5) * 1.5;
            }
            log(s, `[FLICKERJUMP MODULE] ${sourceUnit.name} flickers across reality to engage ${nearestFoe.name} (${nearestDist.toFixed(1)}")!`, 'info');
            pushFx(s, {
              kind: 'place',
              unitId: sourceUnit.id,
              owner: sourceUnit.owner,
              at: dest,
              deepStrike: true,
              label: 'FLICKERJUMP',
            });
          }
        }
        break;
      }
    }
  }
}

// Hook token expenditure to trigger relics (e.g. proc_nova_shield)
setTokenExpendHook((s, u, token) => {
  triggerRelicEvent(s, 'ON_TOKEN_EXPEND', u, undefined, { tokenKind: token });
});
