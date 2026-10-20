/// <reference types="vitest/config" />
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// a fingerprint of the rules data: the page asks for ./data/…?v=<it>, so a browser never keeps last version's files
function dataVersion() {
  const h = crypto.createHash('sha1');
  const dir = path.resolve(__dirname, 'public/data');
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.json')) h.update(fs.readFileSync(p));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return h.digest('hex').slice(0, 10);
}

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __DATA_VERSION__: JSON.stringify(dataVersion()) },
  // whole bot-vs-bot games run in the tests: a few seconds each
  test: { testTimeout: 120000, setupFiles: ['src/engine/testSetup.ts'] },
});
