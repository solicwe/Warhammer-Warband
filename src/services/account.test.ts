// A save file (or a Google Drive backup) is checked whole before anything is written to this device.
import { expect, it } from 'vitest';
import { parseSave } from './account';
import { KEYS } from './storage';

const save = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind: 'warhammer-warband-save', version: 1, savedAt: 5, data, ...extra });
const army = { name: 'Ultramarines', factionId: 'SM', battleSize: 'strike-force', detachments: [], units: [] };

it('accepts a real save and refuses anything else', () => {
  const ok = parseSave(save({ [KEYS.armies]: JSON.stringify([army]), [KEYS.sound]: '1' }));
  expect(ok?.data[KEYS.armies]).toContain('Ultramarines');
  expect(ok?.savedAt).toBe(5);

  expect(parseSave('not json')).toBeNull();
  expect(parseSave(save({}, { kind: 'something-else' }))).toBeNull();
  expect(parseSave(save({ 'some-other-key': 'x' }))).toBeNull(); // only the app's own keys
  expect(parseSave(save({ [KEYS.armies]: 42 }))).toBeNull(); // values are text
  expect(parseSave(save({ [KEYS.armies]: '{oops' }))).toBeNull(); // and readable
  expect(parseSave(save({ [KEYS.armies]: JSON.stringify([{ name: 1, units: [] }]) }))).toBeNull(); // armies look like armies
  expect(parseSave(save({ [KEYS.game]: '"a string, not a game"' }))).toBeNull();
});
