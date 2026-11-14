// Choosing where a unit deploys: used by the bot and by the player's "place it for me" button.
// Every open spot in the deployment zone is scored instead of taking the first spot towards the enemy:
//  - out of sight of the enemy zone where possible (the other side may shoot first), in cover or behind terrain;
//  - shooters where they see the middle objectives (fire lanes), melee units staged behind cover at the front;
//  - a unit with OC on the home objective while nobody holds it;
//  - units spread out rather than packed together (blast weapons, room to move), vehicles never boxed in.
import { RULES } from '../engine/config';
import { formationAt, isRiledUp, objectiveTerrain, scoutsOf, validatePlacement, zoneOf } from '../engine/game';
import { bodyAt, bodyWhollyInPoly, circleTouchesPoly, dist, gap, pointInPoly, polyCentroid, ptGap, segCrossesPoly, segSegDist } from '../engine/geometry';
import { canDo, unitFlags } from '../rules-engine/effects';
import { canLeave } from './botMove';
import { isBrawler, maxRange, moveOf, oc, securesObjectives, unitValue } from './botEval';
import { alive, onBoard, other, tableH, tableW, withinTerrain } from '../engine/state';
import { homeScoresVp } from './botPlan';
import type { GameState, ModelState, Pt, UnitState } from '../engine/types';
import { roughLos } from '../engine/visibility';

/** A stand-in model at a point (to ask "could a model standing here see that unit?"). */
const lookout = (p: Pt): ModelState => ({ x: p.x, y: p.y, r: 0.5, keywords: ['INFANTRY'] }) as unknown as ModelState;

/** Points of `poly` on a coarse grid (where enemy models could stand). */
function samplePoly(poly: Pt[], step: number): Pt[] {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const out: Pt[] = [];
  for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) if (pointInPoly({ x, y }, poly)) out.push({ x, y });
  }
  return out;
}

/** The models that stand for the unit when checking sight: its ends and its middle. */
function probes(u: UnitState, pos: Map<string, Pt>): ModelState[] {
  const ms = alive(u).map((m) => ({ ...m, ...pos.get(m.id)! }) as ModelState);
  if (ms.length <= 5) return ms;
  const c = polyCentroid(ms);
  const sorted = [...ms].sort((a, b) => dist(a, c) - dist(b, c));
  return [sorted[0], sorted[sorted.length - 1], sorted[sorted.length - 2], sorted[Math.floor(sorted.length / 2)]];
}

/** How a bot sets up its whole army, decided once from both armies:
 *  - closed: the enemy has the guns — hide what matters from their first turn of shooting;
 *  - open: the enemy is built to fight in melee — nothing to hide from at range, so take ground forward;
 *  - bait (with closed): one cheap, sturdy unit stands in plain view to draw the enemy into the hidden guns. */
export type Posture = 'open' | 'closed';
export function deployPosture(s: GameState, p: 0 | 1): Posture {
  const foes = s.units.filter((e) => e.owner !== p && e.status !== 'destroyed');
  let guns = 0, fists = 0;
  for (const e of foes) {
    const v = unitValue(e);
    if (isBrawler(s, e)) fists += v; else if (maxRange(e) >= 18) guns += v; else { guns += v / 2; fists += v / 2; }
  }
  return fists > guns * 1.5 ? 'open' : 'closed';
}

/** Roughly how many ordinary shots (S4, AP0, 1 damage) the unit takes to wipe out: wounds, saves and toughness. */
function sturdiness(u: UnitState): number {
  return alive(u).reduce((a, m) => {
    const sv = Math.min(m.profile.Sv || 7, m.profile.InSv ?? 7);
    return a + m.wounds / Math.min(1, Math.max(1 / 6, (sv - 1) / 6)) * Math.min(2, (m.profile.T || 4) / 4);
  }, 0);
}

/**
 * The unit sent out as bait: cheap, not a character or vehicle, and able to soak a turn of shooting; only for a big
 * enough army. Ten Gretchin in the open are not bait, just free points for the enemy (they hold home instead).
 */
