import { expect, it } from 'vitest';
import { blessingPicks } from '../factions/blessings';
import { findBlessingPick } from './Blessings';

it('matches individual Blessing selections regardless of selection order and rejects unpayable pairs', () => {
  const picks = blessingPicks([1, 2, 2, 2, 3, 4, 6, 6], 2);

  expect(findBlessingPick(picks, ['warp', 'decap'])?.ids.sort()).toEqual(['decap', 'warp']);
  expect(findBlessingPick(picks, ['decap', 'warp', 'bloodlust'])).toBeUndefined();
  expect(findBlessingPick(picks, ['decap'])?.ids).toEqual(['decap']);
});
