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
import { isBrawler, maxRange, moveOf, oc, unitValue } from './botEval';
import { alive, onBoard, other, withinTerrain } from './state';
import type { GameState, ModelState, Pt, UnitState } from './types';
import { roughLos } from './visibility';

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
  const holdsGround = oc(u) > 0 && !brawler;
  // the home objective is for a cheap or Battleline unit, not the army's hammer
  const cheap = alive(u).some((m) => m.keywords.includes('BATTLELINE')) || unitValue(u) <= 200;
  // Infiltrators: anywhere more than 9" from the enemy deployment zone
  const how = opt.how ?? 'deploy';
  // the bot's plan for the whole army (the player's "place it for me" always plays it safe)
  const isBot = (s.bots ?? []).includes(u.owner);
  const posture: Posture = isBot ? deployPosture(s, u.owner) : 'closed';
  const bait = isBot && baitUnit(s, u.owner)?.id === u.id;

  // where the enemy could stand (sight checks), and the objectives
  const watchers = samplePoly(enemyZone, 6).map(lookout);
  const objs = s.objectives.map((o) => ({ o, p: polyCentroid(objectiveTerrain(s, o).poly) }));
  const home = objs.filter(({ p }) => pointInPoly(p, zone));
  const middle = objs.filter(({ p }) => !pointInPoly(p, zone) && !pointInPoly(p, enemyZone));
  const friends = s.units.filter((f) => f.owner === u.owner && f.id !== u.id && onBoard(f));
  // held by a unit that stays there: a mob of Boyz standing on it now charges off in the first turn
  const homeHeld = (p: Pt) => friends.some((f) => oc(f) > 0 && !isBrawler(s, f) && alive(f).some((m) => dist(m, p) <= 3 + m.r));
  const zoneDepth = Math.max(1, ...samplePoly(zone, 3).map((p) => dist(p, ec))) - Math.min(...samplePoly(zone, 3).map((p) => dist(p, ec)));
  const frontDist = Math.min(...samplePoly(zone, 3).map((p) => dist(p, ec)));

  // first the cheap terms for every open spot, then the sight checks only for the most promising ones
  const cands: { pos: Map<string, Pt>; ms: ModelState[]; centre: Pt; score: number }[] = [];
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

      // cover: models standing in terrain areas
      const covered = ms.filter((m) => withinTerrain(s, m, ['light', 'dense'])).length / ms.length;
      score += covered * (vehicle ? 1 : 4);

      // how far forward: melee and fast units at the front, long guns further back
      const forward = 1 - (dist(centre, ec) - frontDist) / zoneDepth; // 1 = front edge, 0 = back edge
      if (how === 'infiltrate') { /* placed by objectives and cover, not by depth */ }
      else if (bait) score += forward * 6;
      else if (brawler || fast) score += forward * 8;
      else if (range >= 30) score += (1 - Math.abs(forward - 0.35)) * 3;
      else score += forward * 3;
      if (posture === 'open' && how === 'deploy') score += forward * 4;

      // objectives out in the middle: Infiltrators sit on one, others start where they reach one in their first move
      if (holdsGround || how === 'infiltrate') {
        const dMid = Math.min(99, ...middle.map(({ p }) => Math.min(...ms.map((m) => dist(m, p) - m.r))));
        // snipers stay back in cover; others take an objective only from cover
        if (how === 'infiltrate' && range < 30) score += (dMid <= 3 ? 5 : Math.max(0, 3 - dMid / 3)) * (covered > 0.5 ? 1 : 0.4);
        else if (dMid <= moveOf(u) + 3) score += 3;
      }
      // somebody with OC on the home objective
      for (const { p } of home) if (holdsGround && cheap && !homeHeld(p) && ms.some((m) => dist(m, p) <= 3 + m.r)) score += 7;

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
  // sight checks for many spots: a hidden spot a little further back often beats the open one in front
  const worth = Math.min(2, (u.pts * alive(u).length) / Math.max(1, u.startingStrength) / 120);
  // the best by position, plus the best spots in cover (often a little further back, and out of sight)
  const pool = [...cands.slice(0, 70)];
  for (const c of cands.slice(70).filter((c) => c.ms.some((m) => withinTerrain(s, m, ['light', 'dense']))).slice(0, 50)) pool.push(c);
  for (const cand of pool) {
    if (vehicle && !canLeave(s, u, cand.pos)) continue;
    let score = cand.score;
    const eyes = probes(u, cand.pos);
    // hidden from the enemy deployment zone (they may get the first turn)
    const seen = watchers.filter((w) => eyes.some((m) => roughLos(s, w, m))).length / Math.max(1, watchers.length);
    // a tournament player hides what matters most from the first turn of shooting
    // closed: hide; open: being seen matters much less; the bait wants to be seen
    if (bait) score += seen * 8;
    else score -= seen * (brawler || how === 'infiltrate' ? 14 : 11) * (0.6 + 0.4 * worth) * (posture === 'open' ? (brawler ? 0.35 : 0.7) : 1);
    // shooters: sight of the middle objectives from here (to shoot whatever goes onto them)
    if (!brawler && range >= 18 && middle.length) {
      const lanes = middle.filter(({ p }) => dist(cand.centre, p) <= range + 3 && eyes.some((m) => roughLos(s, m, lookout(p)))).length;
      score += (lanes / middle.length) * 6;
    }
    if (!best || score > best.score) best = { pos: cand.pos, score };
  }
  // a vehicle whose best spots are all boxed in: any open spot it can drive out of
  if (!best && vehicle) for (const cand of cands) if (canLeave(s, u, cand.pos)) return cand.pos;
  return best?.pos ?? null;
}
