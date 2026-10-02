import { useEffect, useMemo, useState } from 'react';
import {
  applyMortalWounds, buildFightPools, buildShootPools, expectedDamage, finishAttack, meleeWeapons, rerollOne, resolveAll, shootingModes, startAttack, stepAttack,
  type ShootMode,
} from '../engine/attack';
import { primaryById, RULES } from '../engine/config';
import { rollN } from '../engine/dice';
import {
  autoApproach, bestLd, canIngress, chargeEligibility, chargeTargetOptions, closeWindow, commitCharge, commitMove, consolidateEligible, consolidateMode,
  counteroffensiveCandidates, crushingImpact, declareCharge, deployUnit, endConsolidateStep, endPhase, endPileInStep, fightCandidates, findPlacement,
  formationAt, heroicCandidates, ingressUnit, markFought, maxMoveDistance, objectiveTerrain, openCounteroffensive, overwatchCandidates, pileInEligible,
  rapidIngressCandidates, remainStationary, rerollCharge, rollAdvance, rollBattleShock, sendToReserves, smokescreenCandidates, useCounteroffensive,
  validateMove, validatePlacement, type MoveCheck, hasArmyRule, setOathTarget, callWaaagh, isRiledUp, unitHasAbility,
  canEmbarkIn, embarkUnit, disembarkMode, disembarkUnit, validateDisembark, embarkedIn, scoutUnits, endScouts,
  claimSecondary, discardSecondary, swapSecondary, chooseFixedSecondaries,
} from '../engine/game';
import { botShouldAct, botStep } from '../engine/bot';
import { endUnitShooting, rangedWeaponNames } from '../engine/attack';
import { MISSIONS, secondaryById } from '../engine/config';
import { polyCentroid } from '../engine/geometry';
import {
  alive, boardUnits, canUseStratagem, engagedEnemies, hasKw, isEngaged, onBoard, other, spendStratagem, strength, unitById, unitDistance,
} from '../engine/state';
import type { BuffKind, GameState, PlayerId, Pt, UnitState } from '../engine/types';
import { hasCover, isHidden, modelVisible, unitVisibleTo } from '../engine/visibility';
import { baseDist } from '../engine/geometry';
import { Portrait, unitToken } from './Tokens';
import { isMelee, hasAbility } from '../engine/weapons';
import { Board, type Paths, type Ring } from './Board';
import { DiceTray } from './DiceTray';
import { UnitView } from './Sheet';
import { useGame } from './store';

type Mode =
  | { k: 'place'; unitId: string; how: 'deploy' | 'infiltrate' | 'ingress' | 'deepStrike' | 'disembark'; rapid?: boolean; transportId?: string }
  | { k: 'move'; unitId: string; kind: 'normal' | 'advance' | 'fallback' | 'scout'; fly: boolean }
  | { k: 'shoot'; unitId: string; smode: ShootMode; target: string | null; useCQ: boolean; profile: Record<string, number>; overwatch?: boolean; skip?: string[] }
  | { k: 'charge'; unitId: string; targets: string[]; heroic?: 'leap' | 'fray' }
  | { k: 'pile'; unitId: string; kind: 'pileIn' | 'consolidate'; overrun?: boolean }
  | { k: 'fight'; unitId: string; target: string | null; weapon?: string; epic: boolean }
  | { k: 'explosives'; unitId: string; target: string | null }
  | { k: 'crush'; unitId: string };

const PHASE_TH: Record<string, string> = {
  deploy: 'DEPLOYMENT', command: 'COMMAND', movement: 'MOVEMENT', shooting: 'SHOOTING', charge: 'CHARGE', fight: 'FIGHT', gameover: 'GAME OVER', formations: 'FORMATIONS',
};

const BUFFS: { kind: BuffKind; label: string }[] = [
  { kind: 'hit+1', label: '+1 Hit' }, { kind: 'hit-1', label: '−1 Hit' }, { kind: 'rerollHits1', label: 'Re-roll Hit 1' }, { kind: 'rerollHits', label: 'Re-roll Hits' },
  { kind: 'wound+1', label: '+1 Wound' }, { kind: 'rerollWounds1', label: 'Re-roll Wound 1' }, { kind: 'rerollWounds', label: 'Re-roll Wounds' },
  { kind: 'ap+1', label: '+1 AP' }, { kind: 'lethal', label: 'Lethal Hits' }, { kind: 'sustained1', label: 'Sustained 1' }, { kind: 'devastating', label: 'Dev Wounds' },
  { kind: 'ignoresCover', label: 'Ignores Cover' }, { kind: 'save+1', label: '+1 Save' }, { kind: 'fnp5', label: 'FNP 5+' }, { kind: 'fnp6', label: 'FNP 6+' }, { kind: 'damage-1', label: '−1 Damage' },
];

const startPaths = (u: UnitState): Paths => new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));
const placePaths = (pos: Map<string, Pt>): Paths => new Map([...pos].map(([id, p]) => [id, [p]]));
const lastPos = (d: Paths): Map<string, Pt> => new Map([...d].map(([id, p]) => [id, p[p.length - 1]]));
const mergePaths = (base: Paths, add: Paths): Paths => { const o = new Map(base); for (const [k, v] of add) o.set(k, v); return o; };
const pName = (s: GameState, p: PlayerId) => s.players[p].name;

