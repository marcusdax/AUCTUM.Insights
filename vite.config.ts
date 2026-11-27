import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          maplibre: ['maplibre-gl'],
          leaflet: ['leaflet'],
        },
      },
    },
  },
});
