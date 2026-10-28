import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { preferLanguage, waitForLoginCapacity } from './helpers';

// Cookie de renovación con HTTPS REAL (COOKIE_SECURE=true). Necesita la pila con docker-compose.https.yml (gateway con el puerto 8443 e identity con
// COOKIE_SECURE=true) y corre solo en los proyectos «https-*» (ver playwright.config.ts). El certificado es de la CA de desarrollo, que ningún navegador
// conoce: se acepta con `ignoreHTTPSErrors`, así que lo que se prueba es la cookie y el transporte, no la confianza en la CA.
const here = dirname(fileURLToPath(import.meta.url));
const EMAIL = 'laura.rios@nexus.example';
const cookieOf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'erp_refresh');
const setServerLanguage = () => { execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d identity -Atc "update users set language='en' where email='${EMAIL}'"`, { cwd: join(here, '..', '..'), stdio: 'ignore' }); };

async function signIn(page: Page) {
  setServerLanguage();
  await preferLanguage(page, 'en');
  await waitForLoginCapacity(page.request);
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD ?? 'demo-password-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
}

test('HTTPS: the page really is served over TLS and the renewal cookie is Secure, HttpOnly, SameSite=Strict and only for /auth', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  expect(page.url().startsWith('https://')).toBe(true);
  const c = await cookieOf(page);
  expect(c, 'el servidor puso la cookie por HTTPS').toBeTruthy();
  expect({ secure: c!.secure, httpOnly: c!.httpOnly, sameSite: c!.sameSite, path: c!.path }).toEqual({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/auth' });
  expect(await page.evaluate(() => document.cookie), 'el JavaScript de la página no la ve').not.toContain('erp_refresh');
});

test('HTTPS: with the Secure cookie the app renews itself, the cookie rotates, and the person stays signed in', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const before = await cookieOf(page);
  let renewals = 0;
  page.on('response', (r) => { if (new URL(r.url()).pathname === '/auth/refresh' && r.status() === 200) renewals++; });
  await page.getByText('JWT sample').click();
  await page.getByRole('button', { name: 'Simulate expired token' }).click(); // el token «vence»: la app renueva con la cookie
  await expect.poll(() => renewals, { timeout: 10_000, message: 'renovaciones con respuesta 200 por HTTPS' }).toBe(1);
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  const after = await cookieOf(page);
  expect(after!.secure, 'la cookie nueva también es Secure').toBe(true);
  expect(after!.value, 'la cookie rota en cada renovación').not.toBe(before!.value);
  await page.getByRole('button', { name: 'Invoices', exact: true }).click(); // y el token nuevo abre la API
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
});

test('HTTPS: signing out over TLS revokes the session and clears the Secure cookie', async ({ page, request }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const value = (await cookieOf(page))!.value;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect.poll(() => cookieOf(page), { timeout: 10_000, message: 'el servidor borró la cookie Secure' }).toBeUndefined();
  const replay = await request.post('/auth/refresh', { headers: { 'X-Requested-With': 'erp-web', Cookie: `erp_refresh=${value}` } });
  expect(replay.status(), 'la cookie copiada antes de cerrar sesión ya no sirve').toBe(401);
});
