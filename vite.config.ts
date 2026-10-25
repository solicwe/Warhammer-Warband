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

// Content Security Policy of the built site: our own files and Google Fonts.
// Build only: the dev server's hot reload injects inline scripts. An absolute VITE_IMAGE_BASE host is allowed too.
function csp(): string {
  const imageHost = /^https?:\/\//.test(process.env.VITE_IMAGE_BASE ?? '') ? new URL(process.env.VITE_IMAGE_BASE!).origin : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${imageHost}`.trim(),
    `connect-src 'self' data: blob: ${imageHost}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp()}" />`),
  }],
  define: { __DATA_VERSION__: JSON.stringify(dataVersion()) },
  // whole bot-vs-bot games run in the tests: a few seconds each
  test: { testTimeout: 120000, setupFiles: ['src/engine/testSetup.ts'] },
});
