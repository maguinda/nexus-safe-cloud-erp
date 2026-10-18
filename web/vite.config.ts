import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// En desarrollo, las llamadas a la API van al gateway (docker compose up); en producción las sirve el mismo origen.
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/auth': GATEWAY, '/projects': GATEWAY, '/milestones': GATEWAY, '/invoices': GATEWAY } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], css: false },
});
