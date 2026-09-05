import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    // Avoid stale optimized-deps 504 during long HMR sessions after dependency graph changes.
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/pages/WorkspacePage.tsx',
        './src/components/charts/ChartBoard.tsx',
      ],
    },
  },
  optimizeDeps: {
    // Prebundle echarts as a single graph so partial HMR invalidation doesn't 504 mid-session.
    include: [
      'echarts',
      'echarts/core',
      'echarts/charts',
      'echarts/components',
      'echarts/renderers',
      'zrender',
      'react',
      'react-dom',
      'react-router-dom',
    ],
    // Keep the dep optimizer from serving half-updated entries after file thrash.
    holdUntilCrawlEnd: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('zrender') || id.includes('echarts')) {
            return 'echarts-vendor';
          }

          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
            return 'react-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
});
