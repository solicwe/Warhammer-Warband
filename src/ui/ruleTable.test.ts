import { expect, it } from 'vitest';
import { phasesOf, stratRows } from './RuleTable';

it('reads the phase from the stratagem field, else from the rule text', () => {
  expect(phasesOf('Shooting phase or Fight phase')).toEqual(['shooting', 'fight']);
  expect(phasesOf('Any phase')).toEqual(['any']);
  expect(phasesOf(undefined, 'WHEN: Your Charge phase, just after a unit makes a Charge move. TARGET: x EFFECT: y')).toEqual(['charge']);
  expect(phasesOf(undefined, "This model's melee attacks have +1 A.")).toEqual(['fight']);
  expect(phasesOf(undefined, 'This model has a 2+ Sv.')).toEqual([]);
});

it('splits a stratagem into WHEN / TARGET / EFFECT rows', () => {
  expect(stratRows('WHEN: Your Command phase.\nTARGET: One unit.\nEFFECT: It gets +1.').map((r) => r.label)).toEqual(['WHEN', 'TARGET', 'EFFECT']);
  expect(stratRows('Re-roll 1 die')).toEqual([{ label: '', text: 'Re-roll 1 die' }]);
});
