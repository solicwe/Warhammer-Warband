// Allied units from other books (11th edition army rules): Freeblades and Dreadblades (Knights), Titanic Support,
// Assigned Agents and the Daemonic Pact. Their datasheets join the army's faction data marked `ally`, so the builder,
// points and the game treat them as any other unit; the caps of each rule are checked here.
import type { ArmyList, ArmyUnitEntry, DatasheetData, FactionData } from './types';

export interface AllySource {
  id: string;
  /** the army rule of the ally's book that allows it */
  rule: string;
  army: (factionId: string, group?: string) => boolean;
  unit: (d: DatasheetData) => boolean;
}

const has = (d: DatasheetData, k: string) => d.keywords.includes(k);
// shortcut: "every model has the IMPERIUM / CHAOS keyword" is read from the faction's group, not checked per model
export const ALLIES: AllySource[] = [
  { id: 'QI', rule: 'Freeblades', army: (id, g) => g === 'Imperium' && id !== 'QI', unit: (d) => has(d, 'TITANIC') || has(d, 'ARMIGER') },
  { id: 'TL', rule: 'Titanic Support', army: (id, g) => g === 'Imperium' && id !== 'TL', unit: () => true },
  { id: 'AoI', rule: 'Assigned Agents', army: (id, g) => g === 'Imperium' && id !== 'AoI', unit: () => true },
  { id: 'QT', rule: 'Dreadblades', army: (id, g) => g === 'Chaos' && id !== 'QT', unit: (d) => has(d, 'TITANIC') || has(d, 'WAR DOG') },
  { id: 'CD', rule: 'Daemonic Pact', army: (id) => id === 'CSM' || id === 'QT', unit: (d) => d.factionKeywords.includes('LEGIONES DAEMONICA') },
];

/** Units from another book that only one detachment of the army allows (up to 500 pts): Mechanicus Allies, Wretched Thralls. */
export const DETACHMENT_ALLIES = [
  { id: 'QI', kw: 'ADEPTUS MECHANICUS', det: 'Questor Forgepact', rule: 'Mechanicus Allies' },
  { id: 'QT', kw: 'DAMNED', det: 'Iconoclast Fiefdom', rule: 'Wretched Thralls' },
];
export const detachmentAllyOf = (factionId: string | undefined, d: { keywords: string[]; factionKeywords: string[] }) =>
  DETACHMENT_ALLIES.find((a) => a.id === factionId && (d.factionKeywords.includes(a.kw) || d.keywords.includes(a.kw)));

export const allySources = (factionId: string, group?: string) => ALLIES.filter((a) => a.army(factionId, group));

/** The army's faction data with the datasheets its allies may bring (a unit it already has stays its own). */
export function withAllies(f: FactionData, allies: { src: AllySource; data: FactionData }[]): FactionData {
  const names = new Set(f.datasheets.map((d) => d.name));
  const extra: DatasheetData[] = [];
  for (const { src, data } of allies) {
    for (const d of data.datasheets) {
      if (names.has(d.name) || !src.unit(d)) continue;
      names.add(d.name);
      extra.push({ ...d, ally: src.id, allyName: data.name });
    }
  }
  return extra.length ? { ...f, datasheets: [...f.datasheets, ...extra] } : f;
}

