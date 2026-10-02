// Making Attacks (04) + Attack Sequence (05), resolved stage by stage so the UI can show every roll.
import { RULES } from './config';
import { d6, exprAverage, rollExpr, rollN } from './dice';
import { baseDist, clamp } from './geometry';
import { alive, engagedEnemies, hasKw, isEngaged, log, modelEngagedWith, onBoard, other, unitById } from './state';
import type { AttackSession, Die, GameState, ModelState, Pool, UnitState, WeaponData, WeaponProfileData } from './types';
import { getAbility, hasAbility, isMelee } from './weapons';
import { hasCover, modelVisible, unitVisibleTo } from './visibility';

export type ShootMode = 'normal' | 'assault' | 'closeQuarters' | 'indirect' | 'snap';

export interface ShootOptions {
  mode: ShootMode;
  useCloseQuarters?: boolean; // non-M/V models: fire close-quarters weapons instead of other guns
  profile?: Record<string, number>; // weapon name -> chosen profile index
  skipWeapons?: string[];
}

// ---------- helpers ----------

export function targetToughness(u: UnitState): number {
  const a = alive(u);
  const body = a.filter((m) => m.isBodyguard);
  const pool = body.length ? body : a;
  return Math.max(...pool.map((m) => m.profile.T));
}

export function woundNeed(S: number, T: number): number {
  if (S >= T * 2) return 2;
  if (S > T) return 3;
  if (S === T) return 4;
  if (S * 2 <= T) return 6;
  return 5;
}

const isMV = (m: ModelState) => m.keywords.includes('MONSTER') || m.keywords.includes('VEHICLE');
const buffSum = (u: UnitState, plus: string, minus: string) => u.buffs.filter((b) => b.kind === plus).length - u.buffs.filter((b) => b.kind === minus).length;

interface Mods { skillDelta: number; skillNotes: string[]; hit: number; hitNotes: string[] }

function finishPoolMods(p: WeaponProfileData, mods: Mods, psychic: boolean) {
  let skillDelta = mods.skillDelta;
  let hit = mods.hit;
  if (psychic) { skillDelta = Math.min(0, skillDelta); hit = Math.max(0, hit); } // ignore detrimental modifiers
  const skill = p.skill === null ? null : clamp(p.skill + skillDelta, RULES.modifierCaps.bestSkill, RULES.modifierCaps.worstSkill);
  return { skill, hit: clamp(hit, -RULES.modifierCaps.hitRoll, RULES.modifierCaps.hitRoll) };
}

function newPool(key: string, w: WeaponData, p: WeaponProfileData, target: UnitState): Pool {
  const tk = target.keywords;
  const sus = getAbility(p, 'sustained-hits', tk);
  const anti = p.abilities.length ? (getAbility(p, 'anti', tk)?.on ?? 7) : 7;
  return {
    key, weapon: w.name, profile: p, models: 0, instances: [], attacks: 0, attackNote: '',
    skill: p.skill, skillNote: '', hitMod: 0, hitNote: '', hitOn6Only: false, autoHit: hasAbility(p, 'torrent', tk), noHitReroll: false,
    woundNeed: 4, woundMod: 0, woundNote: '', critWoundOn: Math.min(6, anti),
    sustained: sus ? (sus.value ?? '1') : null,
    lethal: hasAbility(p, 'lethal-hits', tk), devastating: hasAbility(p, 'devastating-wounds', tk), twinLinked: hasAbility(p, 'twin-linked', tk),
    precision: hasAbility(p, 'precision', tk), ap: p.AP, damage: p.D, hazardous: 0,
    hits: [], wounds: [], autoWounds: 0, saves: [], saveTargets: [], mortalFromDev: [], damageLines: [], killed: 0, done: false,
  };
}

function applyUnitBuffs(pool: Pool, u: UnitState) {
  if (u.buffs.some((b) => b.kind === 'lethal')) pool.lethal = true;
  if (u.buffs.some((b) => b.kind === 'devastating')) pool.devastating = true;
  if (u.buffs.some((b) => b.kind === 'sustained1') && !pool.sustained) pool.sustained = '1';
  const ap = u.buffs.filter((b) => b.kind === 'ap+1').length;
  if (ap) pool.ap = pool.ap - ap;
}

