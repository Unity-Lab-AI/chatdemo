import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  envPrefix: ['VITE_', 'POLLI_', 'POLLINATIONS_'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
});