/** Errors for the allied units of a list: each rule's caps, and never the Warlord nor an Enhancement. */
export function allyErrors(list: ArmyList, faction: FactionData, sizePoints: number, unitPoints: (u: ArmyUnitEntry) => number): string[] {
  const errs: string[] = [];
  const sheetOf = (u: ArmyUnitEntry) => faction.datasheets.find((d) => d.name === u.datasheet);
  const tier = sizePoints <= 1000 ? 0 : sizePoints <= 2000 ? 1 : 2;
  const by = new Map<string, { u: ArmyUnitEntry; d: DatasheetData }[]>();
  for (const u of list.units) {
    const d = sheetOf(u);
    if (d?.ally) by.set(d.ally, [...(by.get(d.ally) ?? []), { u, d }]);
  }
  // Cult of the Dark Gods: the cult Legionaries (in the Heretic Astartes book) share one points cap
  const cult = faction.id === 'CSM' ? list.units.filter((u) => ['Khorne Berzerkers', 'Rubric Marines', 'Plague Marines', 'Noise Marines'].includes(u.datasheet)) : [];
  if (cult.length) {
    const cap = [250, 500, 750][tier], pts = cult.reduce((a, u) => a + unitPoints(u), 0);
    if (pts > cap) errs.push(`Cult of the Dark Gods: ${pts} pts of cult units — at most ${cap} pts at this battle size`);
  }
  for (const [id, xs] of by) {
    const name = xs[0].d.allyName ?? id;
    if (xs.some((x) => x.u.warlord)) errs.push(`Allied ${name} units cannot be your Warlord`);
    if (id !== 'TL' && id !== 'AoI' && xs.some((x) => x.u.enhancement)) errs.push(`Allied ${name} units cannot take Enhancements`);
    const models = (k: string) => xs.filter((x) => has(x.d, k)).reduce((a, x) => a + x.u.models, 0);
    if (id === 'QI' || id === 'QT') {
      const small = id === 'QI' ? 'ARMIGER' : 'WAR DOG', titans = models('TITANIC'), dogs = models(small);
      if (titans > 1 || dogs > 3 || (titans && dogs)) errs.push(`${id === 'QI' ? 'Freeblades' : 'Dreadblades'}: either 1 TITANIC model or up to 3 ${small} models`);
    }
    if (id === 'TL' && xs.length > 1) errs.push('Titanic Support: only 1 ADEPTUS TITANICUS model');
    if (id === 'AoI') {
      const caps = { RETINUE: [1, 2, 3], CHARACTER: [1, 2, 3], REQUISITIONED: [1, 1, 2] };
      const kind = (d: DatasheetData) => (has(d, 'RETINUE') ? 'RETINUE' : has(d, 'CHARACTER') ? 'CHARACTER' : 'REQUISITIONED');
      for (const [k, cap] of Object.entries(caps)) {
        const units = xs.filter((x) => !has(x.d, 'DEDICATED TRANSPORT') && kind(x.d) === k);
        const voidfarers = xs.filter((x) => has(x.d, 'VOIDFARERS') && has(x.d, 'CHARACTER')).length;
        const inquisitors = xs.filter((x) => has(x.d, 'INQUISITOR') && has(x.d, 'CHARACTER')).length;
        const exemptions = k === 'RETINUE'
          ? Math.min(units.filter((x) => has(x.d, 'VOIDSMEN-AT-ARMS')).length, voidfarers)
            + Math.min(units.filter((x) => has(x.d, 'INQUISITORIAL AGENTS')).length, inquisitors)
          : 0;
        const n = units.length - exemptions;
        if (n > cap[tier]) errs.push(`Assigned Agents: at most ${cap[tier]} ${k} unit${cap[tier] > 1 ? 's' : ''} at this battle size`);
      }
    }
    if (id === 'CD') {
      const cap = [250, 500, 750][tier], pts = xs.reduce((a, x) => a + unitPoints(x.u), 0);
      if (pts > cap) errs.push(`Daemonic Pact: ${pts} pts of LEGIONES DAEMONICA — at most ${cap} pts at this battle size`);
      for (const god of ['KHORNE', 'TZEENTCH', 'NURGLE', 'SLAANESH']) {
        const mine = xs.filter((x) => has(x.d, god));
        const line = mine.filter((x) => has(x.d, 'BATTLELINE')).length;
        if (mine.length - line > line) errs.push(`Daemonic Pact: ${titleGod(god)} needs as many BATTLELINE units as other units`);
      }
    }
  }
  return errs;
}

const titleGod = (g: string) => g[0] + g.slice(1).toLowerCase();