// ---------- building pools ----------

export interface BuildResult { pools: Pool[]; notes: string[]; error?: string }

export function shootingModes(s: GameState, u: UnitState): ShootMode[] {
  if (!onBoard(u) || u.selectedToShoot || u.move === 'fallback') return [];
  const weps = alive(u).flatMap((m) => m.weapons.flatMap((w) => w.profiles)).filter((p) => !isMelee(p));
  if (!weps.length) return [];
  const engaged = isEngaged(s, u);
  const modes: ShootMode[] = [];
  if (engaged) {
    if (u.move !== 'advance' && (weps.some((p) => hasAbility(p, 'close-quarters')) || alive(u).some(isMV))) modes.push('closeQuarters');
    return modes;
  }
  if (u.move === 'advance') { if (weps.some((p) => hasAbility(p, 'assault'))) modes.push('assault'); return modes; }
  modes.push('normal');
  if (weps.some((p) => hasAbility(p, 'indirect-fire'))) modes.push('indirect');
  return modes;
}

export function buildShootPools(s: GameState, attackerId: string, targetId: string, opt: ShootOptions): BuildResult {
  const A = unitById(s, attackerId);
  const T = unitById(s, targetId);
  const notes: string[] = [];
  const pools = new Map<string, Pool>();
  const tModels = alive(T);
  const tEngaged = isEngaged(s, T);
  const engagedWithTarget = engagedEnemies(s, A).some((e) => e.id === T.id);
  const tIsMV = tModels.some(isMV);
  if (opt.mode !== 'closeQuarters' && tEngaged && !tIsMV) return { pools: [], notes, error: 'เป้าหมาย engaged อยู่ ยิงไม่ได้ (ยกเว้น MONSTER/VEHICLE)' };
  if (opt.mode === 'closeQuarters' && !engagedWithTarget && !alive(A).some(isMV)) return { pools: [], notes, error: 'Close-quarters ยิงได้เฉพาะหน่วยที่ engaged ด้วย' };
  const T_T = targetToughness(T);
  const isOwnShootingPhase = s.phase === 'shooting' && A.owner === s.active;

  for (const m of alive(A)) {
    const ranged = m.weapons.filter((w) => !isMelee(w.profiles[0]) && !(opt.skipWeapons ?? []).includes(w.name));
    const cqOnly = ranged.filter((w) => hasAbility(w.profiles[0], 'close-quarters'));
    const others = ranged.filter((w) => !hasAbility(w.profiles[0], 'close-quarters'));
    let chosen = ranged;
    if (!isMV(m)) {
      if (opt.mode === 'closeQuarters') chosen = cqOnly;
      else chosen = opt.useCloseQuarters || !others.length ? cqOnly : others;
    }
    if (opt.mode === 'assault') chosen = chosen.filter((w) => hasAbility(w.profiles[opt.profile?.[w.name] ?? 0], 'assault'));
    const damagedHit = A.core.damaged !== undefined && m.wounds <= A.core.damaged;
    for (const w of chosen) {
      const pi = Math.min(opt.profile?.[w.name] ?? 0, w.profiles.length - 1);
      const p = w.profiles[pi];
      if (hasAbility(p, 'one-shot') && A.oneShotUsed.includes(w.name)) continue;
      const range = typeof p.range === 'number' ? p.range : 0;
      const d = Math.min(...tModels.map((t) => baseDist(m, t)));
      const maxRange = opt.mode === 'snap' ? Math.min(range, RULES.snapShooting.range) : range;
      if (d > maxRange + 1e-6) continue;
      if (opt.mode === 'closeQuarters' && !isMV(m) && !engagedWithTarget) continue;
      if (hasAbility(p, 'blast') && tEngaged) continue;
      const indirect = opt.mode === 'indirect' && hasAbility(p, 'indirect-fire');
      if (opt.mode === 'indirect' && !indirect && !tModels.some((t) => modelVisible(s, m, T, t))) continue;
      if (!indirect && !tModels.some((t) => modelVisible(s, m, T, t))) continue;
      if (indirect && T.core.loneOperative && T.sources.length === 1 && d > T.core.loneOperative) continue;

      const mods: Mods = { skillDelta: 0, skillNotes: [], hit: 0, hitNotes: [] };
      const cover = indirect || (!hasAbility(p, 'ignores-cover', T.keywords) && !A.buffs.some((b) => b.kind === 'ignoresCover') && hasCover(s, m, T));
      if (cover) { mods.skillDelta += 1; mods.skillNotes.push('Cover −1 BS'); }
      if (m.keywords.includes('TOWERING') && d <= RULES.plungingFire.toweringRange && !T.keywords.includes('AIRCRAFT')) { mods.skillDelta -= 1; mods.skillNotes.push('Plunging Fire +1 BS'); }
      if (hasAbility(p, 'heavy') && isOwnShootingPhase && !isEngaged(s, A) && A.setUpTurn !== s.turn && A.maxMoved <= RULES.heavyMaxMove + 1e-6) { mods.hit += 1; mods.hitNotes.push('Heavy +1'); }
      if (tIsMV && tEngaged && !(hasAbility(p, 'close-quarters') && engagedWithTarget)) { mods.hit -= 1; mods.hitNotes.push('ยิงเป้า M/V ที่ engaged −1'); }
      if (opt.mode === 'closeQuarters' && isMV(m) && !(hasAbility(p, 'close-quarters') && engagedWithTarget)) { mods.hit -= 1; mods.hitNotes.push('Big guns ใน combat −1'); }
      if (damagedHit) { mods.hit -= 1; mods.hitNotes.push('Damaged −1'); }
      const bh = buffSum(A, 'hit+1', 'hit-1');
      if (bh) { mods.hit += bh; mods.hitNotes.push(`Buff ${bh > 0 ? '+' : ''}${bh}`); }
      const psychic = hasAbility(p, 'psychic');
      const fm = finishPoolMods(p, mods, psychic);
      const half = d <= range / 2 + 1e-6;
      const key = [w.name, p.name, cover, half, fm.skill, fm.hit].join('|');
      let pool = pools.get(key);
      if (!pool) {
        pool = newPool(key, w, p, T);
        pool.skill = fm.skill;
        pool.skillNote = mods.skillNotes.join(' · ');
        pool.hitMod = fm.hit;
        pool.hitNote = mods.hitNotes.join(' · ') + (psychic ? ' (Psychic: ไม่สน modifier ลบ)' : '');
        if (opt.mode === 'snap') { pool.hitOn6Only = true; pool.noHitReroll = true; pool.autoHit = false; pool.hitNote = 'Snap Shooting: โดนเฉพาะ 6'; }
        if (indirect) {
          pool.noHitReroll = true;
          const spotted = A.move === 'stationary' && s.units.some((f) => f.owner === A.owner && onBoard(f) && alive(f).some((fm2) => tModels.some((t) => modelVisible(s, fm2, T, t))));
          pool.hitOn6Only = !spotted;
          if (spotted) pool.minHitUnmodified = RULES.indirectFire.spottedStationaryHitOn;
          pool.hitNote += spotted ? ' · Indirect (ยืนนิ่ง+มีคนเห็น): 1-3 พลาด' : ' · Indirect: โดนเฉพาะ 6';
        }
        const melta = getAbility(p, 'melta', T.keywords);
        if (melta && half) pool.damage = `${p.D}+${melta.value ?? 0}`.replace(/^(\d+)\+(\d+)$/, (_, a, b) => String(+a + +b));
        pool.woundNeed = woundNeed(p.S ?? 1, T_T);
        const wm = clamp(buffSum(A, 'wound+1', 'wound-1'), -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll);
        pool.woundMod = wm;
        pool.woundNote = `S${p.S} vs T${T_T}` + (wm ? ` · Buff ${wm > 0 ? '+' : ''}${wm}` : '');
        applyUnitBuffs(pool, A);
        pools.set(key, pool);
      }
      pool.models += 1;
      const extras: string[] = [];
      let flat = 0;
      const rf = getAbility(p, 'rapid-fire', T.keywords);
      if (rf && half) extras.push(rf.value ?? '1');
      const blast = getAbility(p, 'blast', T.keywords);
      if (blast) flat += parseInt(blast.value ?? '1', 10) * Math.floor(tModels.length / 5);
      pool.instances.push({ A: p.A, extras, flat });
      if (hasAbility(p, 'hazardous')) pool.hazardous += 1;
    }
  }
  const list = [...pools.values()];
  for (const pl of list) pl.attackNote = attackNote(pl);
  if (!list.length) notes.push('ไม่มีอาวุธที่อยู่ในระยะและมองเห็นเป้า');
  return { pools: list, notes };
}

