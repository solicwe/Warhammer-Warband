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
});
