/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // whole bot-vs-bot games run in the tests: a few seconds each
  test: { testTimeout: 120000, setupFiles: ['src/engine/testSetup.ts'] },
});
