import { defineConfig } from 'vite';

export default defineConfig({
  base: '/crystalfreeze/',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  assetsInclude: ['**/*.glsl', '**/*.vert', '**/*.frag'],
});
