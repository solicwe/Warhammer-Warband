// A playable list for any faction, made from its data alone: the bot arena and the Elo ladder (scripts/elo.mjs) use
// it to play every army without a hand-written list. A leader with a bodyguard, Battleline, then a spread of the
// units that do the most per point. The same faction and seed always give the same list.
import { defaultWargear, syncWargear } from './army';
import { exprAverage } from './dice';
import type { ArmyList, ArmyUnitEntry, DatasheetData, FactionData, WeaponProfileData } from './types';

/** Rough damage per point a datasheet does to a Space Marine squad and to a tank (both matter for a list). */
function punch(d: DatasheetData, pts: number, models: number): number {
  const hurt = (p: WeaponProfileData, T: number, Sv: number, W: number) => {
    const a = exprAverage(p.A);
    const hit = p.skill === null ? 1 : Math.max(1, 7 - p.skill) / 6;
    const S = p.S ?? 3;
    const need = S >= 2 * T ? 2 : S > T ? 3 : S === T ? 4 : S * 2 <= T ? 6 : 5;
    const fail = Math.min(1, Math.max(1 / 6, (Sv - p.AP - 1) / 6));
    return a * hit * ((7 - need) / 6) * fail * Math.min(exprAverage(p.D), W);
  };
  let v = 0;
  for (const w of d.weapons) {
    const best = (T: number, Sv: number, W: number) => Math.max(0, ...w.profiles.map((p) => hurt(p, T, Sv, W)));
    v += best(4, 3, 2) / 2 + best(10, 3, 12) / 12 * 2;
  }
  // the weapons list holds each weapon once: a squad carries roughly one per model
  return (v * Math.max(1, models * 0.6)) / Math.max(1, pts);
}

const rand = (seed: number) => {
  let x = (seed * 2654435761) % 4294967296 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
};

/** Factions with a list of their own (not just allies for others). */
export const playable = (f: FactionData) => autoList(f).units.length >= 3;

export const AUX_EXCLUSIONS: Record<string, string[]> = {
  GC: ['ASTRA MILITARUM', 'TYRANIDS'],
  QI: ['ADEPTUS MECHANICUS'],
  QT: ['HERETIC ASTARTES'],
  DRU: ['HARLEQUINS', 'ASURYANI', 'YNNARI'],
  DG: ['PLAGUE LEGIONS'],
  TS: ['SCINTILLATING LEGIONS'],
  WE: ['BLOOD LEGIONS'],
  EC: ['LEGIONS OF EXCESS'],
  CSM: ['WORLD EATERS', 'THOUSAND SONS', 'DEATH GUARD', 'EMPEROR’S CHILDREN'],
};