export function meleeWeapons(m: ModelState): WeaponData[] {
  return m.weapons.filter((w) => isMelee(w.profiles[0]));
}

function scoreMelee(p: WeaponProfileData, T: number) {
  const a = exprAverage(p.A);
  const hit = (7 - (p.skill ?? 4)) / 6;
  const wound = (7 - woundNeed(p.S ?? 1, T)) / 6;
  return a * hit * wound * (1 + -p.AP * 0.25) * exprAverage(p.D);
}

export function buildFightPools(s: GameState, attackerId: string, targetId: string, opt: { weapon?: string; epicChallengeModel?: string } = {}): BuildResult {
  const A = unitById(s, attackerId);
  const T = unitById(s, targetId);
  const T_T = targetToughness(T);
  const pools = new Map<string, Pool>();
  for (const m of alive(A)) {
    if (!modelEngagedWith(m, T)) continue;
    const melee = meleeWeapons(m);
    const extra = melee.filter((w) => hasAbility(w.profiles[0], 'extra-attacks'));
    const normal = melee.filter((w) => !hasAbility(w.profiles[0], 'extra-attacks'));
    let main = normal.find((w) => w.name === opt.weapon);
    if (!main) main = [...normal].sort((a, b) => scoreMelee(b.profiles[0], T_T) - scoreMelee(a.profiles[0], T_T))[0];
    const use = [...(main ? [main] : []), ...extra];
    if (!use.length) use.push({ name: 'Close combat weapon', profiles: [{ name: 'Close combat weapon', range: 'Melee', A: '1', skill: 4, S: m.profile.T, AP: 0, D: '1', abilities: [] }] });
    const damagedHit = A.core.damaged !== undefined && m.wounds <= A.core.damaged;
    for (const w of use) {
      const p = w.profiles[0];
      const mods: Mods = { skillDelta: 0, skillNotes: [], hit: 0, hitNotes: [] };
      if (damagedHit) { mods.hit -= 1; mods.hitNotes.push('Damaged −1'); }
      const bh = buffSum(A, 'hit+1', 'hit-1');
      if (bh) { mods.hit += bh; mods.hitNotes.push(`Buff ${bh > 0 ? '+' : ''}${bh}`); }
      const fm = finishPoolMods(p, mods, hasAbility(p, 'psychic'));
      const precision = opt.epicChallengeModel === m.id;
      const key = [w.name, fm.hit, precision].join('|');
      let pool = pools.get(key);
      if (!pool) {
        pool = newPool(key, w, p, T);
        pool.skill = fm.skill; pool.hitMod = fm.hit; pool.hitNote = mods.hitNotes.join(' · ');
        if (precision) pool.precision = true;
        pool.woundNeed = woundNeed(p.S ?? 1, T_T);
        let wm = buffSum(A, 'wound+1', 'wound-1');
        const notes = [`S${p.S} vs T${T_T}`];
        if (hasAbility(p, 'lance', T.keywords) && A.chargedTurn === s.turn) { wm += 1; notes.push('Lance +1'); }
        pool.woundMod = clamp(wm, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll);
        pool.woundNote = notes.join(' · ');
        applyUnitBuffs(pool, A);
        pools.set(key, pool);
      }
      pool.models += 1;
      const cleave = getAbility(p, 'cleave', T.keywords);
      pool.instances.push({ A: p.A, extras: [], flat: cleave ? parseInt(cleave.value ?? '1', 10) * Math.floor(alive(T).length / 5) : 0 });
      if (hasAbility(p, 'hazardous')) pool.hazardous += 1;
    }
  }
  const list = [...pools.values()];
  for (const pl of list) pl.attackNote = attackNote(pl);
  return { pools: list, notes: list.length ? [] : ['ไม่มีโมเดลที่ engaged กับเป้า'] };
}

