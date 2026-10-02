// Turns an army list (datasheet names + sizes + attachments) into UnitState objects.
import type { ArmyList, ArmyUnitEntry, CoreAbilities, DatasheetData, FactionData, ModelState, PlayerId, TransportInfo, UnitState, WeaponData } from './types';

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

function loadoutFor(sheet: DatasheetData, compName: string | undefined, profileName: string): WeaponData[] {
  const keys = Object.keys(sheet.loadout);
  let key: string | undefined = keys.find((k) => k === '*');
  if (compName || profileName) {
    const cand = [compName, profileName].filter(Boolean).map((s) => singular(s!));
    key = keys.find((k) => cand.some((c) => singular(k) === c || singular(k).includes(c) || c.includes(singular(k)))) ?? key;
  }
  const items = key ? sheet.loadout[key] : [];
  const weapons = items.map((i) => findWeapon(sheet, i)).filter((w): w is WeaponData => !!w);
  if (weapons.length) return [...new Map(weapons.map((w) => [w.name, w])).values()];
  // Fallback when the loadout text could not be parsed: first ranged + first melee weapon.
  const ranged = sheet.weapons.find((w) => w.profiles[0].range !== 'Melee');
  const melee = sheet.weapons.find((w) => w.profiles[0].range === 'Melee');
  return [ranged, melee].filter((w): w is WeaponData => !!w);
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

function makeModels(sheet: DatasheetData, count: number, unitId: string, bodyguard: boolean): ModelState[] {
  const out: ModelState[] = [];
  const isChar = sheet.keywords.includes('CHARACTER');
  for (const part of distributeModels(sheet, count)) {
    const profile = sheet.models[part.profile];
    const weapons = loadoutFor(sheet, part.comp, profile.name);
    for (let i = 0; i < part.count; i++) {
      out.push({
        id: `${unitId}-m${out.length}`,
        name: part.comp && part.comp !== profile.name ? part.comp.replace(/s$/, '') : profile.name,
        profile,
        source: sheet.name,
        isCharacter: isChar,
        isBodyguard: bodyguard,
        keywords: [...sheet.keywords, ...sheet.factionKeywords],
        weapons,
        x: -100, y: -100,
        r: baseRadius(sheet, part.profile),
        wounds: profile.W,
        dead: false,
      });
    }
  }
  return out;
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
      ...makeModels(sheet, e.models, id, joiners.length > 0),
      ...joiners.flatMap((j, k) => makeModels(sheetOf(j), j.models, `${id}-l${k}`, false)),
    ];
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
      core: coreAbilities(sheets),
      pts: e.pts + joiners.reduce((a, j) => a + j.pts, 0),
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
  return list.units.reduce((a, u) => a + u.pts + (u.enhancementPts ?? 0), 0);
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
    if (!u.attachTo) continue;
    const leader = faction.datasheets.find((d) => d.name === u.datasheet);
    const body = list.units.find((b) => b.uid === u.attachTo);
    if (!leader || !body || !leader.leads.includes(body.datasheet)) errs.push(`${u.datasheet} ผูกกับ ${body?.datasheet ?? '?'} ไม่ได้`);
  }
  return errs;
}
