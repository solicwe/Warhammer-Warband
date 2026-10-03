// Turns an army list (datasheet names + sizes + attachments) into UnitState objects.
import type { ArmyList, ArmyUnitEntry, CoreAbilities, DatasheetData, FactionData, ModelProfileData, ModelState, PlayerId, TransportInfo, UnitState, WargearOption, WargearPick, WeaponData } from './types';

/** "This model has a transport capacity of 12 Adeptus Astartes Infantry models. Each Jump Pack ... takes up the space of 2 models ... It cannot transport ..." */
export function parseTransport(text?: string): TransportInfo | null {
  if (!text) return null;
  const cap = /transport capacity of (\d+)/i.exec(text);
  if (!cap) return null;
  const list = (re: RegExp) => {
    const m = re.exec(text);
    return m ? m[1].split(/,\s*|\/|\s+or\s+|\s+and\s+/i).map((x) => x.replace(/models?$/i, '').trim().toUpperCase()).filter(Boolean) : [];
  };
  return {
    capacity: +cap[1],
    double: list(/Each ([^.]+?) model takes up the space of 2/i),
    forbid: list(/cannot transport ([^.]+?)(?: models)?\./i),
    only: list(/can only transport ([^.]+?)(?: models)?\./i),
    infantryOnly: /capacity of \d+ [^.]*infantry/i.test(text),
    text,
  };
}

const MM_PER_INCH = 25.4;