function attackNote(p: Pool): string {
  const extra = p.instances.reduce((a, i) => a + i.flat, 0);
  const rf = p.instances.filter((i) => i.extras.length).length;
  return `${p.models} โมเดล × A${p.profile.A}${rf ? ` · Rapid Fire ×${rf}` : ''}${extra ? ` · +${extra} (Blast/Cleave)` : ''}`;
}

// ---------- expected value for previews ----------

export function expectedDamage(s: GameState, pool: Pool, target: UnitState): { attacks: number; hits: number; wounds: number; unsaved: number; models: number } {
  const attacks = pool.instances.reduce((a, i) => a + exprAverage(i.A) + i.extras.reduce((b, e) => b + exprAverage(e), 0) + i.flat, 0);
  const pHit = pool.autoHit ? 1 : pool.hitOn6Only ? 1 / 6 : Math.max(1, Math.min(5, 7 - ((pool.skill ?? 7) - pool.hitMod))) / 6;
  const pCrit = pool.autoHit ? 0 : 1 / 6;
  const sus = pool.sustained ? exprAverage(pool.sustained) : 0;
  const hits = attacks * (pHit + pCrit * sus);
  const pW = Math.max(1, Math.min(5, 7 - (pool.woundNeed - pool.woundMod))) / 6;
  const lethal = pool.lethal ? attacks * pCrit : 0;
  const wounds = (hits - lethal) * pW + lethal;
  const m = alive(target)[0];
  const sv = m.profile.Sv - pool.ap;
  const best = Math.min(sv, m.profile.InSv ?? 7);
  const pFail = Math.min(1, Math.max(1 / 6, (best - 1) / 6));
  const unsaved = wounds * pFail;
  const dmg = Math.min(exprAverage(pool.damage), m.profile.W);
  return { attacks, hits, wounds, unsaved, models: (unsaved * dmg) / m.profile.W };
}

