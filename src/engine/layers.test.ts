// The layers depend one way: ui -> ai -> factions -> rules-engine -> engine. Factions register through
// src/engine/events.ts and combatMods.ts (src/factions/index.ts), so the core never imports a faction or the bot.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const files = (dir: string) => fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.') && f !== 'testSetup.ts').map((f) => `${dir}/${f}`);
const importsOf = (file: string) => [...fs.readFileSync(file, 'utf8').matchAll(/^import(?:[^;]*?from)? '(\.[^']+)'/gm)].map((m) => path.normalize(path.join(path.dirname(file), m[1])));

describe('engine layers', () => {
  it('engine and rules-engine import no faction module and no bot code', () => {
    const bad: string[] = [];
    for (const f of [...files('src/engine'), ...files('src/rules-engine')]) {
      for (const dep of importsOf(f)) {
        // game.ts is the one place that loads the faction registry
        if (f === 'src/engine/game.ts' && dep === 'src/factions/index') continue;
        if (dep.startsWith('src/factions') || dep.startsWith('src/ai') || dep.startsWith('src/ui')) bad.push(`${f} imports ${dep}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('faction modules do not import bot code', () => {
    const bad = files('src/factions').flatMap((f) => importsOf(f).filter((d) => d.startsWith('src/ai') || d.startsWith('src/ui')).map((d) => `${f} imports ${d}`));
    expect(bad).toEqual([]);
  });

  it('every faction module is registered in src/factions/index.ts', () => {
    const index = fs.readFileSync('src/factions/index.ts', 'utf8');
    const missing = files('src/factions').map((f) => path.basename(f, '.ts')).filter((m) => m !== 'index' && !index.includes(`from './${m}'`) && !index.includes(`import './${m}'`));
    expect(missing).toEqual([]);
  });
});
