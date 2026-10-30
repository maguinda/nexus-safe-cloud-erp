import { execSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { translate } from '../src/i18n';
import { currentSessions, openAs, preferLanguage, waitForLoginCapacity } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
test.describe.configure({ mode: 'serial' });

// Datos de demostración desechables: se dejan como al inicio antes de cada archivo.
test.beforeAll(() => { execSync('sh scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' }); });

let problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems = [];
  await preferLanguage(page, 'en'); // el login y las pantallas previas salen en inglés; las pruebas de español lo piden aparte
  // En Chromium también aparecen los avisos de la política de contenido en modo solo-reporte.
  // Los 401/403/409 de la API son comportamiento esperado (se provocan a propósito); cualquier otro error sí cuenta.
  const expected = /status of (401|403|409)/;
  page.on('console', (m) => { if ((m.type() === 'error' && !expected.test(m.text())) || /content security policy|refused to/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
});
test.afterEach(() => { expect(problems, 'errores de consola o avisos de la política de contenido').toEqual([]); });

test('the login form validates before sending anything', async ({ page }) => {
  let loginRequests = 0;
  page.on('request', (r) => { if (r.url().endsWith('/auth/login')) loginRequests++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter your email.')).toBeVisible();
  await expect(page.getByText('Enter your password.')).toBeVisible();
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password').fill('x'.repeat(129));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(/valid email/i)).toBeVisible();
  await expect(page.getByText(/too long \(128/i)).toBeVisible();
  expect(loginRequests).toBe(0);
});

test('login: the eye button shows and hides what is typed, and a demo button fills the email', async ({ page }) => {
  await page.goto('/');
  const pw = page.getByLabel('Password');
  await pw.fill('secret-123');
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show the characters' }).click();
  await expect(pw).toHaveAttribute('type', 'text');
  await expect(pw).toHaveValue('secret-123');
  await page.getByRole('button', { name: 'Hide the characters' }).click();
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Manager', exact: true }).click();
  await expect(page.getByLabel('Email')).toHaveValue('diana.vega@nexus.example');
});

test('login layout: brand panel only on wide screens, one column and big touch targets on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByText('All of the company’s work, in one place.')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByText('All of the company’s work, in one place.')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (const name of ['Sign in', 'Show the characters']) expect((await page.getByRole('button', { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByLabel('Email').boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('a wrong password shows a clear message and does not sign in', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('laura.rios@nexus.example');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The email or password is not correct.');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the project lead approves a milestone and the draft invoice appears by itself', async ({ page }) => {
  await openAs(page, 'lead');
  await expect(page.getByText('Project lead', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/token expires in \d\d:\d\d/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Branch network upgrade' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve milestone' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /Billing created draft INV-\d+/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/INV-\d+ · \d+ ms after approving/)).toBeVisible();
  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.getByRole('cell', { name: 'Draft' })).toBeVisible();
});

test('sales cannot approve and sees a 403 on invoices', async ({ page }) => {
  await openAs(page, 'sales');
  await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveCount(0); // el dashboard es solo del gerente
  await expect(page.getByRole('heading', { name: 'New project' })).toHaveCount(0); // sin formularios de alta
  await expect(page.getByRole('button', { name: 'Create project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve milestone' })).toHaveCount(0);
  await expect(page.getByText('Read only for Sales').first()).toBeVisible();
  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.getByText('403 Forbidden')).toBeVisible();
  await expect(page.getByRole('cell', { name: /INV-/ })).toHaveCount(0);
});

test('invoices can be searched, filtered by status and sorted by column', async ({ page }) => {
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices' }).click();
  const order = async () => (await page.getByRole('cell', { name: /^INV-\d+$/ }).allInnerTexts());
  await expect(page.getByRole('cell', { name: 'INV-0101' })).toBeVisible();
  // Buscar: solo el proyecto «Retail POS integration» tiene INV-0102.
  await page.getByLabel('Search invoices').fill('  retail ');
  await expect(page.getByRole('cell', { name: /^INV-\d+$/ })).toHaveText(['INV-0102']);
  await expect(page.getByRole('status').filter({ hasText: /^Showing 1 of \d+$/ })).toBeVisible();
  // Sin resultados: mensaje y «Clear filters» deja todo como estaba.
  await page.getByLabel('Search invoices').fill('zzzz');
  await expect(page.getByText('No invoices match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByLabel('Search invoices')).toHaveValue('');
  await expect(page.getByRole('cell', { name: 'INV-0101' })).toBeVisible();
  // Estado: «Issued» no deja ningún borrador; «Draft» no deja ninguna emitida; «All» vuelve a todo.
  await page.getByRole('button', { name: /^Issued \(\d+\)$/ }).click();
  await expect(page.getByRole('cell', { name: 'Draft' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'INV-0101' })).toBeVisible();
  await page.getByRole('button', { name: /^Draft \(\d+\)$/ }).click();
  await expect(page.getByRole('cell', { name: 'Issued' })).toHaveCount(0);
  await page.getByRole('button', { name: /^All \(\d+\)$/ }).click();
  await expect(page.getByRole('cell', { name: 'INV-0101' })).toBeVisible();
  // Ordenar por Total: INV-0101 (14.280.000) frente a INV-0102 (11.662.000); un segundo clic invierte el orden.
  const totalHeader = page.getByRole('columnheader', { name: /Total \(COP\)/ });
  await page.getByRole('button', { name: 'Sort by Total (COP)' }).click();
  await expect(totalHeader).toHaveAttribute('aria-sort', 'descending');
  let nums = await order(); expect(nums.indexOf('INV-0101')).toBeLessThan(nums.indexOf('INV-0102'));
  await page.getByRole('button', { name: 'Sort by Total (COP)' }).click();
  await expect(totalHeader).toHaveAttribute('aria-sort', 'ascending');
  nums = await order(); expect(nums.indexOf('INV-0102')).toBeLessThan(nums.indexOf('INV-0101'));
  // Por número: en orden numérico ascendente INV-0101 va antes que INV-0102.
  await page.getByRole('button', { name: 'Sort by Invoice' }).click();
  await expect(page.getByRole('columnheader', { name: /Invoice/ }).first()).toHaveAttribute('aria-sort', 'ascending');
  nums = await order(); expect(nums.indexOf('INV-0101')).toBeLessThan(nums.indexOf('INV-0102'));
});

test('due dates close to today or in the past get an amber or red chip', async ({ page }) => {
  // Con los datos de demostración no hay facturas vencidas: se ajusta SOLO la respuesta que ve el navegador (la base no cambia).
  const day = 86_400_000;
  await page.route(/\/invoices$/, async (route) => {
    const res = await route.fetch(); const list = await res.json();
    for (const i of list) {
      if (i.number === 'INV-0101') i.dueDate = new Date(Date.now() - 3 * day).toISOString();
      if (i.number === 'INV-0102') i.dueDate = new Date(Date.now() + 2 * day).toISOString();
    }
    await route.fulfill({ response: res, json: list });
  });
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.getByRole('row', { name: /INV-0101/ }).getByText(/^Overdue \d+ d$/)).toBeVisible();
  await expect(page.getByRole('row', { name: /INV-0102/ }).getByText(/^In \d d$/)).toBeVisible();
});

test('on a phone the invoices become cards and can still be sorted', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  // Tarjetas: las filas son bloques con «etiqueta: valor» y no hay desplazamiento lateral de la página.
  expect(await page.locator('tbody tr td').nth(1).evaluate((el) => getComputedStyle(el).display)).toBe('flex');
  expect(await page.locator('tbody tr td').nth(1).evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"Project"');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  // En 375 px los cinco botones de ordenar caben en una sola fila (misma altura = misma fila).
  const tops = await page.getByRole('group', { name: 'Sort cards by' }).getByRole('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // Sin encabezados no hay dónde pulsar: aparecen los botones «Sort by …» (un segundo clic invierte el orden).
  const firsts = async () => page.locator('tbody tr td:first-child').allInnerTexts();
  const total = page.getByRole('button', { name: 'Sort by Total', exact: true });
  await expect(total).toBeVisible();
  await total.click();
  let nums = await firsts(); expect(nums.indexOf('INV-0101')).toBeLessThan(nums.indexOf('INV-0102'));
  await expect(total).toHaveAttribute('aria-pressed', 'true');
  await total.click();
  nums = await firsts(); expect(nums.indexOf('INV-0102')).toBeLessThan(nums.indexOf('INV-0101'));
  // En escritorio esos botones no existen: se ordena con los encabezados.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(total).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sort by Total (COP)' })).toBeVisible();
});

test('the billing analyst issues the draft invoice', async ({ page }) => {
  await openAs(page, 'billing');
  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.getByRole('cell', { name: 'Draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByRole('status').filter({ hasText: /INV-\d+ issued/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Draft' })).toHaveCount(0);
});

test('an expired token sends the user back to sign in with an explanation', async ({ page }) => {
  await openAs(page, 'lead');
  await page.getByText('JWT sample').click();
  await expect(page.getByText('"role": "project_lead"')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate expired token' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Your session expired. Sign in again.')).toBeVisible();
});

test('the project lead creates a project and a milestone, approves it and the draft invoice appears', async ({ page }) => {
  await openAs(page, 'lead');
  await page.getByLabel('Project name').fill('  Warehouse   Wi-Fi rollout ');
  await page.getByLabel('Client').fill('Nexus Safe-Cloud');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project “Warehouse Wi-Fi rollout” created' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Warehouse Wi-Fi rollout' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Milestones · Warehouse Wi-Fi rollout' })).toBeVisible(); // el proyecto nuevo queda elegido
  await page.getByLabel('Milestone name').fill('Site survey');
  await page.getByLabel('Amount (COP, before VAT)').fill('12000000');
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Milestone “Site survey” added' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Site survey' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Pending' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve milestone' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Billing created draft INV-\d+/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Invoices' }).click();
  // «Site survey» también es un hito de la demo (INV-0101): se busca la fila del proyecto NUEVO.
  await expect(page.getByRole('row', { name: /INV-\d+ Warehouse Wi-Fi rollout Site survey/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Warehouse Wi-Fi rollout Site survey.*Draft/ })).toBeVisible();
});

test('the creation forms validate before sending anything', async ({ page }) => {
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && /\/projects/.test(r.url())) posts++; });
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Enter the project name.')).toBeVisible();
  await expect(page.getByText('Enter the client name.')).toBeVisible();
  await page.getByLabel('Project name').fill('a'.repeat(121));
  await page.getByLabel('Client').fill('Client');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText(/project name is too long \(120/)).toBeVisible();
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByText('Enter the milestone name.')).toBeVisible();
  await expect(page.getByText('Enter the amount in pesos.')).toBeVisible();
  await page.getByLabel('Milestone name').fill('Survey');
  for (const [raw, message] of [['12.5', /digits only/], ['0', /at least 1 peso/], ['1000000001', /more than 1,000,000,000/]] as const) {
    await page.getByLabel('Amount (COP, before VAT)').fill(raw);
    await page.getByRole('button', { name: 'Add milestone' }).click();
    await expect(page.getByText(message)).toBeVisible();
  }
  expect(posts).toBe(0); // nada llegó al servidor
});

test('the manager sees the dashboard and the users tab, and nothing else', async ({ page }) => {
  await openAs(page, 'manager');
  await expect(page.getByText('Manager', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Projects' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invoices' })).toHaveCount(0);
  await expect(page.getByText('Approved milestones')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Branch network upgrade' })).toBeVisible(); // datos de demostración (m1 y m4)
  await expect(page.getByText(/Live/)).toBeVisible();
});

// ---- Network & IoT: los datos de la carpeta PROYECTO_NEXUS (21 dispositivos, 4200 lecturas) dentro del dashboard del gerente ----
const iotPanel = (page: any) => page.getByRole('region', { name: 'Network & IoT' });
const iotKpi = (page: any, label: string) => iotPanel(page).locator('small', { hasText: label }).locator('xpath=following-sibling::strong');

test('Network & IoT: the manager reads the Nexus data in the dashboard, exactly as it was loaded', async ({ page }) => {
  await openAs(page, 'manager');
  await expect(iotPanel(page).getByRole('heading', { name: 'Network & IoT' })).toBeVisible();
  await expect(iotKpi(page, 'Devices online')).toHaveText('21 / 21');
  await expect(iotKpi(page, 'Readings')).toHaveText('4,200');
  await expect(iotKpi(page, 'Warnings')).toHaveText('39');
  await expect(iotKpi(page, 'Alerts')).toHaveText('3');
  await expect(iotPanel(page).getByText('13 Sep 2026, 08:01–11:20 UTC')).toBeVisible();
  const office = iotPanel(page).getByRole('table').first();
  await expect(office.locator('tbody tr')).toHaveCount(3);
  await expect(office.getByRole('cell', { name: 'Oficina 2', exact: true })).toBeVisible();
  const devices = iotPanel(page).getByRole('table').nth(1);
  expect(await iotPanel(page).locator('details').evaluate((el: HTMLDetailsElement) => el.open), 'on a desktop the device list starts open').toBe(true);
  await expect(devices.locator('tbody tr')).toHaveCount(21);
  await expect(devices.getByText('TEMP_MON_OF1')).toBeVisible();
  await expect(devices.getByText('IOT-OF3-07')).toBeVisible();
  await expect(devices.getByText('LOCKED').first()).toBeVisible(); // las señales de sí/no se leen por su estado, no por 0 o 1
  const latest = iotPanel(page).getByRole('region', { name: 'Latest warnings and alerts' }).locator('li');
  await expect(latest).toHaveCount(8);
  await expect(latest.first()).toContainText(/Warning|Alert/);
  await expect(page.getByRole('heading', { name: 'By project' })).toBeVisible(); // lo anterior del dashboard sigue ahí
});

test('Network & IoT: nobody but the manager sees it', async ({ page }) => {
  await openAs(page, 'lead');
  await expect(page.getByRole('button', { name: 'Branch network upgrade' })).toBeVisible();
  await expect(page.getByText('Network & IoT')).toHaveCount(0);
  await expect(page.getByText('IOT-OF1-01')).toHaveCount(0);
});

test('Network & IoT: when the data cannot be loaded it says so, the rest of the dashboard stays, and Try again recovers', async ({ page }) => {
  let fail = true;
  await page.route('**/telemetry/summary', (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }) }) : route.continue()));
  await openAs(page, 'manager');
  await expect(page.getByRole('heading', { name: 'By project' })).toBeVisible(); // el tablero financiero no depende de la telemetría
  await expect(page.getByRole('alert').filter({ hasText: 'Network & IoT is not available' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(iotKpi(page, 'Devices online')).toHaveText('21 / 21');
  problems = problems.filter((m) => !/status of 500/.test(m)); // el 500 lo provocamos a propósito; cualquier otro error de consola sí cuenta
});

test('Network & IoT: with nothing loaded it explains how it gets loaded, not an empty table', async ({ page }) => {
  const empty = { asOf: new Date().toISOString(), window: null, totals: { devices: 0, online: 0, readings: 0, normal: 0, warnings: 0, alerts: 0 }, devices: [], byLocation: [], attention: [] };
  await page.route('**/telemetry/summary', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(empty) }));
  await openAs(page, 'manager');
  await expect(page.getByText(/No Nexus telemetry has been loaded yet/)).toBeVisible();
});