// ---------- running the session ----------

export function startAttack(s: GameState, kind: AttackSession['kind'], attackerId: string, targetId: string, pools: Pool[]) {
  const A = unitById(s, attackerId);
  for (const p of pools) {
    let total = 0;
    const parts: string[] = [];
    for (const i of p.instances) {
      const a = rollExpr(s, i.A);
      const ex = i.extras.map((e) => rollExpr(s, e).total);
      total += a.total + ex.reduce((x, y) => x + y, 0) + i.flat;
      if (a.dice.length) parts.push(`${i.A}=${a.total}`);
    }
    p.attacks = total;
    if (parts.length) p.attackNote += ` · ทอยจำนวน attack: ${parts.join(', ')}`;
    if (hasAbility(p.profile, 'one-shot') && !A.oneShotUsed.includes(p.weapon)) A.oneShotUsed.push(p.weapon);
  }
  s.attack = { kind, attackerId, targetId, pools, idx: 0, stage: pools.length ? 'hit' : 'done', hazardousRolls: [], summary: [] };
}

function evalHit(p: Pool, v: number): Die['o'] {
  if (v === 1) return 'miss';
  if (v === 6) return 'crit';
  if (p.hitOn6Only) return 'miss';
  if (p.minHitUnmodified && v < p.minHitUnmodified) return 'miss';
  return v + p.hitMod >= (p.skill ?? 7) ? 'hit' : 'miss';
}

function evalWound(p: Pool, v: number): Die['o'] {
  if (v === 1) return 'fail';
  if (v === 6 || v >= p.critWoundOn) return 'critWound';
  return v + p.woundMod >= p.woundNeed ? 'wound' : 'fail';
}

