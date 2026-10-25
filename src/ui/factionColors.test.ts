import { describe, expect, it } from 'vitest';
import { getFactionTheme, readableOnDark } from './factionColors';
import { armyColor } from './Sheet';

const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (hex: string) => (lum(hex) + 0.05) / (lum('#0e1013') + 0.05);

describe('faction colours on the dark UI', () => {
  it('lifts a dark colour to readable and leaves a bright one alone', () => {
    expect(contrast(readableOnDark('#1b3768'))).toBeGreaterThanOrEqual(4.5);
    expect(readableOnDark('#fde68a')).toBe('#fde68a');
  });
  it('every army and chapter colour used for text reads on the dark background', () => {
    const subs = ['ULTRAMARINES', 'BLACK TEMPLARS', 'IRON HANDS', 'RAVEN GUARD', 'DARK ANGELS', 'BLOOD ANGELS'];
    const ids = ['SM', 'ORK', 'CSM', 'DG', 'TS', 'WE', 'EC', 'CD', 'AE', 'DRU', 'NEC', 'TYR', 'GC', 'TAU', 'LoV', 'AM', 'AS', 'AdM', 'GK', 'AoI', 'QI', 'QT', 'AC'];
    for (const id of ids) for (const t of [getFactionTheme(id), getFactionTheme(id, undefined, true)]) {
      expect(contrast(t.primary), `${id} ${t.primary}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.secondary), `${id} ${t.secondary}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(armyColor(id)), id).toBeGreaterThanOrEqual(4.5);
    }
    for (const sub of subs) {
      expect(contrast(getFactionTheme('SM', sub).primary), sub).toBeGreaterThanOrEqual(4.5);
      expect(contrast(armyColor('SM', sub)), sub).toBeGreaterThanOrEqual(4.5);
    }
  });
});