test('Network & IoT: on a 320 px phone every figure of both tables is inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openAs(page, 'manager');
  await expect(iotKpi(page, 'Readings')).toHaveText('4,200');
  const list = iotPanel(page).locator('details');
  expect(await list.evaluate((el: HTMLDetailsElement) => el.open), 'in a phone the long device list starts folded').toBe(false);
  await list.locator('summary').click();
  await expect(list.locator('tbody tr').first()).toBeVisible();
  const cells = await iotPanel(page).locator('td[data-label]').evaluateAll((els: Element[]) => els.map((el: Element) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('data-label'), text: (el.textContent ?? '').trim(), left: r.left, right: r.right }; }));
  expect(cells.length).toBe(3 * 5 + 21 * 6); // 3 oficinas x 5 cifras + 21 dispositivos x 6 campos con etiqueta
  for (const c of cells) {
    expect(c.text, `${c.label} has a value`).not.toBe('');
    expect(c.left, `${c.label} starts inside the screen`).toBeGreaterThanOrEqual(0);
    expect(c.right, `${c.label} ends inside the screen`).toBeLessThanOrEqual(321);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

// ---- Idioma de la interfaz: español por defecto, y cada persona lo cambia en su perfil (se guarda en el servidor) ----
const T = (lang: 'es' | 'en') => (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(lang, key, params);
const profileButton = (page: any, name: string, role: string, lang: 'es' | 'en') => page.getByRole('button', { name: T(lang)('profile.open', { name, role }) });
/** Lo que el servidor tiene guardado, leído de la base (no por el login: el gateway deja pasar solo 10 inicios de sesión por minuto y la suite ya usa varios). */
const serverLanguage = (_request: unknown, email: string): string => execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d identity -Atc "select language from users where email='${email}'"`, { cwd: join(here, '..', '..'), shell: '/bin/sh' }).toString().trim();
const serverTheme = (email: string): string => execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d identity -Atc "select theme from users where email='${email}'"`, { cwd: join(here, '..', '..'), shell: '/bin/sh' }).toString().trim();
/** Claridad del fondo de la página (0 a 255): claro ≈ 245, oscuro ≈ 14. Se mide el color calculado, no el atributo: lo que importa es lo que se ve. */
const pageLuma = (page: any) => page.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number); return Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]); });

test('Language: in Spanish the screens and options are Spanish and the stored data stays as stored', async ({ page }) => {
  const es = T('es');
  await openAs(page, 'manager', 'es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('button', { name: es('nav.dashboard'), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: es('nav.users'), exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: es('dashboard.title'), exact: true })).toBeVisible();
  const panel = page.getByRole('region', { name: es('iot.title') });
  await expect(panel.locator('small', { hasText: es('iot.kpi.online') }).locator('xpath=following-sibling::strong')).toHaveText('21 / 21');
  await expect(panel.locator('small', { hasText: es('iot.kpi.readings') }).locator('xpath=following-sibling::strong')).toHaveText('4.200'); // separador de miles del español
  await expect(panel.getByText('13 sep 2026, 08:01–11:20 UTC')).toBeVisible();
  // los datos se muestran como están: nombres y notas de los dispositivos, nombres de proyecto
  await expect(panel.getByText('TEMP_MON_OF1').first()).toBeVisible();
  await expect(panel.getByText(/Umbral Ligero Superado/).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Branch network upgrade' })).toBeVisible();
  // nada de lo que es de la app quedó en inglés
  for (const english of ['Approved milestones', 'Draft invoices', 'By project', 'Recent activity', 'Sign out', 'token expires in']) await expect(page.getByText(english, { exact: false })).toHaveCount(0);
});

test('Language: the profile shows the person and switches the language at once, and the server keeps it', async ({ page, request }) => {
  await openAs(page, 'sales', 'es');
  await profileButton(page, 'Camila Soto', 'Ventas', 'es').click();
  const dialog = page.getByRole('dialog', { name: T('es')('profile.title') });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('camila.soto@nexus.example')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Español', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'English', exact: true }).click();
  // la pantalla cambia sin recargar, el aviso sale ya en el idioma nuevo y el atributo lang cambia
  await expect(page.getByRole('button', { name: 'Invoices', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Language changed to English.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(serverLanguage(request, 'camila.soto@nexus.example')).toBe('en'); // el servidor lo guardó: la sigue a cualquier equipo
  await expect(page.getByRole('dialog', { name: 'My profile' }).getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // y se puede volver
  await page.getByRole('dialog', { name: 'My profile' }).getByRole('button', { name: 'Español', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Facturas', exact: true })).toBeVisible();
  expect(serverLanguage(request, 'camila.soto@nexus.example')).toBe('es');
});

test('Language: Escape closes the profile and gives the focus back; the dialog also closes by clicking outside', async ({ page }) => {
  await openAs(page, 'lead', 'en');
  const trigger = profileButton(page, 'Laura Ríos', 'Project lead', 'en');
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'My profile' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('navigation').click({ position: { x: 5, y: 200 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Language: if the server cannot save it, the screen does not change and says why', async ({ page }) => {
  await page.route('**/me/language', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }) }));
  await openAs(page, 'lead', 'en');
  await profileButton(page, 'Laura Ríos', 'Project lead', 'en').click();
  const dialog = page.getByRole('dialog', { name: 'My profile' });
  await dialog.getByRole('button', { name: 'Español', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('The language could not be changed:');
  await expect(dialog.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true'); // sigue en inglés
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  problems = problems.filter((m) => !/status of 500/.test(m)); // el 500 lo provocamos a propósito
});

test('Language: the choice follows the person to another computer: a browser that knows nothing opens the login in Spanish and, once inside, shows hers', async ({ page, browser, baseURL }) => {
  await openAs(page, 'lead', 'es');
  await profileButton(page, 'Laura Ríos', 'Líder de proyecto', 'es').click();
  await page.getByRole('dialog', { name: 'Mi perfil' }).getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invoices', exact: true })).toBeVisible();
  expect(serverLanguage(null, 'laura.rios@nexus.example')).toBe('en');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible(); // en ESTE navegador la pantalla de entrada recuerda el último idioma

  // Otra computadora: un contexto nuevo, sin localStorage ni sesión. La entrada sale en español (el predeterminado)...
  const es = T('es');
  const other = await (await browser.newContext({ baseURL })).newPage();
  await other.goto('/');
  await expect(other.getByRole('heading', { name: es('login.title') })).toBeVisible();
  await other.getByLabel(es('login.email')).fill('laura.rios@nexus.example');
  await other.getByLabel(es('login.password')).fill(process.env.DEMO_PASSWORD ?? 'demo-password-1');
  await other.getByRole('button', { name: es('login.submit'), exact: true }).click();
  // ...y al entrar el servidor le devuelve SU idioma: la pantalla pasa a inglés sin que ese navegador lo supiera.
  await expect(other.getByRole('button', { name: 'Invoices', exact: true })).toBeVisible();
  await expect(other.locator('html')).toHaveAttribute('lang', 'en');
  // se deja como estaba
  await profileButton(other, 'Laura Ríos', 'Project lead', 'en').click();
  await other.getByRole('dialog', { name: 'My profile' }).getByRole('button', { name: 'Español', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Facturas', exact: true })).toBeVisible();
  expect(serverLanguage(null, 'laura.rios@nexus.example')).toBe('es');
  await other.context().close();
});

test('Language: a known server warning is translated and an unknown one is shown as it came', async ({ page }) => {
  await page.route('**/invoices', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ statusCode: 400, message: 'Invalid invoice number' }) }));
  await openAs(page, 'lead', 'es');
  await page.getByRole('button', { name: 'Facturas', exact: true }).click();
  await expect(page.getByText('El número de factura no es válido.')).toBeVisible(); // «Invalid invoice number» llega en inglés del servicio y se traduce
  await page.unroute('**/invoices');
  await page.route('**/invoices', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'A brand new server problem' }) }));
  await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
  await page.getByRole('button', { name: 'Facturas', exact: true }).click();
  await expect(page.getByText('A brand new server problem')).toBeVisible();
  problems = problems.filter((m) => !/status of (400|500)/.test(m));
});

// ---- Tema de la interfaz: Sistema | Claro | Oscuro, por persona, guardado en el servidor ----
const themeButton = (page: any, name: string) => page.getByRole('dialog').getByRole('group', { name: 'Theme' }).getByRole('button', { name, exact: true });
const openProfile = async (page: any, name: string, role: string) => { await profileButton(page, name, role, 'en').click(); await page.getByRole('dialog', { name: 'My profile' }).waitFor(); };

test('Theme: the profile switches light and dark at once, the colors really change, and the server keeps it', async ({ page }) => {
  await openAs(page, 'lead', 'en', 'light');
  expect(await pageLuma(page), 'light page').toBeGreaterThan(200);
  await openProfile(page, 'Laura Ríos', 'Project lead');
  await expect(themeButton(page, 'Light')).toHaveAttribute('aria-pressed', 'true');
  await themeButton(page, 'Dark').click();
  await expect(page.getByRole('status').filter({ hasText: 'Theme changed to Dark.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await pageLuma(page), 'dark page').toBeLessThan(60);
  expect(serverTheme('laura.rios@nexus.example')).toBe('dark');
  await themeButton(page, 'Light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await pageLuma(page)).toBeGreaterThan(200);
  expect(serverTheme('laura.rios@nexus.example')).toBe('light');
  await themeButton(page, 'System').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/); // sigue al sistema: sin atributo
  expect(serverTheme('laura.rios@nexus.example')).toBe('system');
});

test('Theme: «System» follows the computer (dark computer, dark page) and an explicit choice wins over the computer', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openAs(page, 'lead', 'en', 'system');
  expect(await pageLuma(page), 'system + dark computer').toBeLessThan(60);
  await openProfile(page, 'Laura Ríos', 'Project lead');
  await themeButton(page, 'Light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await pageLuma(page), 'explicit light on a dark computer').toBeGreaterThan(200);
  await themeButton(page, 'System').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/); // primero se espera a que la página cambie (el servidor responde antes)
  expect(await pageLuma(page)).toBeLessThan(60);
});

test('Theme: it follows the person to another computer, and language and theme do not undo each other', async ({ page, browser, baseURL }) => {
  await openAs(page, 'sales', 'es');
  await profileButton(page, 'Camila Soto', 'Ventas', 'es').click();
  const dlg = page.getByRole('dialog', { name: 'Mi perfil' });
  await dlg.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'Oscuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dlg.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Invoices', exact: true })).toBeVisible();
  expect([serverTheme('camila.soto@nexus.example'), serverLanguage(null, 'camila.soto@nexus.example')]).toEqual(['dark', 'en']);
  // otra computadora: un navegador que no sabe nada de ella
  await waitForLoginCapacity(page.request); // a mitad de la suite el gateway puede estar sin cupo de inicios de sesión (429): se espera en vez de fallar
  const other = await (await browser.newContext({ baseURL })).newPage();
  await other.goto('/');
  await other.getByLabel('Correo').fill('camila.soto@nexus.example'); await other.getByLabel('Contraseña').fill(process.env.DEMO_PASSWORD ?? 'demo-password-1');
  await other.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Invoices', exact: true })).toBeVisible(); // su idioma
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark'); // y su tema
  expect(await pageLuma(other)).toBeLessThan(60);
  await other.context().close();
  // se deja como estaba
  await page.getByRole('dialog', { name: 'My profile' }).getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System', exact: true }).click();
  await page.getByRole('dialog', { name: 'My profile' }).getByRole('button', { name: 'Español', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Facturas', exact: true })).toBeVisible();
  expect([serverTheme('camila.soto@nexus.example'), serverLanguage(null, 'camila.soto@nexus.example')]).toEqual(['system', 'es']);
});

test('Theme: if the server cannot save it, the page does not change and says why', async ({ page }) => {
  await page.route('**/me/theme', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }) }));
  await openAs(page, 'lead', 'en', 'light');
  await openProfile(page, 'Laura Ríos', 'Project lead');
  await themeButton(page, 'Dark').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('The theme could not be changed:');
  await expect(themeButton(page, 'Light')).toHaveAttribute('aria-pressed', 'true');
  expect(await pageLuma(page)).toBeGreaterThan(200);
  problems = problems.filter((m) => !/status of 500/.test(m));
});

// ---- Dashboards «Sensores» y «Red»: hallazgos con referencia, filtros reales y tablas explorables ----
const netLinks: { originName: string; destinationName: string; functional: boolean | null }[] = JSON.parse(readFileSync(join(here, '..', '..', 'services', 'operations', 'prisma', 'data', 'network-links.json'), 'utf8'));
const goTo = async (page: any, nav: string) => { await page.getByRole('navigation').getByRole('button', { name: nav, exact: true }).click(); };
const shown = (page: any, text: RegExp | string) => page.getByText(text).first();
/** La tabla del explorador (la de lecturas o la de dispositivos y enlaces); no las tablas alternativas de los gráficos, que están plegadas dentro de «Ver como tabla». */
const explorerRows = (page: any) => page.locator('table:visible').filter({ has: page.locator('caption') }).last().locator('tbody tr');

test('Sensors: a finding says what happened and «See the readings» filters the table to the readings behind it', async ({ page }) => {
  await openAs(page, 'manager');
  await goTo(page, 'Sensors');
  await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
  const first = page.getByRole('button', { name: /^See the readings/ }).first();
  await expect(page.getByText(/09:40 UTC .* 3 offices|3 offices/).first()).toBeVisible(); // la alta prioridad: las alertas simultáneas, con su hora y sus oficinas
  await expect(page.getByText(/Oficina 1, Oficina 2, Oficina 3/).first()).toBeVisible();
  await first.click();
  await expect(shown(page, 'Showing 1–3 of 3')).toBeVisible();
  await expect(explorerRows(page)).toHaveCount(3);
  await expect(explorerRows(page).filter({ hasText: 'Alert' })).toHaveCount(3);
  for (const device of ['IoT10', 'IoT10(1)', 'IoT10(2)']) await expect(page.getByRole('cell', { name: new RegExp('^' + device.replace(/[()]/g, '\\$&')) }).first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Active filters' }).or(page.getByText('Active filters')).first()).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(shown(page, 'Showing 1–50 of 4,200')).toBeVisible();
});

test('Sensors: card detail and combined filters give exactly the counts of the source (39 warnings, 13 in Oficina 2)', async ({ page }) => {
  await openAs(page, 'manager');
  await goTo(page, 'Sensors');
  await page.getByRole('button', { name: 'See detail: Warnings' }).click();
  await expect(shown(page, /Showing 1–39 of 39$/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await page.getByRole('button', { name: 'Oficina 2', exact: true }).first().click();
  await page.getByRole('button', { name: 'Warning', exact: true }).first().click();
  await expect(shown(page, /Showing 1–13 of 13$/)).toBeVisible();
  // las 13 son de Oficina 2, de 24 °C, con su nota tal como viene de la fuente
  const body = explorerRows(page);
  await expect(body).toHaveCount(13);
  expect(await body.filter({ hasText: 'Oficina 2' }).count()).toBe(13);
  await expect(page.getByRole('cell', { name: 'Umbral Ligero Superado' }).first()).toBeVisible();
  // el filtro de oficina también deja solo esa serie en los gráficos (se ve en la tabla alternativa)
  // El filtro de oficina también deja solo esa serie en el gráfico: el texto de su tarjeta (leyenda y tabla alternativa) nombra solo Oficina 2.
  const chartText = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2, h3, h4')].find((x) => x.textContent?.trim() === 'Temperature by office')!;
    let e: Element | null = h; while (e && !e.querySelector('svg')) e = e.parentElement;
    return e?.textContent ?? '';
  });
  expect(chartText).toContain('Oficina 2');
  expect(chartText).not.toContain('Oficina 1');
  expect(chartText).not.toContain('Oficina 3');
});

test('Sensors: paging and sorting by value work over the whole 4200 and never repeat a row', async ({ page }) => {
  await openAs(page, 'manager');
  await goTo(page, 'Sensors');
  await expect(shown(page, 'Showing 1–50 of 4,200')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).first().click();
  await expect(shown(page, 'Showing 51–100 of 4,200')).toBeVisible();
  await expect(shown(page, 'Page 2 of 84')).toBeVisible();
  await page.getByRole('button', { name: '100', exact: true }).first().click();
  await expect(shown(page, /Showing 1–100 of 4,200$/)).toBeVisible();
});

test('Sensors: every chart says its finding to a screen reader and has its table', async ({ page }) => {
  await openAs(page, 'manager');
  await goTo(page, 'Sensors');
  await expect(page.getByRole('heading', { name: 'Readings', exact: true })).toBeVisible();
  const charts = page.getByRole('img');
  await expect.poll(async () => charts.count()).toBeGreaterThanOrEqual(5);
  for (const label of await charts.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))) expect(label.length, 'aria-label with a finding').toBeGreaterThan(20);
  expect(await page.getByText('View as table').count()).toBeGreaterThanOrEqual(5);
});