export function rollHits(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  if (p.autoHit) {
    p.hits = Array.from({ length: p.attacks }, () => ({ v: 0, o: 'auto' as const }));
  } else {
    p.hits = rollN(s, p.attacks).map((v) => ({ v, o: evalHit(p, v) }));
    const reroll1s = unitById(s, at.attackerId).buffs.some((b) => b.kind === 'rerollHits1');
    const rerollAll = unitById(s, at.attackerId).buffs.some((b) => b.kind === 'rerollHits');
    if (!p.noHitReroll && (reroll1s || rerollAll)) {
      p.hits = p.hits.map((d) => (d.o === 'miss' && (rerollAll || d.v === 1) ? reroll(s, d, (v) => evalHit(p, v)) : d));
    }
  }
  at.stage = 'wound';
}

function reroll(s: GameState, d: Die, ev: (v: number) => Die['o']): Die {
  const v = d6(s);
  return { v, o: ev(v), rerolled: true, orig: d.v };
}

export function hitsForWounding(p: Pool, s: GameState) {
  let auto = 0;
  let rolls = 0;
  for (const d of p.hits) {
    if (d.o === 'miss') continue;
    if (d.o === 'crit' && p.lethal) auto += 1; else rolls += 1;
    if (d.o === 'crit' && p.sustained) rolls += rollExpr(s, p.sustained).total;
  }
  return { auto, rolls };
}

export function rollWounds(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  const { auto, rolls } = hitsForWounding(p, s);
  p.autoWounds = auto;
  p.wounds = rollN(s, rolls).map((v) => ({ v, o: evalWound(p, v) }));
  const A = unitById(s, at.attackerId);
  const rrAll = p.twinLinked || A.buffs.some((b) => b.kind === 'rerollWounds');
  const rr1 = A.buffs.some((b) => b.kind === 'rerollWounds1');
  if (rrAll || rr1) p.wounds = p.wounds.map((d) => (d.o === 'fail' && (rrAll || d.v === 1) ? reroll(s, d, (v) => evalWound(p, v)) : d));
  at.stage = 'save';
}

/** Command Re-roll on one die of the current stage. */
export function rerollOne(s: GameState, stage: 'hit' | 'wound' | 'save', index: number) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  if (stage === 'hit') p.hits[index] = reroll(s, p.hits[index], (v) => evalHit(p, v));
  if (stage === 'wound') p.wounds[index] = reroll(s, p.wounds[index], (v) => evalWound(p, v));
  if (stage === 'save') {
    const d = p.saves[index];
    p.saves[index] = { v: d6(s), o: 'pass', rerolled: true, orig: d.v };
  }
}

// ----- saves & damage (05.03 / 05.04) -----

interface Group { char: boolean; models: ModelState[] }

export function allocationGroups(T: UnitState): Group[] {
  const a = alive(T);
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const m of a) {
    if (m.isCharacter) { groups.push({ char: true, models: [m] }); continue; }
    const k = `${m.profile.W}|${m.profile.Sv}|${m.profile.InSv}`;
    if (!byKey.has(k)) { const g = { char: false, models: [] as ModelState[] }; byKey.set(k, g); groups.push(g); }
    byKey.get(k)!.models.push(m);
  }
  const wounded = (g: Group) => g.models.some((m) => m.wounds < m.profile.W);
  const rank = (g: Group) => (g.char ? 2 : 0) + (wounded(g) ? 0 : 1);
  return groups.sort((x, y) => rank(x) - rank(y) || x.models[0].profile.W - y.models[0].profile.W || y.models[0].profile.Sv - x.models[0].profile.Sv);
}

function pickModel(g: Group): ModelState | undefined {
  const a = g.models.filter((m) => !m.dead);
  return a.find((m) => m.wounds < m.profile.W) ?? a[0];
}

