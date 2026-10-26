import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openAs } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
test.describe.configure({ mode: 'serial' });

// Datos de demostración desechables: se dejan como al inicio antes de cada archivo.
test.beforeAll(() => { execSync('sh scripts/reset-demo.sh', { cwd: join(here, '..', '..'), stdio: 'ignore' }); });

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = [];
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

const PW = 'Qa-Passw0rd-long!';
const roleButton = (page: any, name: string) => page.getByRole('group', { name: 'Role', exact: true }).getByRole('button', { name, exact: true });

test('the manager creates two salespeople who can sign in, and changes a role', async ({ page }) => {
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
  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByLabel('Email').fill('qa.carlos@nexus.example');
  await other.getByLabel('Password').fill(PW);
  await other.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(other.getByText('Sales', { exact: true }).first()).toBeVisible();
  await expect(other.getByRole('button', { name: 'Users' })).toHaveCount(0);
  await expect(other.getByText('Read only for Sales').first()).toBeVisible();
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

