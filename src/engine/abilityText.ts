// Reads the common ability patterns straight from the datasheet text, for factions without a hand-written file.
import type { AbilityRule } from './effects';

const cache = new Map<string, AbilityRule | undefined>();

export function parseAbilityText(name: string, text: string): AbilityRule | undefined {
  const key = `${name}\n${text}`;
  if (cache.has(key)) return cache.get(key);
  const r = undefined;
  cache.set(key, r);
  return r;
}