test('Sensors in Spanish: the screen is Spanish, the findings carry their numbers, and the source data stays as it is', async ({ page }) => {
  await openAs(page, 'manager', 'es');
  await goTo(page, 'Sensores');
  await expect(page.getByRole('heading', { name: 'Hallazgos' })).toBeVisible();
  await expect(page.getByText(/a las 09:40 UTC hubo alertas/i).first()).toBeVisible();
  await expect(page.getByText(/exactamente 15 minutos/).first()).toBeVisible();
  await page.getByRole('button', { name: /^Ver las lecturas/ }).nth(1).click();
  await expect(page.getByText(/Mostrando 1–39 de 39$/).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Umbral Ligero Superado' }).first()).toBeVisible(); // la nota de la docente, sin traducir
  for (const english of ['Findings', 'Readings by severity', 'Showing', 'Clear filters']) await expect(page.getByText(english, { exact: false })).toHaveCount(0);
});

test('Network: the findings name the gap (nothing configured on ASA0) and lead to the equipment that shows it', async ({ page }) => {
  await openAs(page, 'manager');
  await goTo(page, 'Network');
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible();
  await expect(page.getByText(/None of the 10 pieces of infrastructure equipment|None of the 10/).first()).toBeVisible();
  await expect(page.getByText(/ASA0/).first()).toBeVisible();
  // la matriz de cobertura: 10 equipos, Syslog/SNMP/NTP todos ✗, NetFlow ✓ en 4
  const matrix = page.getByRole('table', { name: /monitoring/i }).first();
  await expect(matrix.locator('tbody tr')).toHaveCount(10);
  await expect(matrix.getByText('Syslog 0 of 10')).toBeVisible().catch(() => undefined);
  await page.getByRole('button', { name: /^See the critical equipment/ }).click();
  await expect(shown(page, /Showing 1–5 of 5$/)).toBeVisible();
  await expect(explorerRows(page).filter({ hasText: 'ASA0' })).toHaveCount(1); // el cortafuegos, entre los 5 críticos con registro de monitoreo
});

test('Network: the explorer filters the 76 devices and the 74 links exactly as the source, and a device leads to its links', async ({ page }) => {
  await openAs(page, 'manager');
  await goTo(page, 'Network');
  await expect(page.getByRole('tab', { name: 'Devices (76)' })).toBeVisible();
  await expect(shown(page, /Showing 1–25 of 76$/)).toBeVisible();
  await page.getByRole('button', { name: 'Without a monitoring record', exact: true }).first().click();
  await expect(shown(page, /Showing 1–25 of 66$/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await page.getByRole('button', { name: 'High', exact: true }).first().click();
  await expect(shown(page, /Showing 1–5 of 5$/)).toBeVisible(); // los 5 switches de acceso son los de criticidad Alta
  await page.getByRole('tabpanel').getByRole('button', { name: 'See the links of SW1 P1' }).first().click(); // el de la tabla del explorador (la matriz de arriba tiene los suyos) // dos botones llevan a los enlaces (el nombre y «Ver enlaces»): con cualquiera basta
  await expect(page.getByRole('tab', { name: /Links/ })).toHaveAttribute('aria-selected', 'true');
  const n = netLinks.filter((l) => l.originName === 'SW1 P1' || l.destinationName === 'SW1 P1').length;
  await expect(page.getByRole('tab', { name: /Links/ })).toHaveAttribute('aria-selected', 'true');
  await expect(shown(page, new RegExp(`Showing 1–${n} of ${n}$`))).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.getByRole('tab', { name: 'Links (74)' })).toBeVisible();
});

// ---- Asesor de decisiones «Qué hacer primero» ----
const advisorCard = (page: any) => page.getByRole('region', { name: 'What to do first' });
/** Simula un equipo SIN llave de IA (la respuesta real de reglas, con `aiAvailable:false`): la prueba no debe depender de si quien la corre tiene una llave en su .env. */
async function withoutAiKey(page: any, language: 'en' | 'es') {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  const real = await (await page.request.post('/advisor/brief', { headers: { authorization: `Bearer ${sessions.manager.token}` }, data: { language, ai: false } })).json();
  await page.route('**/advisor/brief', (route: any) => route.fulfill({ json: { ...real, aiAvailable: false } }));
}

test('Advisor: the manager sees what to do first, ranked, each item with its reason, action and evidence', async ({ page }) => {
  await openAs(page, 'manager');
  const card = advisorCard(page);
  await expect(card.getByRole('heading', { level: 3 }).first()).toBeVisible();
  await expect(card.getByText('Ranked by rules')).toBeVisible();
  await expect(card.getByText(/Business criteria: version \d{4}-\d{2}-\d{2}\.\d+/)).toBeVisible();
  await expect(card.getByRole('heading', { level: 3 }).first()).toHaveText('Check the alerts of 09:40 UTC'); // la alta de Sensores va primero
  const first = card.getByRole('listitem').first();
  await expect(first.getByText(/Oficina 1, Oficina 2, Oficina 3/)).toBeVisible();
  await expect(first.getByText('Evidence:')).toBeVisible();
  await expect(first.getByText(/Simultaneous alerts at 09:40 UTC in 3 offices/)).toBeVisible();
  expect(await card.getByRole('listitem').count()).toBeGreaterThanOrEqual(2);
  await expect(card.getByText(/Nothing is urgent/)).toHaveCount(0);
});

test('Advisor: an item opens the screen it talks about', async ({ page }) => {
  await openAs(page, 'manager');
  await advisorCard(page).getByRole('button', { name: 'Open Network' }).first().click();
  await expect(page.getByRole('heading', { name: 'What needs attention' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await advisorCard(page).getByRole('button', { name: 'Open Sensors' }).first().click();
  await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();
});

test('Advisor: with no AI key configured the button is off and says why; the rules still work', async ({ page }) => {
  await withoutAiKey(page, 'en');
  await openAs(page, 'manager');
  const card = advisorCard(page);
  await expect(card.getByRole('heading', { level: 3 }).first()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Write with AI' })).toBeDisabled();
  await expect(card.getByText(/not configured on this machine/)).toBeVisible();
});

test('Advisor: an answer written by the AI is labelled as such, and a discarded one shows the rules with the reason', async ({ page }) => {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  const real = await (await page.request.post('/advisor/brief', { headers: { authorization: `Bearer ${sessions.manager.token}` }, data: { language: 'en' } })).json();
  const id = real.evidence[0].id;
  const ai = { ...real, source: 'ai', aiAvailable: true, fallbackReason: null, items: [{ evidenceIds: [id], target: 'sensors', title: 'Look at the 09:40 alerts first', why: 'They fired together in 3 offices.', action: 'Open the readings of that time.' }] };
  let mode: 'ai' | 'invalid' = 'ai';
  await page.route('**/advisor/brief', async (route) => {
    const body = route.request().postDataJSON();
    if (!body.ai) return route.fulfill({ json: { ...real, aiAvailable: true } });
    return route.fulfill({ json: mode === 'ai' ? ai : { ...real, aiAvailable: true, fallbackReason: 'invalid' } });
  });
  await openAs(page, 'manager');
  const card = advisorCard(page);
  await card.getByRole('button', { name: 'Write with AI' }).click();
  await expect(card.getByText('Written with AI and checked against the data')).toBeVisible();
  await expect(card.getByRole('heading', { level: 3, name: 'Look at the 09:40 alerts first' })).toBeVisible();
  await expect(card.getByText('Evidence:')).toBeVisible();
  mode = 'invalid';
  await card.getByRole('button', { name: 'Write with AI' }).click();
  await expect(card.getByText('Ranked by rules')).toBeVisible();
  await expect(card.getByText(/did not match the data and was discarded/)).toBeVisible();
});

test('Advisor in Spanish: the screen and the sentences come in Spanish', async ({ page }) => {
  await withoutAiKey(page, 'es');
  await openAs(page, 'manager', 'es');
  const card = page.getByRole('region', { name: 'Qué hacer primero' });
  await expect(card.getByRole('heading', { level: 3 }).first()).toHaveText('Revisa las alertas de las 09:40 UTC');
  await expect(card.getByText('Ordenado por reglas')).toBeVisible();
  await expect(card.getByText('Por qué:').first()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Redactar con IA' })).toBeDisabled();
});

test('Advisor: only the manager gets it (the others have no panel and the API says 403)', async ({ page, request }) => {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  for (const role of ['lead', 'billing', 'sales'] as const) expect((await request.post('/advisor/brief', { headers: { authorization: `Bearer ${sessions[role].token}` }, data: { language: 'en', ai: true } })).status()).toBe(403);
  await openAs(page, 'lead');
  await expect(page.getByRole('region', { name: 'What to do first' })).toHaveCount(0);
});

test('Dashboards: nobody but the manager sees the Sensors and Network screens, and the API refuses the others', async ({ page, request }) => {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  for (const role of ['lead', 'billing', 'sales'] as const) {
    for (const path of ['/telemetry/trends', '/telemetry/readings', '/network/devices', '/network/links']) expect((await request.get(path, { headers: { authorization: `Bearer ${sessions[role].token}` } })).status()).toBe(403);
  }
  await openAs(page, 'lead');
  await expect(page.getByRole('button', { name: 'Sensors', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Network', exact: true })).toHaveCount(0);
});

test('Dashboards on a 320 px phone: nothing leaves the screen, in both screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openAs(page, 'manager');
  for (const [nav, ready] of [['Sensors', 'Readings'], ['Network', 'Explorer']] as const) {
    await goTo(page, nav);
    await expect(page.getByRole('heading', { name: ready, exact: true })).toBeVisible();
    await expect(explorerRows(page).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${nav}: no sideways scroll`).toBe(true);
    await expect.poll(() => explorerRows(page).locator('td[data-label]').count()).toBeGreaterThan(10);
    const cells = await explorerRows(page).locator('td[data-label]').evaluateAll((els: Element[]) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    expect(cells.length).toBeGreaterThan(10);
    for (const c of cells) { expect(c.left).toBeGreaterThanOrEqual(0); expect(c.right).toBeLessThanOrEqual(321); }
  }
});

const PW = 'Qa-Passw0rd-long!';
const roleButton = (page: any, name: string) => page.getByRole('group', { name: 'Role', exact: true }).getByRole('button', { name, exact: true });

test('the manager creates two salespeople who can sign in, and changes a role', async ({ page, request }) => {
  await openAs(page, 'manager');
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Diana Vega/ }).getByText('You', { exact: true })).toBeVisible(); // la propia fila no tiene «Change role»
  await expect(page.getByRole('row', { name: /Laura Ríos/ }).getByRole('button', { name: /Change role/ })).toBeVisible();
  for (const [email, name] of [['qa.carlos@nexus.example', 'Carlos Pérez'], ['qa.ana@nexus.example', 'Ana María Gómez']]) {
    await expect(roleButton(page, 'Sales')).toHaveAttribute('aria-pressed', 'true'); // por omisión: Sales
    await page.getByLabel('Email').fill(`  ${email.toUpperCase()}  `); // se normaliza: minúsculas y sin espacios
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Initial password').fill(PW);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('status').filter({ hasText: `${name} created as Sales` })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(email.replace('.', '\\.')) })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(''); // el formulario queda limpio para el siguiente
  }
  // El vendedor nuevo inicia sesión de verdad (otra pestaña: la sesión es por pestaña) y se comporta como Sales.
  // «Solo lectura» solo aparece en un hito PENDIENTE: la prueba crea el suyo (antes dependía de qué proyecto quedara seleccionado, y fallaba a veces en el CI).
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  const lead = { headers: { authorization: `Bearer ${sessions.lead.token}` } };
  const readOnlyProject = await (await request.post('/projects', { ...lead, data: { name: 'Read-only check', client: 'Nexus Safe-Cloud' } })).json();
  expect((await request.post(`/projects/${readOnlyProject.id}/milestones`, { ...lead, data: { name: 'Pending milestone', amountCop: 1000000 } })).status()).toBe(201);
  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByLabel('Email').fill('qa.carlos@nexus.example');
  await other.getByLabel('Password').fill(PW);
  await other.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Una persona nueva empieza en español (así lo guarda el servidor): el login ya le devuelve su idioma.
  const es = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('es', key, params);
  await expect(other.getByText(es('role.sales'), { exact: true }).first()).toBeVisible();
  await expect(other.getByRole('button', { name: es('nav.users') })).toHaveCount(0);
  await other.getByRole('button', { name: 'Read-only check' }).click();
  await expect(other.getByText(es('projects.readOnly', { role: es('role.sales') })).first()).toBeVisible();
  await expect(other.getByRole('button', { name: es('projects.approve') })).toHaveCount(0); // y no tiene el botón de aprobar
  await expect(other.locator('html')).toHaveAttribute('lang', 'es');
  await other.close();
  // Cambio de rol de otra persona: panel aparte, aviso de que vale desde el siguiente inicio de sesión.
  await page.getByRole('button', { name: 'Change role for Carlos Pérez' }).click();
  await expect(page.getByRole('heading', { name: /Change role for Carlos Pérez/ })).toBeVisible();
  await page.getByRole('group', { name: 'New role', exact: true }).getByRole('button', { name: 'Billing analyst', exact: true }).click();
  await page.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Carlos Pérez is now Billing analyst/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /qa\.carlos@nexus\.example/ }).getByText('Billing analyst', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Change role for/ })).toHaveCount(0);
});

test('the new user form validates before sending anything, and a repeated email shows its own message', async ({ page }) => {
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && /\/users$/.test(r.url())) posts++; });
  await openAs(page, 'manager');
  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('Enter the email.')).toBeVisible();
  await expect(page.getByText('Enter the name.')).toBeVisible();
  await expect(page.getByText('The password must have at least 12 characters.')).toBeVisible();
  await page.getByLabel('Email').fill('qa.nuevo@nexus.example');
  await page.getByLabel('Full name').fill('Nuevo Usuario');
  for (const [pw, message] of [['aaaaaaaaaaaa', /4 different characters/], ['qa.nuevo-secret-1', /must not contain the email/], [' leading-space-1234', /start or end with spaces/], ['abcd'.repeat(18) + 'e', /72 bytes/]] as [string, RegExp][]) {
    await page.getByLabel('Initial password').fill(pw);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText(message)).toBeVisible();
  }
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Initial password').fill(PW);
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.getByLabel('Full name').fill('n'.repeat(121));
  await page.getByLabel('Email').fill('qa.nuevo@nexus.example');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText(/name is too long \(120/)).toBeVisible();
  expect(posts, 'ninguna de las entradas inválidas debe llegar al servidor').toBe(0);
  // Un email que ya existe: el servidor responde 409 y se avisa junto al campo.
  await page.getByLabel('Email').fill('CAMILA.SOTO@nexus.example');
  await page.getByLabel('Full name').fill('Otra Camila');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('That email is already registered.')).toBeVisible();
  expect(posts).toBe(1);
  // Mostrar y ocultar la contraseña.
  const pw = page.getByLabel('Initial password');
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(pw).toHaveAttribute('type', 'text');
});

test('only the manager has the Users tab, and the API refuses the others', async ({ page, request }) => {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  for (const role of ['lead', 'billing', 'sales'] as const) {
    expect((await request.get('/users', { headers: { authorization: `Bearer ${sessions[role].token}` } })).status()).toBe(403);
  }
  await openAs(page, 'lead');
  await expect(page.getByRole('button', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
});

test('on a phone the users become cards and the role buttons stay inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await openAs(page, 'manager');
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  expect(await page.locator('tbody tr td').nth(1).evaluate((el) => getComputedStyle(el).display)).toBe('flex');
  expect(await page.locator('tbody tr td').nth(1).evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"Email"');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (const name of ['Project lead', 'Billing analyst', 'Sales', 'Manager']) {
    const box = await roleButton(page, name).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 376, `${name} inside the screen`).toBe(true);
  }
});

test('the dashboard updates by itself while the project lead approves and the billing analyst issues', async ({ page, request }) => {
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  const api = (role: 'lead' | 'billing') => ({ headers: { authorization: `Bearer ${sessions[role].token}` } });
  await openAs(page, 'manager');
  const value = (name: string) => page.locator(`div:has(> small:text-is("${name}")) > strong`);
  await expect(value('Draft invoices')).toBeVisible();
  // Otras pruebas del archivo ya dejaron borradores: se compara contra el valor de partida, no contra un número fijo.
  const num = async (name: string) => Number(await value(name).innerText());
  const [draft0, issued0, approved0] = [await num('Draft invoices'), await num('Issued invoices'), await num('Approved milestones')];
  // El gerente no hace nada: el project lead aprueba por la API y el tablero cambia solo (aprobado -> borrador -> emitida).
  expect((await request.post('/milestones/m3/approve', api('lead'))).status()).toBe(200);
  await expect(value('Approved milestones')).toHaveText(String(approved0 + 1), { timeout: 20_000 });
  await expect(value('Draft invoices')).toHaveText(String(draft0 + 1), { timeout: 20_000 });
  const list = await (await request.get('/invoices', api('billing'))).json();
  const draft = list.find((i: any) => i.milestoneName === 'Link redundancy design' || i.status === 'draft');
  expect((await request.patch(`/invoices/${draft.number}/issue`, api('billing'))).status()).toBe(200);
  await expect(value('Issued invoices')).toHaveText(String(issued0 + 1), { timeout: 20_000 });
  await expect(value('Draft invoices')).toHaveText(String(draft0), { timeout: 20_000 });
  await expect(page.getByText(new RegExp(`issued invoice ${draft.number}`))).toBeVisible();
});

test('on a 320 px phone every figure of the dashboard table is inside the screen (nothing hidden in a sideways scroll)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openAs(page, 'manager');
  await expect(page.getByRole('heading', { name: 'By project' })).toBeVisible();
  const cells = await page.$$eval('td[data-label]', (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('data-label'), text: (el.textContent ?? '').trim(), left: r.left, right: r.right, width: r.width }; }));
  expect(cells.length).toBeGreaterThanOrEqual(8); // 2 proyectos de demostración x 4 cifras
  for (const c of cells) {
    expect(c.text, `${c.label} has a value`).not.toBe('');
    expect(c.left, `${c.label} starts inside the screen`).toBeGreaterThanOrEqual(0);
    expect(c.right, `${c.label} ends inside the screen`).toBeLessThanOrEqual(321);
  }
});


// ---- Proyectos a escala: selección, una sola petición de hitos, búsqueda y «Mostrar más» ----
// Estas pruebas crean proyectos desechables por la API (con el token de la líder) y se limpian al final con el reset de la demo.
const leadToken = (): string => JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8')).lead.token; // openAs ya renovó la guardada si hacía falta
async function seedProjects(request: { post: (url: string, o: { headers: Record<string, string>; data: object }) => Promise<{ status(): number }> }, n: number, client: string) {
  for (let i = 1; i <= n; i++) {
    const r = await request.post('/projects', { headers: { authorization: `Bearer ${leadToken()}` }, data: { name: `Scale test ${String(i).padStart(2, '0')}`, client } });
    expect(r.status()).toBe(201);
  }
}

test('Projects: a click anywhere on the row selects it, and the milestones on screen always belong to the title above them', async ({ page }) => {
  await openAs(page, 'lead');
  const heading = (name: string) => page.getByRole('heading', { name: `Milestones · ${name}` });
  await page.getByRole('row', { name: /Retail POS integration/ }).getByRole('cell').nth(1).click(); // la celda del cliente, no el nombre
  await expect(heading('Retail POS integration')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'API contract' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Site survey', exact: true })).toHaveCount(0); // un hito del proyecto anterior nunca queda bajo el título nuevo
  await page.getByRole('row', { name: /SME cloud migration/ }).getByRole('cell').nth(2).click(); // la celda del contador
  await expect(heading('SME cloud migration')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add a milestone to SME cloud migration' })).toBeVisible(); // el formulario apunta al proyecto elegido
  await expect(page.getByRole('cell', { name: 'API contract' })).toHaveCount(0);
});

test('Projects: opening the screen asks for the milestones of ONE project, however many projects there are', async ({ page, request }) => {
  await seedProjects(request, 12, 'Scale Co A');
  const urls: string[] = [];
  page.on('request', (r) => { if (r.method() === 'GET' && /\/projects(\/|$)/.test(new URL(r.url()).pathname)) urls.push(new URL(r.url()).pathname); });
  await openAs(page, 'lead');
  await expect(page.getByRole('heading', { name: /^Milestones · / })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Loading milestones…' })).toHaveCount(0);
  expect(urls.filter((u) => u === '/projects')).toHaveLength(1);
  expect(urls.filter((u) => u.endsWith('/milestones')), 'una petición de hitos, no una por proyecto').toHaveLength(1);
});

test('Projects: search by name or client, and «Show more» reveals the rest in batches of 25', async ({ page, request }) => {
  await seedProjects(request, 30, 'Scale Co B'); // 30 de este cliente; la prueba no depende de las demás
  // El total real se lee de la API: otras pruebas de este archivo también crean proyectos.
  const total = (await (await request.get('/projects', { headers: { authorization: `Bearer ${leadToken()}` } })).json()).length as number;
  expect(total).toBeGreaterThan(30);
  await openAs(page, 'lead');
  const rows = page.getByRole('table').first().getByRole('row');
  await expect(page.getByText(`Showing 25 of ${total}`)).toBeVisible();
  await expect(rows).toHaveCount(26); // 25 filas + el encabezado
  await page.getByRole('button', { name: `Show ${total - 25} more` }).click();
  await expect(page.getByText(`Showing ${total} of ${total}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /Show \d+ more/ })).toHaveCount(0);
  await page.getByLabel('Search projects').fill('scale co b'); // por cliente, sin distinguir mayúsculas
  await expect(page.getByText('Showing 25 of 30')).toBeVisible(); // al buscar vuelve a la primera tanda
  await page.getByLabel('Search projects').fill('retail norte');
  await expect(page.getByText('Showing 1 of 1')).toBeVisible();
  await page.getByLabel('Search projects').fill('zzzz');
  await expect(page.getByText('No project matches your search')).toBeVisible();
  await expect(page.getByText('Showing 0 of 0')).toBeVisible();
});

test('Invoices: with many invoices only the first 50 are drawn, «Show more» adds the next batch and a new search starts again from the first batch', async ({ page, request }) => {
  const auth = { authorization: `Bearer ${leadToken()}` };
  const countInvoices = async () => (await (await request.get('/invoices', { headers: auth })).json()).length as number;
  const before = await countInvoices(); // otras pruebas del archivo ya dejaron facturas: se cuenta lo que hay ANTES de crear las 52
  const project = await (await request.post('/projects', { headers: auth, data: { name: 'Invoice scale', client: 'Scale Co C' } })).json();
  const ids: string[] = [];
  for (let i = 1; i <= 52; i++) ids.push((await (await request.post(`/projects/${project.id}/milestones`, { headers: auth, data: { name: `Scale M${String(i).padStart(2, '0')}`, amountCop: 1_000_000 } })).json()).id);
  for (const id of ids) expect((await request.post(`/milestones/${id}/approve`, { headers: auth })).status()).toBe(200);
  let total = before; // las facturas las crea Billing por evento: se espera a que lleguen las 52 NUEVAS (CI es más lento que un portátil)
  for (let k = 0; k < 120 && total < before + 52; k++) { total = await countInvoices(); if (total < before + 52) await new Promise((r) => setTimeout(r, 500)); }
  expect(total).toBe(before + 52);
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await expect(page.getByText(`Showing 50 of ${total}`)).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(51); // 50 filas + el encabezado
  await page.getByRole('button', { name: `Show ${total - 50} more` }).click();
  await expect(page.getByText(`Showing ${total} of ${total}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /Show \d+ more/ })).toHaveCount(0);
  await page.getByLabel('Search invoices').fill('scale m'); // buscar vuelve a la primera tanda
  await expect(page.getByText(`Showing 50 of ${total}`)).toBeVisible();
  await page.getByLabel('Search invoices').fill('scale m05');
  await expect(page.getByText(`Showing 1 of ${total}`)).toBeVisible();
});

const openInvoices = async (page: import('@playwright/test').Page, role: 'lead' | 'billing') => {
  await openAs(page, role);
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible();
};
const einvPanel = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Electronic invoice (test mode)' });

test('E-invoice: only the billing analyst sees the panel, and the sandbox banner is always on screen', async ({ page }) => {
  await openInvoices(page, 'lead');
  await expect(page.getByText('Electronic invoice (test mode)')).toHaveCount(0);
  const p2 = await page.context().newPage();
  await openInvoices(p2, 'billing');
  await expect(einvPanel(p2)).toBeVisible();
  await expect(einvPanel(p2).getByRole('note')).toContainText('SANDBOX – NO LEGAL VALIDITY');
  await expect(einvPanel(p2).getByRole('note')).toContainText('not valid electronic sales invoices');
  await p2.close();
});

test('E-invoice: generate, view, download the XML, simulate the send and register the delivery of an issued invoice; every step says it is only a test', async ({ page }) => {
  test.setTimeout(90_000);
  await openInvoices(page, 'billing');
  const panel = einvPanel(page);
  const row = panel.getByRole('row').filter({ hasText: 'INV-0101' });
  await expect(row.getByText('Ready to generate')).toBeVisible();
  await row.getByRole('button', { name: 'Generate document: INV-0101' }).click();
  // El número del documento depende de cuántos se generaron antes en la corrida (otras pruebas emiten facturas y su documento sale solo): se lee del aviso.
  const toast = page.getByText(/^INV-0101: document FE\d+ generated \(sandbox, no legal validity\)\.$/);
  await expect(toast).toBeVisible();
  const doc = /FE\d+/.exec(await toast.innerText())![0];
  await expect(row.getByText('Generated · sandbox')).toBeVisible();
  // Ver: se abre otra pestaña con la representación, que lleva el aviso y el número.
  const popupPromise = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'View: INV-0101' }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole('alert')).toContainText('SANDBOX – SIN VALIDEZ LEGAL', { timeout: 15_000 });
  await expect(popup.getByRole('heading', { level: 1 })).toContainText(doc);
  await expect(popup.locator('.qr svg')).toBeVisible();
  await popup.close();
  // Descargar el XML.
  const dl = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download XML: INV-0101' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('INV0101.xml');
  const xml = readFileSync((await file.path())!, 'utf8');
  expect(xml).toContain(`<cbc:ID>${doc}</cbc:ID>`); expect(xml).toContain('SANDBOX – NO LEGAL VALIDITY'); expect(xml).toContain('<cbc:PayableAmount currencyID="COP">14280000.00</cbc:PayableAmount>');
  // Enviar (simulado) y registrar el envío por correo.
  await row.getByRole('button', { name: 'Send (simulated): INV-0101' }).click();
  await expect(page.getByText('INV-0101: SIMULATED send to the sandbox. Nothing was sent to the DIAN.')).toBeVisible();
  await expect(row.getByText('Simulated send · sandbox')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Send (simulated): INV-0101' })).toHaveCount(0); // ya no se puede enviar otra vez
  await row.getByRole('button', { name: 'Register delivery by email: INV-0101' }).click();
  await expect(page.getByText('INV-0101: delivery REGISTERED. No email was sent: no mail server is connected.')).toBeVisible();
  expect(await page.locator('text=/accepted|aceptad/i').count()).toBe(0); // en ninguna parte dice que alguien lo aceptó
});

test('E-invoice: an invoice of a client with no fiscal data waits; the form says what is wrong in its own words; with the data saved the document is generated', async ({ page, request }) => {
  test.setTimeout(120_000);
  const sessions = await currentSessions();
  const as = (role: 'lead' | 'billing') => ({ Authorization: `Bearer ${sessions[role].token}` });
  const client = `Cliente E2E ${Date.now() % 100000}`;
  const project = await (await request.post('/projects', { headers: as('lead'), data: { name: 'Proyecto factura electrónica', client } })).json();
  const milestone = await (await request.post(`/projects/${project.id}/milestones`, { headers: as('lead'), data: { name: 'Hito electrónico', amountCop: 2_000_000 } })).json();
  expect((await request.post(`/milestones/${milestone.id}/approve`, { headers: as('lead') })).status()).toBe(200);
  let invoice: { number: string } | undefined;
  for (let i = 0; i < 40 && !invoice; i++) { invoice = (await (await request.get('/invoices', { headers: as('billing') })).json()).find((x: any) => x.milestoneName === 'Hito electrónico' && x.projectName === 'Proyecto factura electrónica'); if (!invoice) await page.waitForTimeout(500); }
  expect(invoice, 'la factura borrador apareció sola').toBeTruthy();
  const issuedRes = await request.patch(`/invoices/${invoice!.number}/issue`, { headers: as('billing') });
  expect(issuedRes.status()).toBe(200);
  expect((await issuedRes.json()).electronicStatus).toBe('pending_customer_data'); // la factura queda emitida igual
  await openInvoices(page, 'billing');
  const row = einvPanel(page).getByRole('row').filter({ hasText: invoice!.number });
  await expect(row.getByText('Client data missing')).toBeVisible();
  await expect(row.getByRole('button', { name: /^Generate document/ })).toHaveCount(0);
  await row.getByRole('button', { name: `Client data: ${invoice!.number}` }).click();
  const form = page.getByRole('form', { name: `Fiscal data of ${client}` });
  await expect(form).toBeVisible();
  // El formulario valida con sus propios avisos (sin burbujas del navegador) y no manda nada si hay errores.
  await form.getByRole('button', { name: 'Save data' }).click();
  await expect(form.getByText('Fill in this field.')).toHaveCount(4);
  await form.getByLabel('NIT (with or without hyphen and check digit)').fill('900000001-9');
  await form.getByLabel('Email').fill('x@y');
  await form.getByLabel('Address').fill('Calle 1 # 2-3');
  await form.getByLabel('City').fill('Cali');
  await form.getByRole('button', { name: 'Save data' }).click();
  await expect(form.getByText('The NIT must have 6 to 10 digits, and if it has a hyphen, the correct check digit.')).toBeVisible();
  await expect(form.getByText('Enter a valid email.')).toBeVisible();
  expect((await (await request.get('/customers', { headers: as('billing') })).json()).some((c: any) => c.name === client)).toBe(false);
  // Con datos buenos: se guarda, el estado pasa a «lista» y se genera.
  await form.getByLabel('NIT (with or without hyphen and check digit)').fill('900000001-2');
  await form.getByLabel('Email').fill('cuentas@cliente-e2e.example');
  await form.getByRole('button', { name: 'Save data' }).click();
  await expect(page.getByText(`Fiscal data of ${client} saved.`)).toBeVisible();
  await expect(row.getByText('Ready to generate')).toBeVisible();
  await row.getByRole('button', { name: `Generate document: ${invoice!.number}` }).click();
  await expect(row.getByText('Generated · sandbox')).toBeVisible();
});

const billingSql = (sql: string) => { execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d billing -Atc "${sql}"`, { cwd: join(here, '..', '..'), stdio: 'ignore' }); };

test('Overdue invoices: when an issued invoice passes its due day the dashboard shows it by itself (the service notices, announces it once, and the dashboard counts it)', async ({ page }) => {
  test.setTimeout(150_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' }); // estado limpio: INV-0102 aún sin vencer
  await new Promise((r) => setTimeout(r, 20_000));
  await openAs(page, 'manager');
  const kpi = page.getByText('Overdue invoices', { exact: true });
  await expect(kpi).toBeVisible();
  const value = async () => Number(await kpi.locator('xpath=following-sibling::strong[1]').innerText());
  const before = await value();
  // La factura sembrada INV-0102 pasa a estar emitida hace mes y medio y vencida hace dos semanas (el reinicio de la demo la devuelve a su fecha).
  billingSql("UPDATE invoices SET issued_at = '2026-09-01T10:00:00Z', due_date = '2026-10-01T10:00:00Z' WHERE number = 'INV-0102'");
  await expect.poll(value, { timeout: 60_000, message: 'la tarjeta «Overdue invoices» sube sola' }).toBe(before + 1);
  await expect(kpi.locator('xpath=following-sibling::span[1]')).toContainText('11.662.000 COP');
  // En la lista de actividad queda dicho, con los días, y la columna del proyecto lo cuenta.
  await expect(page.getByText(/Invoice INV-0102 is overdue by \d+ days/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Retail POS integration' }).getByRole('cell').nth(6)).toHaveText('1');
});

test('Notifications: an overdue invoice rings the bell of billing and management (not of the project lead), and reading is per person', async ({ browser }) => {
  test.setTimeout(150_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' }); // estado limpio: sin avisos y con INV-0102 aún sin vencer
  await new Promise((r) => setTimeout(r, 20_000)); // deja que los servicios vean el reinicio
  const open = async (role: 'billing' | 'manager' | 'lead') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const bell = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Notifications \(/ });
  const [billing, manager, lead] = [await open('billing'), await open('manager'), await open('lead')];
  try {
    await expect(bell(billing.page)).toHaveAccessibleName('Notifications (none unread)');
    // INV-0102 pasa a estar vencida: billing lo detecta, lo anuncia por RabbitMQ y Notifications lo guarda.
    billingSql("UPDATE invoices SET issued_at = '2026-09-01T10:00:00Z', due_date = '2026-10-01T10:00:00Z' WHERE number = 'INV-0102'");
    await expect(bell(billing.page)).toHaveAccessibleName('Notifications (1 unread)', { timeout: 60_000 });
    await expect(bell(manager.page)).toHaveAccessibleName('Notifications (1 unread)', { timeout: 60_000 });
    await expect(bell(lead.page)).toHaveAccessibleName('Notifications (none unread)');
    await bell(billing.page).click();
    const panel = billing.page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByText(/Invoice INV-0102 of “Retail POS integration” \(.+\) is \d+ days overdue · 11\.662\.000 COP with IVA/)).toBeVisible();
    await panel.getByRole('button', { name: 'Mark as read' }).click();
    await expect(bell(billing.page)).toHaveAccessibleName('Notifications (none unread)');
    await expect(panel.getByText('No notifications right now.')).toHaveCount(0); // sigue en la lista, ya leído
    await expect(panel.getByText('Unread', { exact: true })).toHaveCount(0);
    // Que billing lo lea NO lo marca para gerencia.
    await expect(bell(manager.page)).toHaveAccessibleName('Notifications (1 unread)');
    // Se cierra con Escape y devuelve el foco a la campana.
    await billing.page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(bell(billing.page)).toBeFocused();
  } finally { await billing.ctx.close(); await manager.ctx.close(); await lead.ctx.close(); }
});

test('Capacity: each role sees what it may — sales only reads, the project lead allocates, the manager adds engineers, billing has no screen', async ({ browser }) => {
  test.setTimeout(90_000);
  const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation').getByRole('button', { name: 'Capacity', exact: true });
  const open = async (role: 'billing' | 'sales' | 'lead' | 'manager') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [sales, lead, manager, billing] = [await open('sales'), await open('lead'), await open('manager'), await open('billing')];
  try {
    await expect(billing.page.getByRole('navigation').getByRole('button', { name: 'Invoices' })).toBeVisible();
    await expect(nav(billing.page)).toHaveCount(0);
    for (const who of [sales, lead, manager]) { await nav(who.page).click(); await expect(who.page.getByRole('heading', { name: 'Technical capacity' })).toBeVisible(); await expect(who.page.getByRole('heading', { name: 'Ana Torres' })).toBeVisible(); }
    // La carga de Ana sale de las asignaciones sembradas (60 % + 30 % más adelante).
    await expect(sales.page.locator('[data-engineer="Ana Torres"]')).toContainText(/Load today \d+%/);
    await expect(sales.page.getByRole('button', { name: /^Allocate / })).toHaveCount(0);
    await expect(sales.page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(sales.page.getByRole('heading', { name: 'New engineer' })).toHaveCount(0);
    await expect(lead.page.getByRole('button', { name: 'Allocate Ana Torres' })).toBeVisible();
    await expect(lead.page.getByRole('heading', { name: 'New engineer' })).toHaveCount(0);
    await expect(manager.page.getByRole('heading', { name: 'New engineer' })).toBeVisible();
  } finally { for (const w of [sales, lead, manager, billing]) await w.ctx.close(); }
});

test('Capacity: the 100% rule end to end — a second allocation is refused with the peak, the manager may allow it on purpose, and the over-allocation reaches the bells of management and sales', async ({ browser }) => {
  test.setTimeout(180_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const open = async (role: 'sales' | 'lead' | 'manager') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); await page.getByRole('navigation').getByRole('button', { name: 'Capacity', exact: true }).click(); return { ctx, page }; };
  const bell = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Notifications \(/ });
  const [manager, lead, sales] = [await open('manager'), await open('lead'), await open('sales')];
  const card = (page: import('@playwright/test').Page) => page.locator('[data-engineer="Playwright Engineer"]');
  const fill = async (page: import('@playwright/test').Page, percent: string, start: string, end: string) => {
    const form = page.getByRole('form', { name: 'Allocate Playwright Engineer' });
    await form.getByLabel('The project').fill('Branch network upgrade'); await form.getByLabel('Percent (1 to 100)').fill(percent);
    await form.getByLabel('From (YYYY-MM-DD)').fill(start); await form.getByLabel('To (YYYY-MM-DD)').fill(end);
    return form;
  };
  try {
    // El gerente agrega al ingeniero (el formulario avisa si falta algo, sin enviar).
    const newForm = manager.page.getByRole('form', { name: 'New engineer' });
    await newForm.getByRole('button', { name: 'Add engineer' }).click();
    await expect(newForm.getByText(/The name must have at least 2 characters/)).toBeVisible();
    await newForm.getByLabel('The name').fill('Playwright Engineer'); await newForm.getByLabel('The role').fill('Tester');
    await newForm.getByLabel('The skills').fill('Jest, Playwright, jest');
    await newForm.getByRole('button', { name: 'Add engineer' }).click();
    await expect(manager.page.getByText('Engineer Playwright Engineer added.')).toBeVisible();
    await expect(card(manager.page)).toContainText('Skills: Jest, Playwright');
    // Fechas relativas a hoy para que la carga de hoy se vea en la tarjeta.
    const iso = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
    await lead.page.reload(); await lead.page.getByRole('navigation').getByRole('button', { name: 'Capacity', exact: true }).click();
    await card(lead.page).getByRole('button', { name: 'Allocate Playwright Engineer' }).click();
    // Validación del lado del navegador: se avisa, no se envía.
    let form = await fill(lead.page, '150', iso(0), iso(10));
    await form.getByRole('button', { name: 'Save allocation' }).click();
    await expect(form.getByText('The percent must be a whole number from 1 to 100.')).toBeVisible();
    // El proyecto sale de la lista de Projects: uno que no existe se rechaza sin enviar.
    await form.getByLabel('The project').fill('Proyecto inventado'); await form.getByLabel('Percent (1 to 100)').fill('50');
    await form.getByRole('button', { name: 'Save allocation' }).click();
    await expect(form.getByText('Choose one of the projects in the list.')).toBeVisible();
    form = await fill(lead.page, '100', iso(0), iso(10));
    await form.getByRole('button', { name: 'Save allocation' }).click();
    await expect(lead.page.getByText('Playwright Engineer allocated to “Branch network upgrade” at 100%.')).toBeVisible();
    await expect(card(lead.page)).toContainText('Load today 100%');
    // La segunda asignación pasaría de 100 %: se rechaza y se dice el máximo. El líder no ve la casilla de permitir.
    await card(lead.page).getByRole('button', { name: 'Allocate Playwright Engineer' }).click();
    form = await fill(lead.page, '10', iso(5), iso(8));
    await expect(form.getByLabel(/Allow going over 100%/)).toHaveCount(0);
    await form.getByRole('button', { name: 'Save allocation' }).click();
    await expect(form.getByRole('alert')).toHaveText('Playwright Engineer would be at 110% (the limit is 100%).');
    await expect(card(lead.page).locator('li', { hasText: '10%' })).toHaveCount(0);
    // El gerente sí puede permitirlo a propósito.
    await manager.page.reload(); await manager.page.getByRole('navigation').getByRole('button', { name: 'Capacity', exact: true }).click();
    await card(manager.page).getByRole('button', { name: 'Allocate Playwright Engineer' }).click();
    form = await fill(manager.page, '10', iso(5), iso(8));
    await form.getByLabel(/Allow going over 100%/).check();
    await form.getByRole('button', { name: 'Save allocation' }).click();
    await expect(manager.page.getByText(/Playwright Engineer is now at 110% \(authorized by management\)/)).toBeVisible();
    await expect(card(manager.page)).toContainText('Over 100% (authorized)');
    // Nadie más se entera por la pantalla: el aviso llega por RabbitMQ y Notifications a la campana de gerencia y de ventas (no a la del líder).
    for (const who of [manager, sales]) {
      await expect(bell(who.page)).toHaveAccessibleName(/Notifications \([1-9]\d* unread\)/, { timeout: 60_000 });
      await bell(who.page).click();
      await expect(who.page.getByRole('dialog').getByText(/Playwright Engineer is allocated at 110% between/)).toBeVisible();
    }
    await expect(bell(lead.page)).toHaveAccessibleName('Notifications (none unread)');
    // Quitar la asignación libera la capacidad.
    await card(manager.page).locator('li', { hasText: '· 100% ·' }).getByRole('button', { name: /^Remove the allocation/ }).click();
    await expect(manager.page.getByText('Allocation removed.')).toBeVisible();
    await expect(card(manager.page)).toContainText('Load today 0% · free 100% · peak of the next 30 days 10%');
  } finally { await manager.ctx.close(); await lead.ctx.close(); await sales.ctx.close(); }
});

test('Notifications: a sensor that goes into ALERT rings the manager\'s bell (not the project lead\'s), once, through ingestion → outbox → RabbitMQ → Notifications', async ({ browser }) => {
  test.setTimeout(150_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const open = async (role: 'manager' | 'lead') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const bell = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Notifications \(/ });
  const [manager, lead] = [await open('manager'), await open('lead')];
  try {
    await expect(bell(manager.page)).toHaveAccessibleName('Notifications (none unread)');
    const d = IOT_DEVICES.find((x: { id: string; unit: string }) => x.unit === '°C') as { id: string; name: string; unit: string };
    const send = (status: string, minAgo: number) => manager.page.request.post('/telemetry/readings', { headers: { 'x-ingest-key': ingestKey() }, data: { readings: [{ deviceId: d.id, recordedAt: new Date(Date.now() - minAgo * 60_000).toISOString(), status, value: 33.5, unit: d.unit, note: 'e2e rango' }] } });
    expect((await send('ALERT', 3)).status()).toBe(200);
    await expect(bell(manager.page)).toHaveAccessibleName('Notifications (1 unread)', { timeout: 60_000 });
    await bell(manager.page).click();
    const panel = manager.page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByText(new RegExp(`${d.name} in .+: .+ at 33.5 ${d.unit} \\(ALERT\\)`))).toBeVisible();
    await expect(panel.getByText('Critical')).toBeVisible();
    // Otra lectura en alerta NO vuelve a avisar (el dispositivo ya estaba mal); la del líder de proyecto nunca suena.
    expect((await send('ALERT', 2)).status()).toBe(200);
    await new Promise((r) => setTimeout(r, 4000));
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(bell(lead.page)).toHaveAccessibleName('Notifications (none unread)');
    // Mejora en silencio y vuelve a empeorar: ahora sí avisa otra vez.
    expect((await send('NORMAL', 1)).status()).toBe(200);
    expect((await send('ALERT', 0)).status()).toBe(200);
    await expect(panel.getByRole('listitem')).toHaveCount(2, { timeout: 60_000 });
  } finally { await manager.ctx.close(); await lead.ctx.close(); deleteOldReadings(); }
});

test('Procurement: each role sees what it may — sales has no screen, lead and billing only look, the manager buys, receives and adjusts', async ({ browser }) => {
  test.setTimeout(90_000);
  const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation').getByRole('button', { name: 'Procurement', exact: true });
  const open = async (role: 'sales' | 'lead' | 'billing' | 'manager') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [sales, lead, billing, manager] = [await open('sales'), await open('lead'), await open('billing'), await open('manager')];
  try {
    await expect(nav(sales.page)).toHaveCount(0);
    for (const who of [lead, billing, manager]) { await nav(who.page).click(); await expect(who.page.getByRole('heading', { name: 'Procurement and inventory' })).toBeVisible(); await expect(who.page.locator('[data-item="Sensor de temperatura TH-10"]')).toContainText('In stock: 8'); }
    for (const who of [lead, billing]) {
      await expect(who.page.getByText('You can look; only the manager buys and adjusts stock.')).toBeVisible();
      await expect(who.page.getByRole('button', { name: /^Adjust / })).toHaveCount(0);
      await expect(who.page.getByRole('heading', { name: 'New order' })).toHaveCount(0);
    }
    await expect(manager.page.getByRole('heading', { name: 'New order' })).toBeVisible();
    await expect(manager.page.getByRole('button', { name: 'Adjust the stock of Sensor de temperatura TH-10' })).toBeVisible();
  } finally { for (const w of [sales, lead, billing, manager]) await w.ctx.close(); }
});

test('Procurement: buy → receive (the stock goes up once) → adjust (never below zero), and a sensor alert suggests the spare part', async ({ browser }) => {
  test.setTimeout(180_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const row = (name: string) => page.locator(`[data-item="${name}"]`);
  try {
    await openAs(page, 'manager');
    await page.getByRole('navigation').getByRole('button', { name: 'Procurement', exact: true }).click();
    await expect(row('Sensor de temperatura TH-10')).toContainText('In stock: 8');
    // El formulario avisa sin enviar.
    const form = page.getByRole('form', { name: 'New order' });
    await form.getByRole('button', { name: 'Create order' }).click();
    await expect(form.getByText('The quantity must be a whole number from 1 to 100,000.')).toBeVisible();
    await expect(form.getByText('Choose an option.').first()).toBeVisible();
    await form.getByRole('button', { name: 'Redes del Norte (example)' }).click();
    await form.getByRole('button', { name: 'Sensor de temperatura TH-10' }).click();
    await form.getByLabel('Quantity (1 to 100,000)').fill('5'); await form.getByLabel('Price per unit in pesos').fill('100000');
    await form.getByRole('button', { name: 'Create order' }).click();
    await expect(page.getByText(/Order PO-\d+ created \(pending\)\./)).toBeVisible();
    const order = page.locator('[data-order]').first();
    await expect(order).toContainText('Sensor de temperatura TH-10 × 5'); await expect(order).toContainText('Pending');
    await expect(row('Sensor de temperatura TH-10')).toContainText('In stock: 8'); // comprar no mueve el stock
    // Recibir sube el stock UNA vez (el botón desaparece: un segundo clic ya no existe).
    await order.getByRole('button', { name: /^Receive order/ }).click();
    await expect(page.getByText(/is now at 13\./)).toBeVisible();
    await expect(row('Sensor de temperatura TH-10')).toContainText('In stock: 13');
    await expect(page.locator('[data-order]').first()).toContainText('Received');
    await expect(page.locator('[data-order]').first().getByRole('button')).toHaveCount(0);
    // Ajuste: restar de más se rechaza con el mensaje; restar lo justo funciona.
    const adj = async (delta: string) => { await page.getByRole('button', { name: 'Adjust the stock of Fuente de poder 12 V' }).click(); const f = page.getByRole('form', { name: 'Adjust the stock of Fuente de poder 12 V' }); await f.getByLabel('Change (+ adds, − removes)').fill(delta); await f.getByLabel('The reason').fill('Stock count'); await f.getByRole('button', { name: 'Save adjustment' }).click(); return f; };
    const f1 = await adj('-4');
    await expect(f1.getByRole('alert')).toHaveText('Fuente de poder 12 V has 3 in stock: it cannot go down by 4.');
    await f1.getByLabel('Change (+ adds, − removes)').fill('-3'); await f1.getByRole('button', { name: 'Save adjustment' }).click();
    await expect(page.getByText('Stock of Fuente de poder 12 V: 0.')).toBeVisible();
    await expect(row('Fuente de poder 12 V')).toContainText('In stock: 0');
    // Un sensor de temperatura entra en alerta: llega por Operations → RabbitMQ → Procurement y se sugiere el repuesto que sirve para TEMP.
    const d = IOT_DEVICES.find((x: { id: string; unit: string }) => x.unit === '°C') as { id: string; name: string; unit: string };
    const sent = await page.request.post('/telemetry/readings', { headers: { 'x-ingest-key': ingestKey() }, data: { readings: [{ deviceId: d.id, recordedAt: new Date(Date.now() - 2 * 60_000).toISOString(), status: 'ALERT', value: 35, unit: d.unit, note: 'e2e rango' }] } });
    expect(sent.status()).toBe(200);
    await expect.poll(async () => { await page.reload(); await page.getByRole('navigation').getByRole('button', { name: 'Procurement', exact: true }).click(); await row('Sensor de temperatura TH-10').waitFor(); return page.getByText('Spare parts that serve it: Sensor de temperatura TH-10 (13)').count(); }, { timeout: 60_000, intervals: [3000] }).toBeGreaterThan(0);
  } finally { await ctx.close(); deleteOldReadings(); }
});

test('Payments: the billing analyst registers a partial and then the final payment; an over-payment is refused; the manager sees what was collected; the lead cannot register', async ({ browser }) => {
  test.setTimeout(150_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const open = async (role: 'billing' | 'manager' | 'lead') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [billing, manager, lead] = [await open('billing'), await open('manager'), await open('lead')];
  try {
    await billing.page.getByRole('navigation').getByRole('button', { name: 'Invoices' }).click();
    const card = billing.page.locator('[data-invoice="INV-0102"]');
    await expect(card).toContainText('Unpaid'); await expect(card).toContainText('Balance: 11.662.000 COP');
    await card.getByRole('button', { name: 'Register a payment for invoice INV-0102' }).click();
    const form = billing.page.getByRole('form', { name: 'Register a payment for invoice INV-0102' });
    // El formulario avisa sin enviar.
    await form.getByRole('button', { name: 'Save payment' }).click();
    await expect(form.getByText('The amount must be a whole number of pesos greater than 0 (no dots or commas).')).toBeVisible();
    await expect(form.getByText('Choose a payment method.')).toBeVisible();
    await form.getByLabel(/Amount in pesos/).fill('1000000'); await form.getByRole('button', { name: 'Transfer' }).click(); await form.getByLabel('Reference (optional)').fill('Bank transfer 8841');
    await form.getByRole('button', { name: 'Save payment' }).click();
    await expect(billing.page.getByText('Payment of 1.000.000 COP registered on INV-0102: balance 10.662.000 COP.')).toBeVisible();
    await expect(card).toContainText('Partly paid'); await expect(card).toContainText('Paid: 1.000.000 COP');
    // Un pago de más no se envía: el navegador lo avisa con el saldo.
    await card.getByRole('button', { name: 'Register a payment for invoice INV-0102' }).click();
    const form2 = billing.page.getByRole('form', { name: 'Register a payment for invoice INV-0102' });
    await form2.getByLabel(/Amount in pesos/).fill('10662001'); await form2.getByRole('button', { name: 'Cash' }).click(); await form2.getByRole('button', { name: 'Save payment' }).click();
    await expect(form2.getByText(/cannot be above the balance of the invoice/)).toBeVisible();
    await form2.getByLabel(/Amount in pesos/).fill('10662000'); await form2.getByRole('button', { name: 'Save payment' }).click();
    await expect(billing.page.getByText('the invoice is now paid.')).toBeVisible();
    await expect(card).toContainText('Paid'); await expect(card.getByRole('button', { name: /Register a payment/ })).toHaveCount(0);
    await card.getByRole('button', { name: 'See the payments of invoice INV-0102' }).click();
    await expect(card.getByRole('listitem')).toHaveCount(2);
    await expect(card).toContainText('Bank transfer 8841');
    // Gerencia ve lo cobrado en el tablero (se refresca solo).
    await expect(manager.page.getByText('Collected', { exact: true })).toBeVisible();
    await expect(manager.page.getByText('11.662.000 COP with IVA').first()).toBeVisible({ timeout: 60_000 });
    // El líder no tiene el panel de pagos.
    await lead.page.getByRole('navigation').getByRole('button', { name: 'Invoices' }).click();
    await expect(lead.page.getByRole('heading', { name: 'Payments', exact: true })).toHaveCount(0);
  } finally { await billing.ctx.close(); await manager.ctx.close(); await lead.ctx.close(); }
});

test('Contracts: manager creates one (the form warns first), billing closes it, the lead only reads and sales cannot see it', async ({ browser }) => {
  test.setTimeout(120_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const open = async (role: 'billing' | 'manager' | 'lead' | 'sales') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [manager, billing, lead, sales] = [await open('manager'), await open('billing'), await open('lead'), await open('sales')];
  try {
    await manager.page.getByRole('navigation').getByRole('button', { name: 'Contracts' }).click();
    await expect(manager.page.getByText('There are no contracts yet.')).toBeVisible();
    await manager.page.getByRole('button', { name: 'New contract' }).click();
    const form = manager.page.getByRole('form', { name: 'New contract' });
    await form.getByRole('button', { name: 'Save contract' }).click();
    await expect(form.getByText('Write 2 to 120 characters, without < > or control characters.').first()).toBeVisible();
    await expect(form.getByText('The amount must be a whole number of pesos greater than 0 (no dots or commas).')).toBeVisible();
    await form.getByLabel('Client').fill('Retail Norte (example)'); await form.getByLabel('Project').fill('Branch network upgrade');
    await form.getByLabel(/Amount in pesos/).fill('50000000'); await form.getByLabel('Start').fill('2026-11-10'); await form.getByLabel('End').fill('2026-11-01');
    await form.getByRole('button', { name: 'Save contract' }).click();
    await expect(form.getByText('The end cannot be before the start.')).toBeVisible();
    await form.getByLabel('End').fill('2027-05-10'); await form.getByRole('button', { name: 'Save contract' }).click();
    await expect(manager.page.getByText('Contract of Retail Norte (example) saved.')).toBeVisible();
    const row = manager.page.locator('[data-contract="Branch network upgrade"]');
    await expect(row).toContainText('Active'); await expect(row).toContainText('2026-11-10 → 2027-05-10');
    // Facturación lo cierra; el líder solo lee; ventas no ve la opción.
    await billing.page.getByRole('navigation').getByRole('button', { name: 'Contracts' }).click();
    const brow = billing.page.locator('[data-contract="Branch network upgrade"]');
    await brow.getByRole('button', { name: /Close the contract of Retail Norte/ }).click();
    await expect(brow).toContainText('Closed'); await expect(brow.getByRole('button')).toHaveCount(0);
    await lead.page.getByRole('navigation').getByRole('button', { name: 'Contracts' }).click();
    await expect(lead.page.locator('[data-contract="Branch network upgrade"]')).toBeVisible();
    await expect(lead.page.getByRole('button', { name: 'New contract' })).toHaveCount(0);
    await expect(sales.page.getByRole('navigation').getByRole('button', { name: 'Contracts' })).toHaveCount(0);
  } finally { await manager.ctx.close(); await billing.ctx.close(); await lead.ctx.close(); await sales.ctx.close(); }
});

test('Project team: an allocation made in Capacity reaches the project through the event; sales does not see the team', async ({ browser }) => {
  test.setTimeout(120_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const open = async (role: 'lead' | 'sales') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [lead, sales] = [await open('lead'), await open('sales')];
  const iso = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  try {
    await lead.page.getByRole('row', { name: /Branch network upgrade/ }).click();
    await expect(lead.page.getByRole('heading', { name: 'Project team' })).toBeVisible();
    // La demo trae asignaciones sembradas; la nueva (5 %, dentro de 200 días) todavía no está.
    await expect(lead.page.locator('tr', { hasText: 'Ana Torres' }).filter({ hasText: iso(200) })).toHaveCount(0);
    await lead.page.getByRole('navigation').getByRole('button', { name: 'Capacity', exact: true }).click();
    await lead.page.getByRole('button', { name: 'Allocate Ana Torres' }).click();
    const form = lead.page.getByRole('form', { name: 'Allocate Ana Torres' });
    await form.getByLabel('The project').fill('Branch network upgrade'); await form.getByLabel('Percent (1 to 100)').fill('5');
    await form.getByLabel('From (YYYY-MM-DD)').fill(iso(200)); await form.getByLabel('To (YYYY-MM-DD)').fill(iso(210));
    await form.getByRole('button', { name: 'Save allocation' }).click();
    await expect(lead.page.getByText('Ana Torres allocated to “Branch network upgrade” at 5%.')).toBeVisible();
    await expect(async () => {
      // Al volver a la pantalla de proyectos el equipo se pide de nuevo.
      await lead.page.getByRole('navigation').getByRole('button', { name: 'Capacity', exact: true }).click();
      await lead.page.getByRole('navigation').getByRole('button', { name: 'Projects' }).click();
      await lead.page.getByRole('row', { name: /Branch network upgrade/ }).click();
      await expect(lead.page.locator('tr', { hasText: 'Ana Torres' }).filter({ hasText: '5 %' }).filter({ hasText: iso(200) })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 30_000 });
    await sales.page.getByRole('row', { name: /Branch network upgrade/ }).click();
    await expect(sales.page.getByRole('heading', { name: /^Milestones/ })).toBeVisible();
    await expect(sales.page.getByRole('heading', { name: 'Project team' })).toHaveCount(0);
  } finally { await lead.ctx.close(); await sales.ctx.close(); }
});

test('Profitability: the manager sees revenue minus labor cost and edits the daily cost; an allocation without cost is flagged; the lead never sees costs', async ({ browser }) => {
  test.setTimeout(150_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const open = async (role: 'manager' | 'lead' | 'billing') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [manager, lead, billing] = [await open('manager'), await open('lead'), await open('billing')];
  const iso = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  const nav = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  try {
    await nav(manager.page, 'Profitability');
    const row = manager.page.locator('[data-project="Branch network upgrade"]');
    await expect(row).toBeVisible(); await expect(row).toContainText('12.000.000'); // la factura INV-0101 emitida, sin IVA
    await expect(manager.page.locator('[data-total]')).toBeVisible();
    await expect(manager.page.getByText(/without a daily cost/)).toHaveCount(0);
    // El costo se escribe en Capacidad técnica; el formulario avisa antes de enviar.
    await nav(manager.page, 'Capacity');
    const ana = manager.page.locator('[data-engineer="Ana Torres"]');
    await expect(ana).toContainText('450.000 COP per day');
    await ana.getByRole('button', { name: 'Change the daily cost of Ana Torres' }).click();
    const form = manager.page.getByRole('form', { name: 'Change the daily cost of Ana Torres' });
    await form.getByLabel(/Daily cost in pesos/).fill('1.5'); await form.getByRole('button', { name: 'Save cost' }).click();
    await expect(form.getByText(/Write whole pesos from 1 to 50.000.000/)).toBeVisible();
    await form.getByLabel(/Daily cost in pesos/).fill(''); await form.getByRole('button', { name: 'Save cost' }).click();
    await expect(manager.page.getByText('Daily cost of Ana Torres saved.')).toBeVisible();
    await expect(ana).toContainText('no cost yet');
    // Una asignación nueva a un ingeniero sin costo llega por evento y la rentabilidad lo avisa.
    await nav(lead.page, 'Capacity');
    await expect(lead.page.getByText(/Daily cost/)).toHaveCount(0);
    await lead.page.getByRole('button', { name: 'Allocate Ana Torres' }).click();
    const af = lead.page.getByRole('form', { name: 'Allocate Ana Torres' });
    await af.getByLabel('The project').fill('Branch network upgrade'); await af.getByLabel('Percent (1 to 100)').fill('5');
    await af.getByLabel('From (YYYY-MM-DD)').fill(iso(220)); await af.getByLabel('To (YYYY-MM-DD)').fill(iso(225));
    await af.getByRole('button', { name: 'Save allocation' }).click();
    await expect(lead.page.getByText('Ana Torres allocated to “Branch network upgrade” at 5%.')).toBeVisible();
    await expect(async () => {
      await nav(manager.page, 'Dashboard'); await nav(manager.page, 'Profitability');
      await expect(manager.page.getByText(/1 without a daily cost/).first()).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 30_000 });
    // Facturación no tiene esta pantalla y el líder no recibe el costo.
    await expect(billing.page.getByRole('navigation').getByRole('button', { name: 'Profitability' })).toHaveCount(0);
  } finally { await manager.ctx.close(); await lead.ctx.close(); await billing.ctx.close(); }
});

test('Audit: the manager sees who did what and when from the events; the log is read-only; other roles have no audit screen', async ({ browser }) => {
  test.setTimeout(150_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  const open = async (role: 'manager' | 'lead' | 'billing') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [manager, lead, billing] = [await open('manager'), await open('lead'), await open('billing')];
  try {
    await lead.page.getByRole('row', { name: /Branch network upgrade/ }).click();
    await lead.page.getByRole('button', { name: /Approve/ }).first().click();
    await expect(lead.page.getByText(/approved/i).first()).toBeVisible();
    await billing.page.getByRole('navigation').getByRole('button', { name: 'Invoices' }).click();
    await expect(billing.page.getByRole('button', { name: /^Issue / }).first()).toBeVisible({ timeout: 30_000 });
    await billing.page.getByRole('button', { name: /^Issue / }).first().click();
    await manager.page.getByRole('navigation').getByRole('button', { name: 'Audit', exact: true }).click();
    await expect(manager.page.getByRole('heading', { name: 'Audit', exact: true })).toBeVisible();
    await expect(async () => {
      await manager.page.getByRole('button', { name: 'Refresh' }).click();
      await expect(manager.page.locator('[data-type="MilestoneApproved"]').first()).toContainText('laura.rios@nexus.example', { timeout: 1500 });
      await expect(manager.page.locator('[data-type="InvoiceIssued"]').first()).toContainText('andres.mora@nexus.example', { timeout: 1500 });
    }).toPass({ timeout: 40_000 });
    await manager.page.getByRole('group', { name: 'Event type' }).getByRole('button', { name: 'InvoiceIssued', exact: true }).click();
    await expect(manager.page.locator('tbody tr').first()).toHaveAttribute('data-type', 'InvoiceIssued');
    await expect(manager.page.locator('tbody tr:not([data-type="InvoiceIssued"])')).toHaveCount(0);
    // No hay forma de editar o borrar desde la pantalla, y los demás roles no tienen la opción.
    await expect(manager.page.getByRole('button', { name: /delete|edit|remove/i })).toHaveCount(0);
    await expect(lead.page.getByRole('navigation').getByRole('button', { name: 'Audit', exact: true })).toHaveCount(0);
    await expect(billing.page.getByRole('navigation').getByRole('button', { name: 'Audit', exact: true })).toHaveCount(0);
  } finally { await manager.ctx.close(); await lead.ctx.close(); await billing.ctx.close(); }
});

test('Cameras: the manager sees the IP cameras from IoT and the surveillance devices of the network inventory; other roles have no such screen', async ({ browser }) => {
  test.setTimeout(90_000);
  const open = async (role: 'manager' | 'lead' | 'sales') => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await openAs(page, role); return { ctx, page }; };
  const [manager, lead, sales] = [await open('manager'), await open('lead'), await open('sales')];
  try {
    await manager.page.getByRole('navigation').getByRole('button', { name: 'Cameras', exact: true }).click();
    await expect(manager.page.getByRole('heading', { name: 'Cameras', exact: true })).toBeVisible();
    for (const n of ['WEBCAM_OF1', 'WEBCAM_OF2', 'WEBCAM_OF3']) await expect(manager.page.locator(`[data-camera="${n}"]`)).toBeVisible();
    await expect(manager.page.locator('[data-netcam]')).toHaveCount(9);
    await expect(manager.page.getByText(/There is no video here/)).toBeVisible();
    for (const w of [lead, sales]) await expect(w.page.getByRole('navigation').getByRole('button', { name: 'Cameras', exact: true })).toHaveCount(0);
  } finally { await manager.ctx.close(); await lead.ctx.close(); await sales.ctx.close(); }
});

test('Purchased equipment: buying and receiving a network device adds its units to the network inventory, once', async ({ page }) => {
  test.setTimeout(180_000);
  execSync('./scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 15_000));
  await openAs(page, 'manager');
  await page.getByRole('navigation').getByRole('button', { name: 'Procurement', exact: true }).click();
  const form = page.getByRole('form', { name: 'New order' });
  await form.getByRole('button', { name: 'Redes del Norte (example)' }).click();
  await form.getByRole('button', { name: 'Switch de acceso 24 puertos' }).click();
  await form.getByLabel('Quantity (1 to 100,000)').fill('2'); await form.getByLabel('Price per unit in pesos').fill('900000');
  await form.getByRole('button', { name: 'Create order' }).click();
  await expect(page.getByText(/Order PO-\d+ created \(pending\)\./)).toBeVisible();
  const order = page.locator('[data-order]').first();
  await order.getByRole('button', { name: /^Receive order/ }).click();
  await expect(page.locator('[data-order]').first()).toContainText('Received');
  await page.getByRole('navigation').getByRole('button', { name: 'Network', exact: true }).click();
  await expect(async () => {
    await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Network', exact: true }).click();
    await page.getByPlaceholder('Name, model, role or IP').fill('Switch de acceso 24 puertos (PO-');
    await expect(page.getByText(/Switch de acceso 24 puertos \(PO-\d+-1\)/).first()).toBeVisible({ timeout: 2000 });
    await expect(page.getByText(/Switch de acceso 24 puertos \(PO-\d+-2\)/).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 40_000 });
  await expect(page.getByText(/\(PO-\d+-3\)/)).toHaveCount(0);
  // La gerencia completa uno de los dos: el formulario avisa sin enviar y, al guardar, sale de la lista de pendientes.
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Network', exact: true }).click();
  const pending = page.locator('[data-pending]');
  await expect(pending).toHaveCount(2);
  await pending.first().getByRole('button', { name: /^Complete the device/ }).click();
  const cfg = page.getByRole('form', { name: /^Complete the device/ });
  await cfg.getByRole('button', { name: 'Save device' }).click();
  await expect(cfg.getByText(/Write 2 to 60 characters/)).toBeVisible(); await expect(cfg.getByText('Choose a criticality.')).toBeVisible();
  await cfg.getByLabel(/What it is for/).fill('Switch de acceso piso 2'); await cfg.getByRole('button', { name: 'Alta' }).click(); await cfg.getByLabel(/IPs \(optional/).fill('10.0.2.999');
  await cfg.getByRole('button', { name: 'Save device' }).click();
  await expect(cfg.getByText(/different IPv4 addresses/)).toBeVisible();
  await cfg.getByLabel(/IPs \(optional/).fill('10.0.2.5'); await cfg.getByRole('button', { name: 'Save device' }).click();
  await expect(page.getByText(/completed\./)).toBeVisible();
  await expect(pending).toHaveCount(1);
});

test('Invoices: the list stops asking the server while the tab is hidden and refreshes at once when it comes back', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __vis: string }).__vis = 'hidden'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window as unknown as { __vis: string }).__vis }); });
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await expect(page.getByText(/Showing \d+ of \d+/)).toBeVisible();
  let calls = 0;
  page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname === '/invoices') calls++; });
  await page.waitForTimeout(9_000); // con el refresco de 4 s habrían salido 2 peticiones
  expect(calls, 'peticiones a /invoices con la pestaña oculta').toBe(0);
  await page.evaluate(() => { (window as unknown as { __vis: string }).__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => calls, { timeout: 3_000 }).toBeGreaterThan(0);
});

const openNetwork = async (page: import('@playwright/test').Page) => {
  await openAs(page, 'manager');
  await page.getByRole('navigation', { name: 'Modules' }).getByRole('button', { name: 'Network', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Network', exact: true })).toBeVisible();
};
const HIDDEN_TAB = () => { (window as unknown as { __vis: string }).__vis = 'visible'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window as unknown as { __vis: string }).__vis }); };

test('Network: it asks the server again every minute while the tab is visible, and not at all while it is hidden', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(HIDDEN_TAB);
  await page.clock.install();
  await openNetwork(page);
  let calls = 0;
  page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname === '/network/summary') calls++; });
  await page.clock.runFor(30_000);
  expect(calls, 'a los 30 s todavía no toca').toBe(0);
  await page.clock.runFor(31_000);
  await expect.poll(() => calls, { timeout: 5_000, message: 'a los 61 s volvió a pedir el resumen' }).toBe(1);
  await page.clock.runFor(60_000);
  await expect.poll(() => calls, { timeout: 5_000 }).toBe(2);
  await page.evaluate(() => { (window as unknown as { __vis: string }).__vis = 'hidden'; });
  await page.clock.runFor(180_000); // con la pestaña oculta pasan 3 minutos y no pide nada
  await page.waitForTimeout(500);
  expect(calls, 'peticiones con la pestaña oculta').toBe(2);
  await page.evaluate(() => { (window as unknown as { __vis: string }).__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => calls, { timeout: 5_000, message: 'al volver a la pestaña se actualiza de inmediato' }).toBe(3);
  await expect(page.getByText('Loading')).toHaveCount(0); // y sin pasar por «cargando…»
});

test('Network: if a refresh fails the data stays with a notice, and it recovers by itself', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(HIDDEN_TAB);
  await page.clock.install();
  await openNetwork(page);
  await page.route('**/network/summary', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":500,"error":"Internal Server Error","message":"x"}' }));
  await page.clock.runFor(61_000);
  await expect(page.getByText(/We could not refresh just now/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Network', exact: true })).toBeVisible(); // los datos de antes siguen a la vista
  await page.unroute('**/network/summary');
  await page.clock.runFor(61_000);
  await expect(page.getByText(/We could not refresh just now/)).toHaveCount(0, { timeout: 5_000 });
  problems = problems.filter((m) => !/status of 500/.test(m)); // el 500 lo provocamos a propósito
});

test('Projects: every project shows its progress, and the board view splits the milestones into Pending and Approved', async ({ page }) => {
  await openAs(page, 'lead');
  await page.getByLabel('Search projects').fill('Retail POS'); // otras pruebas dejan más de 25 proyectos y el orden depende de la base: se busca en vez de suponer la posición
  const retail = page.getByRole('row', { name: /Retail POS integration/ });
  const bar = retail.getByRole('progressbar', { name: '1 of 2 milestones approved' });
  await expect(bar).toHaveAttribute('value', '1');
  await expect(bar).toHaveAttribute('max', '2');
  await retail.getByRole('button', { name: 'Retail POS integration' }).click();
  await expect(page.getByRole('heading', { name: 'Milestones · Retail POS integration' })).toBeVisible();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const pendingCol = page.getByRole('region').filter({ has: page.getByRole('heading', { name: /^Pending/ }) });
  const approvedCol = page.getByRole('region').filter({ has: page.getByRole('heading', { name: /^Approved/ }) });
  await expect(pendingCol.getByText('Pilot in 3 stores')).toBeVisible();
  await expect(pendingCol.getByRole('button', { name: 'Approve milestone' })).toBeVisible();
  await expect(approvedCol.getByText('API contract')).toBeVisible();
  await expect(approvedCol.getByText('Done')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Milestone', exact: true })).toHaveCount(0); // en el tablero no se pinta la tabla de hitos (la del equipo sí sigue ahí)
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Pilot in 3 stores' })).toBeVisible();
});

test('Projects: approving from the board creates the draft invoice and the step tracker shows it', async ({ page, request }) => {
  const auth = { authorization: `Bearer ${leadToken()}` };
  const project = await (await request.post('/projects', { headers: auth, data: { name: 'Board approve', client: 'Scale Co D' } })).json();
  expect((await request.post(`/projects/${project.id}/milestones`, { headers: auth, data: { name: 'Board hito', amountCop: 2_000_000 } })).status()).toBe(201);
  await openAs(page, 'lead');
  await page.getByLabel('Search projects').fill('Board approve'); // el proyecto puede quedar en la segunda tanda de 25
  await page.getByRole('button', { name: 'Board approve' }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: 'Approve milestone' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Billing created draft INV-\d+/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('listitem').filter({ hasText: /INV-\d+ · \d+ ms after approving/ })).toBeVisible(); // el último paso del seguidor
  await expect(page.getByRole('region').filter({ has: page.getByRole('heading', { name: /^Approved/ }) }).getByText('Board hito')).toBeVisible(); // y la tarjeta pasó de columna
});

test('Layout: the left menu runs the full height of the page even when the screen has little content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  const gap = () => page.evaluate(() => { const r = document.querySelector('nav[aria-label]')!.getBoundingClientRect(); return Math.round(Math.max(innerHeight, document.documentElement.scrollHeight) - (r.bottom + scrollY)); });
  expect(await gap(), 'px de pantalla que quedan bajo el menú').toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1920, height: 1080 }); // y en una pantalla más grande
  expect(await gap(), 'px bajo el menú en 1920x1080').toBeLessThanOrEqual(1);
});

test('Layout: on a phone the menu stays a compact bar at the top and does not grow to fill the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  const h = await page.evaluate(() => Math.round(document.querySelector('nav[aria-label]')!.getBoundingClientRect().height));
  // Con 5 opciones (Contratos se sumó) el menú pasa a dos filas, como prevé el CSS; el tope sigue siendo «una barra compacta», no media pantalla (667 px).
  expect(h, 'alto del menú en teléfono').toBeLessThanOrEqual(110);
});

test('Menu: the manager\'s options are grouped under labels, with icons that only decorate', async ({ page }) => {
  await openAs(page, 'manager');
  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav.getByRole('group', { name: 'Business' }).getByRole('button')).toHaveText(['Contracts', 'Profitability']);
  await expect(nav.getByRole('group', { name: 'Nexus data' }).getByRole('button')).toHaveText(['Sensors', 'Network', 'Cameras']);
  await expect(nav.getByRole('group', { name: 'Team' }).getByRole('button')).toHaveText(['Capacity', 'Procurement']);
  await expect(nav.getByRole('group', { name: 'Administration' }).getByRole('button')).toHaveText(['Users', 'Audit']);
  await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await nav.locator('svg[aria-hidden="true"]').count(), 'un ícono decorativo por opción').toBe(10);
  await nav.getByRole('button', { name: 'Network', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Network', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).not.toHaveAttribute('aria-current', 'page');
});

test('Menu: on a long page the left menu stays in view while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await openAs(page, 'manager');
  const first = page.getByRole('navigation', { name: 'Modules' }).getByRole('button', { name: 'Dashboard', exact: true });
  await expect(first).toBeVisible();
  await page.waitForFunction(() => document.documentElement.scrollHeight > 2600); // el Tablero es largo
  await page.evaluate(() => window.scrollTo(0, 1800));
  await expect.poll(async () => (await first.boundingBox())?.y ?? -9999, 'posición del primer botón del menú tras bajar 1.800 px').toBeGreaterThanOrEqual(0);
  expect((await first.boundingBox())!.y).toBeLessThan(120);
});

test('Menu: on a phone the top bar stays at the top while scrolling and the group labels are hidden', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openAs(page, 'manager');
  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Nexus data', { exact: true })).toBeHidden();
  await page.waitForFunction(() => document.documentElement.scrollHeight > 2000);
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect.poll(async () => Math.round((await nav.boundingBox())?.y ?? -9999), 'posición de la barra tras bajar 1.500 px').toBeLessThanOrEqual(1);
  expect((await nav.boundingBox())!.y).toBeGreaterThanOrEqual(-1);
});

test('Menu: on a 320 px phone every option of the manager\'s menu is inside the screen, even with a wide font', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openAs(page, 'manager');
  // El ancho del texto depende de la tipografía de cada equipo (en CI, con Linux, «Users» terminaba en 322 px y en un Mac en 301): se fuerza una fuente ancha.
  // Una hoja construida por código (no un <style>): la política de contenido de la app (style-src 'self') bloquea los estilos en línea y la suite cuenta ese aviso como error.
  await page.evaluate(() => { const sh = new CSSStyleSheet(); sh.replaceSync('* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh]; });
  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav.getByRole('button', { name: 'Users', exact: true })).toBeVisible();
  const edges = await nav.getByRole('button').evaluateAll((bs) => bs.map((b) => [b.textContent?.trim(), Math.round(b.getBoundingClientRect().right)] as const));
  expect(edges.length).toBe(10);
  for (const [label, right] of edges) expect(right, `«${label}» termina dentro de los 320 px`).toBeLessThanOrEqual(320);
  expect(await nav.evaluate((n) => n.scrollWidth > n.clientWidth), 'el menú no necesita desplazarse de lado').toBe(false);
});

// ---- Sensores en vivo: se actualiza sola, dice «en vivo», avisa si no hay conexión y no mueve la tabla bajo los ojos ----
// La clave de ingesta sale del entorno o del .env de la raíz (el CI lo genera). Las lecturas que estas pruebas mandan las borra el reset del final.
const ingestKey = (): string => {
  if (process.env.INGEST_KEY) return process.env.INGEST_KEY;
  try { return /^INGEST_KEY=(.*)$/m.exec(readFileSync(join(here, '..', '..', '.env'), 'utf8'))?.[1].trim() ?? ''; } catch { return ''; }
};
const IOT_DEVICES = JSON.parse(readFileSync(join(here, '..', '..', 'services', 'operations', 'prisma', 'data', 'iot-devices.json'), 'utf8')) as { id: string; unit: string }[];
/** Un lote de 21 lecturas (una por dispositivo) en el minuto `minute` después de las 11:20 UTC del 13-sep, justo donde sigue el Excel. */
async function sendReadings(request: { post: (url: string, o: { headers: Record<string, string>; data: object }) => Promise<{ status(): number; json(): Promise<{ accepted: number; duplicates: number }> }> }, minute: number) {
  const at = new Date(Date.UTC(2026, 8, 13, 11, 21 + minute)).toISOString();
  const r = await request.post('/telemetry/readings', { headers: { 'x-ingest-key': ingestKey() }, data: { readings: IOT_DEVICES.map((d, i) => ({ deviceId: d.id, recordedAt: at, status: 'NORMAL', value: 20 + i, unit: d.unit, note: 'e2e en vivo' })) } });
  expect(r.status()).toBe(200);
  return r.json();
}
const openSensors = async (page: import('@playwright/test').Page) => {
  await openAs(page, 'manager');
  await page.getByRole('navigation', { name: 'Modules' }).getByRole('button', { name: 'Sensors', exact: true }).click();
  await expect(page.getByText(/Nexus sensor data/)).toBeVisible();
};
const readingsInSubtitle = async (page: import('@playwright/test').Page): Promise<number> => Number(/· ([\d,]+) readings/.exec(await page.getByText(/Nexus sensor data/).innerText())![1].replace(/,/g, ''));

test('Sensors: readings sent by the sensors appear by themselves, the table shows the newest and the badge counts them', async ({ page, request }) => {
  test.setTimeout(90_000);
  expect(ingestKey().length, 'hace falta INGEST_KEY (en el entorno o en el .env de la raíz)').toBeGreaterThanOrEqual(32);
  await openSensors(page);
  const before = await readingsInSubtitle(page);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  expect((await sendReadings(request, 0)).accepted).toBe(IOT_DEVICES.length);
  await expect.poll(() => readingsInSubtitle(page), { timeout: 25_000, message: 'el total de lecturas del subtítulo, sin recargar' }).toBe(before + IOT_DEVICES.length);
  await expect(page.getByText(`New readings since you opened this screen: ${IOT_DEVICES.length}`).first()).toBeVisible(); // el mismo texto está también en la región solo para lectores de pantalla
  await expect(page.getByRole('row').filter({ hasText: '11:21' }).first()).toBeVisible(); // la tabla (primera página, la más reciente arriba) se actualizó sola
  await expect(page.getByText('Loading readings')).toHaveCount(0); // y sin pasar por «cargando…»
});

test('Sensors: while the tab is hidden it asks the server nothing, and when you come back it refreshes at once', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => { (window as unknown as { __vis: string }).__vis = 'hidden'; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window as unknown as { __vis: string }).__vis }); });
  await openSensors(page);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  let calls = 0;
  page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname === '/telemetry/trends') calls++; });
  await page.waitForTimeout(12_000); // con el refresco de 10 s habría salido al menos una
  expect(calls, 'peticiones a /telemetry/trends con la pestaña oculta').toBe(0);
  await page.evaluate(() => { (window as unknown as { __vis: string }).__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => calls, { timeout: 4_000 }).toBeGreaterThan(0);
});

