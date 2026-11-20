// The slow group the everyday run leaves out (vite.config.ts): whole bot-vs-bot games, the simulations, and the bot
// tools' entry point (tune.test.ts, started by scripts/elo.mjs and scripts/tune.mjs). `npm run test:slow`.
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vite.config.ts';

const slow = ['**/*Games*.test.ts', '**/sim.test.ts', '**/autoPlay.test.ts', '**/botLook.test.ts', '**/tune.test.ts', '**/arena.test.ts'];

export default defineConfig(async (env) => {
  const b = typeof base === 'function' ? await base(env) : base;
  return mergeConfig({ ...b, test: { ...b.test, exclude: ['**/node_modules/**', '**/dist/**'] } }, { test: { include: slow.map((p) => `src/${p}`), testTimeout: 600000 } });
});
