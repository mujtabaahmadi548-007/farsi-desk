import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// `base: './'` makes every asset URL relative, so the same build works at
// https://<user>.github.io/<any-repo-name>/ without further configuration.
export default defineConfig({
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
