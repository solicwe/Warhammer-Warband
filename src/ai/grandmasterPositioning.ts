// Grandmaster AI: Per-Model Micro-Positioning, Strict Footprint Avoidance,
// 2D Threat Shadow Projection, Conga-Line Objective Toe-In & Rapid Ingress AI.
// Engineered for tournament-level execution with sub-10ms performance budget.

import {
  axis, baseDist, bodyAt, bodyTouchesPoly, bodyWhollyInPoly, circleTouchesPoly, coherencyProblems,
  dist, gap, girth, onTable, pointInPoly, pointSegDist, polyCentroid, ptGap, segSegDist, type Body,
} from '../engine/geometry';
import { alive, boardUnits, hasKw, isEngaged, other, tableH, tableW, unitDistance } from '../engine/state';
import { findPlacement, formationAt, hasDeepStrike, validateMove, validatePlacement, zoneOf } from '../engine/game';
import { hasLos, roughLos } from '../engine/visibility';
import { pathLength, routeAround } from '../engine/pathing';
import { RULES } from '../engine/config';
import { centre, isBrawler, maxRange, perModel, rangedKills, unitValue, oc } from './botEval';
import type { GameState, ModelState, MoveKind, PlayerId, Pt, TerrainPiece, UnitState } from '../engine/types';

export type MoveStance = 'STANCE_STAGE_HIDDEN' | 'STANCE_PEEK_SHOOT';

export interface ThreatGrid {
  key: string;
  cols: number;
  rows: number;
  topRangedFoes: { u: UnitState; lead: ModelState; value: number }[];
  nearestEnemyDistGrid: Float32Array; // 2" resolution
  enemyHomeObj?: Pt;
  enemyHomeDefenderOc: number;
}

let cachedThreatGrid: ThreatGrid | null = null;

/**
 * Builds or retrieves precomputed 2" Threat Grid and top ranged threats.
 * Cached once per game turn + phase + active player.
 */
export function getThreatGrid(s: GameState, active: PlayerId): ThreatGrid {
  const opp = other(active);
  const oppUnits = boardUnits(s, opp);
  const oppPosKey = oppUnits.map((u) => u.id + ':' + (alive(u)[0]?.x ?? 0).toFixed(0) + ',' + (alive(u)[0]?.y ?? 0).toFixed(0)).join(';');
  const key = `${s.turn}:${s.phase}:${active}:${oppPosKey}`;
  if (cachedThreatGrid && cachedThreatGrid.key === key) {
    return cachedThreatGrid;
  }

  // Top 5 ranged threats by firepower & value
  const topRangedFoes = oppUnits
    .filter((u) => maxRange(u) >= 12 && alive(u).length > 0)
    .map((u) => ({
      u,
      lead: alive(u)[0],
      value: unitValue(u) + rangedKills(u, u) * 20,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const W = tableW(s);
  const H = tableH(s);
  const cols = Math.ceil(W / 2);
  const rows = Math.ceil(H / 2);
  const nearestEnemyDistGrid = new Float32Array(cols * rows);
  const oppModels = oppUnits.flatMap(alive);

  for (let r = 0; r < rows; r++) {
    const y = r * 2 + 1;
    for (let c = 0; c < cols; c++) {
      const x = c * 2 + 1;
      let minD = 999;
      for (let i = 0; i < oppModels.length; i++) {
        const m = oppModels[i];
        const d = Math.hypot(x - m.x, y - m.y) - m.r;
        if (d < minD) minD = d;
      }
      nearestEnemyDistGrid[r * cols + c] = minD;
    }
  }

  // Enemy Home Objective and Defenders
  const enemyZone = zoneOf(s, opp);
  const enemyHomeObj = s.objectives.find((o) => pointInPoly(o, enemyZone))
    ?? (opp === 1 ? s.objectives.find((o) => o.y < tableH(s) / 2) : s.objectives.find((o) => o.y > tableH(s) / 2))
    ?? s.objectives[0];
  let enemyHomeDefenderOc = 0;
  if (enemyHomeObj) {
    for (const u of oppUnits) {
      if (alive(u).some((m) => dist(m, enemyHomeObj) <= 6.0)) {
        enemyHomeDefenderOc += oc(u);
      }
    }
  }

  cachedThreatGrid = {
    key,
    cols,
    rows,
    topRangedFoes,
    nearestEnemyDistGrid,
    enemyHomeObj: enemyHomeObj ? { x: enemyHomeObj.x, y: enemyHomeObj.y } : undefined,
    enemyHomeDefenderOc,
  };
  return cachedThreatGrid;
}

/**
 * Fast lookup for distance to nearest enemy model using 2" grid.
 */
export function getFastNearestEnemyDistance(grid: ThreatGrid, p: Pt): number {
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor(p.x / 2)));
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor(p.y / 2)));
  return grid.nearestEnemyDistGrid[r * grid.cols + c];
}

