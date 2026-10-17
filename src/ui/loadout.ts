// Which model is which in a squad with mixed wargear: a short label (the weapon that sets it apart) for every model
// whose kit differs from what the whole squad carries.
import type { ArmyList, DatasheetData, FactionData, ModelState, UnitState, WargearPick } from '../engine/types';
import { buildUnits } from '../engine/army';
import { kitOf, modelPortraitKey, modelVariantKey } from './portraits';

const FILLER = /^(astartes|master-crafted|archeotech|relic|artificer)\s+/i;

/** "Master-crafted Power Weapon" → "Power Weapon", long names cut to fit under a token. */
export function shortItem(name: string, max = 13): string {
  let n = name.replace(FILLER, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  if (n.length > max) n = n.slice(0, max - 1).trimEnd() + '…';
  return n;
}

const items = (m: ModelState) => [...new Set([...m.weapons.map((w) => w.name), ...(m.gear ?? [])])];
const isGun = (m: ModelState, name: string) => m.weapons.some((w) => w.name === name && w.profiles.some((p) => p.range !== 'Melee'));
const isPistol = (name: string) => /pistol/i.test(name);

const namedSquad = (ms: ModelState[]) => new Set(ms.map((m) => m.name).filter((n) => n && n !== ms[0].source)).size >= 3;

/** "Twin Lightning Claws" → "Claws", "Thunder Hammer" → "Hammer", "Storm Shield" → "Shield": the word that tells kits apart. */
export function itemTag(name: string): string {
  if (/storm shield/i.test(name)) return 'Shield';
  if (/power weapon/i.test(name)) return 'Power Weapon';
  if (/close combat weapon/i.test(name)) return '';
  return name.replace(/^((twin|master-crafted|astartes|archeotech|relic|artificer|lightning|thunder)[\s-]+)+/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim() || name;
}

/** model id → what sets its kit apart (`tag` for the token, `full` for the unit card). */
const loadoutsCache = new WeakMap<UnitState, Map<string, { tag: string; full: string }>>();
function loadouts(u: UnitState): Map<string, { tag: string; full: string }> {
  const cached = loadoutsCache.get(u);
  if (cached) return cached;
  const out = new Map<string, { tag: string; full: string }>();
  const bySource = new Map<string, ModelState[]>();
  for (const m of u.models) bySource.set(m.source, [...(bySource.get(m.source) ?? []), m]);
  for (const ms of bySource.values()) {
    if (ms.length < 2) continue;
    // a squad of named characters (Wardens of Ultramar): each model goes by its name
    if (namedSquad(ms)) {
      for (const m of ms) if (!m.dead) out.set(m.id, { tag: m.name.split(' ').pop()!, full: `${m.name}: ${items(m).join(', ')}` });
      continue;
    }
    const sets = ms.map(items);
    const sig = sets.map((x) => [...x].sort().join('|'));
    if (sig.every((x) => x === sig[0])) continue; // everyone carries the same
    const common = sets[0].filter((x) => sets.every((y) => y.includes(x)));
    // the squad's usual kit: when nearly everyone carries it (9 bolters and a plasma gun) only the odd ones out get a
    // label; a real split (3 hammers and shields, 2 pairs of claws) labels every model
    const count = new Map<string, number>();
    for (const x of sig) count.set(x, (count.get(x) ?? 0) + 1);
    const [usualSig, usualN] = [...count].sort((p, q) => q[1] - p[1])[0];
    const labelUsual = usualN / ms.length < 0.7;
    const usual = sets[sig.indexOf(usualSig)];
    ms.forEach((m, i) => {
      if (m.dead) return;
      if (sig[i] === usualSig && !labelUsual) return;
      const own = sets[i].filter((x) => !(labelUsual ? common : usual).includes(x));
      if (!own.length) return;
      // guns first (not pistols), then melee weapons, then wargear
      const rank = (x: string) => (isGun(m, x) && !isPistol(x) ? 0 : m.weapons.some((w) => w.name === x) ? 1 : 2);
      const sorted = [...own].sort((p, q) => rank(p) - rank(q));
      // the odd one out of a squad with its own name (a Nob among Boyz, a Sergeant) is best told by that name
      const usualName = ms[sig.indexOf(usualSig)].name;
      const tag = !labelUsual && m.name !== usualName && m.name !== m.source ? m.name.split(' ').pop()!
        : sorted.slice(0, 2).map(itemTag).join('+') + (sorted.length > 2 ? ' +' : '');
      out.set(m.id, { tag, full: tag === m.name.split(' ').pop() ? `${m.name}: ${sorted.join(' + ')}` : sorted.join(' + ') });
    });
  }
  loadoutsCache.set(u, out);
  return out;
}

/** model id → short label for the token, only for models whose kit needs telling apart. */
const labelsCache = new WeakMap<UnitState, Map<string, string>>();
export function loadoutLabels(u: UnitState): Map<string, string> {
  const cached = labelsCache.get(u);
  if (cached) return cached;
  const res = new Map([...loadouts(u)].map(([id, l]) => [id, l.tag]));
  labelsCache.set(u, res);
  return res;
}

/** For the unit card: who carries what in a mixed squad ("3× Thunder Hammer + Storm Shield", "Lucia Vestha: …"). */
export function loadoutSummary(u: UnitState): string[] {
  const out = new Map<string, number>();
  for (const [, l] of loadouts(u)) out.set(l.full, (out.get(l.full) ?? 0) + 1);
  return [...out].map(([k, n]) => (k.includes(':') ? k : `${n}× ${k}`));
}

export interface PictureVariant { key: string; fallback: string[]; label: string }

/** The pictures a squad can have: one per model name, split further by loadout when the same model comes with
 *  different kits (Terminator with claws / with hammer and shield). Empty when one picture covers the squad. */
export function pictureVariants(source: string, models: ModelState[]): PictureVariant[] {
  const ms = models.filter((m) => m.source === source);
  const groups = new Map<string, { name: string; kit: string[]; m: ModelState }>();
  for (const m of ms) { const kit = kitOf(m); groups.set(`${m.name}|${kit.join('+')}`, { name: m.name, kit, m }); }
  const all = [...groups.values()];
  const names = [...new Set(all.map((g) => g.name))];
  if (all.length < 2) return [];

  const isMelee = (w: string) => /chainsword|power\s+(weapon|sword|axe|fist|lance)|thunder hammer|force\s+|claws|blade|halberd|spear|relic weapon|eviscerator|talons|maul/i.test(w);
  const isGear = (w: string) => /vox-caster|icon|banner|shield|mine|pack|signum|array|auspex|narthecium|teleport/i.test(w);

  return all.map((g) => {
    const split = all.filter((x) => x.name === g.name).length > 1;
    const nameKey = g.name && g.name !== source ? modelPortraitKey(source, g.name) : source;
    if (!split) return { key: nameKey, fallback: [source], label: g.name || source };

    // Filter out generic close combat weapon if the model has other weapons
    const nonGeneric = g.kit.filter((x) => !/^close combat weapon$/i.test(x.trim()));
    const pool = nonGeneric.length ? nonGeneric : g.kit;

    // Ranged weapons first, then special melee, then wargear
    const ranged = pool.filter((w) => !isMelee(w) && !isGear(w));
    const melee = pool.filter(isMelee);
    const gear = pool.filter(isGear);
    const display = [...ranged, ...melee, ...gear].map(itemTag).filter(Boolean);
    const tag = display.length ? display.join(' + ') : 'standard kit';

    return { key: modelVariantKey(source, g.name, g.kit), fallback: [nameKey, source], label: `${g.name || source} · ${tag}` };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

/** Every picture slot a datasheet can need: its default kit plus each wargear choice, tried one at a time, so a
 *  loadout can get its picture before it is picked in the list (Terminator · Claws / · Hammer + Shield). */
export function datasheetVariants(sheet: DatasheetData, extra: ModelState[] = []): PictureVariant[] {
  const faction = { id: 'x', name: 'x', datasheets: [sheet], detachments: [], armyRules: [] } as unknown as FactionData;
  const size = Math.max(sheet.models.length, (sheet.composition ?? []).reduce((a, c) => a + (c.max ?? c.min ?? 1), 0));
  const build = (wargear: WargearPick[]): ModelState[] => {
    try {
      return buildUnits({ name: 'x', factionId: 'x', battleSize: 'incursion', detachments: [], units: [{ uid: 'x', datasheet: sheet.name, models: size, pts: 0, wargear }] } as ArmyList, faction, 0)
        .flatMap((u) => u.models).filter((m) => m.source === sheet.name);
    } catch { return []; }
  };
  const models = [...build([]), ...extra.filter((m) => m.source === sheet.name)];
  (sheet.wargearOptions ?? []).forEach((o, opt) => o.choices.forEach((_, choice) => models.push(...build([{ opt, choice, count: 1 }]))));
  return pictureVariants(sheet.name, models);
}
