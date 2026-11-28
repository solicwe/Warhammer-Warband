// Allied units from other books (11th edition army rules, as Wahapedia 11e: owner, 24 Nov 2026): Freeblades and
// Dreadblades (Knights), Titanic Support, Assigned Agents and the Daemonic Pact. Their datasheets join the army's
// faction data marked `ally`, so the builder, points and the game treat them as any other unit; the caps of each rule
// are checked here. Units another book's detachment brings (Mechanicus Allies, Wretched Thralls, Thralls of the
// First Prince) are in the army's own faction data and listed in DETACHMENT_ALLIES.
import type { ArmyList, ArmyUnitEntry, DatasheetData, FactionData } from './types';

export interface AllySource {
  id: string;
  /** the army rule of the ally's book that allows it */
  rule: string;
  army: (factionId: string, group?: string) => boolean;
  unit: (d: DatasheetData) => boolean;
  /** allied datasheets that copy a unit of another book: not offered to that book's own armies (owner, 21 Nov 2026) */
  notFor?: Record<string, string[]>;
}

const has = (d: DatasheetData, k: string) => d.keywords.includes(k);
// shortcut: "every model has the IMPERIUM / CHAOS keyword" is read from the faction's group, not checked per model
export const ALLIES: AllySource[] = [
  { id: 'QI', rule: 'Freeblades', army: (id, g) => g === 'Imperium' && id !== 'QI', unit: (d) => has(d, 'TITANIC') || has(d, 'ARMIGER') },
  { id: 'TL', rule: 'Titanic Support', army: (id, g) => g === 'Imperium' && id !== 'TL', unit: () => true },
  { id: 'AoI', rule: 'Assigned Agents', army: (id, g) => g === 'Imperium' && id !== 'AoI', unit: () => true,
    // the Ordos' requisitioned squads: a Space Marine army has its own Deathwatch, Grey Knights and Sisters their own squads
    notFor: { 'Deathwatch Kill Team': ['SM'], 'Aquila Kill Team': ['SM'], 'Grey Knights Terminator Squad': ['GK'], 'Sisters of Battle Squad': ['AS'], 'Sisters of Battle Immolator': ['AS'] } },
  { id: 'QT', rule: 'Dreadblades', army: (id, g) => g === 'Chaos' && id !== 'QT', unit: (d) => has(d, 'TITANIC') || has(d, 'WAR DOG') },
  // "If every model from your army has the Chaos Knights or Heretic Astartes keyword": Chaos Space Marines and Chaos
  // Knights armies (Death Guard, Thousand Sons, World Eaters and Emperor's Children have their own faction keyword,
  // and their own daemon detachments). The Chaos Daemons book's Heretic Astartes units are not daemons
  { id: 'CD', rule: 'Daemonic Pact', army: (id) => id === 'CSM' || id === 'QT', unit: (d) => d.factionKeywords.includes('LEGIONES DAEMONICA') && !d.factionKeywords.includes('HERETIC ASTARTES') },
];

/** Units from another book that only one detachment of the army allows, with their points cap at each battle size. */
export const DETACHMENT_ALLIES = [
  { id: 'QI', kw: 'ADEPTUS MECHANICUS', det: 'Questor Forgepact', rule: 'Mechanicus Allies', caps: [500, 500, 500] },
  { id: 'QT', kw: 'DAMNED', det: 'Iconoclast Fiefdom', rule: 'Wretched Thralls', caps: [500, 500, 500] },
  { id: 'CD', kw: 'HERETIC ASTARTES', det: 'Shadow Legion', rule: 'Thralls of the First Prince', caps: [500, 1000, 1500] },
  // the Genestealer Cults book carries the Astra Militarum and Tyranids datasheets; each shows only after its detachment is chosen
  { id: 'GC', kw: 'ASTRA MILITARUM', det: 'Brood Brother Auxilia', rule: 'Brood Brothers', caps: [500, 1000, 1500], notKw: 'GENESTEALER CULTS' },
  { id: 'GC', kw: 'TYRANIDS', det: 'Final Day', rule: 'Tyranid Allies', caps: [500, 1000, 1500], notKw: 'GENESTEALER CULTS' },
];
export const detachmentAllyOf = (factionId: string | undefined, d: { keywords: string[]; factionKeywords: string[] }) =>
  DETACHMENT_ALLIES.find((a) => a.id === factionId && (d.factionKeywords.includes(a.kw) || d.keywords.includes(a.kw)) && !(a.notKw && (d.factionKeywords.includes(a.notKw) || d.keywords.includes(a.notKw))));

