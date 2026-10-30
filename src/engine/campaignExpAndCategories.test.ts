import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  newRun,
  recruitUnit,
  type Run,
} from './campaign';
import { autoList } from './autoList';
import { KINDS, unitKind } from '../ui/ArmyBuilder';
import type { FactionData, ArmyList } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync('public/data/factions/' + id + '.json', 'utf8')) as FactionData;
const SM = load('SM');

describe('Campaign Exp Requirements & Character Categorization Audit', () => {
  describe('1. Character & Epic Hero Categorization', () => {
    it('lists Epic Heroes with the other Characters (unitKind)', () => {
      expect(KINDS[0]).toBe('Character');

      const guilliman = SM.datasheets.find((d) => d.name === 'Roboute Guilliman');
      if (guilliman) {
        expect(unitKind(guilliman)).toBe('Character');
        expect(guilliman.keywords).toContain('EPIC HERO');
      }

      const captain = SM.datasheets.find((d) => d.name === 'Captain');
      if (captain) {
        expect(unitKind(captain)).toBe('Character');
        expect(captain.keywords).toContain('CHARACTER');
        expect(captain.keywords).not.toContain('EPIC HERO');
      }

      const intercessors = SM.datasheets.find((d) => d.name === 'Intercessor Squad');
      if (intercessors) {
        expect(unitKind(intercessors)).toBe('Infantry');
      }
    });
  });

});
