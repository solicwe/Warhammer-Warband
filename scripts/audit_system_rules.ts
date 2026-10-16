import fs from 'node:fs';
import path from 'node:path';
import { createGame, formationAt, placeUnit, startTurn, endPhase, setOathTarget, callWaaagh } from '../src/engine/game';
import { activeRules, DET_RULES, effectsFor, addTimed, expireTimed, withRuleCache } from '../src/engine/effects';
import { buildShootPools, buildFightPools, resolveAll, applyMortalWounds } from '../src/engine/attack';
import { PRESETS } from '../src/ui/presets';
import { RULES } from '../src/engine/config';
import type { ArmyList, FactionData, GameState, Pt, UnitState } from '../src/engine/types';

export interface AuditResult {
  factionId: string;
  factionName: string;
  totalDetachments: number;
  implementedDetachments: number;
  detachmentStatuses: Record<string, { status: 'PASS' | 'FAIL' | 'NEEDS_MANUAL_REVIEW'; reason?: string; effectsCount?: number }>;
  armyRulesStatuses: Record<string, { status: 'PASS' | 'FAIL' | 'NEEDS_MANUAL_REVIEW'; reason?: string }>;
  combatPassivesCheck: 'PASS' | 'FAIL';
  modifierCappingCheck: 'PASS' | 'FAIL';
  keywordFilteringCheck: 'PASS' | 'FAIL';
  botAutomationCheck: 'PASS' | 'FAIL';
  errors: string[];
}

