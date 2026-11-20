import { expect, it } from 'vitest';
import { ext } from './state';

it('ext keeps one rule\'s own state under its name and survives a clone', () => {
  const u: { ext?: Record<string, unknown> } = {};
  ext(u, 'Blood Tithe', () => ({ points: 0 })).points += 2;
  expect(ext(u, 'Blood Tithe', () => ({ points: 0 })).points).toBe(2);
  const copy = structuredClone(u);
  expect(ext(copy, 'Blood Tithe', () => ({ points: 0 })).points).toBe(2);
});
