import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RULES, MISSIONS, deploymentById, toPoly } from '../engine/config';
import { baseDist, bodyTouchesPoly, dist, pointInPoly, polyCentroid } from '../engine/geometry';
import { alive, onBoard, other } from '../engine/state';
import { flowAreas, inFlow, hasFlowOfMagic } from '../factions/flow';
import { isDaemonsArmy, isDaemonUnit, isUnderShadowOfChaos } from '../factions/daemons';
import { zonePoly } from '../engine/missions';
import { levelOfControl, markRuleLabel, scaledPoly } from '../engine/game';
import { loneOperativeNow, unitFlags } from '../rules-engine/effects';
import { getUnitLoneOpRange, isInfantryBeastLoneOpActive, modelVisible } from '../engine/visibility';
import { modelToken } from './Tokens';
import { getModelPortrait, IMAGE_BASE, usePortraitsVersion } from './portraits';
import { loadoutLabels, shortItem } from './loadout';
import { getAbilityOrWeaponInfo, PopoverCard, type AbilityOrWeaponInfo } from './AbilityBadgePopover';
import { Icon, SvgIcon } from './Icon';
import { FX_MS, FxLayer, type ActiveFx } from './BattleFx';
import { getPlayerFactionTheme, getUnitFactionTheme } from './factionColors';
import type { SecondaryGoal } from '../engine/secondaries';
import type { FxEvent, GameState, ModelState, ObjectiveState, PlayerId, Pt, TerrainPiece, UnitState } from '../engine/types';
import { play, type Sfx } from './sfx';

export type Paths = Map<string, Pt[]>;

export interface Ring { c: Pt; r: number; color: string; dash?: boolean }

export interface BoardProps {
  s: GameState;
  viewer: PlayerId;
  selected?: string | null;
  /** unit IDs eligible to move this phase: highlighted so the player sees who can move */
  movable?: string[];
  draftUnit?: string | null;
  draft?: Paths | null;
  /** numbers shared with a unit-selection list, to identify units with duplicate names */
  unitNumbers?: Record<string, number>;
  /** draw an inset guide this many inches from the battlefield edge */
  edgeGuide?: number;
  /** show the keep-out distance around a deployment zone while placing a unit */
  zoneGuide?: { poly: Pt[]; distance: number };
  maxFor?: (modelId: string) => number;
  /** the legal route for a model dragged along [start, wanted end]: around walls it can't cross, stopping where it can't go on */
  walk?: (modelId: string, path: Pt[]) => Pt[];
  /** players whose moves are replayed as an animation (the bot) */
  animateMoves?: PlayerId[];
  bad?: string[];
  targets?: string[];
  picked?: string[];
  rings?: Ring[];
  zones?: boolean;
  badges?: Record<string, string[]>;
  /** temporary buffs / debuffs on a unit ("+1 Hit", "−2\" M"): green good, red bad, under the unit */
  buffTags?: Record<string, [string, boolean][]>;
  /** Ork units riled up (WAAAGH! …): green flames on their models */
  riled?: string[];
  losLines?: { a: Pt; b: Pt; cover: boolean }[];
  onTapUnit?: (unitId: string, modelId: string) => void;
  measure?: { a?: Pt; b?: Pt; label?: string; los?: boolean; why?: string };
  /** what the viewer's secondary mission cards want on the table (drawn in gold) */
  goals?: SecondaryGoal[];
  /** shooting: models of the firing unit that cannot see the chosen target (they don't shoot it) */
  noLos?: string[];
  onTapBoard?: (p: Pt) => void;
  onDraft?: (p: Paths) => void;
  /** a drag of the draft finished (the screen settles models into legal spots) */
  onDragEnd?: (p: Paths) => void;
  /** the enemy's likely attacks next turn (its look ahead): an arrow from each attacker to its target */
  plan?: { from: Pt; to: Pt; melee: boolean; label: string }[];
  /** cards laid on the table beside the battlefield, next to each army's deployment zone (army-wide buffs) */
  side?: { p: PlayerId; at: 'left' | 'right' | 'top' | 'bottom'; cards: React.ReactNode[] }[];
  /** quick floating contextual action menu above selected unit */
  quickActions?: { unitId: string; actions: { label: string; icon?: string; primary?: boolean; onClick: () => void }[] };
}

/** Width of the table beside the battlefield that holds the side cards, in inches; card text is laid out at PX px per inch. */
const SIDE = 13, PX = 20;

export interface ObjectiveDetachmentEffect {
  id: string;
  radius: number; // in inches
  color: string;
  fill: string;
  badgeBg: string;
  badgeBorder: string;
  title: string;
  desc: string;
}

export function getObjectiveEffects(s: GameState, o: ObjectiveState): ObjectiveDetachmentEffect[] {
  const effects: ObjectiveDetachmentEffect[] = [];
  const ctrl = o.controller;

  // 1. Chaos Daemons - Shadow of Chaos (6" aura)
  const isCorrupted = o.corrupted !== null && o.corrupted !== undefined;
  const isListedCorrupted = (s.players[0]?.corruptedObjectives ?? []).includes(o.id) || (s.players[1]?.corruptedObjectives ?? []).includes(o.id);
  const isDaemonCtrl = ctrl !== null && (s.players[ctrl]?.factionId === 'CD' || (s.players[ctrl]?.detachments ?? []).some((d) => [
    'Daemonic Incursion', 'Legion of Excess', 'Scintillating Legion', 'Blood Legion',
    'Plague Legion', 'Shadow Legion', 'Cavalcade of Chaos', 'Lords of the Warp', 'Warptide',
  ].includes(d.name)));

  if (isCorrupted || isListedCorrupted || isDaemonCtrl) {
    effects.push({
      id: 'shadow-of-chaos',
      radius: 6.0,
      color: '#c084fc',
      fill: 'url(#warp-shadow)',
      badgeBg: 'rgba(76, 29, 149, 0.92)',
      badgeBorder: '#a855f7',
      title: 'SHADOW OF CHAOS (6")',
      desc: 'Deep Strike 6" · +1 Ld (Enemy -1 Ld)',
    });
  }

  // 2. Grey Knights - Warpbane Task Force (Hallowed Ground - 3" zone)
  if (ctrl !== null && (s.players[ctrl]?.detachments ?? []).some((d) => d.name === 'Warpbane Task Force')) {
    effects.push({
      id: 'hallowed-ground',
      radius: 3.0,
      color: '#38bdf8',
      fill: 'url(#hallowed-ground)',
      badgeBg: 'rgba(12, 74, 110, 0.92)',
      badgeBorder: '#0284c7',
      title: 'HALLOWED GROUND (3")',
      desc: 'Grey Knights: +1 to Hit · 4+ Invulnerable Save',
    });
  }

  // 3. Necrons - Canoptek Court (Power Matrix - 6" aura)
  if (ctrl !== null && (s.players[ctrl]?.detachments ?? []).some((d) => d.name === 'Canoptek Court')) {
    effects.push({
      id: 'power-matrix',
      radius: 6.0,
      color: '#4ade80',
      fill: 'url(#power-matrix)',
      badgeBg: 'rgba(20, 83, 45, 0.92)',
      badgeBorder: '#16a34a',
      title: 'POWER MATRIX (6")',
      desc: 'Cryptek & Canoptek: Re-roll All Hits',
    });
  }

  // 4. Leagues of Votann - Fortified Position (3" zone)
  if (ctrl !== null && s.players[ctrl]?.factionId === 'LOV') {
    effects.push({
      id: 'fortified-position',
      radius: 3.0,
      color: '#fbbf24',
      fill: 'url(#fortified-ground)',
      badgeBg: 'rgba(120, 53, 15, 0.92)',
      badgeBorder: '#d97706',
      title: 'FORTIFIED POSITION (3")',
      desc: 'Votann: +1 to Hit Attacking from here',
    });
  }

  // 5. Dark Angels - Vowed Objective (3" zone)
  const isVowed = (s.players[0]?.vowed ?? []).includes(o.id) || (s.players[1]?.vowed ?? []).includes(o.id);
  if (isVowed) {
    effects.push({
      id: 'vowed-objective',
      radius: 3.0,
      color: '#fde047',
      fill: 'rgba(250, 204, 21, 0.16)',
      badgeBg: 'rgba(113, 63, 18, 0.92)',
      badgeBorder: '#ca8a04',
      title: 'VOWED OBJECTIVE (3")',
      desc: 'Inner Circle: +1 to Wound vs enemy on it',
    });
  }

  // 6. Death Guard - Blighted Objective (3" zone)
  const isBlighted = s.players.some((p) => (p.blight ?? []).some((b) => b.objId === o.id));
  if (isBlighted) {
    effects.push({
      id: 'blighted-objective',
      radius: 3.0,
      color: '#a3e635',
      fill: 'rgba(132, 204, 22, 0.16)',
      badgeBg: 'rgba(54, 83, 20, 0.92)',
      badgeBorder: '#65a30d',
      title: 'BLIGHTED OBJECTIVE (3")',
      desc: 'Enemies in range become Afflicted (-1 T)',
    });
  }

  // 7. Sticky Objective (Secured - 3" zone)
  if (o.secured !== null && o.secured !== undefined && o.controller === o.secured) {
    effects.push({
      id: 'secured-sticky',
      radius: 3.0,
      color: '#34d399',
      fill: 'url(#secured-ground)',
      badgeBg: 'rgba(6, 78, 59, 0.92)',
      badgeBorder: '#059669',
      title: 'SECURED (STICKY)',
      desc: 'Controlled even if vacated until enemy takes it',
    });
  }

  // 8. Warded Objective (6" aura)
  if (o.warded !== null && o.warded !== undefined) {
    effects.push({
      id: 'warded-zone',
      radius: 6.0,
      color: '#60a5fa',
      fill: 'rgba(37, 99, 235, 0.16)',
      badgeBg: 'rgba(30, 58, 138, 0.92)',
      badgeBorder: '#2563eb',
      title: 'WARDED (6")',
      desc: 'Enemy Daemons cannot Deep Strike within 6"',
    });
  }

  // 9. Sabotaged / Mutated / Snared (3" hazard)
  if (o.sabotaged != null || o.mutated != null || o.snared != null) {
    effects.push({
      id: 'sabotaged-hazard',
      radius: 3.0,
      color: '#f87171',
      fill: 'url(#sabotaged-ground)',
      badgeBg: 'rgba(127, 29, 29, 0.92)',
      badgeBorder: '#dc2626',
      title: o.sabotaged != null ? 'SABOTAGED (3")' : o.snared != null ? 'MORTIS SNARE (3")' : 'MUTATED LANDSCAPE (3")',
      desc: 'Enemy moving here takes D3 Mortal Wounds',
    });
  }

  // 10. Roguelike Supply Cache (3" zone)
  if (s.campaign && o.controller === null) {
    effects.push({
      id: 'supply-cache',
      radius: 3.0,
      color: '#facc15',
      fill: 'url(#supply-cache)',
      badgeBg: 'rgba(113, 63, 18, 0.92)',
      badgeBorder: '#ca8a04',
      title: 'SUPPLY CACHE (3")',
      desc: 'First capture awards +25 Scrap / +1 CP',
    });
  }

  return effects;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function alongPath(p: Pt[], f: number): Pt {
  const total = pathLen(p);
  if (total < 1e-6) return p[p.length - 1];
  let want = total * f;
  for (let i = 1; i < p.length; i++) {
    const d = dist(p[i - 1], p[i]);
    if (want <= d) { const k = d ? want / d : 0; return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * k, y: p[i - 1].y + (p[i].y - p[i - 1].y) * k }; }
    want -= d;
  }
  return p[p.length - 1];
}

function pathLen(p: Pt[]) { let d = 0; for (let i = 1; i < p.length; i++) d += dist(p[i - 1], p[i]); return d; }

interface DragState {
  pointerId: number;
  start: Pt;
  models: string[];
  base: Paths; // paths at drag start (with new waypoint appended)
  moved: boolean;
  unitId: string;
  modelId: string;
  solo?: boolean; // single picked model: re-aim its move from where it started
  grab?: Pt; // that model's position when the drag began
  last?: Paths; // the draft as last sent
}

/** A model's base drawn to its real shape: round, oval, or a vehicle hull (rounded rectangle), turned to its facing;
 *  `grow` draws it that much bigger all round (selection rings, Engagement Range). */
function BaseShape({ m, p, grow = 0, ...rest }: { m: ModelState; p: Pt; grow?: number } & React.SVGProps<SVGElement>) {
  const attrs = rest as Record<string, unknown>;
  if (!m.hl) return <circle cx={p.x} cy={p.y} r={m.r + grow} {...attrs} />;
  const hw = (m.hw ?? m.r) + grow, len = m.hl + hw, deg = ((m.rot ?? 0) * 180) / Math.PI;
  const t = `rotate(${deg} ${p.x} ${p.y})`;
  return m.hull
    ? <rect x={p.x - len} y={p.y - hw} width={len * 2} height={hw * 2} rx={hw * 0.45} transform={t} {...attrs} />
    : <ellipse cx={p.x} cy={p.y} rx={len} ry={hw} transform={t} {...attrs} />;
}

