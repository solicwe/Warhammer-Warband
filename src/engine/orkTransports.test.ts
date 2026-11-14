import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { embarkCheck, parseTransport, transportLoads } from './army';
import type { ArmyList, FactionData } from './types';

const orkFaction: FactionData = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../public/data/factions/ORK.json'), 'utf8')
);

describe('Ork Transports Embarkation Audit', () => {
  it('parses all Ork transport datasheets correctly', () => {
    const hunta = orkFaction.datasheets.find((d: { name: string }) => d.name === 'Hunta Rig');
    expect(hunta).toBeDefined();
    const huntaInfo = parseTransport(hunta?.transport);
    expect(huntaInfo).not.toBeNull();
    expect(huntaInfo?.capacity).toBe(22);

    const kill = orkFaction.datasheets.find((d: { name: string }) => d.name === 'Kill Rig');
    expect(kill).toBeDefined();
    const killInfo = parseTransport(kill?.transport);
    expect(killInfo).not.toBeNull();
    expect(killInfo?.capacity).toBe(12);

    const trukk = orkFaction.datasheets.find((d: { name: string }) => d.name === 'Trukk');
    expect(trukk).toBeDefined();
    const trukkInfo = parseTransport(trukk?.transport);
    expect(trukkInfo?.capacity).toBe(12);

    const wagon = orkFaction.datasheets.find((d: { name: string }) => d.name === 'Battlewagon');
    expect(wagon).toBeDefined();
    const wagonInfo = parseTransport(wagon?.transport);
    expect(wagonInfo?.capacity).toBe(22);
  });

  it('Hunta Rig: allows Beast Snagga Boyz and Beastboss to embark', () => {
    const list: ArmyList = {
      name: 'Beast Snaggas Test',
      factionId: 'ORK',
      battleSize: 'incursion',
      detachments: ['Da Big Hunt'],
      units: [
        { uid: 'u-hunta', datasheet: 'Hunta Rig', models: 1, pts: 150 },
        { uid: 'u-bsb', datasheet: 'Beast Snagga Boyz', models: 10, pts: 105, embarkIn: 'u-hunta' },
        { uid: 'u-bb', datasheet: 'Beastboss', models: 1, pts: 80, attachTo: 'u-bsb', embarkIn: 'u-hunta' },
      ],
    };

    const chkBoyz = embarkCheck(list, orkFaction, 'u-bsb', 'u-hunta');
    expect(chkBoyz.why).toBeNull();
    expect(chkBoyz.full).toBe(false);
    expect(chkBoyz.need).toBe(11); // 10 boyz + 1 beastboss

    const loads = transportLoads(list, orkFaction);
    const huntaLoad = loads.find((l) => l.uid === 'u-hunta');
    expect(huntaLoad).toBeDefined();
    expect(huntaLoad?.problems).toEqual([]);
    expect(huntaLoad?.used).toBe(11);
  });

  it('Hunta Rig: forbids regular Boyz, Nobz, and Mounted units', () => {
    const list: ArmyList = {
      name: 'Wrong Riders Test',
      factionId: 'ORK',
      battleSize: 'incursion',
      detachments: ['War Horde'],
      units: [
        { uid: 'u-hunta', datasheet: 'Hunta Rig', models: 1, pts: 150 },
        { uid: 'u-boyz', datasheet: 'Boyz', models: 10, pts: 85 },
        { uid: 'u-nobz', datasheet: 'Nobz', models: 5, pts: 105 },
        { uid: 'u-squighog', datasheet: 'Squighog Boyz', models: 3, pts: 160 },
      ],
    };

    const chkBoyz = embarkCheck(list, orkFaction, 'u-boyz', 'u-hunta');
    expect(chkBoyz.why).toMatch(/Can only carry/i);

    const chkNobz = embarkCheck(list, orkFaction, 'u-nobz', 'u-hunta');
    expect(chkNobz.why).toMatch(/Can only carry/i);

    const chkSquig = embarkCheck(list, orkFaction, 'u-squighog', 'u-hunta');
    expect(chkSquig.why).toMatch(/cannot embark|Can only carry/i);
  });

  it('Kill Rig: allows Beast Snagga Boyz (10 models), but exceeds capacity with 20 models', () => {
    const list: ArmyList = {
      name: 'Kill Rig Test',
      factionId: 'ORK',
      battleSize: 'incursion',
      detachments: ['Da Big Hunt'],
      units: [
        { uid: 'u-kill', datasheet: 'Kill Rig', models: 1, pts: 195 },
        { uid: 'u-bsb10', datasheet: 'Beast Snagga Boyz', models: 10, pts: 105 },
        { uid: 'u-bsb20', datasheet: 'Beast Snagga Boyz', models: 20, pts: 210 },
      ],
    };

    const chk10 = embarkCheck(list, orkFaction, 'u-bsb10', 'u-kill');
    expect(chk10.why).toBeNull();
    expect(chk10.need).toBe(10);

    const chk20 = embarkCheck(list, orkFaction, 'u-bsb20', 'u-kill');
    expect(chk20.why).toMatch(/Full/i);
    expect(chk20.full).toBe(true);
  });

  it('Trukk: respects Ghazghkull and Jump Pack exclusion, allows Mega Armour (space 2)', () => {
    const list: ArmyList = {
      name: 'Trukk Test',
      factionId: 'ORK',
      battleSize: 'incursion',
      detachments: ['War Horde'],
      units: [
        { uid: 'u-trukk', datasheet: 'Trukk', models: 1, pts: 65 },
        { uid: 'u-ghaz', datasheet: 'Ghazghkull Thraka', models: 2, pts: 235 },
        { uid: 'u-storm', datasheet: 'Stormboyz', models: 5, pts: 65 },
        { uid: 'u-meganobz', datasheet: 'Meganobz', models: 3, pts: 105 },
      ],
    };

    const chkGhaz = embarkCheck(list, orkFaction, 'u-ghaz', 'u-trukk');
    expect(chkGhaz.why).toMatch(/Cannot carry/i);

    const chkStorm = embarkCheck(list, orkFaction, 'u-storm', 'u-trukk');
    expect(chkStorm.why).toMatch(/Cannot carry/i);

    const chkMega = embarkCheck(list, orkFaction, 'u-meganobz', 'u-trukk');
    expect(chkMega.why).toBeNull();
    expect(chkMega.need).toBe(6); // 3 models * 2 space each
  });
});
