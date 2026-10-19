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

test('on a phone the invoices become cards and can still be sorted', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await openAs(page, 'lead');
  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  // Tarjetas: las filas son bloques con «etiqueta: valor» y no hay desplazamiento lateral de la página.
  expect(await page.locator('tbody tr td').nth(1).evaluate((el) => getComputedStyle(el).display)).toBe('flex');
  expect(await page.locator('tbody tr td').nth(1).evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"Project"');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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

test('the manager sees the dashboard and nothing else', async ({ page }) => {
  await openAs(page, 'manager');
  await expect(page.getByText('Manager', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Projects' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invoices' })).toHaveCount(0);
  await expect(page.getByText('Approved milestones')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Branch network upgrade' })).toBeVisible(); // datos de demostración (m1 y m4)
  await expect(page.getByText(/Live/)).toBeVisible();
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