/** Calculate hit flinch / recoil / twitch offset for a model being shot, struck, or caught in explosions. */
function modelFlinch(u: UnitState, m: ModelState, fx: ActiveFx[], now: number): { x: number; y: number; intensity: number } | null {
  if (!fx.length) return null;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
  const relevant = fx.some((a) => (a.e.kind === 'attack' && a.e.targetId === u.id) || (a.e.kind === 'mortal' && a.e.unitId === u.id) || a.e.kind === 'explosion');
  if (!relevant) return null;
  // Dead models must NEVER flinch/shake unless actively dying from this specific attack event
  if (m.dead && !isDyingModel(u, m, fx, now)) return null;
  for (const a of fx) {
    if (a.e.kind === 'attack' && a.e.targetId === u.id) {
      const f = (now - a.t0) / FX_MS.attack;
      if (f < 0.08 || f > 0.72) continue;
      const dx = (a.e.to?.x ?? m.x) - a.e.from.x;
      const dy = (a.e.to?.y ?? m.y) - a.e.from.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist, uy = dy / dist;
      const px = -uy, py = ux;
      const r = m.hl ? (m.hw ?? m.r) : m.r;
      const baseKick = Math.min(0.38, Math.max(0.16, r * 0.38));
      let hash = a.e.seq;
      for (let i = 0; i < m.id.length; i++) hash = ((hash * 31) + m.id.charCodeAt(i)) | 0;
      hash = Math.abs(hash);

      const progress = (f - 0.08) / 0.47;
      if (progress <= 1) {
        const shotCount = Math.min(14, Math.max(5, a.e.hits ?? a.e.shots ?? 8));
        const shotIndex = progress * shotCount;
        const phaseOffset = ((hash % 100) / 100) * 0.35;
        const shotPhase = (shotIndex + phaseOffset) % 1;
        const kick = Math.exp(-shotPhase * 4.5) * Math.sin(shotPhase * Math.PI);
        const shudder = Math.sin(f * 95 + hash) * 0.06;
        const lateral = Math.sin(f * 65 + hash * 3) * 0.09;
        const recoilMag = baseKick * kick * 2.2 + shudder;
        const lateralMag = baseKick * lateral;
        const intensity = Math.min(1, kick * 1.5 + Math.abs(shudder) * 5);
        return {
          x: ux * recoilMag + px * lateralMag,
          y: uy * recoilMag + py * lateralMag,
          intensity,
        };
      } else {
        const rec = (f - 0.55) / 0.17;
        const settle = Math.exp(-rec * 5) * Math.cos(rec * Math.PI * 3);
        const recoilMag = baseKick * 0.35 * settle;
        return {
          x: ux * recoilMag,
          y: uy * recoilMag,
          intensity: Math.max(0, settle * 0.4),
        };
      }
    }
    if (a.e.kind === 'mortal' && a.e.unitId === u.id) {
      const f = (now - a.t0) / FX_MS.mortal;
      if (f < 0.05 || f > 0.65) continue;
      let hash = a.e.seq;
      for (let i = 0; i < m.id.length; i++) hash = ((hash * 31) + m.id.charCodeAt(i)) | 0;
      hash = Math.abs(hash);
      const shake = Math.sin(f * 85 + hash) * Math.exp(-f * 5) * 0.25;
      return {
        x: shake,
        y: Math.cos(f * 70 + hash) * Math.exp(-f * 5) * 0.2,
        intensity: Math.exp(-f * 4),
      };
    }
    if (a.e.kind === 'explosion') {
      const f = (now - a.t0) / FX_MS.explosion;
      if (f > 0.02 && f < 0.5) {
        const d = Math.hypot(m.x - a.e.at.x, m.y - a.e.at.y);
        if (d <= a.e.range) {
          const dx = m.x - a.e.at.x, dy = m.y - a.e.at.y;
          const len = Math.hypot(dx, dy) || 1;
          const push = (1 - d / a.e.range) * (1 - f / 0.5) * 0.35;
          return {
            x: (dx / len) * push,
            y: (dy / len) * push,
            intensity: 1 - f / 0.5,
          };
        }
      }
    }
  }
  return null;
}

/** Is this model currently in the process of taking fatal damage before the damage numbers / hit fx finish? */
function isDyingModel(u: UnitState, m: ModelState, fx: ActiveFx[], now: number): boolean {
  if (!m.dead || !fx.length) return false;
  const relevant = fx.some((a) => (a.e.kind === 'attack' && a.e.targetId === u.id) || (a.e.kind === 'mortal' && a.e.unitId === u.id));
  if (!relevant) return false;
  for (const a of fx) {
    if (a.e.kind === 'attack' && a.e.targetId === u.id) {
      if (!a.e.deadIds || !a.e.deadIds.includes(m.id)) continue;
      const f = (now - a.t0) / FX_MS.attack;
      if (f < 0.75 && (a.e.killed ?? 0) > 0) return true;
    }
    if (a.e.kind === 'mortal' && a.e.unitId === u.id) {
      if (!a.e.deadIds || !a.e.deadIds.includes(m.id)) continue;
      const f = (now - a.t0) / FX_MS.mortal;
      if (f < 0.75) return true;
    }
  }
  return false;
}

/** Delay wound deduction until damage numbers and impact effects pop up first (Thai req: เลขดาเมจกับเอฟเฟคขึ้นก่อน ค่อยให้เลือดลด) */
function getModelDisplayWounds(u: UnitState, m: ModelState, fx: ActiveFx[], now: number): { wounds: number; low: boolean; fading?: number } {
  if (!fx.length) return { wounds: m.wounds, low: m.wounds * 2 <= m.profile.W };
  const relevant = fx.some((a) => (a.e.kind === 'attack' && a.e.targetId === u.id) || (a.e.kind === 'mortal' && a.e.unitId === u.id));
  if (!relevant) return { wounds: m.wounds, low: m.wounds * 2 <= m.profile.W };
  for (const a of fx) {
    if (a.e.kind === 'attack' && a.e.targetId === u.id) {
      if (m.dead && (!a.e.deadIds || !a.e.deadIds.includes(m.id))) continue;
      const f = (now - a.t0) / FX_MS.attack;
      // f < 0.55: attacks are flying and damage numbers/effects are popping up first!
      if (f < 0.55 && (a.e.dmg ?? 0) > 0) {
        if (m.dead && (!a.e.deadIds || !a.e.deadIds.includes(m.id))) continue;
        const prev = Math.min(m.profile.W, (m.dead ? 1 : m.wounds) + (a.e.dmg ?? 1));
        return { wounds: prev, low: prev * 2 <= m.profile.W };
      }
      if (m.dead && f >= 0.55 && f < 0.75) {
        return { wounds: 0, low: true, fading: Math.max(0, (0.75 - f) / 0.2) };
      }
    }
    if (a.e.kind === 'mortal' && a.e.unitId === u.id) {
      if (m.dead && (!a.e.deadIds || !a.e.deadIds.includes(m.id))) continue;
      const f = (now - a.t0) / FX_MS.mortal;
      if (f < 0.55 && (a.e.n ?? 0) > 0) {
        if (m.dead && (!a.e.deadIds || !a.e.deadIds.includes(m.id))) continue;
        const prev = Math.min(m.profile.W, (m.dead ? 1 : m.wounds) + (a.e.n ?? 1));
        return { wounds: prev, low: prev * 2 <= m.profile.W };
      }
      if (m.dead && f >= 0.55 && f < 0.75) {
        return { wounds: 0, low: true, fading: Math.max(0, (0.75 - f) / 0.2) };
      }
    }
  }
  return { wounds: m.wounds, low: m.wounds * 2 <= m.profile.W };
}

