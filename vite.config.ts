import { defineConfig } from 'vite';

// Project site lives at https://soap2yadome.github.io/HandSketch/
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? (process.env.BASE_PATH ?? '/HandSketch/') : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
