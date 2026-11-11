// ============================================================================
// WARHAMMER WARBAND v2.0 — DYNAMIC BATTLEFIELD ANOMALIES (PoE League Mechanics)
// In-Battle Warp Breaches, Archeotech Shrines, Eldritch Altars & Environmental Hazards
// ============================================================================

import { addTimed } from '../rules-engine/effects';
import { applyAilment, applyMortalWounds } from './combatEngine';
import { d6, rollExpr } from './dice';
import { baseDist } from './geometry';
import { alive, boardUnits, centreOf, log, onBoard, other, pushFx } from './state';
import type { BattlefieldAnomaly, GameState, PlayerId, Pt, UnitState } from './types';

/**
 * Spawns 1-2 Dynamic Anomalies across the battlefield during battle setup.
 */
export function spawnBattlefieldAnomalies(s: GameState) {
  s.anomalies = [];
  const width = s.table?.width ?? 44;
  const height = s.table?.height ?? 30;

  // Anomaly 1: Archeotech Shrine or Promethium Hazard near centre
  const type1: BattlefieldAnomaly['type'] = Math.random() < 0.5 ? 'ARCHEOTECH_SHRINE' : 'PROMETHIUM_HAZARD';
  const pos1: Pt = {
    x: width * 0.5 + (Math.random() - 0.5) * 8,
    y: height * 0.5 + (Math.random() - 0.5) * 6,
  };

  s.anomalies.push({
    id: `anomaly-1-${type1.toLowerCase()}`,
    type: type1,
    position: pos1,
    radius: 3.0,
    triggered: false,
    activeRound: 1,
    effectPayload: {
      shrineBuff: type1 === 'ARCHEOTECH_SHRINE' ? (Math.random() < 0.5 ? 'LIGHTNING' : 'GOLIATH') : undefined,
    },
  });

  // Anomaly 2: Warp Breach or Eldritch Altar that awakens in Round 2
  const type2: BattlefieldAnomaly['type'] = Math.random() < 0.5 ? 'WARP_BREACH' : 'ELDRITCH_ALTAR';
  const pos2: Pt = {
    x: width * 0.35 + (Math.random() - 0.5) * 10,
    y: height * 0.65 + (Math.random() - 0.5) * 8,
  };

  s.anomalies.push({
    id: `anomaly-2-${type2.toLowerCase()}`,
    type: type2,
    position: pos2,
    radius: 4.0,
    triggered: false,
    activeRound: 2,
    effectPayload: {
      altarRisk: '+2 Attacks to Enemies',
      altarReward: '+150 Scrap & Epic Relic',
    },
  });

  log(s, `[ANOMALIES DETECTED] ${type1} and ${type2} detected on the battlefield!`, 'info');
}

/**
 * Check if a unit's movement triggers any nearby anomaly
 */
export function checkAnomalyTriggers(s: GameState, u: UnitState) {
  if (!s.anomalies?.length || !onBoard(u)) return;
  const uPos = centreOf(u);

  for (const anomaly of s.anomalies) {
    if (anomaly.triggered) continue;
    if (s.round < anomaly.activeRound) continue;

    const dist = Math.hypot(uPos.x - anomaly.position.x, uPos.y - anomaly.position.y);
    if (dist <= anomaly.radius) {
      triggerAnomaly(s, anomaly, u);
    }
  }
}

/**
 * Execute the trigger effect of an anomaly
 */
export function triggerAnomaly(s: GameState, anomaly: BattlefieldAnomaly, triggeringUnit: UnitState) {
  anomaly.triggered = true;
  const pos = anomaly.position;

  switch (anomaly.type) {
    case 'ARCHEOTECH_SHRINE': {
      const buff = anomaly.effectPayload?.shrineBuff ?? 'LIGHTNING';
      if (buff === 'LIGHTNING') {
        log(s, `[ARCHEOTECH SHRINE] ${triggeringUnit.name} touches Lightning Shrine! Arc coils supercharged for 2 turns!`, 'info');
        pushFx(s, { kind: 'skill', unitId: triggeringUnit.id, owner: triggeringUnit.owner, at: pos, name: 'LIGHTNING SHRINE', who: triggeringUnit.name, style: 'tech', epic: true });
        addTimed(s, triggeringUnit, {
          e: { attacks: 1, strength: 1 },
          label: 'Lightning Shrine (+1 Attack, +1 Str)',
          until: 'battle',
          by: triggeringUnit.owner,
        });
      } else {
        log(s, `[ARCHEOTECH SHRINE] ${triggeringUnit.name} touches Goliath Shrine! +1 Toughness and +2 Wounds!`, 'info');
        pushFx(s, { kind: 'skill', unitId: triggeringUnit.id, owner: triggeringUnit.owner, at: pos, name: 'GOLIATH SHRINE', who: triggeringUnit.name, style: 'shield', epic: true });
        for (const m of alive(triggeringUnit)) {
          m.profile.T += 1;
          m.wounds += 2;
          m.profile.W += 2;
        }
      }
      break;
    }

    case 'WARP_BREACH': {
      log(s, `[WARP RIFT BREACH] Reality shatters! Warp Breach opens, yielding Warp Shards! (+60 Scrap)`, 'info');
      pushFx(s, { kind: 'explosion', at: pos, range: 6, radius: 6, hits: 2, title: 'WARP BREACH' });
      s.campaignScrap = (s.campaignScrap ?? 0) + 60;
      s.screenShake = 1;
      // All enemy units within 6" take 1d3 MW from warp shock
      for (const foe of boardUnits(s, other(triggeringUnit.owner))) {
        if (Math.hypot(pos.x - centreOf(foe).x, pos.y - centreOf(foe).y) <= 6.0) {
          const mw = rollExpr(s, '1d3').total;
          applyMortalWounds(s, foe, mw, 'Warp Breach Shock');
        }
      }
      break;
    }

    case 'ELDRITCH_ALTAR': {
      log(s, `[ELDRITCH WAR-ALTAR] Dark pact sealed: enemies enraged, but +120 Salvage Scrap harvested!`, 'info');
      pushFx(s, { kind: 'skill', unitId: triggeringUnit.id, owner: triggeringUnit.owner, at: pos, name: 'ELDRITCH ALTAR', who: triggeringUnit.name, style: 'chaos', epic: true });
      s.campaignScrap = (s.campaignScrap ?? 0) + 120;
      break;
    }

    case 'PROMETHIUM_HAZARD': {
      log(s, `[PROMETHIUM LEAK] Promethium line ruptured! Spreading [Soulfire] across the sector!`, 'info');
      pushFx(s, { kind: 'explosion', at: pos, range: 5, radius: 5, hits: 1, title: 'PROMETHIUM FIRE' });
      for (const target of boardUnits(s)) {
        if (Math.hypot(pos.x - centreOf(target).x, pos.y - centreOf(target).y) <= 5.0) {
          applyAilment(s, target, 'soulfire', 2);
        }
      }
      break;
    }
  }
}