export function baseRadius(sheet: DatasheetData, profileIdx: number): number {
  const b = sheet.models[profileIdx]?.base;
  if (b && b.w > 0) return (b.w + b.h) / 4 / MM_PER_INCH;
  if (sheet.keywords.includes('VEHICLE')) return 2.4;
  if (sheet.keywords.includes('MONSTER')) return 1.8;
  return 0.63;
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const singular = (s: string) => norm(s).replace(/(ies)$/, 'y').replace(/s$/, '');

function matchProfile(sheet: DatasheetData, name?: string): number {
  if (!name || sheet.models.length === 1) return 0;
  const i = sheet.models.findIndex((m) => singular(m.name) === singular(name) || singular(name).includes(singular(m.name)));
  return i >= 0 ? i : 0;
}

function findWeapon(sheet: DatasheetData, item: string): WeaponData | undefined {
  const n = norm(item);
  return (
    sheet.weapons.find((w) => norm(w.name) === n) ??
    sheet.weapons.find((w) => norm(w.name).startsWith(n) || n.startsWith(norm(w.name)))
  );
}

/** Loose key for wargear names: "Astartes chain sword" ~ "Astartes chainsword", "neo volkite" ~ "neo-volkite". */
export const wkey = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');

/** Loadout / option text -> canonical item: the datasheet weapon's name, else the equipment text (shield, banner …). */
function canonItem(sheet: DatasheetData, item: string): string {
  const k = wkey(item);
  const w = sheet.weapons.find((x) => [k, k.replace(/es$/, ''), k.replace(/s$/, '')].includes(wkey(x.name))) ?? findWeapon(sheet, item);
  return w ? w.name : item.charAt(0).toUpperCase() + item.slice(1);
}
const weaponNamed = (sheet: DatasheetData, name: string) => sheet.weapons.find((w) => w.name === name) ?? sheet.weapons.find((w) => wkey(w.name) === wkey(name));

/** Default items of one model: weapon names (a weapon listed twice is carried twice) plus non-weapon gear. */
function loadoutItems(sheet: DatasheetData, compName: string | undefined, profileName: string): string[] {
  const keys = Object.keys(sheet.loadout);
  let key: string | undefined = keys.find((k) => k === '*');
  if (compName || profileName) {
    const cand = [compName, profileName].filter(Boolean).map((s) => singular(s!));
    key = keys.find((k) => cand.some((c) => singular(k) === c || singular(k).includes(c) || c.includes(singular(k)))) ?? key;
  }
  const out: string[] = [];
  const from = new Map<string, string>(); // canonical item -> loadout text it came from
  for (const it of key ? sheet.loadout[key] : []) {
    const c = canonItem(sheet, it);
    if (from.has(c) && from.get(c) !== it) continue; // two different texts for the same weapon
    from.set(c, it);
    out.push(c);
  }
  if (out.some((c) => weaponNamed(sheet, c))) return out;
  // Fallback when the loadout text could not be parsed: first ranged + first melee weapon.
  const ranged = sheet.weapons.find((w) => w.profiles[0].range !== 'Melee');
  const melee = sheet.weapons.find((w) => w.profiles[0].range === 'Melee');
  return [...out, ...[ranged, melee].filter((w): w is WeaponData => !!w).map((w) => w.name)];
}

// ---------- wargear ----------

interface ModelPlan { name: string; comp?: string; profile: number; items: string[]; used: number[] }

/** The models of a unit with their default items, before any wargear choice. */
function planModels(sheet: DatasheetData, count: number, addons: string[] = []): ModelPlan[] {
  const parts = distributeModels(sheet, count);
  for (const a of addons) if (addonLines(sheet).some((l) => l.name === a)) parts.push({ comp: a, profile: matchProfile(sheet, a), count: 1 });
  const out: ModelPlan[] = [];
  for (const part of parts) {
    const profile = sheet.models[part.profile];
    const items = loadoutItems(sheet, part.comp, profile.name);
    const name = part.comp && part.comp !== profile.name ? part.comp.replace(/s$/, '') : profile.name;
    for (let i = 0; i < part.count; i++) out.push({ name, comp: part.comp, profile: part.profile, items: [...items], used: [] });
  }
  return out;
}

/** Optional extra models bought separately ("0-1 Invader ATV" + "+1 Invader ATV: 60 pts"). */
export function addonLines(sheet: DatasheetData): { name: string; pts: number }[] {
  return sheet.composition
    .filter((c) => c.min === 0 && c.name)
    .map((c) => ({ name: c.name!, pts: sheet.wargearCosts?.find((w) => wkey(w.name) === wkey(c.name!))?.pts ?? 0 }))
    .filter((c) => c.pts > 0);
}

function whoModels(plans: ModelPlan[], who: string): ModelPlan[] {
  if (who === '*') return plans;
  const w = singular(who);
  const names = (p: ModelPlan) => [p.name, p.comp].filter((n): n is string => !!n).map(singular);
  const exact = plans.filter((p) => names(p).some((n) => n === w));
  if (exact.length) return exact;
  const loose = plans.filter((p) => names(p).some((n) => n.includes(w) || w.includes(n)));
  return loose.length ? loose : plans;
}

function hasAll(items: string[], need: string[]): boolean {
  const pool = items.map(wkey);
  for (const n of need) {
    const i = pool.indexOf(wkey(n));
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

function removeItems(items: string[], rem: string[]) {
  for (const n of rem) {
    const i = items.findIndex((x) => wkey(x) === wkey(n));
    if (i >= 0) items.splice(i, 1);
  }
}

/** Items a choice gives (choice -1 = the "pick N different" list). */
export function choiceItems(o: WargearOption, pk: Pick<WargearPick, 'choice' | 'picks'>): string[] {
  return pk.choice < 0 ? pk.picks ?? [] : o.choices[pk.choice] ?? [];
}

/** How many models (or copies, for `stack`) may take option `o` in a unit of `size` models. */
export function wargearMax(sheet: DatasheetData, o: WargearOption, size: number, addons: string[] = []): number {
  if (o.minModels && size < o.minModels) return 0;
  const n = whoModels(planModels(sheet, size, addons), o.who).length;
  switch (o.scope) {
    case 'one': return Math.min(1, n);
    case 'upTo': return o.stack ? o.max ?? 1 : Math.min(o.max ?? 1, n);
    case 'perN': return Math.min(n, Math.floor(size / (o.per ?? 5)) * (o.max ?? 1));
    default: return n; // any, all
  }
}

/** Apply wargear choices to the planned models (in option order, so "if equipped with X" sees earlier swaps). Returns what could not be applied. */
function applyWargear(sheet: DatasheetData, plans: ModelPlan[], picks: WargearPick[]): string[] {
  const opts = sheet.wargearOptions ?? [];
  const problems: string[] = [];
  const everything = new Set(plans.flatMap((p) => p.items.map(wkey)));
  for (const pk of [...picks].sort((a, b) => a.opt - b.opt)) {
    const o = opts[pk.opt];
    if (!o || pk.count <= 0) continue;
    const gain = choiceItems(o, pk);
    if (!gain.length) continue;
    const need = o.replace.filter((r) => everything.has(wkey(r))); // ignore data quirks naming items no model has
    let left = pk.count;
    if (o.stack) {
      const target = whoModels(plans, o.who)[0];
      for (; target && left > 0; left--) target.items.push(...gain);
      continue;
    }
    // rank-and-file first, so "1 model can …" does not take the sergeant's slot
    for (const p of [...whoModels(plans, o.who)].reverse()) {
      if (left <= 0) break;
      if (p.used.includes(pk.opt)) continue;
      if (!hasAll(p.items, need) || (o.requires && !hasAll(p.items, o.requires))) continue;
      removeItems(p.items, need);
      p.items.push(...gain);
      p.used.push(pk.opt);
      left--;
    }
    if (left > 0) problems.push(`${gain.join(' + ')}: ไม่มีโมเดลที่ถือ ${[...need, ...(o.requires ?? [])].join(' + ') || 'อาวุธเดิม'} เหลือให้เปลี่ยนอีก ${left} ตัว`);
  }
  return problems;
}

/** Points for costed wargear ("per thunder hammer +5", counted on every model that carries one) and add-on models. */
export function wargearPoints(sheet: DatasheetData | undefined, e: Pick<ArmyUnitEntry, 'models' | 'wargear' | 'addons'>): number {
  const costs = sheet?.wargearCosts ?? [];
  if (!sheet || !costs.length) return 0;
  const plans = planModels(sheet, e.models, e.addons);
  applyWargear(sheet, plans, e.wargear ?? []);
  const addons = addonLines(sheet);
  let pts = 0;
  for (const c of costs) {
    if (addons.some((a) => a.name === c.name)) { pts += (e.addons ?? []).filter((a) => a === c.name).length * c.pts; continue; }
    const k = wkey(c.name);
    for (const p of plans) pts += p.items.filter((i) => wkey(i) === k).length * c.pts;
  }
  return pts;
}

/** Keep wargear choices legal for the unit size and refresh the cached wargear points (call after any change). */
export function syncWargear(sheet: DatasheetData | undefined, e: ArmyUnitEntry): ArmyUnitEntry {
  if (!sheet) return e;
  const opts = sheet.wargearOptions ?? [];
  const wargear: WargearPick[] = [];
  for (const pk of e.wargear ?? []) {
    const o = opts[pk.opt];
    if (!o || pk.count <= 0) continue;
    const max = wargearMax(sheet, o, e.models, e.addons);
    const used = wargear.filter((x) => x.opt === pk.opt).reduce((a, x) => a + x.count, 0);
    const count = o.scope === 'all' ? (pk.count > 0 ? max : 0) : Math.min(pk.count, max - used);
    if (count > 0) wargear.push({ ...pk, count });
  }
  const next: ArmyUnitEntry = { ...e, wargear: wargear.length ? wargear : undefined };
  const wp = wargearPoints(sheet, next);
  return { ...next, wargearPts: wp || undefined };
}

/** Bring every entry's wargear choices and wargear points up to date (same object back when nothing changed). */
export function syncList(list: ArmyList, faction: FactionData): ArmyList {
  let changed = false;
  const units = list.units.map((u) => {
    const next = syncWargear(faction.datasheets.find((d) => d.name === u.datasheet), u);
    if ((next.wargearPts ?? 0) !== (u.wargearPts ?? 0) || JSON.stringify(next.wargear ?? []) !== JSON.stringify(u.wargear ?? [])) { changed = true; return next; }
    return u;
  });
  return changed ? { ...list, units } : list;
}

/** Rule problems with a unit's wargear choices (army validation). */
export function wargearProblems(sheet: DatasheetData, e: ArmyUnitEntry): string[] {
  const opts = sheet.wargearOptions ?? [];
  const out: string[] = [];
  const byOpt = new Map<number, number>();
  for (const pk of e.wargear ?? []) byOpt.set(pk.opt, (byOpt.get(pk.opt) ?? 0) + pk.count);
  for (const [i, n] of byOpt) {
    const o = opts[i];
    if (!o) continue;
    const max = wargearMax(sheet, o, e.models, e.addons);
    if (n > max) out.push(`${e.datasheet}: "${o.text.slice(0, 60)}…" เลือกได้ไม่เกิน ${max}`);
  }
  for (const pk of e.wargear ?? []) {
    const o = opts[pk.opt];
    if (!o || pk.choice >= 0) continue;
    const picks = pk.picks ?? [];
    if (picks.length !== (o.pick ?? 2) || new Set(picks).size !== picks.length) out.push(`${e.datasheet}: ต้องเลือกอาวุธ ${o.pick ?? 2} ชิ้นที่ไม่ซ้ำกัน`);
    const ranged = picks.map((n) => weaponNamed(sheet, n)).filter((w): w is WeaponData => !!w && w.profiles[0].range !== 'Melee');
    const pistols = ranged.filter((w) => w.profiles.some((p) => p.abilities.includes('pistol')));
    if (ranged.length >= 2 && pistols.length !== 1) out.push(`${e.datasheet}: ถืออาวุธยิง 2 ชิ้นได้ถ้ามี Pistol 1 ชิ้นพอดี`);
  }
  const plans = planModels(sheet, e.models, e.addons);
  out.push(...applyWargear(sheet, plans, e.wargear ?? []).map((p) => `${e.datasheet}: ${p}`));
  return out;
}

/** Short text of the non-default wargear, for list rows and sharing. */
export function wargearSummary(sheet: DatasheetData | undefined, e: ArmyUnitEntry): string {
  if (!sheet) return '';
  const opts = sheet.wargearOptions ?? [];
  const parts = (e.wargear ?? []).filter((pk) => pk.count > 0 && opts[pk.opt]).map((pk) => {
    const items = choiceItems(opts[pk.opt], pk);
    const counted = [...new Set(items)].map((n) => { const k = items.filter((x) => x === n).length; return k > 1 ? `${k}× ${n}` : n; });
    return `${pk.count > 1 ? `${pk.count}× ` : ''}${counted.join(' + ')}`;
  });
  for (const a of e.addons ?? []) parts.push(`+ ${a}`);
  return parts.join(', ');
}

/** Stat changes from wargear abilities the model carries: "The bearer has a Wounds characteristic of 4", "… a 4+ invulnerable save". */
function gearProfile(sheet: DatasheetData, gear: string[], base: ModelProfileData): ModelProfileData {
  let p = base;
  for (const g of gear) {
    const ab = sheet.abilities.find((a) => /wargear/i.test(a.type) && wkey(a.name) === wkey(g));
    if (!ab) continue;
    const w = /bearer has a Wounds characteristic of (\d+)/i.exec(ab.text);
    if (w) p = { ...p, W: +w[1] };
    const inv = /bearer has an? (\d)\+ invulnerable save/i.exec(ab.text);
    if (inv && (p.InSv === null || +inv[1] < p.InSv)) p = { ...p, InSv: +inv[1] };
  }
  return p;
}

/** Feel No Pain a carried item gives the whole unit ("Models in the bearer's unit have the Feel No Pain 6+ ability"). */
export function gearFnp(sheet: DatasheetData, gear: string[]): number | undefined {
  let best: number | undefined;
  for (const g of gear) {
    const ab = sheet.abilities.find((a) => /wargear/i.test(a.type) && wkey(a.name) === wkey(g));
    const m = ab && /bearer's unit have the Feel No Pain (\d)\+/i.exec(ab.text.replace(/’/g, "'"));
    if (m && (best === undefined || +m[1] < best)) best = +m[1];
  }
  return best;
}

/** Distribute N models over composition lines: each line gets its minimum, the remainder goes to the largest line. */
export function distributeModels(sheet: DatasheetData, total: number): { comp?: string; profile: number; count: number }[] {
  const lines = sheet.composition.filter((c) => c.min !== undefined);
  if (!lines.length) return [{ profile: 0, count: total }];
  const out = lines.map((c) => ({ comp: c.name, profile: matchProfile(sheet, c.name), count: c.min! }));
  let left = total - out.reduce((a, b) => a + b.count, 0);
  const order = [...lines.keys()].sort((a, b) => (lines[b].max! - lines[b].min!) - (lines[a].max! - lines[a].min!));
  for (const i of order) {
    if (left <= 0) break;
    const add = Math.min(left, lines[i].max! - out[i].count);
    out[i].count += add;
    left -= add;
  }
  if (left > 0) out[out.length - 1].count += left;
  return out.filter((o) => o.count > 0);
}

export function coreAbilities(sheets: DatasheetData[]): CoreAbilities {
  const core: CoreAbilities = {};
  const all = sheets.flatMap((s) => s.abilities.filter((a) => a.type === 'Core'));
  const has = (n: string) => all.find((a) => a.name.toLowerCase() === n.toLowerCase());
  const fnp = has('Feel No Pain');
  if (fnp?.param) core.fnp = parseInt(fnp.param, 10);
  if (has('Stealth') && sheets.every((s) => s.abilities.some((a) => a.name === 'Stealth'))) core.stealth = true;
  const lo = has('Lone Operative');
  if (lo) core.loneOperative = lo.param ? parseInt(lo.param, 10) : 12;
  if (has('Fights First') && sheets.every((s) => s.abilities.some((a) => a.name === 'Fights First'))) core.fightsFirst = true;
  if (has('Deep Strike') && sheets.every((s) => s.abilities.some((a) => a.name === 'Deep Strike'))) core.deepStrike = true;
  const sc = has('Scouts');
  if (sc?.param) core.scouts = parseInt(sc.param, 10);
  if (has('Infiltrators')) core.infiltrators = true;
  const dd = has('Deadly Demise');
  if (dd) core.deadlyDemise = (dd.param || '1').trim();
  if (has('Hover')) core.hover = true;
  const dmg = sheets.find((s) => s.damaged)?.damaged;
  if (dmg) core.damaged = parseInt(dmg.w.split('-').pop()!, 10);
  return core;
}

let uidCounter = 0;
export const newUid = (p = 'u') => `${p}${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

function makeModels(sheet: DatasheetData, e: Pick<ArmyUnitEntry, 'models' | 'wargear' | 'addons'>, unitId: string, bodyguard: boolean): ModelState[] {
  const isChar = sheet.keywords.includes('CHARACTER');
  const plans = planModels(sheet, e.models, e.addons);
  applyWargear(sheet, plans, e.wargear ?? []);
  return plans.map((p, i) => {
    const weapons = p.items.map((n) => weaponNamed(sheet, n)).filter((w): w is WeaponData => !!w);
    const gear = p.items.filter((n) => !weaponNamed(sheet, n));
    const profile = gearProfile(sheet, gear, sheet.models[p.profile]);
    return {
      id: `${unitId}-m${i}`,
      name: p.name,
      profile,
      source: sheet.name,
      isCharacter: isChar,
      isBodyguard: bodyguard,
      keywords: [...sheet.keywords, ...sheet.factionKeywords],
      weapons,
      ...(gear.length ? { gear } : {}),
      x: -100, y: -100,
      r: baseRadius(sheet, p.profile),
      wounds: profile.W,
      dead: false,
    };
  });
}

export function buildUnits(list: ArmyList, faction: FactionData, owner: PlayerId): UnitState[] {
  const sheetOf = (e: ArmyUnitEntry) => faction.datasheets.find((d) => d.name === e.datasheet)!;
  const units: UnitState[] = [];
  const attached = list.units.filter((u) => u.attachTo && list.units.some((b) => b.uid === u.attachTo) && sheetOf(u));
  for (const e of list.units) {
    if (attached.includes(e)) continue;
    const sheet = sheetOf(e);
    if (!sheet) continue;
    const id = `p${owner}-${e.uid}`;
    const joiners = attached.filter((a) => a.attachTo === e.uid);
    const sheets = [sheet, ...joiners.map(sheetOf)];
    const models = [
      ...makeModels(sheet, e, id, joiners.length > 0),
      ...joiners.flatMap((j, k) => makeModels(sheetOf(j), j, `${id}-l${k}`, false)),
    ];
    const core = coreAbilities(sheets);
    const fnp = sheets.map((sh) => gearFnp(sh, models.filter((m) => m.source === sh.name).flatMap((m) => m.gear ?? []))).filter((x): x is number => x !== undefined);
    if (fnp.length) core.fnp = Math.min(core.fnp ?? 7, ...fnp);
    const keywords = [...new Set(sheets.flatMap((s) => s.keywords))];
    units.push({
      id,
      owner,
      name: joiners.length ? `${joiners.map((j) => j.datasheet).join(' + ')} + ${sheet.name}` : sheet.name,
      sources: sheets.map((s) => s.name),
      keywords,
      factionKeywords: [...new Set(sheets.flatMap((s) => s.factionKeywords))],
      models,
      startingStrength: models.length,
      abilities: sheets.flatMap((s) => s.abilities.map((a) => ({ ...a, model: a.model || (sheets.length > 1 ? s.name : undefined) }))),
      core,
      pts: [e, ...joiners].reduce((a, j) => a + j.pts + (j.wargearPts ?? 0), 0),
      status: 'pending',
      embarkedIn: null,
      transport: parseTransport(sheet.transport),
      weaponsFired: [],
      cantCharge: false,
      scoutDone: false,
      battleShocked: false,
      isWarlordUnit: !!(e.warlord || joiners.some((j) => j.warlord)),
      enhancements: [e, ...joiners].filter((x) => x.enhancement).map((x) => {
        const enh = faction.detachments.flatMap((d) => d.enhancements).find((n) => n.name === x.enhancement);
        return { name: x.enhancement!, text: enh?.text ?? '', model: x.datasheet };
      }),
      move: null, advanceRoll: null, maxMoved: 0, setUpTurn: -10, shotTurn: -10,
      selectedToShoot: false, declaredCharge: false, chargeRoll: null, chargedTurn: -10, chargeTargets: [],
      fought: false, foughtFirstUntilTurn: -10, stratagemPhase: null, oneShotUsed: [], buffs: [],
    });
  }
  return units;
}

// ---------- army list validation (Muster Armies, 25) ----------

export function pointsOptions(sheet: DatasheetData) {
  return sheet.points[0]?.options ?? [];
}

export function listPoints(list: ArmyList): number {
  return list.units.reduce((a, u) => a + unitPoints(u), 0);
}

/** A list entry's total: unit + enhancement + costed wargear. */
export function unitPoints(u: ArmyUnitEntry): number {
  return u.pts + (u.enhancementPts ?? 0) + (u.wargearPts ?? 0);
}

/** Enhancements a unit may take from the selected detachments (25.04). */
export function enhancementOptions(list: ArmyList, faction: FactionData, entry: ArmyUnitEntry) {
  const sheet = faction.datasheets.find((d) => d.name === entry.datasheet);
  if (!sheet || sheet.keywords.includes('EPIC HERO')) return [];
  const isChar = sheet.keywords.includes('CHARACTER');
  return faction.detachments
    .filter((d) => list.detachments.includes(d.name))
    .flatMap((d) => d.enhancements.map((e) => ({ ...e, detachment: d.name })))
    .filter((e) => isChar || e.upgrade);
}

export function validateList(list: ArmyList, faction: FactionData, size: { points: number; dp: number; unitLimit: number; enhancements: number }): string[] {
  const errs: string[] = [];
  const pts = listPoints(list);
  if (pts > size.points) errs.push(`แต้มเกิน: ${pts}/${size.points}`);
  const dp = list.detachments.reduce((a, n) => a + (faction.detachments.find((d) => d.name === n)?.dp ?? 0), 0);
  if (dp > size.dp && !(list.detachments.length === 1 && size.dp === 2 && dp === 3)) errs.push(`Detachment Points เกิน: ${dp}/${size.dp}`);
  for (const u of list.units) if (!faction.datasheets.some((d) => d.name === u.datasheet)) errs.push(`${u.datasheet}: ไม่มีใน 11th edition แล้ว (Legends หรือถูกถอด) — ลบออกจากทัพ`);
  for (const n of list.detachments) if (!faction.detachments.some((d) => d.name === n)) errs.push(`Detachment "${n}" ไม่มีใน 11th edition แล้ว — เอาออก`);
  // sub-faction (Chapter): units and detachments must be generic or from the chosen one
  const subName = (k: string) => faction.subfactions?.options.find((o) => o.keyword === k)?.name ?? k;
  for (const n of list.detachments) {
    const d = faction.detachments.find((x) => x.name === n);
    if (d?.subfaction && d.subfaction !== list.subfaction) errs.push(list.subfaction ? `Detachment "${n}" เป็นของ ${subName(d.subfaction)} ใช้กับ ${subName(list.subfaction)} ไม่ได้` : `Detachment "${n}" ต้องเลือก ${faction.subfactions?.label ?? 'sub-faction'} เป็น ${subName(d.subfaction)}`);
  }
  for (const u of list.units) {
    const d = faction.datasheets.find((x) => x.name === u.datasheet);
    if (d?.subfaction && d.subfaction !== list.subfaction) errs.push(list.subfaction ? `${u.datasheet} เป็นหน่วย ${subName(d.subfaction)} ใส่ในทัพ ${subName(list.subfaction)} ไม่ได้` : `${u.datasheet} เป็นหน่วย ${subName(d.subfaction)}: ต้องเลือก ${faction.subfactions?.label ?? 'sub-faction'} ก่อน`);
  }
  const counts = new Map<string, number>();
  for (const u of list.units) counts.set(u.datasheet, (counts.get(u.datasheet) ?? 0) + 1);
  for (const [name, n] of counts) {
    const sheet = faction.datasheets.find((d) => d.name === name);
    if (!sheet) continue;
    const limit = sheet.keywords.includes('EPIC HERO') ? 1 : sheet.keywords.includes('BATTLELINE') || sheet.keywords.includes('DEDICATED TRANSPORT') ? size.unitLimit * 2 : size.unitLimit;
    if (n > limit) errs.push(`${name}: ใส่ได้ไม่เกิน ${limit} หน่วย`);
  }
  if (!list.units.some((u) => faction.datasheets.find((d) => d.name === u.datasheet)?.keywords.includes('CHARACTER'))) errs.push('ต้องมี CHARACTER อย่างน้อย 1 หน่วย (Warlord)');
  if (!list.units.some((u) => u.warlord)) errs.push('ยังไม่ได้เลือก Warlord (กด 👑)');
  const enh = list.units.filter((u) => u.enhancement);
  const allEnh = faction.detachments.flatMap((d) => d.enhancements);
  const isUpgrade = (n: string) => !!allEnh.find((e) => e.name === n)?.upgrade;
  const counted = new Set<string>();
  let enhCount = 0;
  for (const u of enh) {
    const n = u.enhancement!;
    if (isUpgrade(n)) { if (!counted.has(n)) { enhCount++; counted.add(n); } } else enhCount++;
    const same = enh.filter((x) => x.enhancement === n).length;
    if (!isUpgrade(n) && same > 1) errs.push(`Enhancement "${n}" ใส่ได้หน่วยเดียว`);
    if (isUpgrade(n) && same > 3) errs.push(`Upgrade "${n}" ใส่ได้ไม่เกิน 3`);
    const sheet = faction.datasheets.find((d) => d.name === u.datasheet);
    if (sheet?.keywords.includes('EPIC HERO')) errs.push(`${u.datasheet} เป็น EPIC HERO ใส่ enhancement ไม่ได้`);
    if (!faction.detachments.some((d) => list.detachments.includes(d.name) && d.enhancements.some((e) => e.name === n))) errs.push(`Enhancement "${n}" ไม่ได้อยู่ใน detachment ที่เลือก`);
  }
  if (enhCount > (size as { enhancements?: number }).enhancements!) errs.push(`Enhancement เกิน: ${enhCount}/${(size as { enhancements?: number }).enhancements}`);
  for (const u of list.units) {
    const sheet = faction.datasheets.find((d) => d.name === u.datasheet);
    if (sheet && (u.wargear?.length || u.addons?.length)) errs.push(...wargearProblems(sheet, u));
    if (sheet && (u.wargearPts ?? 0) !== wargearPoints(sheet, u)) errs.push(`${u.datasheet}: แต้ม wargear ไม่ตรง (${u.wargearPts ?? 0} ≠ ${wargearPoints(sheet, u)}) — เปิดเมนู ⋮ ของหน่วยเพื่ออัปเดต`);
  }
  for (const u of list.units) {
    if (!u.attachTo) continue;
    const leader = faction.datasheets.find((d) => d.name === u.datasheet);
    const body = list.units.find((b) => b.uid === u.attachTo);
    if (!leader || !body || !leader.leads.includes(body.datasheet)) errs.push(`${u.datasheet} ผูกกับ ${body?.datasheet ?? '?'} ไม่ได้`);
  }
  return errs;
}
