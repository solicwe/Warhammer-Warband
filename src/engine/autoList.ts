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

/** wild: ignore how hard a unit hits and pick at random (a campaign start that differs every run). */
export function autoList(f: FactionData, points = 1000, seed = 1, wild = false): ArmyList {
  const rnd = rand(seed + f.id.length * 31);
  // the faction's own units (allies from other books carry other faction keywords)
  const count = new Map<string, number>();
  for (const d of f.datasheets) for (const k of d.factionKeywords) count.set(k, (count.get(k) ?? 0) + 1);
  const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const usable = f.datasheets.filter((d) => (!main || d.factionKeywords.includes(main)) && d.points[0]?.options?.length && !d.subfaction && !d.keywords.includes('FORTIFICATION')
    && !d.keywords.includes('AIRCRAFT') && !d.transport && d.models.length && d.weapons.length);
  const price = (d: DatasheetData) => [...d.points[0].options].sort((a, b) => a.pts - b.pts)[0];
  const det = f.detachments[Math.floor(rnd() * Math.min(3, f.detachments.length))]?.name;
  const units: ArmyUnitEntry[] = [];
  let left = points;
  let n = 0;
  const add = (d: DatasheetData, extra: Partial<ArmyUnitEntry> = {}) => {
    const o = price(d);
    if (o.pts > left) return null;
    const e: ArmyUnitEntry = syncWargear(d, defaultWargear(d, { uid: `a${n++}`, datasheet: d.name, models: o.models, pts: o.pts, ...extra }));
    units.push(e);
    left -= o.pts + (e.wargearPts ?? 0);
    return e;
  };
  const score = (d: DatasheetData) => { if (wild) return rnd(); const o = price(d); return punch(d, o.pts, o.models) * (0.75 + rnd() * 0.5); };
  // the warlord: a character that leads a squad the faction has, and its bodyguard
  const leaders = usable.filter((d) => d.keywords.includes('CHARACTER') && !d.isSupport && d.leads.some((b) => usable.some((x) => x.name === b)) && price(d).pts <= points * 0.2);
  const lead = leaders.sort((a, b) => score(b) - score(a))[0];
  if (lead) {
    const body = usable.filter((d) => lead.leads.includes(d.name) && !d.keywords.includes('CHARACTER') && price(d).pts <= points * 0.3).sort((a, b) => score(b) - score(a))[0];
    const be = body ? add(body) : null;
    add(lead, { warlord: true, ...(be ? { attachTo: be.uid } : {}) });
  }
  // Battleline holds the objectives
  const lines = usable.filter((d) => d.keywords.includes('BATTLELINE') && price(d).pts <= points * 0.25).sort((a, b) => score(b) - score(a));
  for (const d of lines.slice(0, 2)) add(d);
  // then the hardest-hitting units per point, at most two of each and none worth more than 40% of the army
  const rest = usable.filter((d) => !d.keywords.includes('CHARACTER') || !d.leads.length).filter((d) => price(d).pts <= points * 0.4 && !d.keywords.includes('EPIC HERO'));
  for (let guard = 0; guard < 30 && left > 40; guard++) {
    const fits = rest.filter((d) => price(d).pts <= left && units.filter((u) => u.datasheet === d.name).length < 2);
    if (!fits.length) break;
    const pick = fits.sort((a, b) => score(b) - score(a))[Math.floor(rnd() * Math.min(3, fits.length))];
    add(pick);
  }
  if (!units.some((u) => u.warlord) && units.length) units[0].warlord = true;
  return { name: `${f.name} (auto ${seed})`, factionId: f.id, battleSize: 'incursion', detachments: det ? [det] : [], units };
}
