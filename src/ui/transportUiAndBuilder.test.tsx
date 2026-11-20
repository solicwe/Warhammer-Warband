import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DatasheetView } from './Sheet';
import { parseTransport, transportFit } from '../engine/army';
import type { FactionData } from '../engine/types';

describe('Transport Datasheet and Builder Integration', () => {
  const am: FactionData = JSON.parse(fs.readFileSync('public/data/factions/AM.json', 'utf8'));
  const sm: FactionData = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8'));

  it('renders TRANSPORT section in DatasheetView for Astra Militarum Chimera', () => {
    const chimera = am.datasheets.find((d) => d.name === 'Chimera')!;
    expect(chimera.transport).toBeDefined();

    const html = renderToStaticMarkup(
      <DatasheetView
        sheet={chimera}
        factionId="AM"
      />
    );

    expect(html).toContain('TRANSPORT');
    expect(html).toContain('ds-sec-transport');
    expect(html).toContain('12 Astra Militarum Infantry');
  });

  it('does NOT render TRANSPORT section in DatasheetView for non-transport Cadian Shock Troops', () => {
    const cadians = am.datasheets.find((d) => d.name === 'Cadian Shock Troops')!;
    expect(cadians.transport).toBeUndefined();

    const html = renderToStaticMarkup(
      <DatasheetView
        sheet={cadians}
        factionId="AM"
      />
    );

    expect(html).not.toContain('ds-sec-transport');
  });

  it('finds compatible faction transports for Cadian Shock Troops and forbids for Leman Russ', () => {
    const allTransports = am.datasheets.filter((d) => parseTransport(d.transport));
    expect(allTransports.length).toBeGreaterThan(0);

    const cadians = am.datasheets.find((d) => d.name === 'Cadian Shock Troops')!;
    const cadianTransports = allTransports.filter((t) => {
      const tInfo = parseTransport(t.transport);
      if (!tInfo) return false;
      const fit = transportFit(tInfo, [...cadians.keywords, ...cadians.factionKeywords, cadians.name]);
      return !fit.why;
    });

    const cadianNames = cadianTransports.map((t) => t.name);
    expect(cadianNames).toContain('Chimera');
    expect(cadianNames).toContain('Taurox');
    expect(cadianNames).toContain('Valkyrie');

    // Leman Russ Battle Tank (Vehicle) cannot embark in any transport
    const leman = am.datasheets.find((d) => d.name === 'Leman Russ Battle Tank')!;
    const lemanTransports = allTransports.filter((t) => {
      const tInfo = parseTransport(t.transport);
      if (!tInfo) return false;
      const fit = transportFit(tInfo, [...leman.keywords, ...leman.factionKeywords, leman.name]);
      return !fit.why;
    });
    expect(lemanTransports.length).toBe(0);
  });

  it('Chimera forbids Field Ordnance Battery (Artillery) and Taurox Prime forbids Cadian Shock Troops', () => {
    const chimera = am.datasheets.find((d) => d.name === 'Chimera')!;
    const tauroxPrime = am.datasheets.find((d) => d.name === 'Taurox Prime')!;
    const fob = am.datasheets.find((d) => d.name.includes('Field Ordnance Battery'))!;
    const cadians = am.datasheets.find((d) => d.name === 'Cadian Shock Troops')!;

    const chimeraInfo = parseTransport(chimera.transport)!;
    const tpInfo = parseTransport(tauroxPrime.transport)!;

    const chimeraFobFit = transportFit(chimeraInfo, [...fob.keywords, ...fob.factionKeywords, fob.name]);
    expect(chimeraFobFit.why).toBeTruthy(); // Cannot carry Artillery

    const tpCadianFit = transportFit(tpInfo, [...cadians.keywords, ...cadians.factionKeywords, cadians.name]);
    expect(tpCadianFit.why).toBeTruthy(); // Taurox Prime only carries Tempestus or Characters
  });

  it('Space Marine Rhino carries Intercessors but forbids Terminators, Land Raider carries Terminators', () => {
    const rhino = sm.datasheets.find((d) => d.name === 'Rhino')!;
    const rhinoInfo = parseTransport(rhino.transport)!;

    const intercessors = sm.datasheets.find((d) => d.name === 'Intercessor Squad')!;
    const termis = sm.datasheets.find((d) => d.name === 'Terminator Squad')!;

    const intercessorFit = transportFit(rhinoInfo, [...intercessors.keywords, ...intercessors.factionKeywords, intercessors.name]);
    expect(intercessorFit.why).toBeNull(); // Intercessors fit

    const termiFit = transportFit(rhinoInfo, [...termis.keywords, ...termis.factionKeywords, termis.name]);
    expect(termiFit.why).toBeTruthy(); // Terminators forbidden in Rhino

    const landRaider = sm.datasheets.find((d) => d.name === 'Land Raider')!;
    const landRaiderInfo = parseTransport(landRaider.transport)!;

    const lrTermiFit = transportFit(landRaiderInfo, [...termis.keywords, ...termis.factionKeywords, termis.name]);
    expect(lrTermiFit.why).toBeNull(); // Terminators fit in Land Raider
    expect(lrTermiFit.space).toBe(2); // Takes 2 spaces
  });

  it('Chaos Daemons Skull Cannon has Deep Strike, so hasDs is true and only Deep Strike is presented', () => {
    const cd: FactionData = JSON.parse(fs.readFileSync('public/data/factions/CD.json', 'utf8'));
    const skullCannon = cd.datasheets.find((d) => d.name === 'Skull Cannon')!;
    const cadians = am.datasheets.find((d) => d.name === 'Cadian Shock Troops')!;

    const unitHasDs = (s?: any) => !!s && ((s.abilities || []).some((a: any) => /deep strike/i.test(a.name)) || (s.keywords || []).some((k: string) => /deep strike/i.test(k)));

    expect(unitHasDs(skullCannon)).toBe(true);
    expect(unitHasDs(cadians)).toBe(false);
  });

  it('Allied / detachment points caps: only visible when spent > 0 or explicitly granted by active detachment', async () => {
    const { subPointsList } = await import('../engine/allies');
    const csm: FactionData = JSON.parse(fs.readFileSync('public/data/factions/CSM.json', 'utf8'));
    const dg: FactionData = JSON.parse(fs.readFileSync('public/data/factions/DG.json', 'utf8'));

    // CSM with Huron's Marauders and no daemons or cult marines
    const csmList = {
      name: 'CSM List',
      factionId: 'CSM',
      battleSize: 'strike_force',
      detachments: ["Huron's Marauders"],
      units: [
        { uid: 'u1', datasheet: 'Legionaries', models: 10, pts: 170 },
      ],
    };
    const csmSub = subPointsList(csmList as any, csm, 2000);
    const filterVisible = (items: typeof csmSub, dets: string[]) =>
      items.filter((sp) => {
        if (sp.spent > 0) return true;
        if (sp.fromDetachment) {
          const normDet = sp.fromDetachment.toLowerCase().replace(/’/g, "'");
          return dets.some((d) => d.toLowerCase().replace(/’/g, "'") === normDet);
        }
        return false;
      });

    // 1. In Huron's Marauders with 0 daemons and 0 cult marines: 0 badges visible
    const visible1 = filterVisible(csmSub, csmList.detachments);
    expect(visible1).toHaveLength(0);

    // 2. Add cult marines (Rubric Marines: 105 pts) -> Cult badge appears!
    const csmWithCult = {
      ...csmList,
      units: [...csmList.units, { uid: 'c1', datasheet: 'Rubric Marines', models: 5, pts: 105 }],
    };
    const csmWithCultSub = subPointsList(csmWithCult as any, csm, 2000);
    const visible2 = filterVisible(csmWithCultSub, csmWithCult.detachments);
    expect(visible2).toHaveLength(1);
    expect(visible2[0].id).toBe('cult-marines');
    expect(visible2[0].spent).toBe(105);

    // Also test allied daemons when datasheet is present with ally: 'CD'
    const csmWithDaemonData: FactionData = {
      ...csm,
      datasheets: [
        ...csm.datasheets,
        {
          name: 'Bloodletters',
          ally: 'CD',
          keywords: ['INFANTRY', 'DAEMON'],
          factionKeywords: ['LEGIONES DAEMONICA', 'KHORNE'],
        } as any,
      ],
    };
    const csmWithDaemons = {
      ...csmList,
      units: [...csmList.units, { uid: 'd1', datasheet: 'Bloodletters', models: 10, pts: 110 }],
    };
    const csmWithDaemonsSub = subPointsList(csmWithDaemons as any, csmWithDaemonData, 2000);
    const visible2b = filterVisible(csmWithDaemonsSub, csmWithDaemons.detachments);
    expect(visible2b.some((x) => x.id === 'daemonic-pact')).toBe(false); // no Daemonic Pact (owner)

    // 3. Death Guard with Tallyband Summoners -> Plague Legions badge appears even at 0 spent because it is a Detachment rule!
    const dgTallyband = {
      name: 'DG Tallyband',
      factionId: 'DG',
      battleSize: 'strike_force',
      detachments: ['Tallyband Summoners'],
      units: [],
    };
    const dgSub = subPointsList(dgTallyband as any, dg, 2000);
    const visible3 = filterVisible(dgSub, dgTallyband.detachments);
    expect(visible3.some((s) => s.id === 'plague-legions')).toBe(true);
  });
});
