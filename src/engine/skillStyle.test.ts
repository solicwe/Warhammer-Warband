// Each kind of ability has its own look (.claude/skills/vfx): the style comes from the army and what the ability does.
import { describe, expect, it } from 'vitest';
import { skillStyle } from './state';
import type { UnitState } from './types';

const unit = (factionKeywords: string[], keywords: string[] = []) => ({ factionKeywords, keywords, models: [] }) as unknown as UnitState;

describe('ability looks', () => {
  it.each([
    [['ADEPTUS ASTARTES'], [], 'Litany of Faith', 'holy'],
    [['ADEPTUS ASTARTES'], [], 'Rites of Battle', 'command'],
    [['ADEPTUS ASTARTES'], ['PSYKER'], 'Veil of Time', 'psychic'],
    [['HERETIC ASTARTES'], [], 'Dark Pact', 'chaos'],
    [['WORLD EATERS', 'KHORNE'], [], 'Berzerker Frenzy', 'fury'],
    [['ORKS'], [], 'Waaagh!', 'waaagh'],
    [['ADEPTUS MECHANICUS'], [], 'Canticles', 'tech'],
    [['DEATH GUARD', 'NURGLE'], [], 'Nurgle’s Gift', 'plague'],
    [['NECRONS'], [], 'Reanimation Protocols', 'necron'],
  ] as const)('%s %s %s: %s', (fk, kw, name, style) => expect(skillStyle(unit([...fk], [...kw]), name)).toBe(style));

  it('a defensive ability is a shield, whoever uses it', () => expect(skillStyle(unit(['ORKS']), 'Kustom Force Field', true)).toBe('shield'));
});