function BoardImpl(props: BoardProps) {
  usePortraitsVersion();
  const { s, draft, draftUnit, maxFor, onDraft, walk } = props;
  const p0Theme = getPlayerFactionTheme(s, 0);
  const p1Theme = getPlayerFactionTheme(s, 1);
  const COLORS = [p0Theme.primary, p1Theme.primary];
  const SOFT = [p0Theme.soft, p1Theme.soft];
  const W = Math.max(RULES.battlefield.width, s.table?.width ?? RULES.battlefield.width);
  const H = Math.max(RULES.battlefield.height, s.table?.height ?? RULES.battlefield.height);
  // board popover for clicked interactive ability/wargear badges
  const [boardPopover, setBoardPopover] = useState<{ info: AbilityOrWeaponInfo; rect: DOMRect } | null>(null);
  // models picked for single-model adjustment (tap a model of the moving unit); otherwise a drag moves the whole unit
  const [solo, setSolo] = useState<string[]>([]);
  useEffect(() => setSolo([]), [draftUnit]);
  // --- effects: replay new engine events as short animations ---
  const seen = useRef(s.fxSeq ?? 0);
  const [fx, setFx] = useState<ActiveFx[]>([]);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const fresh = (s.fx ?? []).filter((e) => e.seq > seen.current);
    if (s.fxSeq !== undefined && s.fxSeq < seen.current) seen.current = s.fxSeq; // undo
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.seq));
    const t0 = performance.now();
    const keep = fresh.filter((e) => (e.kind !== 'roll' || (!!e.unitId && !!e.at)) && e.kind !== 'rolloff' && e.kind !== 'cards' && (e.kind !== 'move' || props.animateMoves?.includes(e.owner)));
    // the new kinds of moment get their sound here (attacks are voiced by the attack report)
    const voice: Partial<Record<FxEvent['kind'], Sfx>> = { shock: 'shock', heal: 'heal', place: 'arrive' };
    for (const k of new Set(keep.map((e) => (e.kind === 'move' && e.moveKind === 'charge' ? 'charge' : voice[e.kind])).filter((x): x is Sfx => !!x))) play(k);
    if (keep.some((e) => e.kind === 'roll' && !!e.unitId)) play('dice', 2);
    // stagger events from the same step a little so they read in order
    setFx((cur) => [...cur.filter((a) => t0 - a.t0 < FX_MS[a.e.kind]), ...keep.map((e, i) => ({ e, t0: t0 + i * 180 }))]);
  }, [s.fx, s.fxSeq, props.animateMoves]);
  // drop finished effects (one re-render when each ends; the effects themselves animate in FxLayer)
  useEffect(() => {
    if (!fx.length) return;
    const end = Math.min(...fx.map((a) => a.t0 + FX_MS[a.e.kind]));
    const id = setTimeout(() => { const t = performance.now(); setFx((cur) => cur.filter((a) => t - a.t0 < FX_MS[a.e.kind])); }, Math.max(16, end - performance.now() + 20));
    return () => clearTimeout(id);
  }, [fx]);
  // redraw every frame during unit moves, or while models flinch from attacks, explosions or mortal wounds
  const animating = fx.some((a) => a.e.kind === 'move' || a.e.kind === 'attack' || a.e.kind === 'mortal' || a.e.kind === 'explosion');
  useEffect(() => {
    if (!animating) return;
    let raf = 0;
    let lastTick = 0;
    const tick = (time: number) => {
      // Throttle board full re-render animation to ~30 FPS (33ms) to prevent pegging 120Hz/144Hz displays
      if (time - lastTick >= 33) {
        lastTick = time;
        setNow(time);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animating]);
  const animPos = useMemo(() => {
    const m = new Map<string, Pt>();
    for (const a of fx) {
      if (a.e.kind !== 'move') continue;
      const f = Math.min(1, Math.max(0, (now - a.t0) / FX_MS.move));
      if (f >= 1) continue;
      for (const [id, p] of a.e.paths) m.set(id, alongPath(p, ease(f)));
    }
    return m;
  }, [fx, now]);
  const acting = useMemo(() => {
    const ids = new Set<string>();
    for (const a of fx) {
      if (a.e.kind === 'move' || a.e.kind === 'place') ids.add(a.e.unitId);
      if (a.e.kind === 'attack') ids.add(a.e.attackerId);
      if (a.e.kind === 'skill') ids.add(a.e.unitId);
    }
    return ids;
  }, [fx]);
  // an objective changing hands: a ring in the new controller's colour sweeps out from it
  const ctrlPrev = useRef(s.objectives.map((o) => o.controller));
  const [caps, setCaps] = useState<{ id: string; x: number; y: number; p: PlayerId; k: number }[]>([]);
  useEffect(() => {
    const prev = ctrlPrev.current;
    ctrlPrev.current = s.objectives.map((o) => o.controller);
    const fresh = s.objectives.flatMap((o, i) => (o.controller !== null && prev[i] !== undefined && o.controller !== prev[i] ? [{ id: o.id, x: o.x, y: o.y, p: o.controller, k: Date.now() + i }] : []));
    if (!fresh.length) return;
    setCaps((c) => [...c, ...fresh]);
    const tm = setTimeout(() => setCaps((c) => c.filter((x) => !fresh.includes(x))), 1400);
    return () => clearTimeout(tm);
  }, [s.objectives]);
  const svgRef = useRef<SVGSVGElement>(null);
  // phones: the bottom sheet covers the lower part of the screen, so the battlefield sits at the top, not in the middle
  const FIT = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)')?.matches ? 'xMidYMin meet' : 'xMidYMid meet';
  // the whole table: the battlefield plus the strips the side cards lie on
  const sides = (props.side ?? []).filter((x) => x.cards.length);
  const padL = sides.some((x) => x.at !== 'right') ? SIDE : 0, padR = sides.some((x) => x.at === 'right') ? SIDE : 0;
  const home = useMemo(() => ({ x: -1 - padL, y: -1, w: W + 2 + padL + padR, h: H + 2 }), [padL, padR, W, H]);
  const [vb, setVb] = useState(home);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ id: number; sx: number; sy: number; vb: typeof vb; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; vb: typeof vb; mid: Pt } | null>(null);
  const drag = useRef<DragState | null>(null);

  const toBoard = useCallback((cx: number, cy: number): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const r = pt.matrixTransform(m.inverse());
    return { x: r.x, y: r.y };
  }, []);

  // keep aspect when the element resizes
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    setVb(home);
  }, [home]);

  const zoomAt = (factor: number, c: Pt, base = vb) => {
    const w = Math.min(W * 2.5, Math.max(8, base.w * factor));
    const h = (w / base.w) * base.h;
    setVb({ x: c.x - ((c.x - base.x) * w) / base.w, y: c.y - ((c.y - base.y) * h) / base.h, w, h });
  };

  const onWheel = (e: React.WheelEvent) => {
    zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, toBoard(e.clientX, e.clientY));
  };

  const startModelDrag = (e: React.PointerEvent, unitId: string, modelId: string) => {
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    const canDrag = draft && draftUnit === unitId && draft.has(modelId);
    if (!canDrag) {
      drag.current = { pointerId: e.pointerId, start: toBoard(e.clientX, e.clientY), models: [], base: new Map(), moved: false, unitId, modelId };
      return;
    }
    if (solo.includes(modelId)) {
      const p = draft!.get(modelId)!;
      drag.current = { pointerId: e.pointerId, start: toBoard(e.clientX, e.clientY), models: [modelId], base: new Map([[modelId, [...p]]]), moved: false, unitId, modelId, solo: true, grab: { ...p[p.length - 1] } };
      return;
    }
    // whole unit: every model keeps a straight line from where it started this move, so dragging again re-aims it
    // (no hidden waypoints eating the move distance); walls and enemy models are routed around when the drag ends
    const models = [...draft!.keys()];
    const base: Paths = new Map([...draft!].map(([id, p]) => [id, [...p]]));
    drag.current = { pointerId: e.pointerId, start: toBoard(e.clientX, e.clientY), models, base, moved: false, unitId, modelId };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), vb, mid: toBoard((a.x + b.x) / 2, (a.y + b.y) / 2) };
      pan.current = null;
      drag.current = null;
      return;
    }
    pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vb, moved: false };
  };

  const moveRaf = useRef(0);
  const pendingPointer = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const propsRef = useRef({ draft, onDraft, walk, maxFor, toBoard, zoomAt });
  propsRef.current = { draft, onDraft, walk, maxFor, toBoard, zoomAt };

  useEffect(() => {
    return () => {
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    };
  }, []);

  const flushPointerMove = useCallback(() => {
    moveRaf.current = 0;
    const pending = pendingPointer.current;
    if (!pending) return;
    const { pointerId, clientX, clientY } = pending;
    pendingPointer.current = null;

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      propsRef.current.zoomAt(pinch.current.d / Math.max(d, 1), pinch.current.mid, pinch.current.vb);
      return;
    }
    const dg = drag.current;
    if (dg && dg.pointerId === pointerId) {
      const { draft: curDraft, onDraft: curOnDraft, walk: curWalk, maxFor: curMaxFor, toBoard: curToBoard } = propsRef.current;
      const p = curToBoard(clientX, clientY);
      const dx = p.x - dg.start.x, dy = p.y - dg.start.y;
      if (!dg.moved && Math.hypot(dx, dy) < 0.25) return;
      dg.moved = true;
      if (!dg.models.length || !curOnDraft || !curDraft) return;
      if (dg.solo && dg.grab) {
        // one model: straight line from where it started this move, clamped to its own maximum
        const id = dg.models[0];
        const path = dg.base.get(id)!;
        const origin = path[0];
        let end = { x: dg.grab.x + dx, y: dg.grab.y + dy };
        if (path.length >= 2) {
          const max = curMaxFor?.(id) ?? Infinity;
          const d = dist(origin, end);
          if (d > max) end = { x: origin.x + ((end.x - origin.x) * max) / d, y: origin.y + ((end.y - origin.y) * max) / d };
        }
        const next: Paths = new Map(curDraft);
        next.set(id, path.length < 2 ? [end] : curWalk ? curWalk(id, [origin, end]) : [origin, end]);
        dg.last = next;
        curOnDraft(next);
        return;
      }
      // each model ends at most its maximum from where it started this move: one at its limit slides along that
      // circle instead of freezing the whole unit, so the unit can always be dragged on in any direction
      const next: Paths = new Map(curDraft);
      for (const id of dg.models) {
        const path = dg.base.get(id)!;
        const last = path[path.length - 1];
        let end = { x: last.x + dx, y: last.y + dy };
        if (path.length >= 2) {
          const o = path[0];
          const max = curMaxFor?.(id) ?? Infinity;
          const d = dist(o, end);
          if (d > max) end = { x: o.x + ((end.x - o.x) * max) / d, y: o.y + ((end.y - o.y) * max) / d };
        }
        next.set(id, path.length < 2 ? [end] : curWalk ? curWalk(id, [path[0], end]) : [path[0], end]);
      }
      dg.last = next;
      curOnDraft(next);
      return;
    }
    const pn = pan.current;
    if (pn && pn.id === pointerId) {
      const dx = clientX - pn.sx, dy = clientY - pn.sy;
      if (!pn.moved && Math.hypot(dx, dy) < 6) return;
      pn.moved = true;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scale = Math.max(pn.vb.w / rect.width, pn.vb.h / rect.height);
      setVb({ ...pn.vb, x: pn.vb.x - dx * scale, y: pn.vb.y - dy * scale });
    }
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pendingPointer.current = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
    if (!moveRaf.current) {
      moveRaf.current = requestAnimationFrame(flushPointerMove);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
    }
    if (pendingPointer.current) {
      flushPointerMove();
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const dg = drag.current;
    if (dg && dg.pointerId === e.pointerId) {
      drag.current = null;
      if (!dg.moved) {
        // tapping a model of the unit being moved picks it for single-model adjustment
        if (dg.models.length && draftUnit === dg.unitId) setSolo((cur) => (cur[0] === dg.modelId ? [] : [dg.modelId]));
        else props.onTapUnit?.(dg.unitId, dg.modelId);
      } else {
        if (!solo.includes(dg.modelId)) setSolo([]);
        if (dg.last) props.onDragEnd?.(dg.last);
      }
      return;
    }
    const pn = pan.current;
    if (pn && pn.id === e.pointerId) {
      pan.current = null;
      if (!pn.moved) props.onTapBoard?.(toBoard(e.clientX, e.clientY));
    }
  };

  const dep = deploymentById(s.deploymentId);
  const attacker = s.attackerPlayer;
  const defender = (1 - attacker) as PlayerId;
  const fs = Math.min(0.65, Math.max(0.42, vb.w / 55));

  const units = useMemo(() => s.units.filter((u) => onBoard(u) || u.id === draftUnit), [s.units, draftUnit]);
  const enemyOfDraft = draftUnit ? s.units.find((u) => u.id === draftUnit)?.owner : undefined;

  const posOf = (u: UnitState, id: string, m: Pt): Pt => {
    const ap = animPos.get(id);
    if (ap) return ap;
    if (draft && draftUnit === u.id) {
      const p = draft.get(id);
      if (p) return p[p.length - 1];
    }
    return m;
  };

  const ground = useMemo(() => groundTexture(), []);
  // terrain never changes during a battle: build it once, so redrawing moving units does not rebuild every wall
  const terrainKey = s.terrain.map((t) => t.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ground + footprint art painted once into one picture (dozens of clipped images would be redrawn on every frame)
  const backdrop = useBackdrop(s.terrain, terrainKey, ground, W, H);
  const backdropReady = !!backdrop;
  const terrainEls = useMemo(() => s.terrain.map((t) => {
        const pts = t.poly.map((p) => `${p.x},${p.y}`).join(' ');
        const xs = t.poly.map((p) => p.x), ys = t.poly.map((p) => p.y);
        const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
        const seed = [...t.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
        const rnd = (i: number) => { const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
        if (t.kind === 'crater') {
          return (
            <g key={t.id} pointerEvents="none">
              <ellipse cx={x0 + w / 2} cy={y0 + h / 2} rx={w / 2} ry={h / 2} fill="url(#crater)" stroke="#2a251d" strokeWidth={0.08} />
              <ellipse cx={x0 + w * 0.6} cy={y0 + h * 0.4} rx={w * 0.18} ry={h * 0.14} fill="#2a251d" opacity={0.6} />
            </g>
          );
        }
        if (t.kind === 'barricade') {
          return (
            <g key={t.id} pointerEvents="none">
              <polygon points={pts} fill="rgba(160,150,95,0.25)" stroke="rgba(0,0,0,0.35)" strokeWidth={0.06} strokeDasharray="0.3 0.2" />
              <rect x={x0 + 0.25} y={y0 + 0.25} width={Math.max(0.5, w - 0.5)} height={Math.max(0.5, h - 0.5)} rx={0.3} fill="url(#sandbags)" stroke="#4a4128" strokeWidth={0.08} />
            </g>
          );
        }
        if (t.kind === 'container') {
          return (
            <g key={t.id} pointerEvents="none">
              <rect x={x0} y={y0} width={w} height={h} fill="url(#ribs)" stroke="#2b1a10" strokeWidth={0.25} />
              <rect x={x0 + 0.25} y={y0 + 0.25} width={w - 0.5} height={h - 0.5} fill="none" stroke="#a36b43" strokeWidth={0.08} />
              <g opacity={0.8}><SvgIcon name="shock" x={x0 + w / 2} y={y0 + h / 2} size={0.8} color="#f3d9a4" /></g>
            </g>
          );
        }
        if (t.kind === 'objective-area') {
          return null;
        }
        // terrain area: baseplate, rubble, ruin walls (block sight) and obstacles (low, cover only)
        const cxp = t.poly.reduce((a, p) => a + p.x, 0) / t.poly.length, cyp = t.poly.reduce((a, p) => a + p.y, 0) / t.poly.length;
        const inner = t.poly.map((p) => `${cxp + (p.x - cxp) * 0.86},${cyp + (p.y - cyp) * 0.86}`).join(' ');
        const plate = plateFor(t);
        return (
          <g key={t.id} pointerEvents="none">
            {/* with footprint art the plate itself is drawn on the still layer underneath (see plateEls) */}
            <polygon points={pts} fill={plate && backdropReady ? 'none' : t.category === 'dense' ? 'url(#tiles)' : 'rgba(170,158,128,0.55)'} stroke="#1c1712" strokeWidth={0.14} />
            <polygon points={inner} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.06} />
            {t.box && (() => {
              // a solid block (container / bunker) standing on the plate: shadow, metal top with ribs, lit rim
              const bp = t.box.map((p) => `${p.x},${p.y}`).join(' ');
              const sp = t.box.map((p) => `${p.x + 0.3},${p.y + 0.42}`).join(' ');
              const bc = polyCentroid(t.box);
              const [a, b] = [t.box[0], t.box[1]];
              const long = dist(t.box[0], t.box[1]) >= dist(t.box[1], t.box[2]);
              const u = long ? { x: b.x - a.x, y: b.y - a.y } : { x: t.box[2].x - b.x, y: t.box[2].y - b.y };
              const L = Math.hypot(u.x, u.y) || 1;
              const ribs = Math.max(2, Math.floor(L / 0.5));
              const across = long ? { x: t.box[2].x - b.x, y: t.box[2].y - b.y } : { x: b.x - a.x, y: b.y - a.y };
              return (
                <g>
                  <polygon points={sp} fill="rgba(0,0,0,0.45)" />
                  <polygon points={bp} fill="#4a3a2a" stroke="#1a130c" strokeWidth={0.14} strokeLinejoin="round" />
                  {Array.from({ length: ribs - 1 }, (_, k) => {
                    const f = (k + 1) / ribs - 0.5;
                    const c0 = { x: bc.x + (u.x * f), y: bc.y + (u.y * f) };
                    return <line key={k} x1={c0.x - across.x * 0.45} y1={c0.y - across.y * 0.45} x2={c0.x + across.x * 0.45} y2={c0.y + across.y * 0.45} stroke="#2e2318" strokeWidth={0.07} />;
                  })}
                  <polygon points={t.box.map((p) => `${bc.x + (p.x - bc.x) * 0.9},${bc.y + (p.y - bc.y) * 0.9}`).join(' ')} fill="none" stroke="rgba(255,220,170,0.25)" strokeWidth={0.06} />
                </g>
              );
            })()}
            {!(plate && backdropReady) && Array.from({ length: Math.min(9, Math.round(w * h / 6)) }, (_, i) => {
              const px = x0 + 0.5 + rnd(i) * Math.max(0, w - 1), py = y0 + 0.5 + rnd(i + 9) * Math.max(0, h - 1);
              return pointInPoly({ x: px, y: py }, t.poly) ? <circle key={i} cx={px} cy={py} r={0.12 + rnd(i + 3) * 0.22} fill="#4b4335" opacity={0.85} /> : null;
            })}
            {(t.obstacles ?? []).map((ob, i) => (
              <g key={`o${i}`}>
                <line x1={ob.a.x} y1={ob.a.y} x2={ob.b.x} y2={ob.b.y} stroke="#3a2a12" strokeWidth={0.5} strokeLinecap="round" />
                <line x1={ob.a.x} y1={ob.a.y} x2={ob.b.x} y2={ob.b.y} stroke="#d98b1f" strokeWidth={0.3} strokeLinecap="round" strokeDasharray="0.45 0.15" />
              </g>
            ))}
            {t.walls.filter((wl) => !onBoxEdge(t, wl)).map((wl, i) => (
              // the wall's shadow: ruins stand 5" tall
              <line key={`sh${i}`} x1={wl.a.x + 0.22} y1={wl.a.y + 0.32} x2={wl.b.x + 0.22} y2={wl.b.y + 0.32} stroke="rgba(0,0,0,0.38)" strokeWidth={0.95} strokeLinecap="square" />
            ))}
            {t.walls.filter((wl) => !onBoxEdge(t, wl)).map((wl, i) => {
              const len = dist(wl.a, wl.b);
              const n = Math.max(1, Math.floor(len / 2));
              return (
                <g key={i}>
                  <line x1={wl.a.x} y1={wl.a.y} x2={wl.b.x} y2={wl.b.y} stroke="#14261c" strokeWidth={0.6} strokeLinecap="square" />
                  <line x1={wl.a.x} y1={wl.a.y} x2={wl.b.x} y2={wl.b.y} stroke="#3e7a58" strokeWidth={0.32} strokeLinecap="square" />
                  {Array.from({ length: n }, (_, k) => {
                    const f = (k + 0.5) / n;
                    return <circle key={k} cx={wl.a.x + (wl.b.x - wl.a.x) * f} cy={wl.a.y + (wl.b.y - wl.a.y) * f} r={0.13} fill="#0d1a12" />;
                  })}
                </g>
              );
            })}
          </g>
        );
      }), [terrainKey, backdropReady]);

  const territoryAuras = useMemo(() => {
    if (props.zones === false) return null;
    return ([0, 1] as PlayerId[]).map((p) => {
      const hasFlow = hasFlowOfMagic(s, p);
      const hasShadow = isDaemonsArmy(s, p);
      if (!hasFlow && !hasShadow) return null;

      const ownZ = zonePoly(s, p);
      const oppZ = zonePoly(s, other(p));
      const ownPts = ownZ.map((pt) => `${pt.x},${pt.y}`).join(' ');
      const oppPts = oppZ.map((pt) => `${pt.x},${pt.y}`).join(' ');
      const nmlD = `M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z M ${ownZ.map((pt) => `${pt.x} ${pt.y}`).join(' L ')} Z M ${oppZ.map((pt) => `${pt.x} ${pt.y}`).join(' L ')} Z`;
      const ownCentroid = polyCentroid(ownZ);
      const oppCentroid = polyCentroid(oppZ);

      if (hasFlow) {
        const flow = flowAreas(s, p);
        return (
          <g key={`flow-of-magic-${p}`} pointerEvents="none" className="flow-magic-aura">
            {/* Own deployment zone: ALWAYS in Flow of Magic */}
            <polygon points={ownPts} fill="rgba(6, 182, 212, 0.12)" />
            <polygon points={ownPts} fill="none" stroke="rgba(34, 211, 238, 0.35)" strokeWidth={0.38} strokeDasharray="1.2 0.6" />
            <polygon points={ownPts} fill="url(#flow-magic-pattern)" stroke="#22d3ee" strokeWidth={0.18} strokeDasharray="1.2 0.6" />
            <g transform={`translate(${ownCentroid.x} ${ownCentroid.y})`} opacity={0.18}>
              <rect x={-3.4} y={-0.34} width={6.8} height={0.68} rx={0.34} fill="rgba(8, 47, 73, 0.6)" stroke="#22d3ee" strokeWidth={0.06} strokeDasharray="0.3 0.15" />
              <text y={0.12} fontSize={0.34} textAnchor="middle" fill="#67e8f9" fontWeight={800} letterSpacing={0.05}>FLOW OF MAGIC (OWN ZONE)</text>
            </g>

            {/* No Man's Land: active when controlling half of NML objectives */}
            {flow.nml && (
              <g>
                <path d={nmlD} fillRule="evenodd" fill="rgba(6, 182, 212, 0.14)" />
                <path d={nmlD} fillRule="evenodd" fill="none" stroke="rgba(34, 211, 238, 0.35)" strokeWidth={0.36} strokeDasharray="1.2 0.6" />
                <path d={nmlD} fillRule="evenodd" fill="url(#flow-magic-pattern)" stroke="#22d3ee" strokeWidth={0.18} strokeDasharray="1.2 0.6" />
                <g transform={`translate(${W / 2} ${H / 2})`} opacity={0.18}>
                  <rect x={-4.4} y={-0.34} width={8.8} height={0.68} rx={0.34} fill="rgba(8, 47, 73, 0.6)" stroke="#22d3ee" strokeWidth={0.06} strokeDasharray="0.3 0.15" />
                  <text y={0.12} fontSize={0.34} textAnchor="middle" fill="#67e8f9" fontWeight={800} letterSpacing={0.05}>FLOW OF MAGIC: NO MAN'S LAND (+1 WOUND)</text>
                </g>
              </g>
            )}

            {/* Opponent Zone: active when controlling half of enemy zone objectives */}
            {flow.opp && (
              <g>
                <polygon points={oppPts} fill="rgba(6, 182, 212, 0.14)" />
                <polygon points={oppPts} fill="none" stroke="rgba(34, 211, 238, 0.35)" strokeWidth={0.38} strokeDasharray="1.2 0.6" />
                <polygon points={oppPts} fill="url(#flow-magic-pattern)" stroke="#22d3ee" strokeWidth={0.18} strokeDasharray="1.2 0.6" />
                <g transform={`translate(${oppCentroid.x} ${oppCentroid.y})`} opacity={0.18}>
                  <rect x={-3.9} y={-0.34} width={7.8} height={0.68} rx={0.34} fill="rgba(8, 47, 73, 0.6)" stroke="#22d3ee" strokeWidth={0.06} strokeDasharray="0.3 0.15" />
                  <text y={0.12} fontSize={0.34} textAnchor="middle" fill="#67e8f9" fontWeight={800} letterSpacing={0.05}>FLOW OF MAGIC: ENEMY ZONE BREACHED</text>
                </g>
              </g>
            )}
          </g>
        );
      }

      if (hasShadow) {
        const nmlObjs = s.objectives.filter((o) => !pointInPoly(o, ownZ) && !pointInPoly(o, oppZ));
        const controlsNml = nmlObjs.length > 0 && nmlObjs.filter((o) => o.controller === p).length * 2 >= nmlObjs.length;
        const oppObjs = s.objectives.filter((o) => pointInPoly(o, oppZ));
        const controlsOpp = oppObjs.length > 0 && oppObjs.filter((o) => o.controller === p).length * 2 >= oppObjs.length;

        return (
          <g key={`shadow-of-chaos-${p}`} pointerEvents="none" className="shadow-chaos-aura">
            {/* Own deployment zone: ALWAYS in Shadow of Chaos */}
            <polygon points={ownPts} fill="rgba(147, 51, 234, 0.12)" />
            <polygon points={ownPts} fill="none" stroke="rgba(192, 132, 252, 0.35)" strokeWidth={0.38} strokeDasharray="1.2 0.6" />
            <polygon points={ownPts} fill="url(#shadow-chaos-pattern)" stroke="#c084fc" strokeWidth={0.18} strokeDasharray="1.2 0.6" />
            <g transform={`translate(${ownCentroid.x} ${ownCentroid.y})`} opacity={0.18}>
              <rect x={-3.4} y={-0.34} width={6.8} height={0.68} rx={0.34} fill="rgba(59, 7, 100, 0.6)" stroke="#c084fc" strokeWidth={0.06} strokeDasharray="0.3 0.15" />
              <text y={0.12} fontSize={0.34} textAnchor="middle" fill="#d8b4fe" fontWeight={800} letterSpacing={0.05}>SHADOW OF CHAOS (OWN ZONE)</text>
            </g>

            {/* No Man's Land */}
            {controlsNml && (
              <g>
                <path d={nmlD} fillRule="evenodd" fill="rgba(147, 51, 234, 0.14)" />
                <path d={nmlD} fillRule="evenodd" fill="none" stroke="rgba(192, 132, 252, 0.35)" strokeWidth={0.36} strokeDasharray="1.2 0.6" />
                <path d={nmlD} fillRule="evenodd" fill="url(#shadow-chaos-pattern)" stroke="#c084fc" strokeWidth={0.18} strokeDasharray="1.2 0.6" />
                <g transform={`translate(${W / 2} ${H / 2})`} opacity={0.18}>
                  <rect x={-4.4} y={-0.34} width={8.8} height={0.68} rx={0.34} fill="rgba(59, 7, 100, 0.6)" stroke="#c084fc" strokeWidth={0.06} strokeDasharray="0.3 0.15" />
                  <text y={0.12} fontSize={0.34} textAnchor="middle" fill="#d8b4fe" fontWeight={800} letterSpacing={0.05}>SHADOW OF CHAOS: NO MAN'S LAND</text>
                </g>
              </g>
            )}

            {/* Opponent Zone */}
            {controlsOpp && (
              <g>
                <polygon points={oppPts} fill="rgba(147, 51, 234, 0.14)" />
                <polygon points={oppPts} fill="none" stroke="rgba(192, 132, 252, 0.35)" strokeWidth={0.38} strokeDasharray="1.2 0.6" />
                <polygon points={oppPts} fill="url(#shadow-chaos-pattern)" stroke="#c084fc" strokeWidth={0.18} strokeDasharray="1.2 0.6" />
                <g transform={`translate(${oppCentroid.x} ${oppCentroid.y})`} opacity={0.18}>
                  <rect x={-3.9} y={-0.34} width={7.8} height={0.68} rx={0.34} fill="rgba(59, 7, 100, 0.6)" stroke="#c084fc" strokeWidth={0.06} strokeDasharray="0.3 0.15" />
                  <text y={0.12} fontSize={0.34} textAnchor="middle" fill="#d8b4fe" fontWeight={800} letterSpacing={0.05}>SHADOW OF CHAOS: ENEMY ZONE</text>
                </g>
              </g>
            )}
          </g>
        );
      }

      return null;
    });
  }, [props.zones, s.deploymentId, s.players, s.objectives, W, H]);

  const unitStatusMap = useMemo(() => {
    const map = new Map<string, {
      hasFlowOfMagic: boolean;
      unitInFlow: boolean;
      isDaemon: boolean;
      unitInShadow: boolean;
      enemyInShadow: boolean;
      hasPsychicWep: boolean;
      hasStealth: boolean;
      hasLoneOp: boolean;
      loRange: number | null;
      isInfBeastOp: boolean;
      hasCover: boolean;
    }>();

    // Precompute terrain bounding boxes once for fast spatial culling
    const terrainWithBoxes = s.terrain
      .filter((t) => t.category !== 'exposed')
      .map((t) => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of t.poly) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return { t, minX, maxX, minY, maxY };
      });

    for (const u of s.units) {
      if (!onBoard(u)) continue;
      const ms = alive(u);
      const unitHasFlow = hasFlowOfMagic(s, u.owner);
      const unitInFlow = unitHasFlow && inFlow(s, u);
      const isDaemon = isDaemonUnit(u) && isDaemonsArmy(s, u.owner);
      const unitInShadow = isDaemon && isUnderShadowOfChaos(s, u.owner, u);
      const enemyInShadow = !isDaemon && isDaemonsArmy(s, other(u.owner)) && isUnderShadowOfChaos(s, other(u.owner), u);
      const hasPsychicWep = ms.some((m) => m.weapons?.some((w) => w.profiles?.some((p) => p.abilities?.includes('psychic'))));
      const uFlags = unitFlags(s, u);
      const isInfBeastOp = isInfantryBeastLoneOpActive(s, u);
      const loRange = getUnitLoneOpRange(s, u);
      const hasStealth = !!(u.core.stealth || uFlags.stealth || u.buffs?.some((b) => b.kind === 'smoke'));
      const hasLoneOp = loRange !== null;
      const hasCover = !!(
        u.buffs?.some((b) => b.kind === 'cover' || b.kind === 'smoke') ||
        ms.some((m) => {
          const mr = m.hl ? Math.max(m.r, m.hw ?? m.r) + (m.hl ?? 0) : m.r;
          return terrainWithBoxes.some(({ t, minX, maxX, minY, maxY }) => {
            if (m.x + mr < minX || m.x - mr > maxX || m.y + mr < minY || m.y - mr > maxY) return false;
            return bodyTouchesPoly(m, 0, t.poly);
          });
        })
      );
      map.set(u.id, {
        hasFlowOfMagic: unitHasFlow,
        unitInFlow,
        isDaemon,
        unitInShadow,
        enemyInShadow,
        hasPsychicWep,
        hasStealth,
        hasLoneOp,
        loRange,
        isInfBeastOp,
        hasCover,
      });
    }
    return map;
  }, [s]);

  const untargetableModelIds = useMemo(() => {
    const set = new Set<string>();
    if (!s || props.viewer === undefined) return set;
    const selectedUnit = props.selected ? s.units.find((x) => x.id === props.selected) : null;
    const selAlive = selectedUnit && selectedUnit.owner === props.viewer ? alive(selectedUnit) : null;
    const isTargetingActive = s.phase === 'shooting' || (props.targets && props.targets.length > 0);

    const friendlyUnits = s.units.filter((fu) => fu.owner === props.viewer && onBoard(fu));
    const friendlyModels = friendlyUnits.flatMap((fu) => alive(fu));

    for (const u of s.units) {
      if (u.owner === props.viewer || !onBoard(u)) continue;
      const st = unitStatusMap.get(u.id);
      const hasLoneOp = st?.hasLoneOp ?? false;
      const loRange = st?.loRange ?? null;
      const activeRange = loRange ?? 12;

      for (const m of alive(u)) {
        if (selAlive && selAlive.length > 0 && isTargetingActive) {
          // Check Lone Operative first (fast distance check)
          if (hasLoneOp && selAlive.every((sm) => Math.abs(sm.x - m.x) > activeRange || Math.abs(sm.y - m.y) > activeRange || baseDist(sm, m) > activeRange)) {
            set.add(m.id);
            continue;
          }
          // If allowed targets specified, skip non-targets without raycasting
          if (props.targets && props.targets.length > 0 && !props.targets.includes(u.id)) {
            set.add(m.id);
            continue;
          }
          // Distance culling before raycasting: beyond 48"
          if (selAlive.every((sm) => Math.abs(sm.x - m.x) > 48 || Math.abs(sm.y - m.y) > 48)) {
            set.add(m.id);
            continue;
          }
          // Check line of sight from closest friendly model first
          const canBeTargeted = selAlive.some((sm) => modelVisible(s, sm, u, m));
          if (!canBeTargeted) set.add(m.id);
        } else if (hasLoneOp) {
          // Outside active targeting, check Lone Operative with AABB early-out
          const anyFriendlyInRange = friendlyModels.some((fm) => Math.abs(fm.x - m.x) <= activeRange && Math.abs(fm.y - m.y) <= activeRange && baseDist(fm, m) <= activeRange);
          if (!anyFriendlyInRange) set.add(m.id);
        }
      }
    }
    return set;
  }, [s, props.selected, props.viewer, props.targets, unitStatusMap]);

  const engagementRings = useMemo(() => {
    if (!draftUnit || enemyOfDraft === undefined) return [];
    return s.units
      .filter((u) => u.owner !== enemyOfDraft && onBoard(u))
      .flatMap((u) => alive(u).map((m) => ({ id: m.id, m })));
  }, [draftUnit, enemyOfDraft, s.units]);

  return (
    <>
    <svg
      ref={svgRef}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio={FIT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <defs>
        <marker id="plan-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#f87171" /></marker>
        {ground && <pattern id="ground" width="11" height="11" patternUnits="userSpaceOnUse"><image href={ground} width="11" height="11" preserveAspectRatio="none" /></pattern>}
        <pattern id="grid" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.04" />
        </pattern>
        <pattern id="ash" width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="#5d5648" />
          <circle cx="1.2" cy="1.5" r="0.9" fill="#655d4e" /><circle cx="4.8" cy="3.9" r="1.3" fill="#544d40" />
          <circle cx="2.6" cy="5.6" r="0.6" fill="#6b6352" /><circle cx="6.1" cy="0.8" r="0.5" fill="#4f483c" />
          <circle cx="3.5" cy="2.6" r="0.2" fill="#7a705c" /><circle cx="5.9" cy="6.3" r="0.3" fill="#7a705c" />
        </pattern>
        <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
          <stop offset="60%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity="0.35" />
        </radialGradient>
        <pattern id="tiles" width="1" height="1" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#6e6658" /><path d="M1 0 L0 0 0 1" fill="none" stroke="#585043" strokeWidth="0.06" />
        </pattern>
        <pattern id="sandbags" width="1" height="0.7" patternUnits="userSpaceOnUse">
          <rect width="1" height="0.7" fill="#7d7350" /><rect x="0.05" y="0.08" width="0.9" height="0.55" rx="0.25" fill="#9a8f63" stroke="#5c5338" strokeWidth="0.05" />
        </pattern>
        <pattern id="ribs" width="0.8" height="0.8" patternUnits="userSpaceOnUse">
          <rect width="0.8" height="0.8" fill="#7a4b2e" /><rect width="0.25" height="0.8" fill="#8d5a38" />
        </pattern>
        <radialGradient id="crater"><stop offset="0" stopColor="#2f2a22" /><stop offset="0.7" stopColor="#4a4336" /><stop offset="1" stopColor="#6d6452" /></radialGradient>
        <linearGradient id="fx-flame" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff3c4" /><stop offset="0.4" stopColor="#fb923c" /><stop offset="1" stopColor="#b91c1c" stopOpacity="0.2" /></linearGradient>
        <radialGradient id="objdisc"><stop offset="0" stopColor="#f1f2f4" /><stop offset="1" stopColor="#8d939c" /></radialGradient>
        <radialGradient id="warp-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c084fc" stopOpacity="0.36" />
          <stop offset="60%" stopColor="#9333ea" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#7e22ce" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hallowed-ground" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.38" />
          <stop offset="60%" stopColor="#0284c7" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0369a1" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="power-matrix" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4ade80" stopOpacity="0.38" />
          <stop offset="60%" stopColor="#16a34a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#15803d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fortified-ground" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.38" />
          <stop offset="60%" stopColor="#d97706" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#b45309" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="secured-ground" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.32" />
          <stop offset="60%" stopColor="#059669" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#047857" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sabotaged-ground" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f87171" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#dc2626" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#991b1b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="supply-cache" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde047" stopOpacity="0.38" />
          <stop offset="60%" stopColor="#eab308" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#a16207" stopOpacity="0" />
        </radialGradient>

        <pattern id="flow-magic-pattern" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <path d="M 0 0 L 3 3 M 3 0 L 0 3" fill="none" stroke="rgba(34, 211, 238, 0.22)" strokeWidth="0.12" strokeDasharray="0.8 0.4" />
          <circle cx="1.5" cy="1.5" r="0.25" fill="rgba(103, 232, 249, 0.3)" />
        </pattern>
        <pattern id="shadow-chaos-pattern" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
          <path d="M 0 0 L 3 3 M 3 0 L 0 3" fill="none" stroke="rgba(192, 132, 252, 0.22)" strokeWidth="0.12" strokeDasharray="0.8 0.4" />
          <circle cx="1.5" cy="1.5" r="0.25" fill="rgba(216, 180, 254, 0.3)" />
        </pattern>
      </defs>
      {backdrop
        ? <image href={backdrop} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
        : <rect x={0} y={0} width={W} height={H} fill={ground ? 'url(#ground)' : 'url(#ash)'} />}
      <rect x={0} y={0} width={W} height={H} fill="url(#grid)" />
      {props.zones !== false && (
        <>
          <polygon points={scaledPoly(dep.zones.attacker, W, H).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[attacker]} stroke={COLORS[attacker]} strokeWidth={0.1} strokeDasharray="0.5 0.3" />
          <polygon points={scaledPoly(dep.zones.defender, W, H).map((p) => `${p.x},${p.y}`).join(' ')} fill={SOFT[defender]} stroke={COLORS[defender]} strokeWidth={0.1} strokeDasharray="0.5 0.3" />
        </>
      )}
      {/* Detachment Territory Auras: Thousand Sons Flow of Magic & Chaos Daemons Shadow of Chaos */}
      {territoryAuras}
      <polygon points={scaledPoly(dep.territory.attacker, W, H).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.1} strokeDasharray="0.5 0.4" pointerEvents="none" />
      {Array.from({ length: Math.floor(H / 6) + 1 }, (_, i) => (
        <text key={`ty${i}`} x={0.2} y={i * 6 + 0.5} fontSize={0.6} fill="rgba(255,255,255,0.4)">{i * 6}"</text>
      ))}
      {Array.from({ length: Math.floor(W / 6) + 1 }, (_, i) => (
        <text key={`tx${i}`} x={i * 6 + 0.15} y={H - 0.25} fontSize={0.6} fill="rgba(255,255,255,0.4)">{i * 6}"</text>
      ))}
      {terrainEls}
      {props.edgeGuide !== undefined && props.edgeGuide > 0 && props.edgeGuide * 2 < Math.min(W, H) && (
        <g pointerEvents="none">
          <rect x={props.edgeGuide} y={props.edgeGuide} width={W - props.edgeGuide * 2} height={H - props.edgeGuide * 2}
            fill="none" stroke="#f5d48a" strokeWidth={0.16} strokeDasharray="0.65 0.35" />
          <text x={props.edgeGuide + 0.35} y={props.edgeGuide + 0.95} fontSize={0.72} fill="#f5d48a" stroke="#111" strokeWidth={0.12} paintOrder="stroke" fontWeight={900}>
            {props.edgeGuide}" FROM EDGE
          </text>
        </g>
      )}
      {props.zoneGuide && (
        <g pointerEvents="none">
          <polygon points={props.zoneGuide.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="none"
            stroke="rgba(239,68,68,0.18)" strokeWidth={props.zoneGuide.distance * 2} strokeLinejoin="round" />
          <polygon points={props.zoneGuide.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="none"
            stroke="rgba(252,165,165,0.8)" strokeWidth={0.13} strokeDasharray="0.55 0.3" />
          <text x={props.zoneGuide.poly[0].x + 0.35} y={props.zoneGuide.poly[0].y + 0.95} fontSize={0.72}
            fill="#fecaca" stroke="#111" strokeWidth={0.12} paintOrder="stroke" fontWeight={900}>
            {props.zoneGuide.distance}" FROM ENEMY DEPLOYMENT ZONE
          </text>
        </g>
      )}
      {s.units.filter((u) => u.homer && u.status === 'reserves').map((u) => (
        <g key={'homer-' + u.id} pointerEvents="none">
          <circle cx={u.homer!.x} cy={u.homer!.y} r={3} fill="none" stroke={u.owner ? 'var(--p1)' : 'var(--p0)'} strokeWidth={0.15} strokeDasharray="0.5 0.3" />
          <circle cx={u.homer!.x} cy={u.homer!.y} r={0.7} fill={u.owner ? 'var(--p1)' : 'var(--p0)'} stroke="#fff" strokeWidth={0.15} />
          <text x={u.homer!.x} y={u.homer!.y - 1.2} textAnchor="middle" fontSize={0.9} fill="#fff" stroke="#000" strokeWidth={0.12} paintOrder="stroke">Homer</text>
        </g>
      ))}
      {props.goals?.map((g) => (
        <g key={'goal-' + g.id} pointerEvents="none" className="goal">
          {g.areas.map((a, i) => <polygon key={i} points={a.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(245,212,138,0.10)" stroke="#f5d48a" strokeWidth={0.18} strokeDasharray="0.9 0.5" />)}
          {g.circles.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={c.r} fill="none" stroke="#f5d48a" strokeWidth={0.16} strokeDasharray="0.7 0.4" />)}
          {g.objectives.map((oid) => {
            const o = s.objectives.find((x) => x.id === oid);
            if (!o) return null;
            return (
              <g key={oid}>
                <circle cx={o.x} cy={o.y} r={3.2} fill="none" stroke="#f5d48a" strokeWidth={0.22} className="goal-ring" />
                <g transform={`translate(${o.x} ${o.y + 4.1})`}>
                  <rect x={-3.6} y={-0.48} width={7.2} height={0.95} rx={0.45} fill="rgba(60,40,0,0.9)" stroke="#f5d48a" strokeWidth={0.06} />
                  <text y={0.2} fontSize={0.55} textAnchor="middle" fill="#f5d48a" fontWeight={800}>{g.name.length > 24 ? g.name.slice(0, 23) + '…' : g.name}</text>
                </g>
              </g>
            );
          })}
        </g>
      ))}
      {s.objectives.map((o, i) => {
        const [a, b] = levelOfControl(s, o);
        const ctrl = o.controller;
        const objRadius = 3 + 20 / 25.4; // 3" control zone from 40mm marker edge = ~3.787"
        const top = o.y - objRadius;
        const cx = o.x;
        const bannerY = top > 1.8 ? top - 0.55 : o.y + objRadius + 1.25;
        const label = o.type === 'home' ? 'HOME' : o.type === 'central' ? 'CENTRE' : 'OBJ';
        const effects = getObjectiveEffects(s, o);

        const pendingAction = s.pendingActions?.find((x) => x.objId === o.id);
        const isContested = a > 0 && b > 0;
        const isInProgress = !!pendingAction || isContested;
        const pendingActionDef = pendingAction ? MISSIONS.actions[pendingAction.action] : null;
        const pendingTheme = pendingAction ? getPlayerFactionTheme(s, pendingAction.player) : null;

        const isSecured = o.secured != null;
        const isCleansed = s.players.some((p) => p.sec?.cleansed?.some((x) => x.objId === o.id));
        const isConsecrated = s.players.some((p) => p.mission?.consecrated?.includes(o.id));
        const isDecoyed = s.players.some((p) => p.mission?.decoyed?.includes(o.id));
        const isTriangulated = s.players.some((p) => p.mission?.triangulated?.includes(o.id));
        const isCompleted = isSecured || isCleansed || isConsecrated || isDecoyed || isTriangulated;

        return (
          <g key={o.id} pointerEvents="none">
            {/* Territory / Detachment Aura Circles */}
            {effects.map((eff) => (
              <g key={eff.id}>
                <circle
                  cx={o.x}
                  cy={o.y}
                  r={eff.radius}
                  fill={eff.fill}
                  stroke={eff.color}
                  strokeWidth={0.14}
                  strokeDasharray="0.6 0.3"
                  opacity={0.88}
                />
                <circle
                  cx={o.x}
                  cy={o.y}
                  r={eff.radius - 0.28}
                  fill="none"
                  stroke={eff.color}
                  strokeWidth={0.06}
                  opacity={0.45}
                />
                <text
                  x={o.x + eff.radius - 0.25}
                  y={o.y - 0.2}
                  fontSize={0.42}
                  fill={eff.color}
                  fontWeight={800}
                  textAnchor="end"
                  stroke="#000"
                  strokeWidth={0.08}
                  paintOrder="stroke"
                >
                  {eff.radius}"
                </text>
              </g>
            ))}

            {/* Standard 3" Objective Control Area (40mm marker + 3" radius) */}
            <circle
              cx={o.x}
              cy={o.y}
              r={objRadius}
              fill={ctrl === null ? 'rgba(245,184,61,0.08)' : SOFT[ctrl]}
              stroke={ctrl === null ? '#f5b83d' : COLORS[ctrl]}
              strokeWidth={0.16}
              strokeDasharray="0.6 0.25"
            />

            {/* In-Progress Animated Dashed Halo */}
            {isInProgress && (
              <circle
                cx={o.x} cy={o.y} r={1.16}
                fill="none"
                stroke={pendingAction ? pendingTheme!.primary : '#f59e0b'}
                strokeWidth={0.15}
                strokeDasharray="0.32 0.18"
                className={isContested ? 'obj-contested-pulse' : 'obj-inprogress-pulse'}
              />
            )}

            {/* Completed Glow Halo */}
            {isCompleted && (
              <circle
                cx={o.x} cy={o.y} r={1.06}
                fill="none"
                stroke={ctrl !== null ? COLORS[ctrl] : '#10b981'}
                strokeWidth={0.16}
                className="obj-completed-glow"
              />
            )}

            <circle cx={o.x} cy={o.y} r={0.79} fill="url(#objdisc)" stroke="#111" strokeWidth={0.08} />
            <circle cx={o.x} cy={o.y} r={0.55} fill="none" stroke={ctrl === null ? '#555' : COLORS[ctrl]} strokeWidth={0.18} />
            <text x={o.x} y={o.y + 0.27} fontSize={0.75} textAnchor="middle" fill="#111" fontWeight={900}>{i + 1}</text>
            
            {/* Completed Check Badge */}
            {isCompleted && (
              <g>
                <circle cx={o.x + 1.15} cy={o.y - 0.75} r={0.62} fill="rgba(12,13,16,0.92)" stroke="#10b981" strokeWidth={0.08} />
                <SvgIcon name="check" x={o.x + 1.15} y={o.y - 0.75} size={0.7} color="#10b981" />
              </g>
            )}
            {o.secured != null && !isCompleted && <g><circle cx={o.x + 1.15} cy={o.y - 0.75} r={0.62} fill="rgba(12,13,16,0.9)" stroke={COLORS[o.secured]} strokeWidth={0.08} /><SvgIcon name="hold" x={o.x + 1.15} y={o.y - 0.75} size={0.8} color={COLORS[o.secured]} /></g>}
            {o.warded != null && <g><circle cx={o.x + 1.15} cy={o.y + 0.75} r={0.55} fill="rgba(12,13,16,0.9)" stroke={COLORS[o.warded]} strokeWidth={0.08} /><text x={o.x + 1.15} y={o.y + 0.95} fontSize={0.62} textAnchor="middle" fill={COLORS[o.warded]} fontWeight={900}>W</text></g>}
            
            <g transform={`translate(${cx} ${bannerY})`}>
              <rect x={-2.1} y={-0.5} width={4.2} height={0.95} rx={0.45} fill="rgba(12,13,16,0.85)" stroke={ctrl === null ? '#f5b83d' : COLORS[ctrl]} strokeWidth={0.06} />
              <text x={-1.85} y={0.2} fontSize={0.55} fill="#f5b83d" fontWeight={800}>{label}</text>
              <text x={1.95} y={0.2} fontSize={0.55} textAnchor="end" fontWeight={800}>
                <tspan fill={COLORS[0]}>{a}</tspan><tspan fill="#aaa"> : </tspan><tspan fill={COLORS[1]}>{b}</tspan>
              </text>
              {pendingAction ? (
                <g transform="translate(0 0.95)">
                  <rect x={-2.4} y={-0.38} width={4.8} height={0.76} rx={0.3} fill="rgba(14,16,20,0.92)" stroke={pendingTheme!.primary} strokeWidth={0.07} />
                  <text x={0} y={0.16} fontSize={0.36} textAnchor="middle" fill={pendingTheme!.primary} fontWeight={800}>
                    ACTION: {pendingActionDef?.name?.toUpperCase() ?? 'IN PROGRESS'}
                  </text>
                </g>
              ) : isContested ? (
                <g transform="translate(0 0.95)">
                  <rect x={-2.1} y={-0.38} width={4.2} height={0.76} rx={0.3} fill="rgba(14,16,20,0.92)" stroke="#f59e0b" strokeWidth={0.07} />
                  <text x={0} y={0.16} fontSize={0.36} textAnchor="middle" fill="#f59e0b" fontWeight={800}>
                    CONTESTED
                  </text>
                </g>
              ) : isCompleted ? (
                <g transform="translate(0 0.95)">
                  <rect x={-2.2} y={-0.38} width={4.4} height={0.76} rx={0.3} fill="rgba(14,16,20,0.92)" stroke="#10b981" strokeWidth={0.07} />
                  <text x={0} y={0.16} fontSize={0.36} textAnchor="middle" fill="#10b981" fontWeight={800}>
                    {isSecured ? 'SECURED' : isCleansed ? 'CLEANSED' : isConsecrated ? 'CONSECRATED' : 'COMPLETED'}
                  </text>
                </g>
              ) : null}
            </g>

            {/* Detachment territory effects: one short chip (the rings show the areas; the full text is the tooltip) */}
            {effects.length > 0 && (() => {
              const label = effects.map((eff) => eff.title.replace(/\s*\(.*\)$/, '')).join(' · ');
              const badgeW = Math.min(W - 1, 0.95 + label.length * 0.27);
              const clampedX = Math.max(badgeW / 2 + 0.5, Math.min(W - badgeW / 2 - 0.5, cx));
              const badgeY = top > 2.8 ? bannerY - 0.9 : bannerY + 1.85;
              return (
                <g transform={`translate(${clampedX} ${badgeY})`}>
                  <title>{effects.map((eff) => `${eff.title}: ${eff.desc}`).join('\n')}</title>
                  <rect x={-badgeW / 2} y={-0.36} width={badgeW} height={0.72} rx={0.3} fill={effects[0].badgeBg} stroke={effects[0].badgeBorder} strokeWidth={0.07} />
                  <text x={0} y={0.14} fontSize={0.42} textAnchor="middle" fill="#ffffff" fontWeight={900}>{label}</text>
                </g>
              );
            })()}
          </g>
        );
      })}
      {s.markers.map((m) => (
        <g key={m.id} transform={`translate(${m.x} ${m.y})`} pointerEvents="none">
          <rect x={-0.55} y={-0.55} width={1.1} height={1.1} rx={0.15} transform="rotate(45)" fill={COLORS[m.owner]} stroke="#fff" strokeWidth={0.12} />
          <text y={0.22} fontSize={0.6} textAnchor="middle" fill="#fff" fontWeight={900}>{m.kind === 'trap' ? '!' : m.kind === 'locate' ? 'L' : m.kind === 'consecrate' ? '+' : ''}</text>
        </g>
      ))}
      {s.players.flatMap((P, pi) => (P.tunnels ?? []).map((t, i) => (
        <g key={`tunnel${pi}-${i}`} transform={`translate(${t.x} ${t.y})`} pointerEvents="none">
          <circle r={0.8} fill="rgba(12,14,18,0.85)" stroke={COLORS[pi]} strokeWidth={0.15} />
          <text y={0.22} fontSize={0.6} textAnchor="middle" fill="#fff" fontWeight={900}>T</text>
        </g>
      )))}
      {s.pendingActions.map((a) => {
        const u = s.units.find((x) => x.id === a.unitId);
        const ms = u ? alive(u) : [];
        if (!ms.length) return null;
        const c = { x: ms.reduce((q, m) => q + m.x, 0) / ms.length, y: Math.min(...ms.map((m) => m.y - m.r)) };
        const actTheme = getPlayerFactionTheme(s, a.player);
        const actDef = MISSIONS.actions[a.action];
        return (
          <g key={a.unitId + a.action} pointerEvents="none">
            <rect x={c.x - 2.4} y={c.y - 1.25} width={4.8} height={0.76} rx={0.35} fill="rgba(12,14,18,0.92)" stroke={actTheme.primary} strokeWidth={0.08} />
            <text x={c.x} y={c.y - 0.74} fontSize={0.38} textAnchor="middle" fill={actTheme.primary} fontWeight={800}>
              {actDef?.name?.toUpperCase() ?? 'ACTION'}...
            </text>
          </g>
        );
      })}
      {props.rings?.map((r, i) => (
        <circle key={`r${i}`} cx={r.c.x} cy={r.c.y} r={r.r} fill="none" stroke={r.color} strokeWidth={0.08} strokeDasharray={r.dash ? '0.35 0.25' : undefined} />
      ))}
      {props.losLines?.map((l, i) => (
        <line key={`los${i}`} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={l.cover ? '#fbbf24' : '#86efac'} strokeWidth={0.07} strokeDasharray="0.3 0.2" opacity={0.85} pointerEvents="none" />
      ))}
      {/* engagement range of enemies while moving */}
      {engagementRings.map(({ id, m }) => (
        <BaseShape key={`e${id}`} m={m} p={m} grow={RULES.engagementRange} fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.55)" strokeWidth={0.06} strokeDasharray="0.3 0.15" />
      ))}
      {units.map((u) => {
        const isDraft = draft && draftUnit === u.id;
        const isSel = props.selected === u.id;
        const isTarget = props.targets?.includes(u.id);
        const isPicked = props.picked?.includes(u.id);
        const isMovable = props.movable?.includes(u.id);
        const col = COLORS[u.owner];
        const uTheme = getUnitFactionTheme(s, u);
        const ms = u.models.filter((m) => !m.dead || isDyingModel(u, m, fx, now));
        const labels = loadoutLabels(u); // which model carries what, in a squad with mixed wargear
        const pts = ms.map((m) => posOf(u, m.id, m));
        const cx = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
        const minY = Math.min(...pts.map((p, i) => p.y - ms[i].r));
        const unitNumber = props.unitNumbers?.[u.id];
        const riled = props.riled?.includes(u.id);
        const tags = props.buffTags?.[u.id];
        const st = unitStatusMap.get(u.id);
        const hasFlowOfMagic = st?.hasFlowOfMagic ?? false;
        const unitInFlow = st?.unitInFlow ?? false;
        const isDaemon = st?.isDaemon ?? false;
        const unitInShadow = st?.unitInShadow ?? false;
        const enemyInShadow = st?.enemyInShadow ?? false;
        const hasPsychicWep = st?.hasPsychicWep ?? false;
        const hasStealth = st?.hasStealth ?? false;
        const hasLoneOp = st?.hasLoneOp ?? false;
        const hasCover = st?.hasCover ?? false;
        const isInfBeastOp = st?.isInfBeastOp ?? false;
        const loRange = st?.loRange ?? null;
        return (
          <g key={u.id}>
            {isDraft && ms.map((m) => {
              const p = draft!.get(m.id);
              if (!p || p.length < 2) return null;
              const used = pathLen(p);
              const maxAllowed = maxFor ? maxFor(m.id) : 999;
              const exceeds = used > maxAllowed + 0.05;
              const isBad = props.bad?.includes(m.id) || exceeds;
              const strokeColor = isBad ? '#ef4444' : '#10b981';
              return (
                <g key={`g${m.id}`} pointerEvents="none">
                  <BaseShape m={m} p={p[0]} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.06} strokeDasharray="0.2 0.15" />
                  <polyline
                    points={p.map((q) => `${q.x},${q.y}`).join(' ')}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isBad ? 0.11 : 0.08}
                    strokeDasharray={isBad ? '0.35 0.18' : undefined}
                  />
                  {ms.length <= 6 && maxFor && (
                    <circle
                      cx={p[0].x}
                      cy={p[0].y}
                      r={maxAllowed + m.r}
                      fill="none"
                      stroke={exceeds ? '#ef4444' : 'rgba(245,184,61,0.45)'}
                      strokeWidth={0.06}
                      strokeDasharray="0.3 0.2"
                    />
                  )}
                </g>
              );
            })}
            {ms.map((m, i) => {
              const p = pts[i];
              const bad = props.bad?.includes(m.id);
              // the photo fits the narrow side of an oval or hull base
              const pr = m.hl ? (m.hw ?? m.r) : m.r;
              const isSolo = isDraft && solo.includes(m.id);
              const flinch = modelFlinch(u, m, fx, now);
              const disp = getModelDisplayWounds(u, m, fx, now);
              const isEnemy = u.owner !== props.viewer;
              const isUntargetable = isEnemy && untargetableModelIds.has(m.id);
              return (
                <g
                  key={m.id}
                  data-unit={u.id}
                  onPointerDown={(e) => startModelDrag(e, u.id, m.id)}
                  style={{
                    cursor: isDraft ? 'grab' : 'pointer',
                    ...(isUntargetable ? { opacity: 0.45 } : {}),
                  }}
                  transform={flinch ? `translate(${flinch.x.toFixed(3)} ${flinch.y.toFixed(3)})` : undefined}
                  opacity={disp.fading !== undefined ? disp.fading : 1}
                >
                  <BaseShape m={m} p={p} grow={Math.max(0, 0.35 - m.r) + 0.35} fill="transparent" />
                  {acting.has(u.id) && <BaseShape m={m} p={p} grow={0.35} fill="none" stroke={col} strokeWidth={0.22} opacity={0.75} className="fx-glow" pointerEvents="none" />}
                  {(isSel || isPicked) && !isDraft && (
                    <>
                      <BaseShape m={m} p={p} grow={0.44} fill="none" stroke={uTheme.glow} strokeWidth={0.24} opacity={0.85} className="faction-aura-glow" pointerEvents="none" />
                      <BaseShape m={m} p={p} grow={0.26} fill="none" stroke={isSel ? uTheme.primary : uTheme.secondary} strokeWidth={0.16} className="sel-ring" pointerEvents="none" />
                    </>
                  )}
                  {isMovable && !isSel && !isDraft && !isPicked && <BaseShape m={m} p={p} grow={0.24} fill="none" stroke="#38bdf8" strokeWidth={0.13} strokeDasharray="0.32 0.18" className="movable-ring" pointerEvents="none" />}
                  {isTarget && !isPicked && !isSel && <BaseShape m={m} p={p} grow={0.28} fill="none" stroke="#fde68a" strokeWidth={0.1} strokeDasharray="0.3 0.2" pointerEvents="none" />}
                  {isSolo && <BaseShape m={m} p={p} grow={0.3} fill="none" stroke="#fff" strokeWidth={0.12} strokeDasharray="0.25 0.15" pointerEvents="none" />}
                  {unitInFlow && <BaseShape m={m} p={p} grow={0.34} fill="none" stroke="#22d3ee" strokeWidth={0.16} strokeDasharray="0.45 0.22" opacity={0.9} className="flow-magic-aura" pointerEvents="none" />}
                  {unitInShadow && <BaseShape m={m} p={p} grow={0.34} fill="none" stroke="#c084fc" strokeWidth={0.16} strokeDasharray="0.45 0.22" opacity={0.9} className="shadow-chaos-aura" pointerEvents="none" />}
                  {hasStealth && <BaseShape m={m} p={p} grow={0.3} fill="none" stroke="#38bdf8" strokeWidth={0.14} strokeDasharray="0.22 0.14" opacity={0.88} className="stealth-aura" pointerEvents="none" />}
                  {hasLoneOp && <BaseShape m={m} p={p} grow={0.38} fill="none" stroke="#fbbf24" strokeWidth={0.12} strokeDasharray="0.35 0.15" opacity={0.9} className="lone-op-aura" pointerEvents="none" />}
                  {hasLoneOp && (isSel || isTarget || isPicked) && (
                    <circle cx={p.x} cy={p.y} r={loRange ?? 12} fill="rgba(251, 191, 36, 0.02)" stroke="#fbbf24" strokeWidth={0.08} strokeDasharray="0.6 0.3" opacity={0.65} pointerEvents="none" />
                  )}
                  {riled && (
                    <g pointerEvents="none">
                      <path className="ork-flame" d={`M ${p.x - m.r * 0.95} ${p.y} Q ${p.x - m.r * 1.25} ${p.y - m.r * 1.2} ${p.x - m.r * 0.45} ${p.y - m.r * 1.95} Q ${p.x - m.r * 0.35} ${p.y - m.r * 1.3} ${p.x} ${p.y - m.r * 2.5} Q ${p.x + m.r * 0.3} ${p.y - m.r * 1.35} ${p.x + m.r * 0.5} ${p.y - m.r * 1.95} Q ${p.x + m.r * 1.25} ${p.y - m.r * 1.2} ${p.x + m.r * 0.95} ${p.y} Z`} fill="url(#ork-flame)" />
                      <BaseShape m={m} p={p} grow={0.12} fill="none" stroke="#4ade80" strokeWidth={0.16} opacity={0.85} className="fx-glow" />
                    </g>
                  )}
                  <BaseShape
                    m={m} p={p}
                    fill={bad ? '#7f1d1d' : '#ffffff'}
                    fillOpacity={1}
                    stroke={bad ? '#fca5a5' : isSel || isDraft ? uTheme.primary : isPicked ? uTheme.secondary : isTarget ? '#fde68a' : col}
                    strokeWidth={isSel || isDraft || isTarget || isPicked || bad ? 0.16 : 0.12}
                    strokeDasharray={u.battleShocked ? '0.25 0.15' : undefined}
                  />
                  {getModelPortrait(m)
                    ? <image href={getModelPortrait(m)} x={p.x - pr * 0.9} y={p.y - pr * 0.9} width={pr * 1.8} height={pr * 1.8} clipPath="url(#clip-round)" preserveAspectRatio="xMidYMid slice" pointerEvents="none" />
                    : <use href={`#tok-${modelToken(m)}`} x={p.x - pr * 0.82} y={p.y - pr * 0.82} width={pr * 1.64} height={pr * 1.64} pointerEvents="none" />}
                  {m.isCharacter && <use href="#tok-crown" x={p.x - m.r * 0.55} y={p.y - m.r * 1.35} width={m.r * 1.1} height={m.r * 0.66} pointerEvents="none" />}
                  {((m.profile.W > 1 && disp.wounds < m.profile.W) || (m.dead && disp.wounds > 0)) && (() => {
                    // wounds left on a small badge sitting on the base's rim, so the photo stays visible
                    const fsz = Math.max(0.48, Math.min(0.85, m.r * 0.55));
                    const by = p.y + m.r * 0.98;
                    return (
                      <g pointerEvents="none">
                        <rect x={p.x - fsz * 0.62} y={by - fsz * 0.72} width={fsz * 1.24} height={fsz * 0.98} rx={fsz * 0.3} fill="rgba(0,0,0,0.78)" stroke={disp.low ? '#f87171' : '#fde68a'} strokeWidth={0.06} />
                        <text x={p.x} y={by + fsz * 0.1} fontSize={fsz} textAnchor="middle" fill={disp.low ? '#fca5a5' : '#fff7d6'} stroke="#000" strokeWidth={fsz * 0.22} paintOrder="stroke" fontWeight={900}>{disp.wounds}</text>
                      </g>
                    );
                  })()}
                  {hasLoneOp && (
                    <g pointerEvents="none" transform={`translate(${p.x + m.r * 0.78} ${p.y + m.r * 0.78})`} className="fx-glow">
                      <circle r={0.36} fill={isInfBeastOp ? '#064e3b' : '#0f172a'} stroke={isInfBeastOp ? '#10b981' : '#f59e0b'} strokeWidth={0.08} />
                      <text y={0.11} fontSize={0.26} textAnchor="middle" fill={isInfBeastOp ? '#6ee7b7' : '#fbbf24'} fontWeight={900}>
                        {loRange ? `${loRange}"` : '12"'}
                      </text>
                    </g>
                  )}
                  {labels.has(m.id) && vb.w >= 30 && (
                    // zoomed out: words don't fit, a letter badge tells the kits apart (C = Claws, H = Hammer…)
                    <g pointerEvents="none">
                      <circle cx={p.x + m.r * 0.72} cy={p.y + m.r * 0.72} r={Math.max(0.32, m.r * 0.42)} fill="#fff7d6" stroke="#000" strokeWidth={0.07} />
                      <text x={p.x + m.r * 0.72} y={p.y + m.r * 0.72 + Math.max(0.32, m.r * 0.42) * 0.42} fontSize={Math.max(0.32, m.r * 0.42) * 1.25} textAnchor="middle" fill="#111" fontWeight={900}>{labels.get(m.id)!.charAt(0).toUpperCase()}</text>
                    </g>
                  )}
                  {labels.has(m.id) && vb.w < 30 && (isSel || isDraft) && (() => {
                    const raw = labels.get(m.id)!;
                    const items = raw.replace(/ \+$/, '').split('+').map((x) => x.trim()).filter(Boolean);
                    if (!items.length) return null;
                    const pillH = 0.44;
                    const placeAbove = p.y + m.r + 0.2 + pillH > H && p.y - m.r - pillH - 0.2 >= 0;
                    const badgeY = placeAbove ? p.y - m.r - 0.28 : p.y + m.r + 0.32;
                    return (
                      <g key={`badge-${m.id}`} pointerEvents="none">
                        {items.slice(0, 2).map((item, k) => {
                          const info = getAbilityOrWeaponInfo(item, u, m);
                          const label = info.badgeLabel || item;
                          const shortText = label.length > 14 ? label.slice(0, 13) + '…' : label;
                          const pillW = Math.max(1.6, Math.min(2.8, shortText.length * 0.16 + 0.65));
                          const offX = items.length === 1 ? 0 : (k === 0 ? -pillW / 2 - 0.08 : pillW / 2 + 0.08);
                          const bx = Math.max(pillW / 2 + 0.2, Math.min(W - pillW / 2 - 0.2, p.x + offX));
                          return (
                            <g
                              key={k}
                              className="board-ability-pill"
                              transform={`translate(${bx} ${badgeY})`}
                              pointerEvents="auto"
                              style={{ cursor: 'pointer' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setBoardPopover({ info, rect: e.currentTarget.getBoundingClientRect() });
                              }}
                            >
                              <rect
                                x={-pillW / 2}
                                y={-pillH / 2}
                                width={pillW}
                                height={pillH}
                                rx={pillH / 2}
                                fill="rgba(18, 20, 23, 0.94)"
                                stroke="#374151"
                                strokeWidth={0.04}
                                className="board-pill-rect"
                              />
                              {info.category.variant === 'cp' && (
                                <path
                                  d="M -0.15 -0.12 L -0.05 0 L -0.12 0 L -0.02 0.14 L 0.08 -0.02 L 0.01 -0.02 Z"
                                  transform={`translate(${-pillW / 2 + 0.25} 0) scale(0.8)`}
                                  fill="#34D399"
                                />
                              )}
                              <text
                                x={info.category.variant === 'cp' ? 0.08 : -0.1}
                                y={0.08}
                                fontSize={0.24}
                                textAnchor="middle"
                                fill="#E2E8F0"
                                fontWeight={700}
                              >
                                {shortText}
                              </text>
                              <circle
                                cx={pillW / 2 - 0.2}
                                cy={0}
                                r={0.11}
                                fill="none"
                                stroke="#F59E0B"
                                strokeWidth={0.03}
                                opacity={0.9}
                              />
                              <text
                                x={pillW / 2 - 0.2}
                                y={0.05}
                                fontSize={0.15}
                                textAnchor="middle"
                                fill="#F59E0B"
                                fontWeight={900}
                              >
                                i
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })()}
                  {props.noLos?.includes(m.id) && (
                    <g pointerEvents="none" transform={`translate(${p.x + m.r * 0.7} ${p.y - m.r * 0.7})`}>
                      <circle r={0.38} fill="#111" stroke="#f87171" strokeWidth={0.08} />
                      <path d="M -0.22 0 Q 0 -0.2 0.22 0 Q 0 0.2 -0.22 0 Z" fill="none" stroke="#fff" strokeWidth={0.06} />
                      <line x1={-0.26} y1={0.26} x2={0.26} y2={-0.26} stroke="#f87171" strokeWidth={0.09} />
                    </g>
                  )}
                </g>
              );
            })}
            {(isSel || isPicked || isDraft || vb.w < 30) && pts.length > 0 && (
              <text x={cx} y={minY - 0.35} fontSize={Math.min(0.56, fs * 0.85)} textAnchor="middle" fill={isTarget ? '#fde68a' : '#fff'} stroke="#000" strokeWidth={0.12} paintOrder="stroke" pointerEvents="none" fontWeight={700}>
                {u.name.length > 20 ? u.name.slice(0, 19) + '…' : u.name}{u.battleShocked ? ' !' : ''}
              </text>
            )}
            {props.badges?.[u.id]?.length && pts.length > 0 ? (() => {
              const uBadges = props.badges![u.id]!;
              const bCount = Math.min(uBadges.length, 3);
              return (
                <g transform={`translate(${cx} ${minY - 0.95})`} pointerEvents="none">
                  {uBadges.slice(0, 3).map((b, i) => {
                    const bOffset = (i - (bCount - 1) / 2) * 2.6;
                    const bText = b.length > 15 ? b.slice(0, 14) + '…' : b;
                    const pillW = Math.max(1.6, Math.min(2.5, bText.length * 0.16 + 0.5));
                    return (
                      <g key={i} transform={`translate(${bOffset} 0)`}>
                        <rect
                          x={-pillW / 2}
                          y={-0.22}
                          width={pillW}
                          height={0.44}
                          rx={0.22}
                          fill="rgba(18, 20, 23, 0.92)"
                          stroke="#F59E0B"
                          strokeWidth={0.04}
                        />
                        <text
                          y={0.08}
                          fontSize={0.24}
                          textAnchor="middle"
                          fill="#FDE68A"
                          fontWeight={800}
                        >
                          {bText}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })() : null}
            {props.quickActions?.unitId === u.id && pts.length > 0 && (() => {
              const qa = props.quickActions.actions;
              const btnW = 2.1;
              const gap = 0.22;
              const qaY = minY - (props.badges?.[u.id]?.length ? 2.3 : (hasStealth || hasLoneOp || hasCover) ? 2.0 : 1.4);
              return (
                <g transform={`translate(${cx} ${qaY})`} pointerEvents="auto">
                  {qa.map((act, i) => {
                    const offX = (i - (qa.length - 1) / 2) * (btnW + gap);
                    return (
                      <g
                        key={act.label}
                        transform={`translate(${offX} 0)`}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          act.onClick();
                        }}
                      >
                        <rect
                          x={-btnW / 2}
                          y={-0.34}
                          width={btnW}
                          height={0.68}
                          rx={0.34}
                          fill={act.primary ? '#d99b26' : '#121417'}
                          stroke={act.primary ? '#f59e0b' : 'rgba(217, 155, 38, 0.45)'}
                          strokeWidth={0.06}
                        />
                        <text
                          y={0.11}
                          fontSize={0.32}
                          textAnchor="middle"
                          fill={act.primary ? '#0f172a' : '#f1f5f9'}
                          fontWeight={800}
                        >
                          {act.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })()}
            {(isSel || isPicked || isTarget) && (hasStealth || hasLoneOp || hasCover || isInfBeastOp) && pts.length > 0 && (() => {
              const tacticalTags: { text: string; color: string; border: string; bg: string; icon: 'stealth' | 'shield' | 'radar' }[] = [];
              if (hasStealth) tacticalTags.push({ text: 'Stealth −1 Hit', color: '#38bdf8', border: '#38bdf8', bg: '#090d16', icon: 'stealth' });
              if (hasCover) tacticalTags.push({ text: 'Cover −1 BS', color: '#4ade80', border: '#4ade80', bg: '#090d16', icon: 'shield' });
              if (isInfBeastOp) tacticalTags.push({ text: 'Lone Op 15" (Beast)', color: '#34d399', border: '#34d399', bg: '#090d16', icon: 'stealth' });
              else if (hasLoneOp) tacticalTags.push({ text: 'Lone Op 12"', color: '#fbbf24', border: '#fbbf24', bg: '#090d16', icon: 'radar' });
              const tCount = tacticalTags.length;
              const tagY = props.badges?.[u.id]?.length ? minY - 1.55 : minY - 0.95;
              const pillW = 2.9;
              const pillSpacing = pillW + 0.35;
              return (
                <g transform={`translate(${cx} ${tagY})`} pointerEvents="none">
                  {tacticalTags.map((tag, i) => {
                    const off = (i - (tCount - 1) / 2) * pillSpacing;
                    return (
                      <g key={tag.text} transform={`translate(${off} 0)`}>
                        <rect
                          x={-pillW / 2}
                          y={-0.25}
                          width={pillW}
                          height={0.5}
                          rx={0.25}
                          fill="#090d16"
                          stroke={tag.border}
                          strokeWidth={0.07}
                        />
                        <SvgIcon name={tag.icon} x={-pillW / 2 + 0.35} y={0} size={0.32} color={tag.color} />
                        <text
                          x={0.16}
                          y={0.08}
                          fontSize={0.24}
                          textAnchor="middle"
                          fill={tag.color}
                          fontWeight={900}
                          stroke="#000"
                          strokeWidth={0.03}
                          paintOrder="stroke"
                        >
                          {tag.text}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })()}
            {unitNumber !== undefined && pts.length > 0 && (
              <g transform={`translate(${cx} ${minY - 0.65})`} pointerEvents="none">
                <circle r={0.55} fill="#f5d48a" stroke="#111" strokeWidth={0.12} />
                <text y={0.2} fontSize={0.62} textAnchor="middle" fill="#111" fontWeight={900}>{unitNumber}</text>
              </g>
            )}
            {u.transport && pts.length > 0 && (() => {
              const pax = s.units.filter((x) => x.embarkedIn === u.id && x.status === 'embarked');
              if (!pax.length) return null;
              const n = pax.reduce((a, x) => a + alive(x).length, 0);
              const maxY = Math.max(...pts.map((p, i) => p.y + ms[i].r));
              return (
                <g transform={`translate(${cx} ${maxY + 0.75})`} pointerEvents="none">
                  <rect x={-2.2} y={-0.5} width={4.4} height={1.0} rx={0.5} fill="rgba(10,12,16,0.88)" stroke={col} strokeWidth={0.08} />
                  <SvgIcon name="transport" x={-1.55} y={0} size={0.7} color="#fff" />
                  <text x={0.35} y={0.24} fontSize={0.62} textAnchor="middle" fill="#fff" fontWeight={800}>{pax.length} units · {n}</text>
                </g>
              );
            })()}
            {(isSel || isPicked) && tags?.length && pts.length > 0 ? (() => {
              // under the unit (below the transport chip): what is boosting or hampering it right now
              const maxY = Math.max(...pts.map((p, i) => p.y + ms[i].r)) + (u.transport && s.units.some((x) => x.embarkedIn === u.id && x.status === 'embarked') ? 1.9 : 0.75);
              return (
                <text x={cx} y={maxY} fontSize={Math.max(0.48, Math.min(0.68, fs * 0.65))} textAnchor="middle" stroke="#000" strokeWidth={0.08} paintOrder="stroke" pointerEvents="none" fontWeight={800}>
                  {/* four tags under the selected one; the rest are counted */}
                  {tags.slice(0, 4).map(([t, good], k) => <tspan key={k} fill={good ? '#86efac' : '#fca5a5'}>{k ? '  ' : ''}{t}</tspan>)}
                  {tags.length > 4 && <tspan fill="#fff">  +{tags.length - 4}</tspan>}
                </text>
              );
            })() : null}
            {u.battleShocked && pts.length > 0 && (
              <g transform={`translate(${cx} ${minY - (props.badges?.[u.id]?.length ? 1.45 : 0.85)})`} pointerEvents="none">
                <rect x={-2.4} y={-0.32} width={4.8} height={0.64} rx={0.32} fill="#4c1d95" stroke="#e9d5ff" strokeWidth={0.06} />
                <SvgIcon name="charge" x={-1.8} y={0} size={0.45} color="#f5f3ff" />
                <text x={0.2} y={0.12} fontSize={0.36} textAnchor="middle" fill="#f5f3ff" fontWeight={900}>BATTLE-SHOCKED</text>
              </g>
            )}
            {s.players[1 - u.owner].oathTarget === u.id && pts.length > 0 && (
              <g transform={`translate(${cx} ${minY - (props.badges?.[u.id]?.length ? 1.45 : 0.85) - (u.battleShocked ? 0.75 : 0)})`} pointerEvents="none">
                <rect x={-1.8} y={-0.32} width={3.6} height={0.64} rx={0.18} fill="#7a0c0c" stroke="#f5d48a" strokeWidth={0.06} />
                <path d="M -1.3 0.16 L -1.0 -0.16 L -0.7 0.16 Z" fill="#f5d48a" />
                <text x={0.2} y={0.12} fontSize={0.38} textAnchor="middle" fill="#f5d48a" fontWeight={800} letterSpacing={0.04}>{markRuleLabel(s, u.owner === 0 ? 1 : 0)}</text>
              </g>
            )}
            {pts.length > 0 && (() => {
              const baseBadgeY = minY - (props.badges?.[u.id]?.length ? 1.45 : 0.85) - (u.battleShocked ? 0.75 : 0) - (s.players[1 - u.owner].oathTarget === u.id ? 0.75 : 0);
              if (unitInFlow) {
                return (
                  <g transform={`translate(${cx} ${baseBadgeY})`} pointerEvents="none" className="flow-magic-aura">
                    <rect x={-2.4} y={-0.28} width={4.8} height={0.56} rx={0.28} fill="rgba(8, 47, 73, 0.92)" stroke="#22d3ee" strokeWidth={0.05} />
                    <text y={0.10} fontSize={0.28} textAnchor="middle" fill="#67e8f9" fontWeight={800} letterSpacing={0.04}>IN FLOW OF MAGIC (+1 W)</text>
                  </g>
                );
              }
              if (hasFlowOfMagic && hasPsychicWep) {
                return (
                  <g transform={`translate(${cx} ${baseBadgeY})`} pointerEvents="none">
                    <rect x={-2.2} y={-0.26} width={4.4} height={0.52} rx={0.26} fill="rgba(15, 23, 42, 0.9)" stroke="#0284c7" strokeWidth={0.05} />
                    <text y={0.10} fontSize={0.26} textAnchor="middle" fill="#7dd3fc" fontWeight={800} letterSpacing={0.03}>PSYCHIC (RE-ROLL 1s)</text>
                  </g>
                );
              }
              if (unitInShadow) {
                return (
                  <g transform={`translate(${cx} ${baseBadgeY})`} pointerEvents="none" className="shadow-chaos-aura">
                    <rect x={-2.4} y={-0.28} width={4.8} height={0.56} rx={0.28} fill="rgba(59, 7, 100, 0.92)" stroke="#c084fc" strokeWidth={0.05} />
                    <text y={0.10} fontSize={0.28} textAnchor="middle" fill="#e9d5ff" fontWeight={800} letterSpacing={0.04}>IN SHADOW OF CHAOS</text>
                  </g>
                );
              }
              if (enemyInShadow) {
                return (
                  <g transform={`translate(${cx} ${baseBadgeY})`} pointerEvents="none" className="shadow-chaos-aura">
                    <rect x={-2.3} y={-0.28} width={4.6} height={0.56} rx={0.28} fill="rgba(88, 28, 135, 0.92)" stroke="#a855f7" strokeWidth={0.05} />
                    <text y={0.10} fontSize={0.26} textAnchor="middle" fill="#f3e8ff" fontWeight={800} letterSpacing={0.03}>SHADOW OF CHAOS (-1 BS)</text>
                  </g>
                );
              }
              return null;
            })()}
            {isDraft && maxFor && ms.map((m) => {
              const p = draft!.get(m.id);
              if (!p || p.length < 2) return null;
              const used = pathLen(p);
              if (used < 0.05) return null;
              const e = p[p.length - 1];
              const maxAllowed = maxFor(m.id);
              const exceeds = used > maxAllowed + 0.05;
              const isBad = props.bad?.includes(m.id) || exceeds;
              const label = isBad
                ? exceeds
                  ? `Exceeds: ${used.toFixed(1)}" > ${maxAllowed.toFixed(0)}"`
                  : `Illegal Position`
                : `${used.toFixed(1)}" / ${maxAllowed.toFixed(0)}"`;
              const badgeBg = isBad ? 'rgba(127,29,29,0.92)' : 'rgba(6,78,59,0.92)';
              const badgeBorder = isBad ? '#ef4444' : '#10b981';
              const badgeText = isBad ? '#fca5a5' : '#a7f3d0';
              const pillW = Math.max(2.4, label.length * 0.22);
              const pillH = 0.54;
              return (
                <g key={`d${m.id}`} pointerEvents="none">
                  <rect
                    x={e.x - pillW / 2}
                    y={e.y - m.r - pillH - 0.2}
                    width={pillW}
                    height={pillH}
                    rx={0.22}
                    fill={badgeBg}
                    stroke={badgeBorder}
                    strokeWidth={0.06}
                  />
                  <text
                    x={e.x}
                    y={e.y - m.r - 0.38}
                    fontSize={0.34}
                    textAnchor="middle"
                    fill={badgeText}
                    fontWeight={800}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      {caps.map((c) => (
        <g key={c.k} pointerEvents="none">
          <circle cx={c.x} cy={c.y} r={0.8} fill="none" stroke={COLORS[c.p]} strokeWidth={0.35}>
            <animate attributeName="r" from="0.8" to="5.5" dur="1.2s" fill="freeze" />
            <animate attributeName="opacity" from="1" to="0" dur="1.2s" fill="freeze" />
          </circle>
          <circle cx={c.x} cy={c.y} r={1.2} fill={COLORS[c.p]} opacity={0.5}>
            <animate attributeName="opacity" from="0.6" to="0" dur="0.9s" fill="freeze" />
          </circle>
        </g>
      ))}
      {props.plan?.map((a, i) => {
        // stop the arrow short of the target's centre, and bend it a little so two arrows at one target stay apart
        const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, L = Math.hypot(dx, dy) || 1;
        const end = { x: a.to.x - (dx / L) * 1.4, y: a.to.y - (dy / L) * 1.4 };
        const mid = { x: (a.from.x + end.x) / 2 - (dy / L) * (1 + (i % 3)), y: (a.from.y + end.y) / 2 + (dx / L) * (1 + (i % 3)) };
        return (
          <g key={`plan${i}`} className="plan-arrow" pointerEvents="none">
            <path d={`M${a.from.x},${a.from.y} Q${mid.x},${mid.y} ${end.x},${end.y}`} fill="none" stroke="#f87171" strokeWidth={a.melee ? 0.32 : 0.22} strokeDasharray={a.melee ? undefined : '0.7 0.4'} markerEnd="url(#plan-head)" opacity={0.9} />
            <text x={mid.x} y={mid.y} fontSize={0.75} textAnchor="middle" fill="#fecaca" stroke="#000" strokeWidth={0.14} paintOrder="stroke" fontWeight={800}>{a.label}</text>
          </g>
        );
      })}
      {props.measure?.a && (
        <g pointerEvents="none">
          <circle cx={props.measure.a.x} cy={props.measure.a.y} r={0.35} fill="#fde68a" stroke="#000" strokeWidth={0.08} />
          {props.measure.b && (() => {
            const a = props.measure.a!, b = props.measure.b!;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const col = props.measure.los === false ? '#f87171' : '#fde68a';
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const n = Math.floor(d);
            const ux = (b.x - a.x) / (d || 1), uy = (b.y - a.y) / (d || 1);
            return (
              <>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={0.2} strokeDasharray={props.measure.los === false ? '0.5 0.3' : undefined} />
                {Array.from({ length: n }, (_, i) => <line key={i} x1={a.x + ux * (i + 1) - uy * 0.35} y1={a.y + uy * (i + 1) + ux * 0.35} x2={a.x + ux * (i + 1) + uy * 0.35} y2={a.y + uy * (i + 1) - ux * 0.35} stroke={col} strokeWidth={(i + 1) % 6 === 0 ? 0.14 : 0.07} />)}
                <circle cx={b.x} cy={b.y} r={0.35} fill={col} stroke="#000" strokeWidth={0.08} />
                <text x={mx} y={my - 0.6} fontSize={1.2} textAnchor="middle" fill={col} stroke="#000" strokeWidth={0.18} paintOrder="stroke" fontWeight={900}>{props.measure.label ?? `${d.toFixed(1)}"`}{props.measure.los === false ? ` (${props.measure.why || 'not visible'})` : ''}</text>
              </>
            );
          })()}
        </g>
      )}
      <rect x={0} y={0} width={W} height={H} fill="none" stroke="#000" strokeWidth={0.15} pointerEvents="none" />
      {sides.map(({ p, at, cards }) => {
        const x = at === 'right' ? W + 1 : -SIDE - 0.5, y = at === 'bottom' ? H / 2 + 0.5 : 0, h = at === 'top' || at === 'bottom' ? H / 2 - 0.5 : H;
        return (
          <g key={p}>
            <rect x={x - 0.3} y={y - 0.3} width={SIDE - 0.1} height={h + 0.6} rx={0.6} fill="rgba(255,255,255,0.04)" stroke={p ? 'var(--p1)' : 'var(--p0)'} strokeOpacity={0.5} strokeWidth={0.08} />
            <foreignObject x={x} y={y} width={SIDE - 0.5} height={h}>
              <div className={`table-cards ${at}`} style={{ width: (SIDE - 0.5) * PX, height: h * PX, transform: `scale(${1 / PX})` }}>
                <div className={`table-head p${p}`}>{s.players[p].name} · army buffs</div>
                {cards}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
    <svg className="fx-overlay" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio={FIT} aria-hidden="true">
      <FxLayer fx={fx} />
    </svg>
    {boardPopover && (
      <PopoverCard
        info={boardPopover.info}
        anchorRect={boardPopover.rect}
        onClose={() => setBoardPopover(null)}
      />
    )}
    </>
  );
}

/** Is this wall one of the edges of the piece's solid block (drawn as the block itself)? */
const onBoxEdge = (t: TerrainPiece, w: { a: Pt; b: Pt }) => !!t.box && [w.a, w.b].every((p) => t.box!.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.01));

/** The official footprint art (11e Battlezone punchboard) laid on a terrain piece: which plate, and the piece's
 *  oriented frame (along its longest edge) so the art lines up with the piece and is cropped, never stretched. */
const PLATES = { large: [682, 408], medium: [358, 235], stripShort: [355, 115], stripLong: [595, 143] } as const;
const PLATE_FILE: Record<keyof typeof PLATES, string> = { large: 'plate-large', medium: 'plate-medium', stripShort: 'strip-short', stripLong: 'strip-long' };
function plateFor(t: TerrainPiece): { href: string; ax: number; ay: number; ang: number; x: number; y: number; w: number; h: number } | null {
  const P = t.poly;
  if (P.length < 3) return null;
  let k = 0, best = 0;
  P.forEach((p, i) => { const d = dist(p, P[(i + 1) % P.length]); if (d > best) { best = d; k = i; } });
  const a = P[k], b = P[(k + 1) % P.length];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const us = P.map((p) => (p.x - a.x) * ux + (p.y - a.y) * uy), vs = P.map((p) => -(p.x - a.x) * uy + (p.y - a.y) * ux);
  const u0 = Math.min(...us), v0 = Math.min(...vs), L = Math.max(...us) - u0, Wd = Math.max(...vs) - v0;
  if (L < 0.5 || Wd < 0.3) return null;
  const strip = Wd < 1.8 && L / Wd > 2.2;
  const kind: keyof typeof PLATES = strip ? (P.length > 4 || L > 5 ? 'stripLong' : 'stripShort') : t.category === 'dense' ? 'large' : 'medium';
  return { href: `${IMAGE_BASE}terrain/${PLATE_FILE[kind]}.webp`, ax: a.x, ay: a.y, ang, x: u0, y: v0, w: L, h: Wd };
}

const PPI = 40; // backdrop pixels per inch (sharp enough when zoomed in on a phone)
const plateImgs = new Map<string, Promise<HTMLImageElement>>();
const loadImg = (href: string) => {
  let p = plateImgs.get(href);
  if (!p) {
    p = new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = href; });
    plateImgs.set(href, p);
  }
  return p;
};
/** The battlefield's ground and every terrain plate's footprint art, drawn once on a canvas: one picture under the
 *  board instead of dozens of clipped images that would be redrawn whenever a unit moves. Null until it is ready (or
 *  if the art can't be loaded — the plain plates are drawn then). */
function useBackdrop(
  terrain: TerrainPiece[],
  key: string,
  ground: string | null,
  w: number = RULES.battlefield.width,
  h: number = RULES.battlefield.height,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false, made: string | null = null;
    setUrl(null);
    (async () => {
      try {
        const c = document.createElement('canvas');
        c.width = Math.round(w * PPI); c.height = Math.round(h * PPI);
        const g = c.getContext('2d');
        if (!g) return;
        g.scale(PPI, PPI);
        g.fillStyle = '#5d5648'; g.fillRect(0, 0, w, h);
        if (ground) {
          const tile = await loadImg(ground);
          const pat = g.createPattern(tile, 'repeat');
          if (pat) { pat.setTransform(new DOMMatrix().scale(11 / tile.width, 11 / tile.height)); g.fillStyle = pat; g.fillRect(0, 0, w, h); }
        }
        for (const t of terrain) {
          if (t.kind === 'crater' || t.kind === 'barricade' || t.kind === 'container' || t.kind === 'objective-area') continue;
          const plate = plateFor(t);
          if (!plate) continue;
          const im = await loadImg(plate.href);
          g.save();
          g.beginPath(); t.poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
          g.fillStyle = t.category === 'dense' ? '#5a4a3a' : '#8a7d62'; g.fill();
          g.clip();
          g.translate(plate.ax, plate.ay); g.rotate(plate.ang);
          // cover the piece's frame, keeping the art's proportions (cropped, never stretched)
          const k = Math.max(plate.w / im.width, plate.h / im.height), dw = im.width * k, dh = im.height * k;
          g.drawImage(im, plate.x + (plate.w - dw) / 2, plate.y + (plate.h - dh) / 2, dw, dh);
          g.restore();
          if (t.category !== 'dense') {
            // light terrain reads a little paler than ruins
            g.save(); g.beginPath(); t.poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
            g.fillStyle = 'rgba(235,225,200,0.12)'; g.fill(); g.restore();
          }
        }
        const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
        if (!blob || dead) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      } catch { /* keep the plain plates */ }
    })();
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ground, w, h]);
  return url;
}

/** A grainy battlefield ground (dirt, ash patches, small stones, cracks), drawn once on a canvas. */
let groundTex: string | null | undefined;
function groundTexture(): string | null {
  if (groundTex !== undefined) return groundTex;
  groundTex = null;
  try {
    const N = 256, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    if (!g) return null;
    let r = 12345;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    g.fillStyle = '#5b5446'; g.fillRect(0, 0, N, N);
    // soft patches of darker ash and lighter dust, wrapped so the tile repeats seamlessly
    const blob = (x: number, y: number, rad: number, col: string) => {
      for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    };
    for (let i = 0; i < 26; i++) blob(rnd() * N, rnd() * N, 20 + rnd() * 50, rnd() < 0.5 ? 'rgba(40,36,30,0.35)' : 'rgba(130,120,98,0.22)');
    // grain
    const img = g.getImageData(0, 0, N, N);
    for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9; }
    g.putImageData(img, 0, 0);
    // pebbles with a lit edge and a shadow
    for (let i = 0; i < 70; i++) {
      const x = rnd() * N, y = rnd() * N, rad = 0.8 + rnd() * 2.6;
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x + 0.8, y + 0.9, rad, rad * 0.8, 0, 0, 7); g.fill();
      g.fillStyle = rnd() < 0.5 ? '#7b725f' : '#6a6252'; g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, rnd() * 3, 0, 7); g.fill();
    }
    // hairline cracks
    g.strokeStyle = 'rgba(25,22,18,0.45)'; g.lineWidth = 0.8;
    for (let i = 0; i < 9; i++) {
      let x = rnd() * N, y = rnd() * N, a = rnd() * 6.28;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 7; k++) { a += (rnd() - 0.5) * 1.2; x += Math.cos(a) * 7; y += Math.sin(a) * 7; g.lineTo(x, y); }
      g.stroke();
    }
    groundTex = c.toDataURL('image/png');
  } catch { groundTex = null; }
  return groundTex;
}

export const Board = memo(BoardImpl);