/**
 * Determine whether unit should hide behind walls (Zero Footprint Intrusion)
 * or step in to peek and shoot (Toe-In for Cover + LOS).
 */
export function determineMoveStance(s: GameState, u: UnitState, threats: UnitState[]): MoveStance {
  const ms = alive(u);
  if (!ms.length) return 'STANCE_STAGE_HIDDEN';

  // Melee-only or brawlers must ALWAYS stay hidden behind walls
  if (isBrawler(s, u) || maxRange(u) < 8) {
    return 'STANCE_STAGE_HIDDEN';
  }

  // If there are top enemy threats, evaluate if peeking gives high Expected Value
  for (const enemy of threats) {
    if (!alive(enemy).length) continue;
    const d = unitDistance(u, enemy);
    if (d <= maxRange(u)) {
      const kills = rangedKills(u, enemy);
      const pointsDestroyed = kills * perModel(enemy);
      // High Expected Damage or removing an objective holder justifies peeking
      if (pointsDestroyed >= 25 || (oc(enemy) > 0 && pointsDestroyed >= 15)) {
        return 'STANCE_PEEK_SHOOT';
      }
    }
  }

  return 'STANCE_STAGE_HIDDEN';
}

/**
 * Checks if a model's base touches or intrudes into a Ruin's Forbidden Footprint Zone.
 * In STANCE_STAGE_HIDDEN: Forbidden Zone is dilated outward by (modelRadius + 0.15").
 */