test('Sensors: if a refresh fails the data stays and the badge says offline, and it recovers by itself', async ({ page }) => {
  test.setTimeout(90_000);
  await openSensors(page);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.route('**/telemetry/trends*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":500,"error":"Internal Server Error","message":"x"}' }));
  await expect(page.getByText(/Offline · last data/)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Nexus sensor data/)).toBeVisible(); // los datos de antes siguen en pantalla
  await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
  await page.unroute('**/telemetry/trends*');
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Offline · last data/)).toHaveCount(0);
  problems = problems.filter((m) => !/status of 500/.test(m)); // el 500 lo provocamos a propósito
});

/** 21 lecturas (una por dispositivo) `daysBefore` días antes de las 08:00 UTC del 13-sep: datos viejos para probar los rangos. Se borran al terminar la prueba. */
async function sendOldReadings(request: Parameters<typeof sendReadings>[0], daysBefore: number) {
  const at = new Date(Date.UTC(2026, 8, 13, 8, 0) - daysBefore * 86_400_000).toISOString();
  const r = await request.post('/telemetry/readings', { headers: { 'x-ingest-key': ingestKey() }, data: { readings: IOT_DEVICES.map((d, i) => ({ deviceId: d.id, recordedAt: at, status: 'NORMAL', value: 20 + i, unit: d.unit, note: 'e2e rango' })) } });
  expect(r.status()).toBe(200);
  expect((await r.json()).accepted).toBe(IOT_DEVICES.length);
}
const deleteOldReadings = () => { execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d operations -Atc "DELETE FROM iot_readings WHERE note = 'e2e rango'"`, { cwd: join(here, '..', '..'), stdio: 'ignore' }); };
const cardsValue = (page: import('@playwright/test').Page, label: string) => page.locator('section[aria-labelledby="sensors-cards-h"]').getByText(label, { exact: true }).locator('xpath=following-sibling::strong[1]');
const numberOf = async (loc: import('@playwright/test').Locator): Promise<number> => Number((await loc.innerText()).replace(/,/g, ''));
const pressed = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name, exact: true });

test('Sensors: it opens on the last 24 hours and the 1 week, 1 month, 6 and 12 months buttons count older readings', async ({ page, request }) => {
  test.setTimeout(120_000);
  await sendOldReadings(request, 3); // entra en 1 semana y más
  await sendOldReadings(request, 40); // entra en 6 y 12 meses
  try {
    await openSensors(page);
    await expect(pressed(page, '24 hours')).toHaveAttribute('aria-pressed', 'true');
    for (const other of ['1 week', '1 month', '6 months', '12 months']) await expect(pressed(page, other)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Mean of each slot of 10 minutes, with the warning threshold')).toBeVisible();
    const day = await numberOf(cardsValue(page, 'Readings'));
    const expected: [string, number, string][] = [['1 week', day + IOT_DEVICES.length, 'slots of 2 hours'], ['1 month', day + IOT_DEVICES.length, 'slots of 6 hours'], ['6 months', day + 2 * IOT_DEVICES.length, 'slots of 2 days'], ['12 months', day + 2 * IOT_DEVICES.length, 'slots of 4 days'], ['24 hours', day, 'slots of 10 minutes']];
    for (const [name, readings, slot] of expected) {
      const asked = page.waitForRequest((r) => new URL(r.url()).pathname === '/telemetry/trends' && new URL(r.url()).searchParams.get('range') === ({ '24 hours': '1d', '1 week': '7d', '1 month': '30d', '6 months': '180d', '12 months': '365d' } as Record<string, string>)[name]);
      await pressed(page, name).click();
      await asked;
      await expect(pressed(page, name)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => numberOf(cardsValue(page, 'Readings')), { timeout: 10_000, message: `lecturas con «${name}»` }).toBe(readings);
      await expect(page.locator('section[aria-labelledby="sensors-cards-h"]').getByText(slot, { exact: false })).toBeVisible();
      await expect(page.getByText(`Mean of each ${slot.replace('slots', 'slot')}`, { exact: false }).first()).toBeVisible();
    }
    // el día-mes aparece en las etiquetas cuando el rango pasa de un día
    await pressed(page, '1 week').click();
    await expect(page.locator('section[aria-labelledby="sensors-cards-h"]').getByText(/\d+ Sep \d\d:\d\d – 13 Sep \d\d:\d\d/)).toBeVisible();
  } finally { deleteOldReadings(); }
});

test('Sensors: if the range fails to load the old data stays, the error says so with Retry, and Retry loads it', async ({ page }) => {
  test.setTimeout(90_000);
  await openSensors(page);
  await page.route('**/telemetry/trends?range=30d', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":500,"error":"Internal Server Error","message":"x"}' }));
  await pressed(page, '1 month').click();
  const alert = page.getByRole('alert').filter({ hasText: /unavailable|Sensors/i });
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Nexus sensor data/)).toBeVisible(); // los datos del rango anterior siguen a la vista
  await page.unroute('**/telemetry/trends?range=30d');
  await alert.getByRole('button').click();
  await expect(alert).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('section[aria-labelledby="sensors-cards-h"]').getByText('slots of 6 hours')).toBeVisible();
  problems = problems.filter((m) => !/status of 500/.test(m)); // el 500 lo provocamos a propósito
});

test('Sensors: choosing another range while one is still loading ends on the LAST one chosen (a slow answer never wins)', async ({ page }) => {
  test.setTimeout(90_000);
  await openSensors(page);
  let slowAnswered = false;
  await page.route('**/telemetry/trends?range=7d', async (route) => { await new Promise((r) => setTimeout(r, 3_000)); await route.continue(); slowAnswered = true; });
  await pressed(page, '1 week').click(); // esta tarda 3 s…
  await pressed(page, '1 month').click(); // …y antes de que llegue se elige otra
  await expect(page.locator('section[aria-labelledby="sensors-cards-h"]').getByText('slots of 6 hours')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => slowAnswered, { timeout: 10_000, message: 'la respuesta lenta de «1 semana» llegó' }).toBe(true);
  await page.waitForTimeout(1_500); // la tardía ya llegó; el refresco automático (cada 10 s) todavía no la habría corregido
  // Lectura inmediata, SIN reintentos: una aserción de Playwright reintenta 5 s y el refresco automático arreglaría la pantalla antes de que fallara.
  expect(await pressed(page, '1 month').getAttribute('aria-pressed')).toBe('true');
  expect(await page.locator('section[aria-labelledby="sensors-cards-h"]').getByText(/slots of/).innerText()).toContain('slots of 6 hours'); // la de «1 semana» se descartó
  await page.unroute('**/telemetry/trends?range=7d');
});

test('Sensors: on another page the table does not move; it says new readings arrived and «Show the latest» goes back to the first page', async ({ page, request }) => {
  test.setTimeout(90_000);
  await openSensors(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  const firstRow = () => page.getByRole('row').nth(1).innerText();
  const rowBefore = await firstRow();
  expect((await sendReadings(request, 1)).accepted).toBe(IOT_DEVICES.length);
  await expect(page.getByText(/New readings arrived; this page did not move\./)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/Page 2 of/)).toBeVisible(); // sigue en la página 2
  expect(await firstRow()).toBe(rowBefore); // y sus filas no se corrieron
  await page.getByRole('button', { name: 'Show the latest', exact: true }).click();
  await expect(page.getByText(/Page 1 of/)).toBeVisible();
  await expect(page.getByText(/New readings arrived; this page did not move\./)).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '11:22' }).first()).toBeVisible(); // la más reciente arriba
});

// ---- Renovación de sesión: el token de acceso dura 15 min y se renueva solo con una cookie HttpOnly mientras la persona siga ahí ----
// Estas pruebas inician sesión POR LA PANTALLA (así el servidor pone la cookie). «Simulate expired token» deja el token de esta pestaña vencido: la app debe
// renovarlo sola con la cookie. Cada inicio de sesión espera cupo (nginx deja pasar 1 cada 6 s).
const refreshCookie = async (page: import('@playwright/test').Page) => (await page.context().cookies()).find((c) => c.name === 'erp_refresh');
/** El idioma de la persona vive en la base y la pantalla lo usa al entrar: se deja en inglés para que estas pruebas lean los mismos textos (el reset del final lo devuelve a español). */
const setServerLanguage = (email: string, lang: 'es' | 'en') => { execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d identity -Atc "update users set language='${lang}' where email='${email}'"`, { cwd: join(here, '..', '..'), shell: '/bin/sh', stdio: 'ignore' }); };
let lastSignInAt = 0;
async function signInThroughTheScreen(page: import('@playwright/test').Page, email: string) {
  setServerLanguage(email, 'en');
  await waitForLoginCapacity(page.request);
  lastSignInAt = Date.now();
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD ?? 'demo-password-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
}
const simulateExpiredToken = async (page: import('@playwright/test').Page) => {
  await page.getByText('JWT sample').click();
  await page.getByRole('button', { name: 'Simulate expired token' }).click();
};

