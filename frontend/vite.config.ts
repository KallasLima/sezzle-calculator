import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const localServer = {
  host: '127.0.0.1',
  port: 5173,
  strictPort: true,
  proxy: { '/api': 'http://127.0.0.1:8080' },
};

export default defineConfig({
  plugins: [react()],
  server: localServer,
  preview: localServer,
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
    },
  },
});
