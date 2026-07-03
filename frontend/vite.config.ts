import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('zrender')) {
            return 'zrender';
          }

          if (id.includes('echarts')) {
            return 'echarts-core';
          }

          if (id.includes('react') || id.includes('react-dom')) {
            return 'react-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
});
