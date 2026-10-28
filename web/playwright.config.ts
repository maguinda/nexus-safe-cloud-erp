import { defineConfig, devices } from '@playwright/test';

// Requiere la pila arriba (docker compose up -d --build) y el gateway en :8080.
// Los proyectos "functional" escriben datos de demostración; los "audit" NUNCA escriben (se bloquean las peticiones).
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8080', trace: 'retain-on-failure' },
  projects: [
    { name: 'functional-chromium', testMatch: /functional\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'functional-webkit', testMatch: /functional\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    // Cookie `Secure` con HTTPS real: necesitan la pila con docker-compose.https.yml (puerto 8443) y COOKIE_SECURE=true. Solo existen con HTTPS_TESTS=1
    // (`npm run test:e2e:https`): en una corrida normal fallarían, porque la pila normal no tiene ese puerto.
    ...(process.env.HTTPS_TESTS === '1' ? [
      { name: 'https-chromium', testMatch: /https\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'https://localhost:8443', ignoreHTTPSErrors: true } },
      { name: 'https-webkit', testMatch: /https\.spec\.ts/, use: { ...devices['Desktop Safari'], baseURL: 'https://localhost:8443', ignoreHTTPSErrors: true } },
    ] : []),
    { name: 'audit-chromium-desktop', testMatch: /audit\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'audit-webkit-desktop', testMatch: /audit\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    { name: 'audit-iphone-se', testMatch: /audit\.spec\.ts/, use: { ...devices['iPhone SE'] } },
    { name: 'audit-iphone-13', testMatch: /audit\.spec\.ts/, use: { ...devices['iPhone 13'] } },
    { name: 'audit-pixel-5', testMatch: /audit\.spec\.ts/, use: { ...devices['Pixel 5'] } },
    { name: 'audit-320-chromium', testMatch: /audit\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } } },
  ],
});