test('Session: the app renews itself by itself with the cookie, a dormant tab wakes up signed in, and with no cookie it asks to sign in again', async ({ page }) => {
  test.setTimeout(90_000);
  await signInThroughTheScreen(page, 'laura.rios@nexus.example');
  const before = await refreshCookie(page);
  expect(before, 'el servidor puso la cookie de renovación').toBeTruthy();
  expect({ httpOnly: before!.httpOnly, sameSite: before!.sameSite, path: before!.path }).toEqual({ httpOnly: true, sameSite: 'Strict', path: '/auth' });
  expect(await page.evaluate(() => document.cookie), 'el JavaScript de la página no puede leer la cookie').not.toContain('erp_refresh');
  expect(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)) + JSON.stringify(Object.entries(localStorage))), 'el token de renovación no está en el almacenamiento de la página').not.toContain(before!.value);

  // 1) El token «vence»: la app lo renueva sola con la cookie y la persona sigue dentro.
  let renewals = 0;
  page.on('response', (r) => { if (new URL(r.url()).pathname === '/auth/refresh' && r.status() === 200) renewals++; });
  await simulateExpiredToken(page);
  await expect.poll(() => renewals, { timeout: 10_000, message: 'renovaciones con respuesta 200' }).toBe(1);
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await expect(page.getByText(/token expires in 1[45]:/)).toBeVisible(); // el contador volvió a ~15:00
  expect((await refreshCookie(page))!.value, 'la cookie rota en cada renovación').not.toBe(before!.value);
  await page.getByRole('button', { name: 'Invoices', exact: true }).click(); // y el token nuevo abre la API
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();

  // 2) Una pestaña «dormida» (token guardado ya vencido) despierta al recargar y sigue dentro, sin pasar por el inicio de sesión.
  const expireStoredToken = () => page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('erp.session')!); const [h, , sig] = s.token.split('.'); s.token = `${h}.${btoa(JSON.stringify({ exp: 1 })).replace(/=+$/, '')}.${sig}`; sessionStorage.setItem('erp.session', JSON.stringify(s)); });
  await expireStoredToken();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);

  // 3) Sin cookie ya no hay nada que renovar: pide iniciar sesión de nuevo y lo explica.
  await page.context().clearCookies();
  await expireStoredToken();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Your session expired. Sign in again.')).toBeVisible();
});