export function GameScreen({ initial, onExit }: { initial: GameState; onExit: () => void }) {
  const { state: s, act, undo, canUndo } = useGame(initial);
  const bot = s.botPlayer ?? null;
  const [showMenu, setShowMenu] = useState(false);
  const [showMissions, setShowMissions] = useState(false);

  // engine errors become a message instead of a crash
  useEffect(() => {
    const onErr = (e: Event) => flash(`ทำไม่ได้: ${(e as CustomEvent).detail}`);
    window.addEventListener('game-error', onErr);
    return () => window.removeEventListener('game-error', onErr);
  });

  // single-player: let the bot take its steps one at a time so the board animates; caption what it just did
  const [botSays, setBotSays] = useState<string | null>(null);
  useEffect(() => {
    if (bot === null) return;
    if (!botShouldAct(s, bot)) {
      if (!botSays) return;
      const t = window.setTimeout(() => setBotSays(null), 2200);
      return () => window.clearTimeout(t);
    }
    const quick = s.phase === 'deploy' || s.phase === 'scouts' || s.phase === 'command';
    const t = window.setTimeout(() => {
      let said: string | null = null;
      act((g) => {
        const last = g.log[g.log.length - 1];
        botStep(g, bot);
        const fresh = g.log.slice(g.log.lastIndexOf(last) + 1).filter((e) => e.kind !== 'roll' || /ชาร์จ|Advance/.test(e.text));
        said = fresh.length ? fresh[fresh.length - 1].text : null;
      });
      if (said) setBotSays(said);
    }, quick ? 350 : 950);
    return () => window.clearTimeout(t);
  }, [s, bot, act, botSays]);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setModeRaw] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<Paths | null>(null);
  const [check, setCheck] = useState<MoveCheck | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showBuffs, setShowBuffs] = useState(false);
  const [fly, setFly] = useState(false);
  const [showStrats, setShowStrats] = useState(false);
  const [stratUnit, setStratUnit] = useState<string>('');
  const [freeAdvRR, setFreeAdvRR] = useState<string | null>(null);

  const setMode = (m: Mode | null, d: Paths | null = null) => { setModeRaw(m); setDraft(d); setCheck(null); };
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? null : x)), 2600); };
  const U = (id: string) => unitById(s, id);

  // Who has to act right now (hotseat hand-off).
  const fc = s.phase === 'fight' && s.fight?.step === 'fight' ? fightCandidates(s) : null;
  const actor: PlayerId = s.window ? s.window.player
    : s.phase === 'deploy' ? s.deployTurn
    : s.phase === 'fight' && s.fight ? (s.fight.step === 'fight' ? fc?.player ?? s.active : s.fight.stepPlayer)
    : s.active;

  const modeUnit = mode ? U(mode.unitId) : null;

  // ---------- board interaction ----------

  const chargeOpts = useMemo(() => {
    if (mode?.k !== 'charge') return [];
    const u = U(mode.unitId);
    return chargeTargetOptions(s, u, mode.heroic === 'leap' ? { onlyChargedThisPhase: true } : mode.heroic === 'fray' ? { within: 6 } : {}).map((x) => x.id);
  }, [s, mode]);

  const shootTargets = useMemo(() => {
    if (mode?.k !== 'shoot') return [];
    const u = U(mode.unitId);
    return boardUnits(s, other(u.owner)).filter((t) => {
      if (mode.smode === 'closeQuarters') return engagedEnemies(s, u).includes(t) || alive(u).some((m) => m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER'));
      if (mode.smode === 'indirect') return true;
      if (mode.smode === 'snap' && unitDistance(u, t) > RULES.snapShooting.range) return false;
      return alive(u).some((m) => unitVisibleTo(s, m, t));
    }).filter((t) => {
      const r = buildShootPools(s, u.id, t.id, { mode: mode.smode, useCloseQuarters: mode.useCQ, profile: mode.profile });
      return !r.error && r.pools.length > 0;
    }).map((t) => t.id);
  }, [s, mode]);

  const fightTargets = mode?.k === 'fight' ? engagedEnemies(s, U(mode.unitId)).map((t) => t.id) : [];
  const explosiveTargets = mode?.k === 'explosives'
    ? boardUnits(s, other(U(mode.unitId).owner)).filter((t) => !isEngaged(s, t) && unitDistance(U(mode.unitId), t) <= 8 && alive(U(mode.unitId)).some((m) => unitVisibleTo(s, m, t))).map((t) => t.id)
    : [];
  const crushTargets = mode?.k === 'crush' ? engagedEnemies(s, U(mode.unitId)).map((t) => t.id) : [];

  const targets = mode?.k === 'shoot' ? shootTargets : mode?.k === 'charge' ? chargeOpts : mode?.k === 'fight' ? fightTargets : mode?.k === 'explosives' ? explosiveTargets : mode?.k === 'crush' ? crushTargets : [];
  const picked = mode?.k === 'shoot' || mode?.k === 'fight' || mode?.k === 'explosives' ? (mode.target ? [mode.target] : []) : mode?.k === 'charge' ? mode.targets : [];

  const onTapUnit = (unitId: string) => {
    if (mode && targets.includes(unitId)) {
      if (mode.k === 'charge') setModeRaw({ ...mode, targets: mode.targets.includes(unitId) ? mode.targets.filter((x) => x !== unitId) : [...mode.targets, unitId] });
      else if (mode.k === 'crush') { const rolls = act((g) => crushingImpact(g, unitById(g, mode.unitId), unitId)); flash(`Crushing Impact: [${rolls.join(' ')}]`); setMode(null); }
      else if (mode.k === 'shoot' || mode.k === 'fight' || mode.k === 'explosives') setModeRaw({ ...mode, target: unitId });
      return;
    }
    if (!mode) setSel(unitId);
  };

  const onTapBoard = (p: Pt) => {
    if (mode?.k === 'place') {
      const u = U(mode.unitId);
      setDraft(placePaths(formationAt(u, p, s.players[u.owner].role === 'defender')));
      setCheck(null);
      return;
    }
    if (!mode) setSel(null);
  };

  const maxFor = (id: string) => {
    if (!mode || !modeUnit) return Infinity;
    const m = modeUnit.models.find((x) => x.id === id)!;
    if (mode.k === 'move') return maxMoveDistance(s, modeUnit, mode.kind, m, { fly: mode.fly });
    if (mode.k === 'charge') return modeUnit.chargeRoll ?? 0;
    if (mode.k === 'pile') return mode.kind === 'pileIn' ? RULES.pileIn.distance : RULES.consolidate.distance;
    return Infinity;
  };

  // Cover / Hidden badges and line-of-sight lines while choosing a shooting target
  const badges: Record<string, string[]> = {};
  const losLines: { a: Pt; b: Pt; cover: boolean }[] = [];
  if (mode?.k === 'shoot' && modeUnit) {
    const shooters = alive(modeUnit);
    for (const id of shootTargets.filter((x) => x === mode.target)) {
      const T = U(id);
      const b: string[] = [];
      if (shooters.some((m) => hasCover(s, m, T))) b.push('Cover −1 BS');
      if (alive(T).some((m) => isHidden(s, T, m))) b.push('Hidden');
      if (b.length) badges[id] = b;
    }
    if (mode.target) {
      const T = U(mode.target);
      for (const m of shooters) {
        const vis = alive(T).filter((t) => modelVisible(s, m, T, t));
        if (!vis.length) continue;
        const t = vis.reduce((x, y) => (baseDist(m, x) <= baseDist(m, y) ? x : y));
        losLines.push({ a: m, b: t, cover: hasCover(s, m, T) });
      }
    }
  }
  const rings: Ring[] = [];
  if (mode?.k === 'charge' && modeUnit) {
    for (const m of alive(modeUnit)) if (alive(modeUnit).length <= 3) rings.push({ c: m, r: (modeUnit.chargeRoll ?? 0) + m.r, color: 'rgba(245,184,61,0.5)', dash: true });
  }

  // ---------- generic confirm helpers ----------

  const confirmMove = (kind: 'normal' | 'advance' | 'fallback' | 'scout' | 'charge' | 'pileIn' | 'consolidate', after?: () => void) => {
    if (!mode || !draft) return;
    const u = U(mode.unitId);
    const opts = mode.k === 'move' ? { fly: mode.fly } : mode.k === 'charge' ? { targets: mode.targets } : {};
    const chk = validateMove(s, u, kind, draft, opts);
    if (!chk.ok) { setCheck(chk); return; }
    if (kind === 'charge') act((g) => commitCharge(g, unitById(g, u.id), draft, (mode as { targets: string[] }).targets));
    else act((g) => { commitMove(g, unitById(g, u.id), kind, draft); if (g.fight && (kind === 'pileIn' || kind === 'consolidate')) g.fight.movedThisStep.push(u.id); });
    setMode(null);
    after?.();
  };

  const confirmPlace = () => {
    if (mode?.k !== 'place' || !draft) return;
    const pos = lastPos(draft);
    const u = U(mode.unitId);
    if (mode.how === 'disembark') {
      const t = U(mode.transportId!);
      const chk = validateDisembark(s, u, t, pos);
      if (!chk.ok) { setCheck(chk); return; }
      act((g) => disembarkUnit(g, unitById(g, u.id), unitById(g, t.id), pos));
      setMode(null);
      return;
    }
    if (mode.how === 'deploy' || mode.how === 'infiltrate') {
      const chk = act((g) => deployUnit(g, u.id, pos, mode.how as 'deploy' | 'infiltrate'));
      if (!chk.ok) { setCheck(chk); return; }
    } else {
      const chk = validatePlacement(s, u, pos, mode.how);
      if (!chk.ok) { setCheck(chk); return; }
      act((g) => { const gu = unitById(g, u.id); if (mode.rapid) { spendStratagem(g, gu.owner, 'rapid-ingress', gu); g.window = null; } ingressUnit(g, gu, pos); });
    }
    setMode(null);
    setSel(null);
  };

  const autoPlace = () => {
    if (mode?.k !== 'place') return;
    if (mode.how === 'disembark') {
      const u = U(mode.unitId), t = U(mode.transportId!);
      const tm = alive(t)[0];
      for (let ring = 0; ring < 4; ring++) for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const pos = formationAt(u, { x: tm.x + Math.cos(ang) * (tm.r + 1 + ring * 0.6), y: tm.y + Math.sin(ang) * (tm.r + 1 + ring * 0.6) });
        if (validateDisembark(s, u, t, pos).ok) { setDraft(placePaths(pos)); setCheck(null); return; }
      }
      flash('หาที่ลงรถอัตโนมัติไม่ได้ ลองแตะวางเอง');
      return;
    }
    const pos = findPlacement(s, U(mode.unitId), mode.how, draft ? polyCentroid([...lastPos(draft).values()]) : undefined);
    if (pos) { setDraft(placePaths(pos)); setCheck(null); } else flash('หาที่วางอัตโนมัติไม่ได้ ลองแตะวางเอง');
  };

  // ---------- attack tray ----------

  const onTrayClose = () => {
    const at = s.attack!;
    const attacker = U(at.attackerId);
    act((g) => {
      finishAttack(g);
      if (at.kind === 'overwatch') closeWindow(g);
      if (at.kind === 'fight') { markFought(g, unitById(g, attacker.id)); openCounteroffensive(g, attacker.owner); }
    });
    setMode(null);
  };

  const onReroll = (stage: 'hit' | 'wound' | 'save', i: number) => {
    act((g) => {
      const at = g.attack!;
      const u = unitById(g, stage === 'save' ? at.targetId : at.attackerId);
      spendStratagem(g, u.owner, 'command-reroll', u);
      rerollOne(g, stage, i);
    });
  };

  // ---------- render helpers ----------

  const unitPill = (u: UnitState, done: boolean, onClick?: () => void) => (
    <button key={u.id} className={`unit-pill ${done ? 'done' : ''} ${sel === u.id ? 'sel' : ''} ${u.battleShocked ? 'shock' : ''}`} onClick={onClick ?? (() => { setSel(u.id); })}>
      <span className={u.owner ? 'p1' : 'p0'}>●</span> {u.name.length > 26 ? u.name.slice(0, 25) + '…' : u.name}
      <span className="muted"> {alive(u).length}/{u.startingStrength}</span>{u.battleShocked ? ' ' : ''}
      {s.players[1 - u.owner].oathTarget === u.id && <span className="oath-tag">OATH</span>}
    </button>
  );

  const selUnit = sel ? s.units.find((u) => u.id === sel) ?? null : null;

  const unitCard = (u: UnitState) => {
    const m = alive(u)[0];
    if (!m) return null;
    const st = strength(u);
    const lead = u.models.find((x) => x.isCharacter && !x.dead) ?? m;
    const flags = [
      (st === 'half' || st === 'belowHalf') && (st === 'half' ? 'Half-strength' : 'Below half'),
      u.battleShocked && 'Battle-shocked',
      u.chargedTurn === s.turn && 'Fights First',
      isRiledUp(s, u) && 'Riled up 5++',
      s.players[other(u.owner)].oathTarget === u.id && 'Oath target',
      ...u.enhancements.map((e) => e.name),
      ...u.buffs.map((b) => BUFFS.find((x) => x.kind === b.kind)?.label ?? b.kind),
    ].filter(Boolean) as string[];
    return (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }} onClick={() => setSheet(u.id)}>
        <Portrait kind={unitToken(u)} owner={u.owner} character={u.models.some((x) => x.isCharacter && !x.dead)} size={40} datasheet={lead.source} />
        <div className="grow">
          <div style={{ fontWeight: 700 }} className={u.owner ? 'p1' : 'p0'}>{u.name} <span className="muted tiny">{alive(u).length}/{u.startingStrength}</span></div>
          <div className="statline">
            M <b>{m.profile.M ?? '-'}"</b> · T <b>{m.profile.T}</b> · Sv <b>{m.profile.Sv}+</b>{m.profile.InSv ? <> · <b>{m.profile.InSv}++</b></> : null} · W <b>{m.wounds}/{m.profile.W}</b> · Ld <b>{bestLd(u)}+</b> · OC <b>{u.battleShocked ? '-' : m.profile.OC ?? '-'}</b>
          </div>
          {flags.length > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}>{flags.join(' · ')}</div>}
        </div>
        <span className="muted">›</span>
      </div>
    );
  };

  const buffPanel = (u: UnitState) => (
    <div>
      <button className="btn small ghost" onClick={() => setShowBuffs((x) => !x)}>{showBuffs ? '▾' : '▸'} Buff จาก ability{u.buffs.length ? ` (${u.buffs.length})` : ''}</button>
      {showBuffs && (
        <div className="row" style={{ marginTop: 6 }}>
          {BUFFS.map((b) => {
            const on = u.buffs.some((x) => x.kind === b.kind);
            return (
              <button key={b.kind} className={`btn small ${on ? 'on' : ''}`} onClick={() => act((g) => {
                const gu = unitById(g, u.id);
                gu.buffs = on ? gu.buffs.filter((x) => x.kind !== b.kind) : [...gu.buffs, { kind: b.kind, until: 'phase', label: b.label }];
              })}>{b.label}</button>
            );
          })}
          <div className="tiny muted" style={{ width: '100%' }}>ใช้แทน ability ของ datasheet / detachment ที่ระบบยังไม่ทำให้อัตโนมัติ (มีผลจนจบ phase)</div>
        </div>
      )}
    </div>
  );

  const moveControls = (kind: string, onConfirm: () => void, extra?: React.ReactNode) => (
    <>
      <div className="row">
        <span className="tiny muted grow">ลาก = ย้ายทั้งหน่วย · แตะโมเดล = เลือกปรับทีละตัว</span>
        <button className="btn small" onClick={() => { setDraft(modeUnit ? startPaths(modeUnit) : null); setCheck(null); }}>Reset</button>
        {extra}
      </div>
      {check && !check.ok && <div className="err">{check.errors.slice(0, 4).map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="row">
        <button className="btn" onClick={() => setMode(null)}>ยกเลิก</button>
        <button className="btn primary grow" onClick={onConfirm}>✓ ยืนยัน {kind}</button>
      </div>
    </>
  );

  // ---------- windows (reactions of the non-active player) ----------

  const windowPanel = () => {
    const w = s.window!;
    const p = w.player;
    const skip = <button className="btn" onClick={() => { act((g) => closeWindow(g)); setMode(null); }}>ไม่ใช้</button>;
    if (w.kind === 'fireOverwatch') {
      if (mode?.k === 'shoot' && mode.overwatch) return shootPanel();
      return (
        <>
          <div className="handoff">{pName(s, p)}: ใช้ Fire Overwatch (1CP) ไหม? <span className="small muted">— ยิงแบบ Snap Shooting โดนเฉพาะ 6</span></div>
          <div className="unit-strip">{overwatchCandidates(s, p).map((u) => unitPill(u, false, () => setMode({ k: 'shoot', unitId: u.id, smode: 'snap', target: null, useCQ: false, profile: {}, overwatch: true })))}</div>
          {skip}
        </>
      );
    }
    if (w.kind === 'rapidIngress') {
      if (mode?.k === 'place') return placePanel();
      return (
        <>
          <div className="handoff">{pName(s, p)}: ใช้ Rapid Ingress (1CP) ไหม?</div>
          <div className="unit-strip">{rapidIngressCandidates(s, p).map((u) => unitPill(u, false, () => setMode({ k: 'place', unitId: u.id, how: u.core.deepStrike ? 'deepStrike' : 'ingress', rapid: true })))}</div>
          {skip}
        </>
      );
    }
    if (w.kind === 'smokescreen') {
      return (
        <>
          <div className="handoff">{pName(s, p)}: ใช้ Smokescreen (1CP) ไหม?</div>
          <div className="unit-strip">{smokescreenCandidates(s, p).map((u) => unitPill(u, false, () => act((g) => {
            const gu = unitById(g, u.id);
            spendStratagem(g, p, 'smokescreen', gu);
            gu.buffs.push({ kind: 'smoke', until: 'phase', label: 'Smokescreen' });
            g.window = null;
          })))}</div>
          {skip}
        </>
      );
    }
    if (w.kind === 'heroicIntervention') {
      if (mode?.k === 'charge') return chargePanel();
      return (
        <>
          <div className="handoff">{pName(s, p)}: ใช้ Heroic Intervention ไหม?</div>
          {heroicCandidates(s, p).map((u) => (
            <div key={u.id} className="row">
              <span className="grow small">{u.name}</span>
              <button className="btn small" onClick={() => { act((g) => { const gu = unitById(g, u.id); spendStratagem(g, p, 'heroic-intervention', gu); declareCharge(g, gu); }); setMode({ k: 'charge', unitId: u.id, targets: [], heroic: 'leap' }, startPaths(u)); }}>Leap to Defend 1CP</button>
              <button className="btn small" disabled={!!canUseStratagem(s, p, 'heroic-intervention', u, 2)} onClick={() => { act((g) => { const gu = unitById(g, u.id); spendStratagem(g, p, 'heroic-intervention', gu, 2); declareCharge(g, gu, false, 6); }); setMode({ k: 'charge', unitId: u.id, targets: [], heroic: 'fray' }, startPaths(u)); }}>Into the Fray 2CP</button>
            </div>
          ))}
          {skip}
        </>
      );
    }
    if (w.kind === 'counteroffensive') {
      return (
        <>
          <div className="handoff">{pName(s, p)}: ใช้ Counteroffensive (2CP) ให้หน่วยของคุณสู้ต่อทันทีไหม?</div>
          <div className="unit-strip">{counteroffensiveCandidates(s, p).map((u) => unitPill(u, false, () => act((g) => useCounteroffensive(g, unitById(g, u.id)))))}</div>
          <button className="btn" onClick={() => act((g) => { g.window = null; })}>ไม่ใช้</button>
        </>
      );
    }
    return null;
  };

  // ---------- phase panels ----------

  const placePanel = () => {
    if (mode?.k !== 'place') return null;
    const u = U(mode.unitId);
    return (
      <>
        <div className="small">วาง <b>{u.name}</b>: แตะบนสนาม{mode.how === 'deploy' ? 'ในโซนของคุณ' : mode.how === 'disembark' ? ` ภายใน ${disembarkMode(s, U(mode.transportId!)) === 'combat' ? 6 : 3}" จากรถ (${disembarkMode(s, U(mode.transportId!))} disembark)` : mode.how === 'deepStrike' ? ` (ห่างศัตรู >${RULES.reserves.enemyDistance}")` : ` (ภายใน ${RULES.reserves.edgeDistance}" จากขอบ, ห่างศัตรู >${RULES.reserves.enemyDistance}")`} แล้วลากปรับตำแหน่ง</div>
        <div className="row">
          <span className="tiny muted grow">ลาก = ย้ายทั้งหน่วย · แตะโมเดล = เลือกปรับทีละตัว</span>
          <button className="btn small" onClick={autoPlace}>หาที่วางให้</button>
        </div>
        {check && !check.ok && <div className="err">{check.errors.slice(0, 4).map((e) => <div key={e}>{e}</div>)}</div>}
        <div className="row">
          <button className="btn" onClick={() => setMode(null)}>ยกเลิก</button>
          <button className="btn primary grow" disabled={!draft} onClick={confirmPlace}>✓ ยืนยันวาง{mode.rapid ? ' (Rapid Ingress 1CP)' : ''}</button>
        </div>
      </>
    );
  };

  const deployPanel = () => {
    if (mode?.k === 'place') return placePanel();
    const p = s.deployTurn;
    const pending = s.units.filter((u) => u.owner === p && u.status === 'pending');
    const u = selUnit && pending.includes(selUnit) ? selUnit : null;
    return (
      <>
        <div className="handoff">{pName(s, p)} ({s.players[p].role === 'attacker' ? 'Attacker' : 'Defender'}) วางหน่วย — ผลัดกันทีละหน่วย</div>
        <div className="unit-strip">{pending.map((x) => unitPill(x, false))}</div>
        {u ? (
          <div className="row">
            <button className="btn primary" onClick={() => setMode({ k: 'place', unitId: u.id, how: 'deploy' })}>วางใน deployment zone</button>
            {u.core.infiltrators && <button className="btn" onClick={() => setMode({ k: 'place', unitId: u.id, how: 'infiltrate' })}>Infiltrate</button>}
            <button className="btn" onClick={() => { const e = act((g) => sendToReserves(g, u.id)); if (e) flash(e); else setSel(null); }}>Strategic Reserves{u.core.deepStrike ? ' / Deep Strike' : ''}</button>
            {s.units.filter((t) => t.owner === p && t.transport && (t.status === 'board' || t.status === 'pending') && !canEmbarkIn(s, u, t)).map((t) => (
              <button key={t.id} className="btn" onClick={() => { const e = act((g) => embarkUnit(g, unitById(g, u.id), unitById(g, t.id), true)); if (e) flash(e); else setSel(null); }}>ขึ้นรถ {t.name}</button>
            ))}
          </div>
        ) : <div className="muted small">เลือกหน่วยที่จะวาง</div>}
        {u && unitCard(u)}
      </>
    );
  };

  const commandPanel = () => {
    const tests = s.shockTests;
    const pending = tests.filter((t) => t.passed === null);
    return (
      <>
        <div className="handoff">Command phase · {pName(s, s.active)} · ทั้งสองฝ่ายได้ +1 CP</div>
        {hasArmyRule(s, s.active, 'Oath of Moment') && (
          <div className="card" style={{ padding: 8 }}>
            <div className="small"><b>Oath of Moment</b> — เลือกหน่วยศัตรู 1 หน่วย: ยิง/ตีใส่ได้ re-roll hit{s.players[s.active].oathWoundBonus ? ' และ +1 wound' : ''} จนถึง Command phase หน้า</div>
            <div className="unit-strip" style={{ marginTop: 6 }}>
              {boardUnits(s, other(s.active)).map((e) => (
                <button key={e.id} className={`unit-pill ${s.players[s.active].oathTarget === e.id ? 'sel' : ''}`} onClick={() => { act((g) => setOathTarget(g, g.active, e.id)); setSel(e.id); flash(`Oath of Moment → ${e.name}`); }}>
                  <span className={e.owner ? 'p1' : 'p0'}>●</span> {e.name}
                  {s.players[s.active].oathTarget === e.id && <span className="oath-tag">OATH</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {hasArmyRule(s, s.active, 'Waaagh!') && (
          <div className="card row" style={{ padding: 8 }}>
            <div className="grow small"><b>WAAAGH!</b> (ครั้งเดียวต่อเกม) — Ork riled up: 5+ InSv, ปืนเป็น [ASSAULT], advance แล้วชาร์จได้ จนจบเทิร์นหน้า</div>
            {s.players[s.active].riledUntilTurn >= s.turn ? <span className="chip warn">WAAAGH! อยู่</span>
              : <button className="btn small primary" disabled={s.players[s.active].waaaghUsed} onClick={() => act((g) => callWaaagh(g, g.active))}>{s.players[s.active].waaaghUsed ? 'ใช้ไปแล้ว' : 'WAAAGH!!!'}</button>}
          </div>
        )}
        {tests.length === 0 && <div className="muted small">ไม่มีหน่วยที่ต้องทอย Battle-shock</div>}
        {tests.map((t) => {
          const u = U(t.unitId);
          const ib = canUseStratagem(s, u.owner, 'insane-bravery', u);
          return (
            <div key={t.unitId} className="row card" style={{ padding: 8 }}>
              <div className="grow small"><b>{u.name}</b><div className="tiny muted">{u.battleShocked ? 'Battle-shocked อยู่' : 'ต่ำกว่าครึ่ง'} · ต้องได้ 2D6 ≥ {bestLd(u)}</div></div>
              {t.passed === null ? (
                <>
                  <button className="btn small" disabled={!!ib} onClick={() => act((g) => rollBattleShock(g, u.id, true))}>Insane Bravery 1CP</button>
                  <button className="btn small primary" onClick={() => act((g) => rollBattleShock(g, u.id))}>ทอย</button>
                </>
              ) : <span className={t.passed ? 'p0' : 'err'}>{t.auto ? 'ผ่าน (Insane Bravery)' : `${t.result} ${t.passed ? 'ผ่าน' : 'Battle-shocked!'}`}</span>}
            </div>
          );
        })}
        <button className="btn primary" disabled={pending.length > 0} onClick={() => { act((g) => endPhase(g)); setSel(null); }}>ไป Movement ▶</button>
      </>
    );
  };

  const movementPanel = () => {
    if (mode?.k === 'place') return placePanel();
    if (mode?.k === 'move' && modeUnit) {
      const advRR = mode.kind === 'advance' ? canUseStratagem(s, modeUnit.owner, 'command-reroll', modeUnit) : 'x';
      return (
        <>
          <div className="small"><b>{modeUnit.name}</b> · {mode.kind === 'normal' ? 'Normal move' : mode.kind === 'advance' ? `Advance (M + ${modeUnit.advanceRoll})` : modeUnit.battleShocked ? 'Fall back – Desperate Escape (hazard ทุกตัว)' : 'Fall back – Ordered Retreat'} · ลากโมเดลบนสนาม ระบบจำกัดระยะให้</div>
          {moveControls(mode.kind, () => confirmMove(mode.kind),
            mode.kind === 'advance' && unitHasAbility(modeUnit, 'Waaagh!') && freeAdvRR !== modeUnit.id ? <button className="btn small" onClick={() => { act((g) => rollAdvance(g, unitById(g, modeUnit.id))); setFreeAdvRR(modeUnit.id); setDraft(startPaths(modeUnit)); }}>Re-roll advance (Waaagh! ฟรี)</button>
            : mode.kind === 'advance' && !advRR ? <button className="btn small" onClick={() => { act((g) => { const gu = unitById(g, modeUnit.id); spendStratagem(g, gu.owner, 'command-reroll', gu); rollAdvance(g, gu); }); setDraft(startPaths(modeUnit)); }}>Re-roll advance 1CP</button> : undefined)}
        </>
      );
    }
    const mine = s.units.filter((u) => u.owner === s.active && (onBoard(u) || u.status === 'reserves' || u.status === 'embarked'));
    const u = selUnit && mine.includes(selUnit) && !selUnit.move ? selUnit : null;
    const moved = selUnit && mine.includes(selUnit) && selUnit.move && ['normal', 'advance', 'fallback'].includes(selUnit.move) ? selUnit : null;
    const rides = moved ? s.units.filter((t) => t.owner === s.active && t.transport && onBoard(t) && !canEmbarkIn(s, moved, t)) : [];
    return (
      <>
        {!selUnit && <div className="small muted">เลือกหน่วยเพื่อเดิน · หน่วยที่ไม่ได้สั่งจะยืนนิ่งเมื่อจบ phase</div>}
        <div className="unit-strip">{mine.map((x) => unitPill(x, !!x.move))}</div>
        {u && u.status === 'embarked' && (() => {
          const t = U(u.embarkedIn!);
          const dm = disembarkMode(s, t);
          return dm
            ? <button className="btn primary" onClick={() => setMode({ k: 'place', unitId: u.id, how: 'disembark', transportId: t.id })}>ลงจากรถ {t.name} ({dm === 'tactical' ? 'Tactical: ลงแล้วเดินต่อได้' : dm === 'rapid' ? 'Rapid: ลงแล้วชาร์จไม่ได้' : 'Combat: hazard + battle-shocked'})</button>
            : <div className="muted small">รถ Advance/Fall back มาแล้ว ลงไม่ได้ phase นี้</div>;
        })()}
        {rides.map((t) => (
          <button key={t.id} className="btn" onClick={() => { const e = act((g) => embarkUnit(g, unitById(g, moved!.id), unitById(g, t.id))); if (e) flash(e); else setSel(null); }}>ขึ้นรถ {t.name}</button>
        ))}
        {u && u.status === 'reserves' && (
          canIngress(s, u)
            ? <button className="btn primary" onClick={() => setMode({ k: 'place', unitId: u.id, how: u.core.deepStrike ? 'deepStrike' : 'ingress' })}>ลงสนาม ({u.core.deepStrike ? 'Deep Strike' : 'Ingress'})</button>
            : <div className="muted small">ลงสนามได้ตั้งแต่ Battle Round {RULES.reserves.firstRound}</div>
        )}
        {u && onBoard(u) && (
          <>
            {unitCard(u)}
            <div className="row">
              {!isEngaged(s, u) && <button className="btn" onClick={() => setMode({ k: 'move', unitId: u.id, kind: 'normal', fly }, startPaths(u))}>Normal {alive(u)[0].profile.M}"</button>}
              {!isEngaged(s, u) && <button className="btn" onClick={() => { act((g) => rollAdvance(g, unitById(g, u.id))); setMode({ k: 'move', unitId: u.id, kind: 'advance', fly }, startPaths(u)); }}>Advance</button>}
              {isEngaged(s, u) && <button className="btn" onClick={() => setMode({ k: 'move', unitId: u.id, kind: 'fallback', fly }, startPaths(u))}>Fall back</button>}
              <button className="btn" onClick={() => { act((g) => remainStationary(g, unitById(g, u.id))); setSel(null); }}>ยืนนิ่ง</button>
              {hasKw(u, 'FLY') && <button className={`btn small ${fly ? 'on' : ''}`} onClick={() => setFly(!fly)}>บิน (−2")</button>}
            </div>
          </>
        )}
        {selUnit && selUnit.owner !== s.active && unitCard(selUnit)}
        <button className="btn primary" onClick={() => { act((g) => endPhase(g)); setSel(null); setMode(null); }}>จบ Movement ▶</button>
      </>
    );
  };

  const shootPanel = () => {
    if (mode?.k === 'explosives' && modeUnit) {
      return (
        <>
          <div className="small"><b>Explosives</b> ({modeUnit.name}): แตะเป้าที่ไม่ engaged ภายใน 8" ที่มองเห็น</div>
          <div className="row">
            <button className="btn" onClick={() => setMode(null)}>ยกเลิก</button>
            <button className="btn primary grow" disabled={!mode.target} onClick={() => {
              const res = act((g) => {
                const gu = unitById(g, modeUnit.id);
                spendStratagem(g, gu.owner, 'explosives', gu);
                const r = rollN(g, 6);
                const n = r.filter((x) => x >= 4).length;
                if (n) applyMortalWounds(g, unitById(g, mode.target!), n, 'Explosives');
                return r;
              });
              flash(`Explosives: [${res.join(' ')}] ${res.filter((x) => x >= 4).length} MW`);
              setMode(null);
            }}>ขว้าง (6D6, 4+)</button>
          </div>
        </>
      );
    }
    if (mode?.k === 'shoot' && modeUnit) {
      const opt = { mode: mode.smode, useCloseQuarters: mode.useCQ, profile: mode.profile, skipWeapons: mode.skip };
      const remaining = rangedWeaponNames(modeUnit).filter((n) => !modeUnit.weaponsFired.includes(n));
      const res = mode.target ? buildShootPools(s, modeUnit.id, mode.target, opt) : null;
      const multi = alive(modeUnit)[0]?.weapons.filter((w) => !isMelee(w.profiles[0]) && w.profiles.length > 1) ?? [];
      const hasCQ = alive(modeUnit).some((m) => m.weapons.some((w) => hasAbility(w.profiles[0], 'close-quarters'))) && alive(modeUnit).some((m) => m.weapons.some((w) => !isMelee(w.profiles[0]) && !hasAbility(w.profiles[0], 'close-quarters')));
      return (
        <>
          <div className="small"><b>{modeUnit.name}</b> <span className="muted">· {mode.smode === 'snap' ? 'Snap Shooting' : mode.smode === 'normal' ? 'ยิง' : mode.smode}{mode.target ? ` › ${U(mode.target).name}` : ' · แตะเป้าบนสนาม'}</span></div>
          {!mode.overwatch && remaining.length > 1 && (
            <div className="row">
              <span className="label">อาวุธที่ยิงใส่เป้านี้</span>
              {remaining.map((n) => {
                const off = (mode.skip ?? []).includes(n);
                return <button key={n} className={`btn small ${off ? '' : 'on'}`} onClick={() => setModeRaw({ ...mode, skip: off ? (mode.skip ?? []).filter((x) => x !== n) : [...(mode.skip ?? []), n] })}>{off ? '○' : '●'} {n}</button>;
              })}
            </div>
          )}
          <div className="row">
            {hasCQ && mode.smode !== 'closeQuarters' && <button className={`btn small ${mode.useCQ ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, useCQ: !mode.useCQ })}>ใช้ Pistol/Close-quarters</button>}
            {multi.map((w) => (
              <button key={w.name} className="btn small" onClick={() => setModeRaw({ ...mode, profile: { ...mode.profile, [w.name]: ((mode.profile[w.name] ?? 0) + 1) % w.profiles.length } })}>
                {w.name}: {w.profiles[mode.profile[w.name] ?? 0].name}
              </button>
            ))}
          </div>
          {!mode.overwatch && buffPanel(modeUnit)}
          {res?.error && <div className="err">{res.error}</div>}
          {res && !res.error && (() => {
            // one row per weapon profile; cover can differ per shooter, so pools are merged for display
            const T = U(mode.target!);
            const groups = new Map<string, typeof res.pools>();
            for (const p of res.pools) { const k = p.weapon + '|' + p.profile.name; groups.set(k, [...(groups.get(k) ?? []), p]); }
            let total = 0;
            const rows = [...groups.values()].map((ps) => {
              const p = ps[0];
              const ev = ps.reduce((a, x) => a + expectedDamage(s, x, T).unsaved, 0);
              total += ev;
              const models = ps.reduce((a, x) => a + x.models, 0);
              const covered = ps.filter((x) => x.skillNote.includes('Cover')).reduce((a, x) => a + x.models, 0);
              return (
                <div key={p.key} className="small">
                  <b>{p.weapon}{p.profile.name !== p.weapon ? ` – ${p.profile.name}` : ''}</b> <span className="muted">×{models}</span>
                  <div className="statline">
                    Hit <b>{p.autoHit ? 'auto' : p.hitOn6Only ? '6' : `${p.skill}+`}</b>{p.hitMod ? ` (${p.hitMod > 0 ? '+' : ''}${p.hitMod})` : ''} · Wound <b>{p.woundNeed}+</b>{p.woundMod ? ` (+${p.woundMod})` : ''} · AP <b>{p.ap}</b> · D <b>{p.damage}</b>
                    {covered ? ` · cover ${covered}/${models}` : ''}{p.rerollAllHits ? ' · Oath' : ''}
                  </div>
                </div>
              );
            });
            return (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows}
                <div className="tiny muted">คาดว่าจะทำ wound ที่ผ่าน save ได้ประมาณ {total.toFixed(1)}</div>
              </div>
            );
          })()}
          {res && !res.error && res.notes.map((n) => <div key={n} className="err">{n}</div>)}
          <div className="row">
            <button className="btn" onClick={() => setMode(null)}>ยกเลิก</button>
            <button className="btn primary grow" disabled={!res || !!res.error || !res.pools.length} onClick={() => {
              act((g) => {
                const gu = unitById(g, modeUnit.id);
                if (mode.overwatch) spendStratagem(g, gu.owner, 'fire-overwatch', gu);
                const r = buildShootPools(g, gu.id, mode.target!, opt);
                startAttack(g, mode.overwatch ? 'overwatch' : 'shoot', gu.id, mode.target!, r.pools);
              });
            }}>ยิง!{mode.overwatch ? ' (1CP)' : ''}</button>
          </div>
        </>
      );
    }
    const mine = boardUnits(s, s.active);
    const u = selUnit && mine.includes(selUnit) ? selUnit : null;
    const modes = u ? shootingModes(s, u) : [];
    const canExplode = u && !u.selectedToShoot && !isEngaged(s, u) && u.move !== 'advance' && u.move !== 'fallback' && (hasKw(u, 'GRENADES') || hasKw(u, 'EXPLOSIVES')) && !canUseStratagem(s, u.owner, 'explosives', u);
    return (
      <>
        {!selUnit && <div className="small muted">เลือกหน่วยที่จะยิง แล้วแตะเป้าบนสนาม · ระบบเช็กระยะ สายตา และ cover ให้</div>}
        <div className="unit-strip">{mine.map((x) => unitPill(x, x.selectedToShoot || shootingModes(s, x).length === 0))}</div>
        {u && (
          <>
            {unitCard(u)}
            <div className="row">
              {modes.map((m) => <button key={m} className="btn" onClick={() => setMode({ k: 'shoot', unitId: u.id, smode: m, target: null, useCQ: false, profile: {} })}>{m === 'normal' ? 'ยิง' : m === 'assault' ? 'Assault (advance มา)' : m === 'closeQuarters' ? 'Close-quarters' : 'Indirect'}</button>)}
              {modes.length === 0 && <span className="muted small">{u.selectedToShoot ? 'ยิงไปแล้ว' : u.move === 'fallback' ? 'Fall back มา ยิงไม่ได้' : u.move === 'advance' ? 'Advance มา (ไม่มีอาวุธ Assault)' : 'ยิงไม่ได้'}</span>}
              {canExplode && <button className="btn small" onClick={() => setMode({ k: 'explosives', unitId: u.id, target: null })}>Explosives 1CP</button>}
              {u.weaponsFired.length > 0 && !u.selectedToShoot && <button className="btn small ghost" onClick={() => act((g) => endUnitShooting(unitById(g, u.id)))}>จบการยิงหน่วยนี้</button>}
            </div>
            {u.weaponsFired.length > 0 && !u.selectedToShoot && <div className="tiny muted">ยิงไปแล้ว: {u.weaponsFired.join(', ')} · อาวุธที่เหลือยิงเป้าอื่นได้</div>}
          </>
        )}
        {selUnit && selUnit.owner !== s.active && unitCard(selUnit)}
        <button className="btn primary" onClick={() => { act((g) => endPhase(g)); setSel(null); setMode(null); }}>จบ Shooting ▶</button>
      </>
    );
  };

  const chargePanel = () => {
    if (mode?.k === 'charge' && modeUnit) {
      const roll = modeUnit.chargeRoll ?? 0;
      const cr = canUseStratagem(s, modeUnit.owner, 'command-reroll', modeUnit);
      const finish = () => { if (mode.heroic) act((g) => { g.window = null; }); };
      return (
        <>
          <div className="big-result">Charge roll: {roll}"</div>
          <div className="small">{chargeOpts.length ? `เลือกเป้า (แตะหน่วยศัตรูที่เรืองแสง) แล้วลากโมเดลให้ engaged (≤${RULES.engagementRange}") หรือกด Auto` : 'ไม่มีเป้าหมายภายในระยะที่ทอยได้ — ชาร์จไม่สำเร็จ'}</div>
          {mode.targets.length > 0 && moveControls('charge', () => confirmMove('charge', () => {
            finish();
            if (hasKw(modeUnit, 'MONSTER') || hasKw(modeUnit, 'VEHICLE')) setTimeout(() => setModeRaw({ k: 'crush', unitId: modeUnit.id }), 0);
          }), <button className="btn small" onClick={() => { const add = autoApproach(s, modeUnit, mode.targets.map(U), roll); setDraft(mergePaths(startPaths(modeUnit), add)); setCheck(null); }}>Auto</button>)}
          <div className="row">
            {!cr && <button className="btn small" onClick={() => { act((g) => rerollCharge(g, unitById(g, modeUnit.id), false, mode.heroic === 'fray' ? 6 : undefined)); setModeRaw({ ...mode, targets: [] }); setDraft(startPaths(modeUnit)); }}>Re-roll charge 1CP</button>}
            <button className="btn" onClick={() => { setMode(null); finish(); }}>ไม่ชาร์จ / จบ</button>
          </div>
        </>
      );
    }
    if (mode?.k === 'crush' && modeUnit) {
      return (
        <>
          <div className="small">Crushing Impact (1CP): แตะหน่วยศัตรูที่ engaged อยู่ — ทอย D6 เท่ากับ T: 5+ ศัตรูโดน MW, 1 ตัวเองโดน MW</div>
          <button className="btn" onClick={() => setMode(null)}>ไม่ใช้</button>
        </>
      );
    }
    const mine = boardUnits(s, s.active);
    const u = selUnit && mine.includes(selUnit) ? selUnit : null;
    const why = u ? chargeEligibility(s, u) : null;
    return (
      <>
        {!selUnit && <div className="small muted">หน่วยที่ชาร์จได้ต้องอยู่ภายใน 12" ของศัตรู · ทอย 2D6 ก่อนแล้วค่อยเลือกเป้าที่อยู่ในระยะ</div>}
        <div className="unit-strip">{mine.map((x) => unitPill(x, !!chargeEligibility(s, x)))}</div>
        {u && (
          <>
            {unitCard(u)}
            {why ? <div className="muted small">ชาร์จไม่ได้: {why}</div> : (
              <div className="row">
                <button className="btn primary" onClick={() => { act((g) => declareCharge(g, unitById(g, u.id), fly)); setMode({ k: 'charge', unitId: u.id, targets: [] }, startPaths(u)); }}>ประกาศชาร์จ (2D6)</button>
                {hasKw(u, 'FLY') && <button className={`btn small ${fly ? 'on' : ''}`} onClick={() => setFly(!fly)}>บิน (−2")</button>}
              </div>
            )}
          </>
        )}
        {selUnit && selUnit.owner !== s.active && unitCard(selUnit)}
        <button className="btn primary" onClick={() => { act((g) => endPhase(g)); setSel(null); setMode(null); }}>จบ Charge ▶</button>
      </>
    );
  };

  const pilePanel = () => {
    if (mode?.k !== 'pile' || !modeUnit) return null;
    const u = modeUnit;
    const cm = mode.kind === 'consolidate' ? consolidateMode(s, u) : null;
    const pileTargets = isEngaged(s, u) ? engagedEnemies(s, u) : boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= RULES.pileIn.targetRange);
    const auto = () => {
      let add: Paths;
      if (cm?.mode === 'objective' && cm.objective) add = autoApproach(s, u, [], RULES.consolidate.distance, { objective: polyCentroid(objectiveTerrain(s, cm.objective).poly) });
      else add = autoApproach(s, u, cm ? cm.enemies : pileTargets, mode.kind === 'pileIn' ? RULES.pileIn.distance : RULES.consolidate.distance);
      setDraft(mergePaths(startPaths(u), add));
      setCheck(null);
    };
    return (
      <>
        <div className="small"><b>{u.name}</b> · {mode.kind === 'pileIn' ? `Pile-in ${RULES.pileIn.distance}"${mode.overrun ? ' (Overrun)' : ''}` : `Consolidate ${RULES.consolidate.distance}" — โหมด: ${cm?.mode ?? '-'}`}</div>
        {moveControls(mode.kind === 'pileIn' ? 'pile-in' : 'consolidate', () => confirmMove(mode.kind, () => {
          if (!mode.overrun) return;
          const eng = act((g) => {
            const gu = unitById(g, u.id);
            const e = engagedEnemies(g, gu).map((x) => x.id);
            if (!e.length) markFought(g, gu);
            return e;
          });
          if (eng.length) setModeRaw({ k: 'fight', unitId: u.id, target: eng.length === 1 ? eng[0] : null, epic: false });
        }), <button className="btn small" onClick={auto}>Auto</button>)}
      </>
    );
  };

  const fightPanel = () => {
    const f = s.fight!;
    if (mode?.k === 'pile') return pilePanel();
    if (f.step === 'pileIn' || f.step === 'consolidate') {
      const p = f.stepPlayer;
      const list = boardUnits(s, p).filter((u) => (f.step === 'pileIn' ? pileInEligible(s, u) : consolidateEligible(s, u) && consolidateMode(s, u).mode));
      return (
        <>
          <div className="handoff">{f.step === 'pileIn' ? 'Pile-in' : 'Consolidate'} · {pName(s, p)} {p === s.active ? '(ผู้เล่นเจ้าของเทิร์นก่อน)' : ''}</div>
          {list.length === 0 && <div className="muted small">ไม่มีหน่วยที่ขยับได้</div>}
          <div className="unit-strip">{list.map((u) => unitPill(u, f.movedThisStep.includes(u.id), () => { setSel(u.id); if (!f.movedThisStep.includes(u.id)) setMode({ k: 'pile', unitId: u.id, kind: f.step === 'pileIn' ? 'pileIn' : 'consolidate' }, startPaths(u)); }))}</div>
          <button className="btn primary" onClick={() => { act((g) => (f.step === 'pileIn' ? endPileInStep(g) : endConsolidateStep(g))); setMode(null); setSel(null); }}>เสร็จ ▶</button>
        </>
      );
    }
    // fight step
    if (mode?.k === 'fight' && modeUnit) {
      const u = modeUnit;
      const weapons = [...new Map(alive(u).flatMap(meleeWeapons).filter((w) => !hasAbility(w.profiles[0], 'extra-attacks')).map((w) => [w.name, w])).values()];
      const chars = alive(u).filter((m) => m.isCharacter);
      const ec = canUseStratagem(s, u.owner, 'epic-challenge', u);
      const res = mode.target ? buildFightPools(s, u.id, mode.target, { weapon: mode.weapon, epicChallengeModel: mode.epic ? chars[0]?.id : undefined }) : null;
      return (
        <>
          <div className="small"><b>{u.name}</b> · {fightTargets.length > 1 ? 'แตะเลือกเป้า' : ''} อาวุธ (ต่อโมเดล 1 ชิ้น):</div>
          <div className="row">
            {weapons.map((w) => <button key={w.name} className={`btn small ${mode.weapon === w.name ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, weapon: w.name })}>{w.name}</button>)}
            {chars.length > 0 && !ec && <button className={`btn small ${mode.epic ? 'on' : ''}`} onClick={() => setModeRaw({ ...mode, epic: !mode.epic })}>Epic Challenge 1CP</button>}
          </div>
          {buffPanel(u)}
          {res?.pools.map((p) => <div key={p.key} className="tiny">{p.weapon}: {p.attackNote} · Hit {p.skill}+ · Wound {p.woundNeed}+ ({p.woundNote}) · AP{p.ap} D{p.damage}</div>)}
          {res?.notes.map((n) => <div key={n} className="err">{n}</div>)}
          <div className="row">
            <button className="btn primary grow" disabled={!res || !res.pools.length} onClick={() => act((g) => {
              const gu = unitById(g, u.id);
              if (mode.epic) spendStratagem(g, gu.owner, 'epic-challenge', gu);
              const r = buildFightPools(g, gu.id, mode.target!, { weapon: mode.weapon, epicChallengeModel: mode.epic ? chars[0]?.id : undefined });
              startAttack(g, 'fight', gu.id, mode.target!, r.pools);
            })}>ตี!</button>
          </div>
        </>
      );
    }
    const cands = fc!;
    const pick = (u: UnitState) => {
      setSel(u.id);
      const eng = engagedEnemies(s, u);
      if (eng.length) setMode({ k: 'fight', unitId: u.id, target: eng.length === 1 ? eng[0].id : null, epic: false });
      else setMode({ k: 'pile', unitId: u.id, kind: 'pileIn', overrun: true }, startPaths(u));
    };
    const overrunReady = selUnit && cands.units.includes(selUnit) && !isEngaged(s, selUnit);
    return (
      <>
        {cands.player !== null && <div className="handoff">{pName(s, cands.player)} เลือกหน่วยที่จะสู้{cands.units.some((u) => u.chargedTurn === s.turn || u.core.fightsFirst || u.foughtFirstUntilTurn === s.turn) ? ' (Fights First ก่อน)' : ''}</div>}
        <div className="unit-strip">{cands.units.map((u) => unitPill(u, false, () => pick(u)))}</div>
        {overrunReady && (
          <div className="row">
            <span className="small grow">{selUnit!.name} ไม่ engaged แล้ว Overrun fight (pile-in เพิ่ม 3")</span>
            {isEngaged(s, selUnit!) ? null : <button className="btn small" onClick={() => act((g) => markFought(g, unitById(g, selUnit!.id)))}>ข้าม (ไม่ได้ตี)</button>}
          </div>
        )}
        {cands.units.length === 0 && <div className="muted small">ไม่มีหน่วยที่สู้ได้</div>}
      </>
    );
  };

  const scoutsPanel = () => {
    if (mode?.k === 'move' && modeUnit) {
      return (
        <>
          <div className="small"><b>{modeUnit.name}</b> · Scout move สูงสุด {modeUnit.core.scouts}" · ต้องจบห่างศัตรูเกิน {RULES.reserves.enemyDistance}"</div>
          {moveControls('scout', () => confirmMove('scout'))}
        </>
      );
    }
    const p = s.deployTurn;
    const list = scoutUnits(s, p);
    return (
      <>
        <div className="handoff">Pre-battle · Scouts · {pName(s, p)}</div>
        <div className="unit-strip">{list.map((u) => unitPill(u, false, () => { setSel(u.id); setMode({ k: 'move', unitId: u.id, kind: 'scout', fly: false }, startPaths(u)); }))}</div>
        {!list.length && <div className="muted small">ไม่มีหน่วย Scouts ที่ต้องขยับแล้ว</div>}
        <button className="btn primary" onClick={() => { act((g) => endScouts(g)); setSel(null); }}>เสร็จ ▶</button>
      </>
    );
  };

  const missionsSheet = () => {
    const prim = primaryById(s.primaryId);
    return (
      <div className="tray-backdrop" onClick={() => setShowMissions(false)}>
        <div className="tray" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-title">Mission</div>
          <div className="card">
            <div style={{ fontWeight: 700 }}>{prim.name} <span className="muted small">· Primary (ทั้งสองฝ่าย)</span></div>
            {prim.scoring.map((r) => <div key={r.text + r.rounds} className="small">R{r.rounds[0]}–{r.rounds[1]} · {r.text} <b>{r.vp}VP</b>{r.bonus ? ` (+${r.bonus.vp})` : ''}</div>)}
            <div className="tiny muted">ระบบนับ Primary ให้อัตโนมัติ · สูงสุด 15VP ต่อรอบ / 45VP</div>
          </div>
          {s.players.map((P, i) => {
            const p = i as PlayerId;
            if (P.secMode === 'none') return null;
            const fixedPicking = P.secMode === 'fixed' && P.secActive.length < 2;
            return (
              <div key={i} className={`card side ${i ? 's1' : ''}`}>
                <div className="row">
                  <b className="grow">{P.name} · Secondary ({P.secMode === 'tactical' ? 'Tactical' : 'Fixed'})</b>
                  <span className="small">{P.secVp} VP</span>
                </div>
                {fixedPicking && (
                  <>
                    <div className="small muted">เลือก Fixed Mission 2 ใบ (ใช้ทั้งเกม)</div>
                    {MISSIONS.secondaries.filter((x) => x.fixed).map((x) => (
                      <button key={x.id} className="btn small" onClick={() => act((g) => chooseFixedSecondaries(g, p, [...g.players[p].secActive, x.id]))} disabled={P.secActive.includes(x.id)}>{x.name}</button>
                    ))}
                  </>
                )}
                {!fixedPicking && P.secActive.length === 0 && <div className="small muted">{P.secMode === 'tactical' ? 'จะจั่ว 2 ใบตอนต้น Command phase ของคุณ' : '—'}</div>}
                {!fixedPicking && P.secActive.map((id) => {
                  const d = secondaryById(id);
                  return (
                    <div key={id} className="sec-card">
                      <div className="row"><b className="grow">{d.name}</b><span className="tiny muted">{d.when}</span></div>
                      <div className="small">{d.text}</div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <span className="tiny muted">ทำสำเร็จ:</span>
                        {d.options.map((v) => <button key={v} className="btn small" onClick={() => { const got = act((g) => claimSecondary(g, p, id, v)); flash(`+${got} VP`); }}>+{v}</button>)}
                        {P.secMode === 'tactical' && <button className="btn small ghost" onClick={() => act((g) => discardSecondary(g, p, id))}>ทิ้ง{s.active === p ? ' (+1CP)' : ''}</button>}
                        {P.secMode === 'tactical' && !P.secSwapUsed && s.active === p && s.phase === 'command' && P.cp >= 1 && <button className="btn small ghost" onClick={() => act((g) => swapSecondary(g, p, id))}>เปลี่ยนใบ 1CP</button>}
                      </div>
                    </div>
                  );
                })}
                {P.secMode === 'fixed' && !fixedPicking && <div className="tiny muted">แต่ละใบได้ไม่เกิน 20VP</div>}
              </div>
            );
          })}
          {s.players.every((P) => P.secMode === 'none') && <div className="small muted">เกมนี้ไม่ได้ใช้ Secondary Missions</div>}
          <button className="btn" onClick={() => setShowMissions(false)}>ปิด</button>
        </div>
      </div>
    );
  };

  const panel = () => {
    if (s.phase === 'gameover') return null;
    if (bot !== null && botShouldAct(s, bot)) return <div className="handoff">{pName(s, bot)} กำลังเล่น…</div>;
    if (s.phase === 'scouts') return scoutsPanel();
    if (s.window) return windowPanel();
    if (s.phase === 'deploy') return deployPanel();
    if (s.phase === 'command') return commandPanel();
    if (s.phase === 'movement') return movementPanel();
    if (s.phase === 'shooting') return shootPanel();
    if (s.phase === 'charge') return chargePanel();
    if (s.phase === 'fight') return fightPanel();
    return null;
  };

  const prim = primaryById(s.primaryId);
  const draftUnit = mode && (mode.k === 'move' || mode.k === 'place' || mode.k === 'charge' || mode.k === 'pile') ? mode.unitId : null;

  return (
    <>
      <div className="topbar">
        <button className="btn small ghost" onClick={() => setShowMenu(true)} aria-label="เมนู">☰</button>
        <div className="grow">
          <div className="phase">{s.phase === 'deploy' ? 'Deployment' : s.phase === 'scouts' ? 'Pre-battle' : `Battle Round ${s.round}`}</div>
          <div className="tiny muted">{s.phase === 'deploy' || s.phase === 'scouts' ? prim.name : `เทิร์น ${pName(s, s.active)}`}</div>
        </div>
        <button className="score" onClick={() => setShowMissions(true)}>
          <span className="p0">{s.players[0].vp + s.players[0].secVp}<small> VP</small> {s.players[0].cp}<small> CP</small></span>
          <span className="p1">{s.players[1].vp + s.players[1].secVp}<small> VP</small> {s.players[1].cp}<small> CP</small></span>
        </button>
        <button className="btn small" onClick={() => setShowStrats(true)}>Strat</button>
      </div>
      {['command', 'movement', 'shooting', 'charge', 'fight'].includes(s.phase) && (
        <div className="phasebar">
          {(['command', 'movement', 'shooting', 'charge', 'fight'] as const).map((ph) => (
            <span key={ph} className={s.phase === ph ? 'on' : ['command', 'movement', 'shooting', 'charge', 'fight'].indexOf(ph) < ['command', 'movement', 'shooting', 'charge', 'fight'].indexOf(s.phase) ? 'done' : ''}>{PHASE_TH[ph][0]}{PHASE_TH[ph].slice(1).toLowerCase()}</span>
          ))}
        </div>
      )}
      <div className="board-wrap">
        <Board
          s={s}
          viewer={actor}
          selected={sel}
          draftUnit={draftUnit}
          draft={draft}
          maxFor={mode?.k === 'place' ? undefined : maxFor}
          animateMoves={bot !== null ? [bot] : undefined}
          bad={check?.bad}
          targets={targets}
          picked={picked}
          rings={rings}
          badges={badges}
          losLines={losLines}
          onTapUnit={onTapUnit}
          onTapBoard={onTapBoard}
          onDraft={(d) => { setDraft(d); setCheck(null); }}
        />
        {botSays && <div className="bot-caption">{botSays.includes(pName(s, bot ?? 1)) ? botSays : <><b>{pName(s, bot ?? 1)}</b> {botSays}</>}</div>}
        {toast && <div className="toast">{toast}</div>}
        {mode?.k === 'shoot' && !mode.target && <div className="toast">แตะหน่วยศัตรูที่เรืองแสงเพื่อเลือกเป้า ({targets.length} เป้า)</div>}
      </div>
      <div className={`panel ${actor ? 's1' : ''}`}>
        {s.phase !== 'deploy' && s.phase !== 'gameover' && !s.window && <div className="label"><span className={actor ? 'p1' : 'p0'}>●</span> ตาของ {pName(s, actor)}</div>}
        {panel()}
      </div>

      {s.attack && (
        <DiceTray
          s={s}
          onStep={() => act((g) => stepAttack(g))}
          onReroll={onReroll}
          onSkip={() => act((g) => resolveAll(g))}
          onClose={onTrayClose}
        />
      )}

      {sheet && (
        <div className="tray-backdrop" onClick={() => setSheet(null)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <UnitView u={U(sheet)} />
            <button className="btn" onClick={() => setSheet(null)}>ปิด</button>
          </div>
        </div>
      )}

      {showMissions && missionsSheet()}
      {showMenu && (
        <div className="tray-backdrop" onClick={() => setShowMenu(false)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">เมนู</div>
            <button className="btn" disabled={!canUndo} onClick={() => { undo(); setMode(null); setShowMenu(false); flash('ย้อนกลับ 1 ขั้นแล้ว'); }}>ย้อนกลับ 1 ขั้น (Undo)</button>
            <button className="btn" onClick={() => { setShowMenu(false); setShowMissions(true); }}>Mission & Secondary</button>
            <button className="btn" onClick={() => { setShowMenu(false); setShowLog(true); }}>Battle log & กฎกองทัพ</button>
            <button className="btn" onClick={() => { setShowMenu(false); setShowStrats(true); }}>Stratagems</button>
            <button className="btn danger" onClick={onExit}>ออกไปหน้าแรก (เกมเซฟไว้แล้ว)</button>
            <button className="btn ghost" onClick={() => setShowMenu(false)}>ปิด</button>
          </div>
        </div>
      )}
      {showStrats && (() => {
        const p = actor;
        const P = s.players[p];
        const own = s.units.filter((u) => u.owner === p && onBoard(u));
        const tgt = own.find((u) => u.id === stratUnit);
        return (
          <div className="tray-backdrop" onClick={() => setShowStrats(false)}>
            <div className="tray" onClick={(e) => e.stopPropagation()}>
              <h2 className={p ? 'p1' : 'p0'}>Stratagems · {P.name} · {P.cp} CP</h2>
              <div className="small muted">phase ตอนนี้: {PHASE_TH[s.phase]} ({s.active === p ? 'เทิร์นของคุณ' : 'เทิร์นศัตรู'})</div>
              <label className="small">เป้าหมาย (หน่วยของคุณ)
                <select style={{ width: '100%' }} value={stratUnit} onChange={(e) => setStratUnit(e.target.value)}>
                  <option value="">— ไม่ระบุ —</option>
                  {own.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              {P.detachments.map((d) => (
                <div key={d.id}>
                  <h3>{d.name} <span className="tiny muted">({d.forceDisposition})</span></h3>
                  {d.rules.map((r) => <details key={r.name}><summary className="small">Detachment rule: {r.name}</summary><div className="sheet">{r.text}</div></details>)}
                  {d.stratagems.map((st) => {
                    const why = canUseStratagem(s, p, st.id, tgt, st.cp);
                    return (
                      <div key={st.id} className="card" style={{ padding: 8, marginTop: 6 }}>
                        <div className="row">
                          <b className="grow">{st.name}</b>
                          <span className="chip">{st.cp}CP</span>
                          <button className="btn small primary" disabled={!!why} title={why ?? ''} onClick={() => { act((g) => spendStratagem(g, p, st.id, tgt ? unitById(g, tgt.id) : undefined, st.cp)); flash(`ใช้ ${st.name} แล้ว — ใช้ปุ่ม Buff ให้ผลตามข้อความ`); setShowStrats(false); }}>ใช้</button>
                        </div>
                        <div className="tiny muted">{st.type} · {st.turn} · {st.phase}{why ? ` · ${why}` : ''}</div>
                        <div className="sheet tiny">{st.text}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <h3>Core Stratagems</h3>
              <div className="tiny muted">ระบบเด้งให้ใช้อัตโนมัติตอนที่ถึงจังหวะตามกฎ</div>
              {RULES.coreStratagems.map((st) => <div key={st.id} className="small"><b>{st.name}</b> ({st.cp}CP) — {st.when}: {st.text}</div>)}
              <button className="btn" onClick={() => setShowStrats(false)}>ปิด</button>
            </div>
          </div>
        );
      })()}

      {showLog && (
        <div className="tray-backdrop" onClick={() => setShowLog(false)}>
          <div className="tray" onClick={(e) => e.stopPropagation()}>
            <h2>Battle Log</h2>
            <div className="log">
              {[...s.log].reverse().map((l, i) => <div key={i} className={l.kind}>{l.round ? `R${l.round} ` : ''}{l.text}</div>)}
            </div>
            <h3>Primary: {prim.name}</h3>
            <div className="small">{prim.scoring.map((r) => <div key={r.text + r.rounds}>R{r.rounds[0]}–{r.rounds[1]} · {r.text}: {r.vp}VP{r.bonus ? ` (+${r.bonus.vp})` : ''}</div>)}</div>
            {s.players.map((p, i) => (
              <details key={i}>
                <summary className={i ? 'p1' : 'p0'}>{p.name}: Army rules & Detachments</summary>
                {p.armyRules.map((r) => <div key={r.name} className="sheet"><b>{r.name}</b>{'\n'}{r.text}</div>)}
                {p.detachments.map((d) => (
                  <div key={d.id} className="sheet"><b>{d.name}</b> ({d.forceDisposition}){'\n'}{d.rules.map((r) => `• ${r.name}: ${r.text}`).join('\n')}{'\n'}<i>Stratagems:</i>{'\n'}{d.stratagems.map((st) => `• ${st.name} (${st.cp}CP) — ${st.text}`).join('\n')}</div>
                ))}
              </details>
            ))}
            <button className="btn" onClick={() => setShowLog(false)}>ปิด</button>
          </div>
        </div>
      )}

      {s.phase === 'gameover' && (
        <div className="tray-backdrop">
          <div className="tray">
            <div className="big-result">{s.winner === 'draw' ? 'เสมอ!' : `${pName(s, s.winner as PlayerId)} ชนะ!`}</div>
            <div className="big-result">{s.players[0].vp} – {s.players[1].vp}</div>
            <button className="btn primary" onClick={onExit}>กลับหน้าแรก</button>
          </div>
        </div>
      )}
    </>
  );
}
