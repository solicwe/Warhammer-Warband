import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RuleText } from './RuleText';

it('Nurgle’s Gift: CONTAGION RANGE / AFFLICTED are boxed sections, the Plagues boxed options under AFFLICTED', () => {
  const dg = JSON.parse(fs.readFileSync('public/data/factions/DG.json', 'utf8'));
  expect(dg.armyRules.map((r: { name: string }) => r.name)).not.toContain('Oath of Moment');
  const html = renderToStaticMarkup(<RuleText text={dg.armyRules.find((r: { name: string }) => r.name.startsWith('Nurgle')).text} />);
  expect(html.match(/rt-box-head/g)?.length).toBe(2);
  expect(html.match(/rt-opt-head/g)?.length).toBe(3);
  expect(html.indexOf('AFFLICTED')).toBeLessThan(html.indexOf('Skullsquirm'));
});

it('Voice of Command: renders intro paragraphs and all 6 orders as option boxes', () => {
  const am = JSON.parse(fs.readFileSync('public/data/factions/AM.json', 'utf8'));
  const html = renderToStaticMarkup(<RuleText text={am.armyRules.find((r: { name: string }) => r.name === 'Voice of Command').text} />);
  expect(html.match(/rt-opt-head/g)?.length).toBe(6);
  expect(html).toContain('Take Aim!');
  expect(html).toContain('Fix Bayonets!');
  expect(html).toContain('Move! Move! Move!');
  expect(html).toContain('First Rank, Fire! Second Rank, Fire!');
  expect(html).toContain('Take Cover!');
  expect(html).toContain('Duty and Honour!');
  // Should NOT have stray M, WS, BS headers as option titles
  expect(html).not.toContain('<div class="rt-opt-head">M</div>');
  expect(html).not.toContain('<div class="rt-opt-head">WS</div>');
  // Intro text should be present
  expect(html).toContain('models with this ability can issue Orders');
});

it('Imperial Agents army rules: Assigned Agents renders table and Kill Team renders Designer Note', () => {
  const aoi = JSON.parse(fs.readFileSync('public/data/factions/AoI.json', 'utf8'));
  const assigned = aoi.armyRules.find((r: { name: string }) => r.name === 'Assigned Agents');
  const killTeam = aoi.armyRules.find((r: { name: string }) => r.name === 'Kill Team');
  expect(assigned).toBeDefined();
  expect(killTeam).toBeDefined();

  const assignedHtml = renderToStaticMarkup(<RuleText text={assigned.text} />);
  expect(assignedHtml).toContain('rt-table');
  expect(assignedHtml).toContain('Incursion');

  const killTeamHtml = renderToStaticMarkup(<RuleText text={killTeam.text} />);
  expect(killTeamHtml).toContain('rt-note');
  expect(killTeamHtml).toContain("Designer’s Note");
});

it('chapterRules preserves Imperial Agents army rules in ArmyBuilder', async () => {
  const { chapterRules } = await import('../engine/army');
  const aoi = JSON.parse(fs.readFileSync('public/data/factions/AoI.json', 'utf8'));
  const visibleRules = chapterRules(aoi.armyRules, undefined);
  expect(visibleRules.map((r: { name: string }) => r.name)).toEqual(['Assigned Agents', 'Kill Team']);
});


it('Cabal of Sorcerers: each Ritual in its own box with its Warp Charge beside the name', () => {
  const ts = JSON.parse(fs.readFileSync('public/data/factions/TS.json', 'utf8'));
  const html = renderToStaticMarkup(<RuleText text={ts.armyRules.find((r: { name: string }) => r.name === 'Cabal of Sorcerers').text} />);
  expect(html).toContain('Warp Charge 5');
  expect(html).not.toMatch(/rt-box-head"><span>WARP CHARGE/);
  expect(html.indexOf('DESTINY')).toBeLessThan(html.indexOf('Warp Charge 5'));
});
