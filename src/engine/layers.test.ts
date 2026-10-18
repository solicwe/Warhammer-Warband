// The core engine does not import faction modules: factions register through events.ts / combatMods.ts in
// factionHooks.ts, so adding one never means editing the core.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const CORE = ['game', 'attack', 'effects', 'activations', 'stratagems', 'detachments', 'state', 'visibility', 'pathing', 'missions', 'secondaries', 'army', 'events', 'combatMods'];
const FACTIONS = ['admech', 'aeldari', 'blessings', 'cult', 'daemons', 'darkPacts', 'deathGuard', 'drukhari', 'emperorsChildren', 'flow', 'greyKnights', 'knights', 'necrons', 'rituals', 'sororitas', 'tau', 'tyranids', 'votann'];

describe('engine layers', () => {
  it('core files import no faction module', () => {
    const bad: string[] = [];
    for (const f of CORE) {
      const src = fs.readFileSync(`src/engine/${f}.ts`, 'utf8');
      for (const m of src.matchAll(/^import[^;]*from '\.\/([A-Za-z]+)'/gm)) if (FACTIONS.includes(m[1])) bad.push(`${f}.ts imports ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it('every faction module is registered in factionHooks.ts or loaded by the game', () => {
    const hooks = fs.readFileSync('src/engine/factionHooks.ts', 'utf8');
    const game = fs.readFileSync('src/engine/game.ts', 'utf8');
    const missing = FACTIONS.filter((m) => !hooks.includes(`from './${m}'`) && !game.includes(`import './${m}'`));
    expect(missing).toEqual([]);
  });
});