/** wild: ignore how hard a unit hits and pick at random (a campaign start that differs every run). */
export function autoList(f: FactionData, points = 1000, seed = 1, wild = false): ArmyList {
  const rnd = rand(seed + f.id.length * 31);
  const excl = AUX_EXCLUSIONS[f.id] ?? [];
  // the faction's own units (allies from other books carry other faction keywords)
  const ownDatasheets = f.datasheets.filter((d) => !d.ally && !excl.some((k) => (d.factionKeywords || []).includes(k)));
  const count = new Map<string, number>();
  for (const d of ownDatasheets) for (const k of d.factionKeywords) count.set(k, (count.get(k) ?? 0) + 1);
  const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const usable = ownDatasheets.filter((d) => (!main || d.factionKeywords.includes(main)) && d.points[0]?.options?.length && !d.subfaction && !d.keywords.includes('FORTIFICATION')
    && !d.keywords.includes('AIRCRAFT') && !d.transport && d.models.length && d.weapons.length);
  const price = (d: DatasheetData, maxSquad = false) => {
    const opts = [...d.points[0].options].sort((a, b) => a.pts - b.pts);
    if (maxSquad && opts.length > 1 && opts[opts.length - 1].pts <= left) {
      return opts[opts.length - 1];
    }
    return opts[0];
  };
  const det = f.detachments[Math.floor(rnd() * Math.min(3, f.detachments.length))]?.name;
  const units: ArmyUnitEntry[] = [];
  let left = points;
  let n = 0;
  const add = (d: DatasheetData, extra: Partial<ArmyUnitEntry> = {}, maxSquad = false) => {
    const o = price(d, maxSquad);
    if (o.pts > left) return null;
    const e: ArmyUnitEntry = syncWargear(d, defaultWargear(d, { uid: `a${n++}`, datasheet: d.name, models: o.models, pts: o.pts, ...extra }));
    units.push(e);
    left -= o.pts + (e.wargearPts ?? 0);
    return e;
  };
  const score = (d: DatasheetData) => {
    if (wild) return rnd();
    const o = price(d);
    let p = punch(d, o.pts, o.models) * (0.75 + rnd() * 0.5);
    if (points >= 750 && (d.keywords.includes('VEHICLE') || d.keywords.includes('MONSTER') || d.keywords.includes('WALKER'))) p *= 1.2;
    return p;
  };
  // the warlord: a character that leads a squad the faction has, and its bodyguard
  const leaders = usable.filter((d) => d.keywords.includes('CHARACTER') && !d.isSupport && d.leads.some((b) => usable.some((x) => x.name === b)) && price(d).pts <= points * 0.2);
  const lead = leaders.sort((a, b) => score(b) - score(a))[0];
  if (lead) {
    const body = usable.filter((d) => lead.leads.includes(d.name) && !d.keywords.includes('CHARACTER') && price(d).pts <= points * 0.3).sort((a, b) => score(b) - score(a))[0];
    const be = body ? add(body) : null;
    add(lead, { warlord: true, ...(be ? { attachTo: be.uid } : {}) });
  }
  // Battleline holds the objectives and forms the sturdy frontline
  const lines = usable.filter((d) => d.keywords.includes('BATTLELINE') && price(d).pts <= points * 0.25).sort((a, b) => score(b) - score(a));
  for (const d of lines.slice(0, 2)) add(d);
  if (points >= 1200 && lines.length > 2) add(lines[2], {}, points >= 1000);

  // Heavies / Vehicles / Monsters / Walkers: ensure high-point bot armies include armored war machines / heavy fire support
  if (points >= 750) {
    const heavies = usable.filter((d) => (d.keywords.includes('VEHICLE') || d.keywords.includes('MONSTER') || d.keywords.includes('WALKER')) && !d.keywords.includes('CHARACTER') && price(d).pts <= points * 0.45).sort((a, b) => score(b) - score(a));
    if (heavies.length > 0) {
      add(heavies[0]);
      if (points >= 1200 && heavies.length > 1) add(heavies[1]);
    }
  }

  // then the hardest-hitting units per point, allowing up to 3-4 duplicates (6 for Battleline) for large armies
  const rest = usable.filter((d) => !d.keywords.includes('CHARACTER') || !d.leads.length).filter((d) => price(d).pts <= points * 0.4 && !d.keywords.includes('EPIC HERO'));
  const maxDup = (d: DatasheetData) => (d.keywords.includes('BATTLELINE') ? 6 : points >= 2000 ? 4 : 3);
  for (let guard = 0; guard < 80 && left > 40; guard++) {
    const fits = rest.filter((d) => price(d).pts <= left && units.filter((u) => u.datasheet === d.name).length < maxDup(d));
    if (!fits.length) break;
    const pick = fits.sort((a, b) => score(b) - score(a))[Math.floor(rnd() * Math.min(3, fits.length))];
    add(pick);
  }
  if (!units.some((u) => u.warlord) && units.length) units[0].warlord = true;
  return { name: `${f.name} Strike Force`, factionId: f.id, battleSize: 'incursion', detachments: det ? [det] : [], units };
}
