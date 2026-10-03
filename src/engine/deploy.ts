// Choosing where a unit deploys: used by the bot and by the player's "place it for me" button.
// Every open spot in the deployment zone is scored instead of taking the first spot towards the enemy:
//  - out of sight of the enemy zone where possible (the other side may shoot first), in cover;
//  - shooters where they see the middle objectives (fire lanes), melee units at the front edge;
//  - a unit with OC on the home objective while nobody holds it;
//  - units spread out rather than packed together (blast weapons, room to move), vehicles never boxed in.
import { RULES } from './config';
import { formationAt, objectiveTerrain, validatePlacement, zoneOf } from './game';
import { circleTouchesPoly, dist, pointInPoly, polyCentroid } from './geometry';
import { canLeave } from './botMove';
import { isBrawler, maxRange, moveOf, oc } from './botEval';
import { alive, onBoard, other, withinTerrain } from './state';
import type { GameState, ModelState, Pt, UnitState } from './types';
import { hasLos } from './visibility';

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;

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
  if (ms.length <= 3) return ms;
  const c = polyCentroid(ms);
  const sorted = [...ms].sort((a, b) => dist(a, c) - dist(b, c));
  return [sorted[0], sorted[sorted.length - 1], sorted[Math.floor(sorted.length / 2)]];
}

export interface DeployOptions { near?: Pt }

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
  const holdsGround = oc(u) > 0 && !brawler;

  // where the enemy could stand (sight checks), and the objectives
  const watchers = samplePoly(enemyZone, 6).map(lookout);
  const objs = s.objectives.map((o) => ({ o, p: polyCentroid(objectiveTerrain(s, o).poly) }));
  const home = objs.filter(({ p }) => pointInPoly(p, zone));
  const middle = objs.filter(({ p }) => !pointInPoly(p, zone) && !pointInPoly(p, enemyZone));
  const friends = s.units.filter((f) => f.owner === u.owner && f.id !== u.id && onBoard(f));
  const homeHeld = (p: Pt) => friends.some((f) => alive(f).some((m) => dist(m, p) <= 3 + m.r));
  const zoneDepth = Math.max(1, ...samplePoly(zone, 3).map((p) => dist(p, ec))) - Math.min(...samplePoly(zone, 3).map((p) => dist(p, ec)));
  const frontDist = Math.min(...samplePoly(zone, 3).map((p) => dist(p, ec)));

  // first the cheap terms for every open spot, then the sight checks only for the most promising ones
  const cands: { pos: Map<string, Pt>; ms: ModelState[]; centre: Pt; score: number }[] = [];
  for (let y = 1; y < H; y += 2) {
    for (let x = 1; x < W; x += 2) {
      const c = { x, y };
      if (!circleTouchesPoly(c, 0, zone)) continue;
      const pos = formationAt(u, c, up);
      if (!validatePlacement(s, u, pos, 'deploy').ok) continue;
      const ms = alive(u).map((m) => ({ ...m, ...pos.get(m.id)! }) as ModelState);
      const centre = polyCentroid(ms);
      let score = 0;

      // cover: models standing in terrain areas
      const covered = ms.filter((m) => withinTerrain(s, m, ['light', 'dense'])).length / ms.length;
      score += covered * (vehicle ? 1 : 4);

      // how far forward: melee and fast units at the front, long guns further back
      const forward = 1 - (dist(centre, ec) - frontDist) / zoneDepth; // 1 = front edge, 0 = back edge
      if (brawler || fast) score += forward * 8;
      else if (range >= 30) score += (1 - Math.abs(forward - 0.35)) * 3;
      else score += forward * 3;

      // somebody with OC on the home objective
      for (const { p } of home) if (holdsGround && !homeHeld(p) && ms.some((m) => dist(m, p) <= 3 + m.r)) score += 7;

      // spread out: no packing next to other units
      for (const f of friends) {
        const d = Math.min(...alive(f).map((fm) => Math.min(...ms.map((m) => dist(m, fm) - m.r - fm.r))));
        if (d < 1.5) score -= 4; else if (d < 4) score -= 1.5;
      }

      // where the player pointed, if they did
      if (opt.near) score -= dist(centre, opt.near) * 0.4;
      cands.push({ pos, ms, centre, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);

  let best: { pos: Map<string, Pt>; score: number } | null = null;
  for (const cand of cands.slice(0, 25)) {
    if (vehicle && !canLeave(s, u, cand.pos)) continue;
    let score = cand.score;
    const eyes = probes(u, cand.pos);
    // hidden from the enemy deployment zone (they may get the first turn)
    const seen = watchers.filter((w) => eyes.some((m) => hasLos(s, w, m))).length / Math.max(1, watchers.length);
    score -= seen * (brawler ? 14 : 9);
    // shooters: sight of the middle objectives from here (to shoot whatever goes onto them)
    if (!brawler && range >= 18 && middle.length) {
      const lanes = middle.filter(({ p }) => dist(cand.centre, p) <= range + 3 && eyes.some((m) => hasLos(s, m, lookout(p)))).length;
      score += (lanes / middle.length) * 6;
    }
    if (!best || score > best.score) best = { pos: cand.pos, score };
  }
  // a vehicle whose best spots are all boxed in: any open spot it can drive out of
  if (!best && vehicle) for (const cand of cands) if (canLeave(s, u, cand.pos)) return cand.pos;
  return best?.pos ?? null;
}
