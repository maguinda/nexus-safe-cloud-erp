import { execSync } from 'node:child_process';
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
  await expect(page.getByRole('heading', { name: 'New project' })).toHaveCount(0); // sin formularios de alta
  await expect(page.getByRole('button', { name: 'Create project' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve milestone' })).toHaveCount(0);
  await expect(page.getByText('Read only for Sales').first()).toBeVisible();
  await page.getByRole('button', { name: 'Invoices' }).click();
  await expect(page.getByText('403 Forbidden')).toBeVisible();
  await expect(page.getByRole('cell', { name: /INV-/ })).toHaveCount(0);
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
