// The faction files stay laid out as scripts/build-data.mjs writes them (2-space JSON, one trailing newline), so a
// rebuild shows only real data changes in git. `npm run data:check` compares the content with a build from data/raw.
import fs from 'node:fs';
import { expect, it } from 'vitest';

it('faction files are laid out as the data build writes them', () => {
  const bad = fs.readdirSync('public/data/factions').filter((f) => {
    const text = fs.readFileSync(`public/data/factions/${f}`, 'utf8');
    return text !== `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  });
  expect(bad).toEqual([]);
});
