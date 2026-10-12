import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RuleText } from './RuleText';

it('Nurgle’s Gift: CONTAGION RANGE / AFFLICTED are section titles, the Plagues boxed options under AFFLICTED', () => {
  const dg = JSON.parse(fs.readFileSync('public/data/factions/DG.json', 'utf8'));
  expect(dg.armyRules.map((r: { name: string }) => r.name)).not.toContain('Oath of Moment');
  const html = renderToStaticMarkup(<RuleText text={dg.armyRules.find((r: { name: string }) => r.name.startsWith('Nurgle')).text} />);
  expect(html.match(/rt-sec/g)?.length).toBe(2);
  expect(html.match(/rt-opt-head/g)?.length).toBe(3);
  expect(html.indexOf('AFFLICTED')).toBeLessThan(html.indexOf('Skullsquirm'));
});
