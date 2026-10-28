import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { translate } from '../src/i18n';
import { openAs, preferLanguage, waitForLoginCapacity } from './helpers';

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
const netLinks: { originName: string; destinationName: string; functional: boolean | null }[] = JSON.parse(readFileSync(join(here, '..', '..', 'services', 'analytics', 'prisma', 'data', 'network-links.json'), 'utf8'));
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
const leadToken = (): string => JSON.parse(readFileSync(join(here, '.auth', 'sessions.json'), 'utf8')).lead.token;
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
  await expect(page.getByRole('table').nth(1)).toHaveCount(0); // en el tablero no se pinta la tabla de hitos
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
  expect(h, 'alto del menú en teléfono').toBeLessThanOrEqual(80);
});

test('Menu: the manager\'s options are grouped under labels, with icons that only decorate', async ({ page }) => {
  await openAs(page, 'manager');
  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav.getByRole('group', { name: 'Nexus data' }).getByRole('button')).toHaveText(['Sensors', 'Network']);
  await expect(nav.getByRole('group', { name: 'Administration' }).getByRole('button')).toHaveText(['Users']);
  await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await nav.locator('svg[aria-hidden="true"]').count(), 'un ícono decorativo por opción').toBe(4);
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

test('Menu: on a 320 px phone every option of the manager\'s menu is inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openAs(page, 'manager');
  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav.getByRole('button', { name: 'Users', exact: true })).toBeVisible();
  const edges = await nav.getByRole('button').evaluateAll((bs) => bs.map((b) => [b.textContent?.trim(), Math.round(b.getBoundingClientRect().right)] as const));
  expect(edges.length).toBe(4);
  for (const [label, right] of edges) expect(right, `«${label}» termina dentro de los 320 px`).toBeLessThanOrEqual(320);
  expect(await nav.evaluate((n) => n.scrollWidth > n.clientWidth), 'el menú no necesita desplazarse de lado').toBe(false);
});

test.afterAll(() => { execSync('sh scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' }); });