export const allySources = (factionId: string, group?: string) => ALLIES.filter((a) => a.army(factionId, group));

/** The army's faction data with the datasheets its allies may bring (a unit it already has stays its own). */
export function withAllies(f: FactionData, allies: { src: AllySource; data: FactionData }[]): FactionData {
  const names = new Set(f.datasheets.map((d) => d.name));
  const extra: DatasheetData[] = [];
  for (const { src, data } of allies) {
    for (const d of data.datasheets) {
      if (names.has(d.name) || !src.unit(d) || src.notFor?.[d.name]?.includes(f.id)) continue;
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
    if (id === 'CD') {
      const cap = [250, 500, 750][tier], pts = xs.reduce((a, x) => a + unitPoints(x.u), 0);
      if (pts > cap) errs.push(`Daemonic Pact: ${pts} pts of LEGIONES DAEMONICA units — at most ${cap} pts at this battle size`);
      // "the number of non-BATTLELINE units with that keyword … cannot be greater than the number of BATTLELINE units"
      for (const god of ['KHORNE', 'TZEENTCH', 'NURGLE', 'SLAANESH']) {
        const mine = xs.filter((x) => has(x.d, god));
        const line = mine.filter((x) => has(x.d, 'BATTLELINE')).length;
        if (mine.length - line > line) errs.push(`Daemonic Pact: ${god[0] + god.slice(1).toLowerCase()} needs as many BATTLELINE units as other units (${line} BATTLELINE, ${mine.length - line} other)`);
      }
    }
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
  }
  return errs;
}


export interface SubPointsItem {
  id: string;
  label: string;
  shortLabel?: string;
  tinyLabel?: string;
  spent: number;
  cap: number;
  over: boolean;
  unit?: string;
  title?: string;
  fromDetachment?: string;
}

const defaultUnitPoints = (u: ArmyUnitEntry): number => {
  const enhPts = (u.enhancements && u.enhancements.length > 0)
    ? u.enhancements.reduce((s, x) => s + x.pts, 0)
    : (u.enhancementPts ?? 0);
  return (u.pts ?? 0) + enhPts + (u.wargearPts ?? 0);
};

/** Returns separate points caps (allied daemons, cult marines, detachment allies, reserves) actively tracked for an army. */
export function subPointsList(
  list: ArmyList,
  faction: FactionData | null | undefined,
  sizePoints: number,
  unitPoints: (u: ArmyUnitEntry) => number = defaultUnitPoints,
): SubPointsItem[] {
  if (!faction) return [];
  const tier = sizePoints <= 1000 ? 0 : sizePoints <= 2000 ? 1 : 2;
  const sheetOf = (u: ArmyUnitEntry) => faction.datasheets.find((d) => d.name === u.datasheet);
  const items: SubPointsItem[] = [];

  const add = (
    id: string,
    label: string,
    shortLabel: string,
    tinyLabel: string,
    cap: number,
    predicate: (u: ArmyUnitEntry, d?: DatasheetData) => boolean,
    title?: string,
    fromDetachment?: string,
  ) => {
    const matching = list.units.filter((u) => predicate(u, sheetOf(u)));
    const spent = matching.reduce((sum, u) => sum + unitPoints(u), 0);
    items.push({
      id,
      label,
      shortLabel,
      tinyLabel,
      spent,
      cap,
      over: spent > cap,
      unit: 'pts',
      title: title ?? `${label}: ${spent}/${cap} pts`,
      fromDetachment,
    });
  };

  // 1. Daemonic Pact: Chaos Space Marines and Chaos Knights armies (the other Chaos books' daemon detachments have
  //    their own caps below)
  if (faction.id === 'CSM' || faction.id === 'QT') {
    const cap = [250, 500, 750][tier];
    add('daemonic-pact', 'Daemonic Pact', 'Daemons', 'D', cap, (_u, d) => d?.ally === 'CD', `Daemonic Pact: allied LEGIONES DAEMONICA units (up to ${cap} pts)`);
  }

  // 2. Cult of the Dark Gods: CSM cult Legionaries (only in Chaos Space Marines armies)
  if (faction.id === 'CSM') {
    const cultNames = ['Khorne Berzerkers', 'Rubric Marines', 'Plague Marines', 'Noise Marines'];
    const cap = [250, 500, 750][tier];
    add(
      'cult-marines',
      'Cult of the Dark Gods',
      'Cult',
      'C',
      cap,
      (u) => cultNames.includes(u.datasheet),
      `Cult of the Dark Gods: Cult Legionaries in Heretic Astartes (up to ${cap} pts)`
    );
  }

  // 3. Plague Legions: DG detachment Tallyband Summoners
  const hasPlagueLegions = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('PLAGUE LEGIONS') || d.keywords.includes('PLAGUE LEGIONS'));
  });
  if (list.detachments.includes('Tallyband Summoners') || (faction.id === 'DG' && hasPlagueLegions)) {
    const cap = [500, 1000, 1500][tier];
    add(
      'plague-legions',
      'Plague Legions',
      'Plague',
      'PL',
      cap,
      (_u, d) => !!d && (d.factionKeywords.includes('PLAGUE LEGIONS') || d.keywords.includes('PLAGUE LEGIONS')),
      `Plague Legions: Tallyband Summoners allied daemons (up to ${cap} pts)`,
      'Tallyband Summoners'
    );
  }

  // 4. Legions of Excess: EC detachment Carnival of Excess
  const hasLegionsExcess = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('LEGIONS OF EXCESS') || d.keywords.includes('LEGIONS OF EXCESS'));
  });
  if (list.detachments.includes('Carnival of Excess') || (faction.id === 'EC' && hasLegionsExcess)) {
    const cap = [500, 1000, 1500][tier];
    add(
      'legions-of-excess',
      'Legions of Excess',
      'Excess',
      'LE',
      cap,
      (_u, d) => !!d && (d.factionKeywords.includes('LEGIONS OF EXCESS') || d.keywords.includes('LEGIONS OF EXCESS')),
      `Legions of Excess: Carnival of Excess allied daemons (up to ${cap} pts)`,
      'Carnival of Excess'
    );
  }

  // 5. Scintillating Legions: TS detachment Changehost of Deceit
  const hasScintillating = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('SCINTILLATING LEGIONS') || d.keywords.includes('SCINTILLATING LEGIONS'));
  });
  if (list.detachments.includes('Changehost of Deceit') || (faction.id === 'TS' && hasScintillating)) {
    const cap = [500, 1000, 1500][tier];
    add(
      'scintillating-legions',
      'Scintillating Legions',
      'Scintillating',
      'SL',
      cap,
      (_u, d) => !!d && (d.factionKeywords.includes('SCINTILLATING LEGIONS') || d.keywords.includes('SCINTILLATING LEGIONS')),
      `Scintillating Legions: Changehost of Deceit allied daemons (up to ${cap} pts)`,
      'Changehost of Deceit'
    );
  }

  // 6. Blood Legions: WE detachment Khorne Daemonkin
  const hasBloodLegions = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('BLOOD LEGIONS') || d.keywords.includes('BLOOD LEGIONS'));
  });
  if (list.detachments.includes('Khorne Daemonkin') || (faction.id === 'WE' && hasBloodLegions)) {
    const cap = [500, 1000, 1500][tier];
    add(
      'blood-legions',
      'Blood Legions',
      'Blood',
      'BL',
      cap,
      (_u, d) => !!d && (d.factionKeywords.includes('BLOOD LEGIONS') || d.keywords.includes('BLOOD LEGIONS')),
      `Blood Legions: Khorne Daemonkin allied daemons (up to ${cap} pts)`,
      'Khorne Daemonkin'
    );
  }

  // 7. Shadow Legion: CD detachment Shadow Legion (Thralls of the First Prince)
  const hasShadowLegion = faction.id === 'CD' && list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('HERETIC ASTARTES') || d.keywords.includes('HERETIC ASTARTES'));
  });
  if (list.detachments.includes('Shadow Legion') || (faction.id === 'CD' && hasShadowLegion)) {
    const cap = [500, 1000, 1500][tier];
    add(
      'shadow-legion',
      'Shadow Legion',
      'Shadow',
      'S',
      cap,
      (_u, d) => !!d && (d.factionKeywords.includes('HERETIC ASTARTES') || d.keywords.includes('HERETIC ASTARTES')),
      `Shadow Legion: Heretic Astartes units in Shadow Legion (up to ${cap} pts)`,
      'Shadow Legion'
    );
  }

  // 8. Drukhari: Reaper's Wager (Harlequins) or Corsairs and Travelling Players
  if (faction.id === 'DRU') {
    if (list.detachments.some((d) => /Reaper/i.test(d))) {
      const cap = [500, 1000, 1500][tier];
      add(
        'dru-harlequins',
        'Harlequins',
        'Harlies',
        'H',
        cap,
        (_u, d) => !!d && (d.factionKeywords.includes('HARLEQUINS') || d.keywords.includes('HARLEQUINS')),
        `Harlequins: Reaper's Wager allied Harlequins (up to ${cap} pts)`,
        "Reaper’s Wager"
      );
    } else {
      const cap = [250, 500, 750][tier];
      add(
        'dru-travelling-players',
        'Travelling Players',
        'Players',
        'TP',
        cap,
        (_u, d) => !!d && (d.factionKeywords.includes('HARLEQUINS') || d.keywords.includes('HARLEQUINS') || d.factionKeywords.includes('ANHRATHE') || d.keywords.includes('ANHRATHE')),
        `Corsairs and Travelling Players: Harlequins and Anhrathe units (up to ${cap} pts)`
      );
    }
  }

  // 9. Brood Brothers: GC detachment Brood Brother Auxilia
  const hasBroodBrothers = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('ASTRA MILITARUM') || d.keywords.includes('ASTRA MILITARUM'));
  });
  if (list.detachments.includes('Brood Brother Auxilia') || (faction.id === 'GC' && hasBroodBrothers)) {
    const cap = [500, 1000, 1500][tier];
    add(
      'brood-brothers',
      'Brood Brothers',
      'Brood',
      'BB',
      cap,
      (_u, d) => !!d && (d.factionKeywords.includes('ASTRA MILITARUM') || d.keywords.includes('ASTRA MILITARUM')),
      `Brood Brothers: Astra Militarum units in Brood Brother Auxilia (up to ${cap} pts)`,
      'Brood Brother Auxilia'
    );
  }

  // 10. Tyranids: GC detachment Final Day
  const hasTyranids = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('TYRANIDS') || d.keywords.includes('TYRANIDS'));
  });
  if (list.detachments.includes('Final Day') || (faction.id === 'GC' && hasTyranids)) {
    const cap = [500, 1000, 1500][tier];
    add(
      'final-day-tyranids',
      'Tyranids',
      'Nids',
      'TY',
      cap,
      (_u, d) => !!d && (d.factionKeywords.includes('TYRANIDS') || d.keywords.includes('TYRANIDS')),
      `Tyranids: Vanguard Invader units in Final Day (up to ${cap} pts)`,
      'Final Day'
    );
  }

  // 11. Mechanicus Allies: QI detachment Questor Forgepact
  const hasMechanicus = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('ADEPTUS MECHANICUS') || d.keywords.includes('ADEPTUS MECHANICUS'));
  });
  if ((faction.id === 'QI' && list.detachments.includes('Questor Forgepact')) || (faction.id === 'QI' && hasMechanicus)) {
    add(
      'mechanicus-allies',
      'Mechanicus Allies',
      'AdMech',
      'AM',
      500,
      (_u, d) => !!d && (d.factionKeywords.includes('ADEPTUS MECHANICUS') || d.keywords.includes('ADEPTUS MECHANICUS')),
      `Mechanicus Allies: Adeptus Mechanicus units in Questor Forgepact (up to 500 pts)`,
      'Questor Forgepact'
    );
  }

  // 12. Wretched Thralls: QT detachment Iconoclast Fiefdom
  const hasDamned = faction.id === 'QT' && list.units.some((u) => !!sheetOf(u)?.keywords.includes('DAMNED'));
  if (faction.id === 'QT' && (list.detachments.includes('Iconoclast Fiefdom') || hasDamned)) {
    add('wretched-thralls', 'Wretched Thralls', 'Damned', 'DM', 500, (_u, d) => !!d?.keywords.includes('DAMNED'),
      'Wretched Thralls: DAMNED units in Iconoclast Fiefdom (up to 500 pts)', 'Iconoclast Fiefdom');
  }

  // 13. Deathwatch Allies: SM detachment Deathwatch Support
  const hasDeathwatch = list.units.some((u) => {
    const d = sheetOf(u);
    return d && (d.factionKeywords.includes('DEATHWATCH') || d.keywords.includes('DEATHWATCH'));
  });
  if ((faction.id === 'SM' && list.detachments.includes('Deathwatch Support')) || (faction.id === 'SM' && hasDeathwatch)) {
    add(
      'deathwatch-allies',
      'Deathwatch Allies',
      'Deathwatch',
      'DW',
      500,
      (_u, d) => !!d && (d.factionKeywords.includes('DEATHWATCH') || d.keywords.includes('DEATHWATCH')),
      `Deathwatch Allies: Deathwatch units in Deathwatch Support (up to 500 pts)`,
      'Deathwatch Support'
    );
  }

  // 14. Dynamic fallback for any other detachment rules with points caps
  for (const det of faction.detachments ?? []) {
    if (!list.detachments.includes(det.name)) continue;
    for (const rule of det.rules ?? []) {
      const txt = rule.text ?? '';
      const capsMatch = [...txt.matchAll(/(Incursion|Strike Force|Onslaught): Up to (\d+) pts/gi)];
      const flatMatch = /(?:cannot exceed|up to) (\d+)\s*(?:points|pts)/i.exec(txt);
      if (!capsMatch.length && !flatMatch) continue;

      const kwMatch = /(?:include|include any|include the)\s+([A-Za-z0-9' -]+?)\s+units/i.exec(txt);
      const kw = kwMatch ? kwMatch[1].trim() : det.name;
      const id = `det-cap-${det.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (items.some((it) => it.id === id || it.label.toLowerCase() === kw.toLowerCase())) continue;

      let cap = 500;
      if (capsMatch.length) {
        const caps = capsMatch.map((m) => +m[2]);
        cap = caps[tier >= caps.length ? caps.length - 1 : tier];
      } else if (flatMatch) {
        cap = +flatMatch[1];
      }

      add(
        id,
        rule.name || det.name,
        kw.split(' ')[0],
        kw.slice(0, 2).toUpperCase(),
        cap,
        (_u, d) => !!d && (d.factionKeywords.some((k) => k.toUpperCase().includes(kw.toUpperCase())) || d.keywords.some((k) => k.toUpperCase().includes(kw.toUpperCase()))),
        `${det.name}: ${rule.name} (up to ${cap} pts)`,
        det.name
      );
    }
  }

  // 15. Strategic Reserves / Deep Strike: when any units in the list are designated for reserves
  const resUnits = list.units.filter((u) => u.reserve && !u.attachTo);
  if (resUnits.length > 0) {
    const resSpent = resUnits.reduce((sum, u) => sum + unitPoints(u), 0);
    const resCap = Math.floor(sizePoints * 0.5);
    const stratUnits = resUnits.filter((u) => u.reserve === 'reserves');
    const stratSpent = stratUnits.reduce((sum, u) => sum + unitPoints(u), 0);
    const stratCap = Math.floor(sizePoints * 0.25);
    const isOver = resSpent > resCap || stratSpent > stratCap;
    items.push({
      id: 'army-reserves',
      label: 'Reserves',
      shortLabel: 'Reserves',
      tinyLabel: 'Res',
      spent: resSpent,
      cap: resCap,
      over: isOver,
      unit: 'pts',
      title: `Reserves: ${resSpent}/${resCap} pts (Strategic Reserves: ${stratSpent}/${stratCap} pts limit)`,
    });
  }

  return items;
}