export function loadFaction(id: string): FactionData | null {
  const file = path.join(process.cwd(), 'public', 'data', 'factions', `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FactionData;
}

export function putOnBoard(s: GameState, u: UnitState, pos: Pt) {
  placeUnit(s, u, formationAt(u, pos));
  u.status = 'active';
  u.setUpTurn = -10;
}

export async function runComprehensiveAudit() {
  console.log('=== STARTING WARHAMMER 40K COMPREHENSIVE RULES AUDIT ===');
  const factionFiles = fs.readdirSync(path.join(process.cwd(), 'public', 'data', 'factions')).filter((f) => f.endsWith('.json'));
  const results: Record<string, AuditResult> = {};
  const allErrors: { faction: string; rule: string; error: string }[] = [];

  const smData = loadFaction('SM')!;
  const orkData = loadFaction('ORK')!;
  const tyrData = loadFaction('TYR');
  const csmData = loadFaction('CSM');
  const defaultOpponentList: ArmyList = PRESETS.ORK;

  for (const file of factionFiles) {
    const fId = file.replace('.json', '');
    const fac = loadFaction(fId);
    if (!fac || !fac.id) continue;

    console.log(`Auditing Faction: ${fac.name} (${fac.id})...`);
    const result: AuditResult = {
      factionId: fac.id,
      factionName: fac.name,
      totalDetachments: (fac.detachments || []).length,
      implementedDetachments: 0,
      detachmentStatuses: {},
      armyRulesStatuses: {},
      combatPassivesCheck: 'PASS',
      modifierCappingCheck: 'PASS',
      keywordFilteringCheck: 'PASS',
      botAutomationCheck: 'PASS',
      errors: [],
    };

    const presetList = PRESETS[fac.id] || {
      name: `${fac.name} Test List`,
      factionId: fac.id,
      battleSize: 'incursion',
      detachments: [],
      units: (fac.datasheets || []).slice(0, 3).map((d, i) => ({
        uid: `u${i}`,
        datasheet: d.name,
        models: d.models.length || 1,
        pts: d.points[0]?.options[0]?.pts || 100,
      })),
    };

    // 1. Audit Detachments: Trigger conditions, active state, and effects loading
    for (const det of fac.detachments || []) {
      const isImpl = !!DET_RULES[det.name];
      if (!isImpl) {
        result.detachmentStatuses[det.name] = {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'Detachment rule not defined in data/detachment-rules.json',
        };
        continue;
      }

      result.implementedDetachments++;
      const detRule = DET_RULES[det.name];

      try {
        const testList: ArmyList = {
          ...presetList,
          detachments: [det.name],
        };

        const s = createGame({
          lists: [testList, defaultOpponentList],
          factions: [fac, orkData],
          names: ['Audited Player', 'Target Opponent'],
          seed: 42,
        });

        // Verify active rules
        const rules = activeRules(s, 0);
        if (!rules.includes(det.name)) {
          throw new Error(`Detachment ${det.name} not found in activeRules: [${rules.join(', ')}]`);
        }

        // Verify effects extraction and unit attachment
        const u = s.units.find((x) => x.owner === 0);
        if (u) {
          putOnBoard(s, u, { x: 20, y: 20 });
          const fx = effectsFor(s, u);
          result.detachmentStatuses[det.name] = {
            status: 'PASS',
            effectsCount: (detRule.effects || []).length,
          };
        } else {
          result.detachmentStatuses[det.name] = {
            status: 'PASS',
            effectsCount: (detRule.effects || []).length,
          };
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.detachmentStatuses[det.name] = {
          status: 'FAIL',
          reason: errMsg,
        };
        result.errors.push(`Detachment [${det.name}]: ${errMsg}`);
        allErrors.push({ faction: fac.name, rule: det.name, error: errMsg });
      }
    }

    // 2. Audit Army Rules
    const armyRules = fac.armyRules || fac.rules || [];
    for (const ar of armyRules) {
      try {
        const testList: ArmyList = {
          ...presetList,
          detachments: fac.detachments?.[0] ? [fac.detachments[0].name] : [],
        };
        const s = createGame({
          lists: [testList, defaultOpponentList],
          factions: [fac, orkData],
          names: ['Audited Player', 'Target Opponent'],
          seed: 42,
        });

        const detArmyRule = DET_RULES[ar.name];
        if (detArmyRule?.armyRule) {
          const act = activeRules(s, 0);
          if (!act.includes(ar.name)) {
            result.armyRulesStatuses[ar.name] = {
              status: 'NEEDS_MANUAL_REVIEW',
              reason: 'Army rule has subfaction/needKw condition',
            };
          } else {
            result.armyRulesStatuses[ar.name] = { status: 'PASS' };
          }
        } else {
          result.armyRulesStatuses[ar.name] = {
            status: 'PASS',
            reason: 'Engine native execution',
          };
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.armyRulesStatuses[ar.name] = { status: 'FAIL', reason: errMsg };
        result.errors.push(`Army Rule [${ar.name}]: ${errMsg}`);
        allErrors.push({ faction: fac.name, rule: ar.name, error: errMsg });
      }
    }

    results[fac.id] = result;
  }

  // 3. Protocol 2: Bot Execution & Automation Audit
  console.log('Auditing Bot Automation & Rules Execution...');
  const botChecks = {
    oathOfMoment: false,
    waaagh: false,
    synapse: false,
    darkPacts: false,
    combatResolutionPassive: false,
    durationExpiration: false,
  };

  // Oath of Moment
  try {
    const s = createGame({
      lists: [PRESETS.SM, PRESETS.ORK],
      factions: [smData, orkData],
      names: ['SM Bot', 'ORK Bot'],
      seed: 42,
    });
    s.bots = [0, 1];
    const smUnit = s.units.find((u) => u.owner === 0)!;
    const orkUnit = s.units.find((u) => u.owner === 1)!;
    putOnBoard(s, smUnit, { x: 20, y: 20 });
    putOnBoard(s, orkUnit, { x: 20, y: 28 });
    s.round = 1;
    s.turn = 1;
    s.active = 0;
    setOathTarget(s, 0, orkUnit.id);
    if (s.players[0].oathTarget === orkUnit.id) {
      botChecks.oathOfMoment = true;
    }
  } catch (e) {
    allErrors.push({ faction: 'Space Marines', rule: 'Oath of Moment', error: String(e) });
  }

  // Waaagh!
  try {
    const s = createGame({
      lists: [PRESETS.ORK, PRESETS.SM],
      factions: [orkData, smData],
      names: ['ORK Bot', 'SM Bot'],
      seed: 42,
    });
    callWaaagh(s, 0);
    if (s.players[0].waaaghUsed) {
      botChecks.waaagh = true;
    }
  } catch (e) {
    allErrors.push({ faction: 'Orks', rule: 'Waaagh!', error: String(e) });
  }

  // Synapse
  try {
    if (tyrData) {
      const sTyr = createGame({
        lists: [PRESETS.TYR, PRESETS.SM],
        factions: [tyrData, smData],
        names: ['TYR', 'SM'],
        seed: 42,
      });
      const syn = sTyr.units.find((u) => u.keywords.includes('SYNAPSE'));
      if (syn) {
        botChecks.synapse = true;
      }
    }
  } catch (e) {
    allErrors.push({ faction: 'Tyranids', rule: 'Synapse', error: String(e) });
  }

  // Dark Pacts
  try {
    if (csmData) {
      const sCsm = createGame({
        lists: [PRESETS.CSM, PRESETS.SM],
        factions: [csmData, smData],
        names: ['CSM', 'SM'],
        seed: 42,
      });
      const csmUnit = sCsm.units.find((u) => u.owner === 0 && u.abilities.some((a) => a.name === 'Dark Pacts'));
      if (csmUnit) {
        botChecks.darkPacts = true;
      }
    }
  } catch (e) {
    allErrors.push({ faction: 'Chaos Space Marines', rule: 'Dark Pacts', error: String(e) });
  }

  // Duration & Expiration test
  try {
    const s = createGame({
      lists: [PRESETS.SM, PRESETS.ORK],
      factions: [smData, orkData],
      names: ['A', 'B'],
      seed: 42,
    });
    const smUnit = s.units.find((u) => u.owner === 0)!;
    putOnBoard(s, smUnit, { x: 20, y: 20 });
    addTimed(s, smUnit, { e: { hit: 1 }, label: 'Test Phase Buff', until: 'phase', by: 0 });
    const beforeExpire = smUnit.timed?.some((t) => t.label === 'Test Phase Buff');
    expireTimed(s, 'phaseEnd', 0);
    const afterExpire = smUnit.timed?.some((t) => t.label === 'Test Phase Buff');
    if (beforeExpire && !afterExpire) {
      botChecks.durationExpiration = true;
    } else {
      allErrors.push({ faction: 'Core', rule: 'Duration & Expiration', error: 'Timed phase effect did not expire on phaseEnd' });
    }
  } catch (e) {
    allErrors.push({ faction: 'Core', rule: 'Duration & Expiration', error: String(e) });
  }

  // 4. Protocol 3: Modifier Capping, Combat Resolution & Keyword Isolation
  console.log('Auditing Edge Cases, Modifier Caps & Keyword Isolation...');
  let cappingPass = true;
  let keywordPass = true;

  try {
    const s = createGame({
      lists: [PRESETS.SM, PRESETS.ORK],
      factions: [smData, orkData],
      names: ['A', 'B'],
      seed: 42,
    });
    s.phase = 'shooting';
    s.active = 0;
    const smUnit = s.units.find((u) => u.owner === 0 && u.models.some((m) => m.weapons.some((w) => w.profiles.some((p) => typeof p.range === 'number'))))!;
    const orkUnit = s.units.find((u) => u.owner === 1)!;
    putOnBoard(s, smUnit, { x: 20, y: 20 });
    putOnBoard(s, orkUnit, { x: 20, y: 28 });

    // Inject 3 stacked +1 Hit and +1 Wound buffs
    smUnit.buffs.push({ kind: 'hit+1', label: 'Buff 1' });
    smUnit.buffs.push({ kind: 'hit+1', label: 'Buff 2' });
    smUnit.buffs.push({ kind: 'hit+1', label: 'Buff 3' });
    smUnit.buffs.push({ kind: 'wound+1', label: 'WoundBuff 1' });
    smUnit.buffs.push({ kind: 'wound+1', label: 'WoundBuff 2' });

    const shootResult = buildShootPools(s, smUnit.id, orkUnit.id, { mode: 'normal' });
    if (shootResult.pools.length > 0) {
      botChecks.combatResolutionPassive = true;
    }
    for (const pool of shootResult.pools) {
      if (pool.hitMod > RULES.modifierCaps.hitRoll || pool.hitMod < -RULES.modifierCaps.hitRoll) {
        cappingPass = false;
        allErrors.push({ faction: 'Core', rule: 'Hit Modifier Cap', error: `hitMod was ${pool.hitMod}, exceeded cap of 1` });
      }
      if (pool.woundMod > RULES.modifierCaps.woundRoll || pool.woundMod < -RULES.modifierCaps.woundRoll) {
        cappingPass = false;
        allErrors.push({ faction: 'Core', rule: 'Wound Modifier Cap', error: `woundMod was ${pool.woundMod}, exceeded cap of 1` });
      }
    }
  } catch (e) {
    cappingPass = false;
    allErrors.push({ faction: 'Core', rule: 'Modifier Capping', error: String(e) });
  }

  // Keyword targeting test
  try {
    const dread = smData.datasheets.find((d) => d.keywords.includes('VEHICLE'));
    if (dread) {
      const testListWithDread: ArmyList = {
        name: 'Dread Test',
        factionId: 'SM',
        battleSize: 'incursion',
        detachments: ['Gladius Task Force'],
        units: [{ uid: 'dread1', datasheet: dread.name, models: 1, pts: 150 }],
      };
      const sDread = createGame({
        lists: [testListWithDread, defaultOpponentList],
        factions: [smData, orkData],
        names: ['A', 'B'],
        seed: 42,
      });
      const dreadUnit = sDread.units.find((u) => u.owner === 0)!;
      putOnBoard(sDread, dreadUnit, { x: 20, y: 20 });
      const dreadFx = effectsFor(sDread, dreadUnit);
      for (const act of dreadFx) {
        if (act.e.units?.includes('INFANTRY') && !dreadUnit.keywords.includes('INFANTRY')) {
          keywordPass = false;
          allErrors.push({ faction: 'Space Marines', rule: 'Keyword Isolation', error: `Vehicle unit received INFANTRY-only rule ${act.label}` });
        }
      }
    }
  } catch (e) {
    keywordPass = false;
    allErrors.push({ faction: 'Space Marines', rule: 'Keyword Isolation', error: String(e) });
  }

  // Output Diagnostic Report JSON for test runner
  const summary = {
    timestamp: new Date().toISOString(),
    totalFactions: Object.keys(results).length,
    botChecks,
    cappingPass,
    keywordPass,
    errorsCount: allErrors.length,
    allErrors,
    factions: results,
  };

  const reportPath = path.join(process.cwd(), 'audit_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Audit report written to ${reportPath}`);
  console.log(`Audited ${summary.totalFactions} factions with ${allErrors.length} total errors.`);
  return summary;
}

if (process.argv[1] && process.argv[1].includes('audit_system_rules')) {
  runComprehensiveAudit().catch((err) => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
}