export function baitUnit(s: GameState, p: 0 | 1): UnitState | undefined {
  const mine = s.units.filter((u) => u.owner === p && u.status !== 'destroyed');
  if (mine.length < 5 || deployPosture(s, p) !== 'closed') return undefined;
  return mine
    .filter((u) => !u.models.some((m) => m.isCharacter || m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER')) && unitValue(u) <= 150 && alive(u).length >= 5
      && sturdiness(u) >= 10)
    .sort((a, b) => unitValue(a) - unitValue(b))[0];
}

/** Check if candidate spot is behind an obscuring footprint or solid wall relative to enemy centre */
function isBehindTerrain(s: GameState, from: Pt, to: Pt): boolean {
  const line = { a: from, b: to };
  const minX = Math.min(from.x, to.x) - 1, maxX = Math.max(from.x, to.x) + 1;
  const minY = Math.min(from.y, to.y) - 1, maxY = Math.max(from.y, to.y) + 1;
  for (const t of s.terrain) {
    if (t.bounds && (t.bounds.x1 < minX || t.bounds.x0 > maxX || t.bounds.y1 < minY || t.bounds.y0 > maxY)) continue;
    if (t.category !== 'exposed') {
      if (!pointInPoly(to, t.poly) && segCrossesPoly(line, t.poly)) return true;
    }
    for (const w of t.walls) if (segSegDist(line, w) < 0.1) return true;
    if (t.box && segCrossesPoly(line, t.box)) return true;
  }
  return false;
}

export interface DeployOptions { near?: Pt; how?: 'deploy' | 'infiltrate' }

/** The best legal deployment for `u`, or null when nothing in the zone fits. */
export function smartPlacement(s: GameState, u: UnitState, opt: DeployOptions = {}): Map<string, Pt> | null {
  const zone = zoneOf(s, u.owner);
  const enemyZone = zoneOf(s, other(u.owner));
  const up = s.players[u.owner].role === 'defender';
  const ec = polyCentroid(enemyZone);
  const brawler = isBrawler(s, u);
  const range = maxRange(u);
  const fast = moveOf(u) >= 10;
  const vehicle = alive(u).some((m) => m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER'));
  const isChar = alive(u).some((m) => m.isCharacter);
  const holdsGround = oc(u) > 0 && !brawler;
  // the home objective is for a cheap unit, not the army's hammer nor a full Battleline squad with its leader
  const cheap = unitValue(u) <= 200;
  // Infiltrators: anywhere more than 9" from the enemy deployment zone
  const how = opt.how ?? 'deploy';
  // the bot's plan for the whole army (the player's "place it for me" always plays it safe)
  // every unit starts as well hidden as the zone allows: nothing is left out in the open for a first-turn alpha strike
  const bait = false;

  // Analyze enemy threats: Advance + Charge, Scouts, and Infiltrators
  const foes = s.units.filter((e) => e.owner !== u.owner && e.status !== 'destroyed');
  const enemyHasAdvanceCharge = foes.some((e) => canDo(s, e, 'chargeAfterAdvance') || isRiledUp(s, e) || (e.abilities ?? []).some((a) => /advance.*charge/i.test(`${a.name} ${a.text ?? ''}`))) ||
    (s.players[other(u.owner)]?.armyRules ?? []).some((r) => /waaagh|advance and charge|fleet of foot/i.test(`${r.name} ${r.text ?? ''}`)) ||
    (s.players[other(u.owner)]?.detachments ?? []).some((d: any) => /advance and charge|assault doctrine/i.test(`${typeof d === 'string' ? d : d.name} ${(d.rules ?? []).map((r: any) => `${r.name} ${r.text ?? ''}`).join(' ')}`));
  const enemyHasScout = foes.some((e) => scoutsOf(s, e) > 0);
  const enemyHasInfiltrator = foes.some((e) => e.core.infiltrators || unitFlags(s, e).infiltrators);
  const enemyAggroThreat = enemyHasAdvanceCharge || enemyHasScout || enemyHasInfiltrator;

  // Sample watchers across enemyZone: full coverage of the enemy deployment area
  const placed = s.units.filter((e) => e.owner !== u.owner && onBoard(e)).flatMap(alive);
  const enemyXs = enemyZone.map((p) => p.x), enemyYs = enemyZone.map((p) => p.y);
  const minX = Math.min(...enemyXs), maxX = Math.max(...enemyXs);
  const minY = Math.min(...enemyYs), maxY = Math.max(...enemyYs);

  const gridPts: Pt[] = [];
  for (let y = minY + 2; y <= maxY; y += 4) {
    for (let x = minX + 2; x <= maxX; x += 4) {
      if (pointInPoly({ x, y }, enemyZone)) gridPts.push({ x, y });
    }
  }
  if (!gridPts.length) gridPts.push(ec);

  const zoneWatchers: ModelState[] = gridPts.map(lookout);
  const placedWatchers: ModelState[] = placed.map(lookout);
  const watchers = [...zoneWatchers, ...placedWatchers];

  const objs = s.objectives.map((o) => ({ o, p: polyCentroid(objectiveTerrain(s, o).poly) }));
  // its own home objective (some layouts put it on the zone's edge, outside the zone itself) and any inside the zone
  const home = objs.filter(({ o, p }) => (o.type === 'home' && o.owner === u.owner) || pointInPoly(p, zone));
  const middle = objs.filter(({ p }) => !pointInPoly(p, zone) && !pointInPoly(p, enemyZone));
  const friends = s.units.filter((f) => f.owner === u.owner && f.id !== u.id && onBoard(f));
  // held by a unit that stays there: a mob of Boyz standing on it now charges off in the first turn
  const homeHeld = (p: Pt) => friends.some((f) => oc(f) > 0 && (securesObjectives(s, f) || !isBrawler(s, f)) && alive(f).some((m) => ptGap(m, p) <= 3));
  const zoneDepth = Math.max(1, Math.max(maxY - minY, maxX - minX));
  const frontDist = Math.min(...zone.map((p) => dist(p, ec)));

  // first the cheap terms for every open spot, then the sight checks only for the most promising ones
  const cands: { pos: Map<string, Pt>; ms: ModelState[]; centre: Pt; score: number }[] = [];
  const W = tableW(s), H = tableH(s);
  for (let y = 1; y < H; y += 2) {
    for (let x = 1; x < W; x += 2) {
      const c = { x, y };
      if (how === 'deploy' && !circleTouchesPoly(c, 0, zone)) continue;
      if (how === 'infiltrate' && circleTouchesPoly(c, RULES.reserves.enemyDistance, enemyZone)) continue;
      const pos = formationAt(u, c, up);
      if (!validatePlacement(s, u, pos, how).ok) continue;
      const ms = alive(u).map((m) => ({ ...m, ...pos.get(m.id)! }) as ModelState);
      const centre = polyCentroid(ms);
      let score = 0;
      const wholly = ms.every((m) => bodyWhollyInPoly(bodyAt(m, m), zone));
      if (how === 'deploy') {
        if (!wholly) continue;
        score += 50;
      }

      // shelter: physically behind a terrain footprint or solid wall relative to enemy zone
      const sheltered = isBehindTerrain(s, ec, centre);
      if (sheltered) score += 20;

      // cover: models standing in terrain areas
      const covered = ms.filter((m) => withinTerrain(s, m, ['light', 'dense'])).length / ms.length;
      score += covered * (vehicle ? 3 : 6);

      // how far forward: concealed/sheltered units may stage forward; exposed units stay back
      const forward = 1 - Math.max(0, dist(centre, ec) - frontDist) / zoneDepth; // 1 = front edge, 0 = back edge
      if (how === 'infiltrate') { /* placed by objectives and cover, not by depth */ }
      else if (bait) score += forward * 6;
      else if (sheltered || covered > 0.5) {
        if (brawler || fast) score += forward * 4;
        else if (range >= 30) score += (1 - Math.abs(forward - 0.25)) * 3;
        else score += forward * 2;
      } else {
        // Exposed spot in the open: penalize forward placement, especially against advance+charge/scout/infiltrators
        score -= forward * (enemyAggroThreat ? 25 : 12);
      }

      // Threat buffer against turn-1 Advance+Charge, Scouts, and Infiltrators
      if (enemyAggroThreat && !sheltered && how === 'deploy') {
        const minFoeDist = Math.min(...watchers.map((w) => dist(centre, w)));
        const threatDist = enemyHasAdvanceCharge ? 24 : (enemyHasScout ? 20 : 16);
        if (minFoeDist <= threatDist) {
          score -= (1 - minFoeDist / threatDist) * (isChar || !brawler ? 30 : 18);
        }
      }

      // objectives out in the middle: Infiltrators sit on one, others start where they reach one in their first move
      if (holdsGround || how === 'infiltrate') {
        const dMid = Math.min(99, ...middle.map(({ p }) => Math.min(...ms.map((m) => ptGap(m, p)))));
        // snipers stay back in cover; others take an objective only from cover
        if (how === 'infiltrate' && range < 30) score += (dMid <= 3 ? 5 : Math.max(0, 3 - dMid / 3)) * (covered > 0.5 ? 1 : 0.4);
        else if (dMid <= moveOf(u) + 3) score += 2;
      }
      // somebody with OC on the home objective
      // (worth more than being forward or in cover: a unit placed wrong at the start plays the whole battle wrong)
      if (homeScoresVp(s, u.owner)) {
        const canSecure = oc(u) > 0 && securesObjectives(s, u);
        const myStickyAvailable = s.units.some((f) => f.owner === u.owner && f.id !== u.id && f.status === 'pending' && oc(f) > 0 && securesObjectives(s, f));
        for (const { p } of home) {
          if (!homeHeld(p) && ms.some((m) => ptGap(m, p) <= 3)) {
            if (canSecure) score += 35;
            else if (holdsGround && cheap && !myStickyAvailable) score += 14;
          }
        }
      }

      // spread out: no packing next to other units
      for (const f of friends) {
        const d = Math.min(...alive(f).map((fm) => Math.min(...ms.map((m) => gap(m, fm)))));
        if (d < 1.5) score -= 4; else if (d < 4) score -= 1.5;
      }

      // where the player pointed, if they did
      if (opt.near) score -= dist(centre, opt.near) * 0.4;
      cands.push({ pos, ms, centre, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);

  let best: { pos: Map<string, Pt>; score: number } | null = null;
  // sight checks for top candidates: evaluate sheltered and well-positioned spots
  const worth = Math.min(2, (u.pts * alive(u).length) / Math.max(1, u.startingStrength) / 120);
  const pool = cands.slice(0, 36);
  for (const cand of pool) {
    if (vehicle && !canLeave(s, u, cand.pos)) continue;
    let score = cand.score;
    const eyes = probes(u, cand.pos);
    // early-exit sight check: count watchers seeing the candidate, break early if heavily exposed
    let seenCount = 0;
    for (const w of watchers) {
      if (eyes.some((m) => roughLos(s, w, m))) {
        seenCount++;
        if (seenCount >= 2) break;
      }
    }
    if (bait) {
      score += (seenCount / watchers.length) * 8;
    } else if (seenCount === 0) {
      // completely hidden behind a footprint or solid wall: highest priority to prevent turn 1 shots
      score += 45;
      if (isChar) score += 30;
      if (enemyAggroThreat) score += 15;
    } else {
      score -= 35 + (seenCount / watchers.length) * 60 * (0.75 + 0.25 * worth);
      if (isChar) score -= 40;
      if (enemyAggroThreat) score -= 20;
    }
    // shooters: sight of the middle objectives from here (to shoot whatever goes onto them)
    if (!brawler && range >= 18 && middle.length) {
      const lanes = middle.filter(({ p }) => dist(cand.centre, p) <= range + 3 && eyes.some((m) => roughLos(s, m, lookout(p)))).length;
      score += (lanes / middle.length) * 4;
    }
    if (!best || score > best.score) best = { pos: cand.pos, score };
  }
  // a vehicle whose best spots are all boxed in: any open spot it can drive out of
  if (!best && vehicle) for (const cand of cands) if (canLeave(s, u, cand.pos)) return cand.pos;
  return best?.pos ?? null;
}