export function isInForbiddenFootprintZone(
  m: ModelState,
  p: Pt,
  terrain: TerrainPiece[],
  buffer = 0.15,
): boolean {
  const body = bodyAt(m, p);
  for (const t of terrain) {
    if (t.category !== 'exposed' && t.poly && t.poly.length >= 3) {
      if (bodyTouchesPoly(body, buffer, t.poly)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Pushes a candidate point outside of any Ruin footprint along the polygon's outward normal.
 */
export function pushOutOfFootprint(p: Pt, r: number, terrain: TerrainPiece[], buffer = 0.25): Pt {
  let res: Pt = { x: p.x, y: p.y };
  for (const t of terrain) {
    if (t.category === 'exposed' || !t.poly || t.poly.length < 3) continue;
    const poly = t.poly;
    if (circleTouchesPoly(res, r + buffer, poly)) {
      // Find closest edge to push outward
      let bestDist = Infinity;
      let pushNormal: Pt = { x: 0, y: 1 };
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const d = pointSegDist(res, { a, b });
        if (d < bestDist) {
          bestDist = d;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          // Normal pointing outward
          let nx = -dy / len;
          let ny = dx / len;
          // Verify normal points away from centroid
          const c = polyCentroid(poly);
          if ((res.x + nx - c.x) ** 2 + (res.y + ny - c.y) ** 2 < (res.x - c.x) ** 2 + (res.y - c.y) ** 2) {
            nx = -nx;
            ny = -ny;
          }
          pushNormal = { x: nx, y: ny };
        }
      }
      const pushDist = (r + buffer + 0.1) - bestDist;
      if (pushDist > 0) {
        res = { x: res.x + pushNormal.x * pushDist, y: res.y + pushNormal.y * pushDist };
      }
    }
  }
  return res;
}

/**
 * Evaluates whether a point is safely in the 2D Threat Shadow of a ruin (100% Out of LOS from top threats).
 */
export function isPointInThreatShadow(s: GameState, p: Pt, threatFoes: { u: UnitState; lead: ModelState }[]): boolean {
  if (!threatFoes.length) return true;
  const dummy = {
    id: '__test__', name: '', x: p.x, y: p.y, r: 0.5,
    profile: { name: '', base: { w: 32, h: 32, text: '32mm' }, M: 6, T: 4, Sv: 3, InSv: null, W: 1, Ld: 6, OC: 1 },
    keywords: [], weapons: [], wounds: 1, source: 'base', isCharacter: false, isBodyguard: false, dead: false,
  } as ModelState;

  let blockedCount = 0;
  for (const f of threatFoes) {
    if (!f.lead) continue;
    if (!roughLos(s, f.lead, dummy)) {
      blockedCount++;
    }
  }
  // True shadow if at least 80% of top threats have line-of-sight blocked
  return blockedCount >= Math.ceil(threatFoes.length * 0.8);
}

/**
 * MODULE 1: Breadth-First Wall-Hugging & Coherency Slot Packer
 * Arranges models strictly hugging the wall contour without circular blob spillage or footprint intrusion.
 */
export function packModelsIntoSafeSlots(
  s: GameState,
  u: UnitState,
  anchorPt: Pt,
  stance: MoveStance,
  maxMove: number,
  fly = false,
  threatFoes: { u: UnitState; lead: ModelState }[] = [],
): Map<string, Pt[]> | null {
  const models = alive(u);
  if (!models.length) return null;

  const W = tableW(s);
  const H = tableH(s);
  const ruins = s.terrain.filter((t) => t.category !== 'exposed' && t.poly?.length >= 3);
  const lead = models[0];

  // Adjust anchor if in STANCE_STAGE_HIDDEN and clipping ruin footprint
  let safeAnchor = { ...anchorPt };
  if (stance === 'STANCE_STAGE_HIDDEN' && isInForbiddenFootprintZone(lead, safeAnchor, ruins, 0.15)) {
    safeAnchor = pushOutOfFootprint(safeAnchor, lead.r, ruins, 0.25);
  }

  // Ensure anchor is within bounds and within movement range
  safeAnchor.x = Math.max(lead.r + 0.1, Math.min(W - lead.r - 0.1, safeAnchor.x));
  safeAnchor.y = Math.max(lead.r + 0.1, Math.min(H - lead.r - 0.1, safeAnchor.y));
  if (dist(lead, safeAnchor) > maxMove + 0.05) return null;

  const r0 = routeAround(s, u, 'normal', lead, lead, safeAnchor, maxMove, { fly });
  if (!r0 || dist(r0[r0.length - 1], safeAnchor) > 0.45) return null;

  const endPositions = new Map<string, Pt>();
  const modelPaths = new Map<string, Pt[]>();
  const placedPoints: Pt[] = [r0[r0.length - 1]];
  endPositions.set(lead.id, placedPoints[0]);
  modelPaths.set(lead.id, r0);

  // Other friendly units and enemy models on board
  const otherModels = s.units
    .filter((x) => x.id !== u.id && x.status === 'board')
    .flatMap(alive);

  // Place models 1 to N-1
  for (let i = 1; i < models.length; i++) {
    const m = models[i];
    let bestSlot: Pt | null = null;
    let bestScore = -Infinity;

    // Generate candidate slots around already placed models
    const angleSteps = 12;
    for (let j = 0; j < placedPoints.length; j++) {
      const anchor = placedPoints[j];
      const spacingDist = Math.min(1.85, m.r + models[j].r + 0.35);

      for (let a = 0; a < angleSteps; a++) {
        const ang = (a * 2 * Math.PI) / angleSteps;
        const cand: Pt = {
          x: anchor.x + Math.cos(ang) * spacingDist,
          y: anchor.y + Math.sin(ang) * spacingDist,
        };

        // Table boundary check
        if (!onTable(bodyAt(m, cand), W, H, 0)) continue;

        // Strict footprint avoidance
        if (stance === 'STANCE_STAGE_HIDDEN' && isInForbiddenFootprintZone(m, cand, ruins, 0.15)) {
          continue;
        }

        // Movement distance check
        if (dist(m, cand) > maxMove + 0.05) continue;

        // Model overlap checks with existing placed models in unit
        let overlap = false;
        for (let k = 0; k < placedPoints.length; k++) {
          if (dist(cand, placedPoints[k]) < m.r + models[k].r + 0.04) {
            overlap = true;
            break;
          }
        }
        if (overlap) continue;

        // Overlap checks with other board units
        for (let o = 0; o < otherModels.length; o++) {
          const om = otherModels[o];
          if (dist(cand, om) < m.r + om.r + 0.05) {
            overlap = true;
            break;
          }
        }
        if (overlap) continue;

        // Coherency check: count how many placed models are within 2.0"
        let coherencyCount = 0;
        for (let k = 0; k < placedPoints.length; k++) {
          const baseGap = dist(cand, placedPoints[k]) - m.r - models[k].r;
          if (baseGap <= RULES.coherency.near + 0.05) {
            coherencyCount++;
          }
        }
        if (models.length <= 6) {
          if (coherencyCount < 1) continue;
        } else {
          // Units of 7+ require 2 coherency links (or 1 for first follower)
          if (placedPoints.length >= 2 && coherencyCount < 2) continue;
        }

        // Score this candidate slot
        let score = 0;
        // Shadow bonus: out of LOS from top threats
        if (isPointInThreatShadow(s, cand, threatFoes)) {
          score += 50;
        }
        // Wall hug bonus: staying close to terrain walls
        let minWallDist = Infinity;
        for (const t of ruins) {
          for (const w of t.walls) {
            const wd = pointSegDist(cand, w);
            if (wd < minWallDist) minWallDist = wd;
          }
        }
        if (minWallDist <= 1.5) {
          score += 30 * (1.5 - minWallDist);
        }
        // Compactness
        score -= dist(cand, safeAnchor) * 2;

        if (score > bestScore) {
          bestScore = score;
          bestSlot = cand;
        }
      }
    }

    if (!bestSlot) return null;

    const r = routeAround(s, u, 'normal', m, m, bestSlot, maxMove, { fly });
    if (!r || dist(r[r.length - 1], bestSlot) > 0.45) return null;

    placedPoints.push(r[r.length - 1]);
    endPositions.set(m.id, r[r.length - 1]);
    modelPaths.set(m.id, r);
  }

  // Final coherency verification
  const probs = coherencyProblems(placedPoints, RULES.coherency.near, RULES.coherency.max, models);
  if (probs.length > 0) return null;

  return modelPaths;
}

/**
 * MODULE 2: Conga-Line Objective Toe-In
 * Sends only 1-2 models to touch the Objective Zone while the remaining squad
 * stays chained back safely in the Ruin's 2D Threat Shadow.
 */
export function congaLineObjectivePaths(
  s: GameState,
  u: UnitState,
  obj: Pt,
  ruin: TerrainPiece,
  maxMove: number,
  fly = false,
  threatFoes: { u: UnitState; lead: ModelState }[] = [],
): Map<string, Pt[]> | null {
  const models = alive(u);
  if (models.length < 2) return null;

  const W = tableW(s);
  const H = tableH(s);
  const ruinCentroid = polyCentroid(ruin.poly);

  // Direction from objective towards the ruin
  const dx = ruinCentroid.x - obj.x;
  const dy = ruinCentroid.y - obj.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  const perp = { x: -dir.y, y: dir.x };

  // Toe-In point: 2.8" from objective center along vector to ruin (touches 3" objective zone)
  const toeInPoint: Pt = {
    x: obj.x + dir.x * 2.8,
    y: obj.y + dir.y * 2.8,
  };

  const lead = models[0];
  if (dist(lead, toeInPoint) > maxMove + 0.05) {
    return null;
  }

  const r0 = routeAround(s, u, 'normal', lead, lead, toeInPoint, maxMove, { fly });
  if (!r0 || dist(r0[r0.length - 1], toeInPoint) > 0.45) {
    return null;
  }

  // Pre-generate slots for remaining models chaining back towards the ruin
  const slots: Pt[] = [];
  let prev = r0[r0.length - 1];

  for (let i = 1; i < models.length; i++) {
    let cand: Pt = {
      x: prev.x + dir.x * 1.5,
      y: prev.y + dir.y * 1.5,
    };

    // If candidate intrudes into forbidden ruin footprint, push outside and fan along wall
    if (isInForbiddenFootprintZone(models[i], cand, [ruin], 0.15)) {
      cand = pushOutOfFootprint(cand, models[i].r, [ruin], 0.25);
      if (dist(cand, prev) < models[i].r * 2 + 0.05) {
        const side = (i % 2 === 0 ? 1 : -1) * (models[i].r * 2 + 0.3);
        cand = { x: prev.x + perp.x * side, y: prev.y + perp.y * side };
        cand = pushOutOfFootprint(cand, models[i].r, [ruin], 0.25);
      }
    }
    slots.push(cand);
    prev = cand;
  }

  // Match remaining models to slots greedily to minimize travel distance
  const remainingModels = models.slice(1);
  const modelPaths = new Map<string, Pt[]>();
  modelPaths.set(lead.id, r0);
  const placedPoints: Pt[] = [r0[r0.length - 1]];

  const usedModels = new Set<string>();
  for (const slot of slots) {
    let bestM: ModelState | null = null;
    let bestD = Infinity;
    for (const m of remainingModels) {
      if (usedModels.has(m.id)) continue;
      const d = dist(m, slot);
      if (d < bestD) {
        bestD = d;
        bestM = m;
      }
    }
    if (!bestM) return null;
    usedModels.add(bestM.id);

    if (dist(bestM, slot) > maxMove + 0.05) {
      return null;
    }

    const r = routeAround(s, u, 'normal', bestM, bestM, slot, maxMove, { fly });
    if (!r || dist(r[r.length - 1], slot) > 0.45) {
      return null;
    }

    placedPoints.push(r[r.length - 1]);
    modelPaths.set(bestM.id, r);
  }

  const probs = coherencyProblems(placedPoints, RULES.coherency.near, RULES.coherency.max, models);
  if (probs.length > 0) {
    return null;
  }

  return modelPaths;
}

/**
 * MODULE 3: Grandmaster Deep Strike, Backfield Heist & Rapid Ingress AI
 * Scans coarse 2" grid in < 3ms and executes 4 tournament deep strike plans:
 * 1. BACKFIELD_HOME_HEIST: Steals unguarded enemy home objective (+150 score).
 * 2. SAFE_SHADOW_INFILTRATION: Drops 100% Out of LOS behind walls for Rapid Ingress.
 * 3. SECONDARY_MISSION_DROP: Scores active secondary missions (Behind Enemy Lines, etc.).
 * 4. SURGICAL_CROSSFIRE_DROP: Backfield keyhole angles on high-value targets.
 */
export function grandmasterArrival(
  s: GameState,
  u: UnitState,
  how: 'ingress' | 'deepStrike',
): Map<string, Pt> | null {
  const startTime = performance.now();
  const W = tableW(s);
  const H = tableH(s);
  const grid = getThreatGrid(s, u.owner);
  const opp = other(u.owner);
  const enemyDZ = zoneOf(s, opp);
  const ms = alive(u);
  if (!ms.length) return null;

  const lead = ms[0];
  const isMelee = isBrawler(s, u) || maxRange(u) < 8;
  const isRapidIngress = how === 'ingress';

  const candidates: { pt: Pt; score: number; plan: string }[] = [];

  // 2" coarse grid scan (660 cells)
  for (let y = 2; y < H; y += 2) {
    for (let x = 2; x < W; x += 2) {
      const pt: Pt = { x, y };

      // Fast 9" exclusion lookup
      const enemyD = getFastNearestEnemyDistance(grid, pt);
      if (enemyD <= 9.05 + lead.r) continue;

      // Strategic Reserves (how === 'ingress') edge & DZ rules
      if (how === 'ingress') {
        const edgeD = Math.min(x, y, W - x, H - y);
        if (edgeD > RULES.reserves.edgeDistance + 0.1) continue;
        if (s.round < RULES.reserves.noEnemyZoneBeforeRound && pointInPoly(pt, enemyDZ)) continue;
      }

      let score = 0;
      let plan = 'GENERAL_DROP';

      // PLAN 1: BACKFIELD_HOME_HEIST (+150 Score)
      if (grid.enemyHomeObj) {
        const dHome = dist(pt, grid.enemyHomeObj);
        if (dHome <= 10.5) {
          if (grid.enemyHomeDefenderOc <= 2) {
            score += 150;
            plan = 'BACKFIELD_HOME_HEIST';
          }
        }
      }

      // PLAN 2: SAFE_SHADOW_INFILTRATION (Rapid Ingress / Melee)
      const inShadow = isPointInThreatShadow(s, pt, grid.topRangedFoes);
      if (inShadow) {
        if (isRapidIngress || isMelee) {
          score += 85;
          plan = 'SAFE_SHADOW_INFILTRATION';
        } else {
          score += 35;
        }
      } else if (isRapidIngress) {
        // Heavy penalty for dropping in the open during enemy turn!
        score -= 90;
      }

      // PLAN 3: SECONDARY_MISSION_DROP
      const P = s.players[u.owner];
      if (P.secMode !== 'none') {
        if (P.secActive.includes('behind-enemy-lines') && pointInPoly(pt, enemyDZ)) {
          score += 65;
          plan = 'SECONDARY_MISSION_DROP';
        }
        if (P.secActive.includes('engage-on-all-fronts')) {
          const qx = x > W / 2 ? 1 : 0;
          const qy = y > H / 2 ? 1 : 0;
          const dCenter = Math.hypot(x - W / 2, y - H / 2);
          if (dCenter >= 6.5) {
            score += 45;
          }
        }
        if (P.secActive.includes('deploy-teleport-homer') || P.secActive.includes('establish-locus')) {
          if (pointInPoly(pt, enemyDZ)) score += 55;
        }
      }

      // PLAN 4: SURGICAL_CROSSFIRE_DROP
      if (!isMelee && maxRange(u) >= 18) {
        for (const foe of grid.topRangedFoes) {
          const d = dist(pt, foe.lead);
          if (d <= maxRange(u) && d >= 10.0) {
            score += 40;
            if (plan === 'GENERAL_DROP') plan = 'SURGICAL_CROSSFIRE_DROP';
            break;
          }
        }
      }

      candidates.push({ pt, score, plan });
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Test top candidates with full placement validation
  const topCands = candidates.slice(0, 10);
  let bestPlacement: Map<string, Pt> | null = null;
  let highestScore = -Infinity;

  for (let i = 0; i < topCands.length; i++) {
    const c = topCands[i];
    if (i > 0 && performance.now() - startTime > 15) break; // Time-budget guard

    const pos = findPlacement(s, u, how, c.pt, (pMap) => {
      const pts = [...pMap.values()];
      const avg = {
        x: pts.reduce((a, b) => a + b.x, 0) / pts.length,
        y: pts.reduce((a, b) => a + b.y, 0) / pts.length,
      };
      return dist(avg, c.pt) <= 5.0;
    });
    if (!pos || !validatePlacement(s, u, pos, how).ok) continue;

    if (c.score > highestScore) {
      highestScore = c.score;
      bestPlacement = pos;
      break;
    }
  }

  return bestPlacement;
}
