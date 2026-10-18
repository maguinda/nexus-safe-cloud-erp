import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, Page, test } from '@playwright/test';
import { openAs, RoleKey } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/** Cuenta filas en las bases de datos de demostración para comprobar que la auditoría no escribió nada. */
function dbFingerprint(): string {
  const q = (db: string, sql: string) => execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d ${db} -Atc "${sql}"`, { cwd: root, shell: '/bin/sh' }).toString().trim();
  const projects = q('projects', `select (select count(*) from milestones where status = 'approved') || '/' || (select count(*) from outbox_events)`);
  const billing = q('billing', `select (select count(*) from invoices) || '/' || (select count(*) from processed_events)`);
  return `${projects} | ${billing}`;
}

let before = '';
let blocked: string[] = [];
let cspReports: string[] = [];
test.beforeAll(() => { before = dbFingerprint(); });
test.afterAll(() => { expect(dbFingerprint(), 'la auditoría no debe cambiar ningún dato').toBe(before); });
test.beforeEach(async ({ page }) => {
  blocked = [];
  cspReports = [];
  // Regla de auditoría: se bloquea TODO lo que escribe. Solo el login (que no crea datos) pasa.
  await page.route('**/*', (route) => {
    const r = route.request();
    // Los reportes de la política de contenido los envía el navegador (no escriben datos): se cuentan aparte.
    if (r.method() === 'POST' && r.url().endsWith('/csp-report')) { cspReports.push(r.postData() ?? ''); return route.fulfill({ status: 204 }); }
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(r.method());
    if (isRead || (r.method() === 'POST' && r.url().endsWith('/auth/login'))) return route.continue();
    blocked.push(`${r.method()} ${r.url()} ${(r.postData() ?? '').slice(0, 500)}`);
    return route.fulfill({ status: 599, body: '{"message":"blocked by audit"}', contentType: 'application/json' });
  });
});

const screens: { name: string; role: RoleKey | null; go: (p: Page) => Promise<void> }[] = [
  { name: 'login', role: null, go: async (p) => { await p.goto('/'); await p.getByRole('heading', { name: 'Sign in' }).waitFor(); } },
  { name: 'projects', role: 'lead', go: async (p) => { await p.getByRole('button', { name: 'Branch network upgrade' }).waitFor(); } },
  { name: 'invoices', role: 'lead', go: async (p) => { await p.getByRole('button', { name: 'Invoices' }).click(); await p.getByRole('table').waitFor(); } },
  { name: 'forbidden', role: 'sales', go: async (p) => { await p.getByRole('button', { name: 'Invoices' }).click(); await p.getByText('403 Forbidden').waitFor(); } },
];

for (const s of screens) {
  test(`layout: ${s.name}`, async ({ page }, info) => {
    if (s.role) await openAs(page, s.role);
    await s.go(page);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const insideScroller = (el: Element) => { for (let e: Element | null = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
      const wide: string[] = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && !insideScroller(el) && getComputedStyle(el).position !== 'fixed') wide.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`.slice(0, 60));
      });
      const small: string[] = [];
      document.querySelectorAll('button, input, select, summary').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height < 32) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 20)}" ${Math.round(r.height)}px`); });
      let minFont = 99;
      document.querySelectorAll('body *').forEach((el) => { if (el.children.length === 0 && (el.textContent || '').trim()) minFont = Math.min(minFont, parseFloat(getComputedStyle(el).fontSize)); });
      return { vw, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, wide, small, minFont };
    });
    // caret/animations en modo normal: así Playwright no inyecta una hoja de estilos que la política de contenido reportaría.
    // Las violaciones de la política de contenido de LA APP deben ser 0 antes de la captura: en WebKit la propia captura de Playwright
    // inyecta una hoja de estilos y genera un reporte (se comprobó aparte), así que solo cuentan las anteriores.
    const violationsBeforeShot = [...cspReports];
    await page.screenshot({ path: `test-results/shots/${info.project.name}-${s.name}.png`, fullPage: false, caret: 'initial', animations: 'allow' });
    expect(m.pageOverflow, `la página se desborda a ${m.vw}px`).toBe(false);
    expect(m.wide, 'elementos fuera de la vista (fuera de un contenedor con scroll)').toEqual([]);
    expect(m.small, 'objetivos táctiles menores de 32 px').toEqual([]);
    expect(m.minFont, 'letra más chica que 11 px').toBeGreaterThanOrEqual(11);
    expect(violationsBeforeShot, 'violaciones de la política de contenido de la app').toEqual([]);
    expect(blocked, 'la auditoría intentó escribir').toEqual([]);
  });
}