export function killModel(s: GameState, u: UnitState, m: ModelState, killer?: string) {
  m.dead = true;
  m.wounds = 0;
  if (!alive(u).length) {
    u.status = 'destroyed';
    s.destroyedByTurn.push({ turn: s.turn, owner: u.owner, unitId: u.id });
    log(s, `💀 ${u.name} ถูกทำลาย${killer ? ' โดย ' + killer : ''}`, 'kill');
  }
  if (u.core.deadlyDemise && (m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER') || u.models.length === 1)) {
    const r = d6(s);
    if (r === 6) {
      log(s, `💥 Deadly Demise (${u.core.deadlyDemise}) ของ ${m.name}: ทอยได้ 6!`, 'roll');
      for (const v of s.units.filter((x) => x.id !== u.id && onBoard(x))) {
        if (alive(v).some((n) => baseDist(n, m) <= RULES.deadlyDemiseRange)) applyMortalWounds(s, v, rollExpr(s, u.core.deadlyDemise).total, 'Deadly Demise');
      }
    } else log(s, `Deadly Demise ของ ${m.name}: ทอยได้ ${r} (ไม่ระเบิด)`, 'roll');
  }
}

/** Lose wounds on one model with Feel No Pain. Returns wounds actually lost. */
function loseWounds(s: GameState, u: UnitState, m: ModelState, n: number, lines?: string[]): number {
  let lost = 0;
  const fnp = u.core.fnp ?? (u.buffs.some((b) => b.kind === 'fnp5') ? 5 : u.buffs.some((b) => b.kind === 'fnp6') ? 6 : undefined);
  const fnpRolls: number[] = [];
  for (let i = 0; i < n && !m.dead; i++) {
    if (fnp) { const r = d6(s); fnpRolls.push(r); if (r >= fnp) continue; }
    m.wounds -= 1;
    lost += 1;
    if (m.wounds <= 0) killModel(s, u, m);
  }
  if (lines && fnpRolls.length) lines.push(`Feel No Pain ${fnp}+: [${fnpRolls.join(' ')}]`);
  return lost;
}

export function applyMortalWounds(s: GameState, u: UnitState, n: number, source: string, maxModels?: number, preferChar?: boolean): number {
  let killed = 0;
  let modelsHit = 0;
  let current: ModelState | undefined;
  for (let i = 0; i < n; i++) {
    const a = alive(u);
    if (!a.length) break;
    if (!current || current.dead) {
      if (maxModels !== undefined && modelsHit >= maxModels) break;
      const nonChar = a.filter((m) => !m.isCharacter);
      const pool = preferChar && a.some((m) => m.isCharacter) ? a.filter((m) => m.isCharacter) : nonChar.length ? nonChar : a;
      current = pool.find((m) => m.wounds < m.profile.W) ?? pool[0];
      modelsHit += 1;
    }
    loseWounds(s, u, current, 1);
    if (current.dead) killed += 1;
  }
  log(s, `⚡ ${u.name} โดน ${n} mortal wound (${source})${killed ? ` → ตาย ${killed}` : ''}`, 'roll', u.owner);
  return killed;
}

export function rollSavesAndDamage(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  const T = unitById(s, at.targetId);
  const devCrits = p.devastating ? p.wounds.filter((d) => d.o === 'critWound').length : 0;
  const normal = p.wounds.filter((d) => d.o === 'wound' || (d.o === 'critWound' && !p.devastating)).length + p.autoWounds;
  p.saves = rollN(s, normal).map((v) => ({ v, o: 'pass' }));
  at.stage = 'damage';
  p.mortalFromDev = Array.from({ length: devCrits }, () => 0);
}

export function applyDamage(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  const T = unitById(s, at.targetId);
  const A = unitById(s, at.attackerId);
  const before = alive(T).length;
  const groups = allocationGroups(T);
  let precisionGroup: Group | undefined;
  if (p.precision) precisionGroup = groups.find((g) => g.char && alive(A).some((am) => modelVisible(s, am, T, g.models[0]) || at.kind === 'fight'));
  const order = p.saves.map((d, i) => ({ d, i })).sort((x, y) => x.d.v - y.d.v);
  p.saveTargets = p.saves.map(() => '');
  for (const { d, i } of order) {
    const g = precisionGroup && precisionGroup.models.some((m) => !m.dead) ? precisionGroup : groups.find((x) => x.models.some((m) => !m.dead));
    if (!g) { d.o = 'saved'; p.saveTargets[i] = '—'; continue; }
    const m = pickModel(g)!;
    const sv = m.profile.Sv - (T.buffs.some((b) => b.kind === 'save+1') ? 1 : 0);
    const inv = m.profile.InSv;
    let ok = false;
    if (d.v !== 1) ok = (inv !== null && d.v >= inv) || d.v + p.ap >= Math.max(RULES.modifierCaps.bestSave, sv);
    p.saveTargets[i] = `${m.name} (Sv${sv}+${inv ? ` / ${inv}++` : ''}, AP${p.ap})`;
    d.o = ok ? 'saved' : 'fail';
    if (!ok) {
      const dr = rollExpr(s, p.damage);
      let dmg = dr.total;
      if (T.buffs.some((b) => b.kind === 'damage-1')) dmg = Math.max(1, dmg - 1);
      const lost = loseWounds(s, T, m, dmg, p.damageLines);
      p.damageLines.push(`${m.name}: −${lost} W${dr.dice.length ? ` (D=${p.damage}→${dmg})` : ''}${m.dead ? ' 💀' : ''}`);
    }
  }
  // Devastating Wounds: mortal wounds after normal damage, each critical wound damages at most one model.
  for (let k = 0; k < p.mortalFromDev.length; k++) {
    if (!alive(T).length) break;
    const dmg = rollExpr(s, p.damage).total;
    p.mortalFromDev[k] = dmg;
    applyMortalWounds(s, T, dmg, `Devastating Wounds (${p.weapon})`, 1, !!precisionGroup);
  }
  p.killed = before - alive(T).length;
  p.done = true;
  at.summary.push(`${p.weapon}: ${p.attacks} attacks → ${p.hits.filter((h) => h.o !== 'miss').length} hit → ${p.wounds.filter((w) => w.o !== 'fail').length + p.autoWounds} wound → ตาย ${p.killed}`);
  if (!alive(T).length) { at.stage = 'done'; return; }
  if (at.idx < at.pools.length - 1) { at.idx += 1; at.stage = 'hit'; } else at.stage = 'done';
}

/** Run every remaining stage instantly (fast mode). */
export function resolveAll(s: GameState) {
  while (s.attack && s.attack.stage !== 'done') stepAttack(s);
}

export function stepAttack(s: GameState) {
  const at = s.attack!;
  if (at.stage === 'hit') rollHits(s);
  else if (at.stage === 'wound') rollWounds(s);
  else if (at.stage === 'save') rollSavesAndDamage(s);
  else if (at.stage === 'damage') applyDamage(s);
}

/** Close the session: hazardous rolls, flags, log. */
export function finishAttack(s: GameState) {
  const at = s.attack!;
  const A = unitById(s, at.attackerId);
  const T = unitById(s, at.targetId);
  const haz = at.pools.reduce((a, p) => a + p.hazardous, 0);
  if (haz && alive(A).length) {
    const rolls = rollN(s, haz);
    at.hazardousRolls = rolls;
    const fails = rolls.filter((r) => r <= RULES.hazard.failOn).length;
    log(s, `☢ Hazard roll ${A.name}: [${rolls.join(' ')}]`, 'roll', A.owner);
    if (fails) {
      const mv = alive(A).every(isMV);
      applyMortalWounds(s, A, fails * (mv ? RULES.hazard.mortalWoundsMonsterVehicle : RULES.hazard.mortalWounds), 'Hazardous');
    }
  }
  const killed = at.pools.reduce((a, p) => a + p.killed, 0);
  const verb = at.kind === 'fight' ? 'ตี' : at.kind === 'overwatch' ? 'Overwatch ยิง' : 'ยิง';
  log(s, `${A.name} ${verb} ${T.name}: ตาย ${killed} โมเดล`, 'info', A.owner);
  if (at.kind !== 'fight') A.shotTurn = s.turn;
  if (at.kind === 'shoot') A.selectedToShoot = true;
  if (at.kind === 'fight') A.fought = true;
  s.attack = null;
}

export function canShootTarget(s: GameState, a: UnitState, t: UnitState): boolean {
  return onBoard(t) && t.owner !== a.owner && alive(a).some((m) => unitVisibleTo(s, m, t));
}

export const opponentOf = (s: GameState, u: UnitState) => other(u.owner);