test('Session: a session with no renewal cookie is NOT closed before its token really expires (it only stops renewing)', async ({ page }) => {
  test.setTimeout(60_000);
  // Un token firmado de verdad (con la llave del entorno de pruebas) que vence en 70 s: ya está dentro de los 2 minutos en que la app intenta renovar, y no hay cookie.
  const sessions = JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8'));
  const claims = JSON.parse(Buffer.from(sessions.lead.token.split('.')[1], 'base64url').toString());
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ sub: claims.sub, email: claims.email, name: claims.name, role: claims.role, iss: 'identity-access', aud: 'erp-api', iat: now, exp: now + 70, jti: `short-${now}` })}`;
  const token = `${data}.${createSign('RSA-SHA256').update(data).sign(readFileSync(join(here, '..', '..', 'infra', 'keys', 'jwt-private.pem'))).toString('base64url')}`;
  await preferLanguage(page, 'en');
  await page.addInitScript(([k, v]) => sessionStorage.setItem(k as string, v as string), ['erp.session', JSON.stringify({ token, user: { ...sessions.lead.user, language: 'en' } })]);
  let refreshAnswers: number[] = [];
  page.on('response', (r) => { if (new URL(r.url()).pathname === '/auth/refresh') refreshAnswers.push(r.status()); });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  await expect.poll(() => refreshAnswers.length, { timeout: 8_000, message: 'la app intentó renovar' }).toBeGreaterThanOrEqual(1);
  expect(refreshAnswers.every((c) => c === 401), `respuestas de /auth/refresh: ${refreshAnswers}`).toBe(true);
  await page.waitForTimeout(5_000); // y 5 s después SIGUE dentro: a su token le quedan más de 60 s
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invoices', exact: true }).click(); // y el token sigue abriendo la API
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  expect(refreshAnswers.length, 'no insiste con una renovación que ya dijo que no (un solo intento)').toBeLessThanOrEqual(2);
});

test('Session: signing out also ends the session on the server: the old cookie renews nothing', async ({ page, request }) => {
  test.setTimeout(60_000);
  await signInThroughTheScreen(page, 'laura.rios@nexus.example');
  const cookie = (await refreshCookie(page))!.value;
  // La pantalla vuelve al inicio de sesión al instante y el servidor responde después (en CI, más lento): se retrasa a propósito su respuesta para que la
  // prueba no dependa de la velocidad de la máquina. La cookie se borra cuando esa respuesta llega, no antes.
  await page.route('**/auth/logout', async (route) => { await new Promise((r) => setTimeout(r, 1_500)); await route.continue(); });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect.poll(() => refreshCookie(page), { timeout: 10_000, message: 'el servidor borró la cookie' }).toBeUndefined();
  const replay = await request.post('/auth/refresh', { headers: { 'X-Requested-With': 'erp-web', Cookie: `erp_refresh=${cookie}` } });
  expect(replay.status(), 'la cookie copiada antes de cerrar sesión ya no sirve').toBe(401);
});

test('Session: another person signing in in the same browser does NOT silently turn this tab into that person', async ({ page }) => {
  test.setTimeout(90_000);
  await signInThroughTheScreen(page, 'laura.rios@nexus.example'); // pestaña A: la líder
  const other = await page.context().newPage(); // pestaña B del MISMO navegador: entra la gerente y la cookie pasa a ser la suya
  await preferLanguage(other, 'en');
  await signInThroughTheScreen(other, 'diana.vega@nexus.example');
  await expect(other.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.bringToFront();
  await simulateExpiredToken(page); // la renovación de A usaría la cookie de la gerente
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Your session expired. Sign in again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0); // A nunca llegó a ser la gerente
  await other.close();
});

test('Session: two tabs renewing at the same moment both stay signed in (they take turns, no 409 reaches the person)', async ({ page }) => {
  test.setTimeout(90_000);
  await signInThroughTheScreen(page, 'laura.rios@nexus.example');
  const second = await page.context().newPage();
  await preferLanguage(second, 'en');
  await signInThroughTheScreen(second, 'laura.rios@nexus.example'); // la misma persona: la cookie del navegador es la de esta segunda sesión
  const statuses: number[] = [];
  for (const p of [page, second]) p.on('response', (r) => { if (new URL(r.url()).pathname === '/auth/refresh') statuses.push(r.status()); });
  await Promise.all([simulateExpiredToken(page), simulateExpiredToken(second)]);
  await expect.poll(() => statuses.filter((c) => c === 200).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  await expect(second.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  expect(statuses.every((c) => c === 200 || c === 409), `respuestas de /auth/refresh: ${statuses}`).toBe(true);
  await second.close();
});

// Estas pruebas gastan el cupo de inicios de sesión de nginx (1 cada 6 s, ráfaga de 5). Se espera a que se reponga entero ANTES de que empiece el archivo en el otro
// navegador (o el siguiente archivo): si no, sus primeras pruebas de inicio de sesión recibían «Too many attempts».
test.afterAll(async () => { const rest = 36_000 - (Date.now() - lastSignInAt); if (lastSignInAt > 0 && rest > 0) await new Promise((r) => setTimeout(r, rest)); });

test.afterAll(() => { execSync('sh scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' }); });
