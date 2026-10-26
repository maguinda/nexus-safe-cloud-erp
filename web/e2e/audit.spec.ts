import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, Page, test } from '@playwright/test';
import { translate } from '../src/i18n';
import type { Lang } from '../src/i18n/core';
import { openAs, preferLanguage, RoleKey } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/** Cuenta filas en las bases de datos de demostración para comprobar que la auditoría no escribió nada. */
function dbFingerprint(): string {
  const q = (db: string, sql: string) => execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d ${db} -Atc "${sql}"`, { cwd: root, shell: '/bin/sh' }).toString().trim();
  const projects = q('projects', `select (select count(*) from milestones where status = 'approved') || '/' || (select count(*) from outbox_events)`);
  const billing = q('billing', `select (select count(*) from invoices) || '/' || (select count(*) from processed_events)`);
  const analytics = q('analytics', `select (select count(*) from milestone_facts) || '/' || (select count(*) from processed_events)`);
  return `${projects} | ${billing} | ${analytics}`;
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

/** Las pantallas se miden en los DOS idiomas (el español es más largo y es donde se desborda): los textos de espera salen del propio diccionario. */
const screensFor = (lang: Lang): { name: string; role: RoleKey | null; go: (p: Page) => Promise<void> }[] => {
  const T = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(lang, key, params);
  return [
    { name: 'login', role: null, go: async (p) => { await p.goto('/'); await p.getByRole('heading', { name: T('login.title') }).waitFor(); } },
    { name: 'projects', role: 'lead', go: async (p) => { await p.getByRole('button', { name: 'Branch network upgrade' }).waitFor(); } },
    { name: 'invoices', role: 'lead', go: async (p) => { await p.getByRole('button', { name: T('nav.invoices') }).click(); await p.getByRole('table').waitFor(); } },
    { name: 'dashboard', role: 'manager', go: async (p) => { await p.getByRole('heading', { name: T('dashboard.title'), exact: true }).waitFor(); await p.getByRole('heading', { name: T('iot.devices'), exact: true }).waitFor(); } }, // incluye el panel Network & IoT
    { name: 'users', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.users') }).click(); await p.getByRole('heading', { name: T('users.form.newUser') }).waitFor(); await p.getByRole('table').waitFor(); } },
    { name: 'forbidden', role: 'sales', go: async (p) => { await p.getByRole('button', { name: T('nav.invoices') }).click(); await p.getByText(T('invoices.denied.title')).waitFor(); } },
  ];
};

for (const lang of ['en', 'es'] as const) for (const s of screensFor(lang)) {
  test(`layout: ${s.name} [${lang}]`, async ({ page }, info) => {
    if (s.role) await openAs(page, s.role, lang); else await preferLanguage(page, lang);
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
      // Botones pegados a un campo: dentro de cada formulario, el hueco entre un campo y cualquier botón debe ser de 8 px o más.
      const tight: string[] = [];
      document.querySelectorAll('form').forEach((f) => {
        const rect = (e: Element) => e.getBoundingClientRect();
        f.querySelectorAll('input, select, textarea').forEach((i) => f.querySelectorAll('button').forEach((b) => {
          const a = rect(i), c = rect(b); if (a.width === 0 || c.width === 0) return;
          const dy = Math.max(c.top - a.bottom, a.top - c.bottom), dx = Math.max(c.left - a.right, a.left - c.right);
          const gap = dy < 0 ? dx : dx < 0 ? dy : Math.hypot(dx, dy);
          if (gap < 8) tight.push(`${(i.getAttribute('id') || i.getAttribute('name') || (i as HTMLInputElement).type)} / "${(b.textContent || '').trim().slice(0, 18)}" ${Math.round(gap)}px`);
        }));
      });
      let minFont = 99;
      document.querySelectorAll('body *').forEach((el) => { if (el.children.length === 0 && (el.textContent || '').trim()) minFont = Math.min(minFont, parseFloat(getComputedStyle(el).fontSize)); });
      return { vw, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, wide, small, tight, minFont };
    });
    // caret/animations en modo normal: así Playwright no inyecta una hoja de estilos que la política de contenido reportaría.
    // Las violaciones de la política de contenido de LA APP deben ser 0 antes de la captura: en WebKit la propia captura de Playwright
    // inyecta una hoja de estilos y genera un reporte (se comprobó aparte), así que solo cuentan las anteriores.
    const violationsBeforeShot = [...cspReports];
    await page.screenshot({ path: `test-results/shots/${info.project.name}-${s.name}-${lang}.png`, fullPage: false, caret: 'initial', animations: 'allow' });
    expect(m.pageOverflow, `la página se desborda a ${m.vw}px`).toBe(false);
    expect(m.wide, 'elementos fuera de la vista (fuera de un contenedor con scroll)').toEqual([]);
    expect(m.small, 'objetivos táctiles menores de 32 px').toEqual([]);
    expect(m.tight, 'botones pegados a un campo (menos de 8 px)').toEqual([]);
    expect(m.minFont, 'letra más chica que 11 px').toBeGreaterThanOrEqual(11);
    expect(violationsBeforeShot, 'violaciones de la política de contenido de la app').toEqual([]);
    expect(blocked, 'la auditoría intentó escribir').toEqual([]);
  });
}

// El menú de perfil se abre desde la barra superior: en un celular debe quedar entero dentro de la pantalla (antes se salía por la izquierda).
for (const lang of ['en', 'es'] as const) {
  test(`layout: profile menu inside the screen [${lang}]`, async ({ page }) => {
    await openAs(page, 'manager', lang);
    await page.getByRole('button', { name: translate(lang, 'profile.open', { name: 'Diana Vega', role: translate(lang, 'role.manager') }) }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const m = await page.evaluate(() => { const r = document.querySelector('[role=dialog]')!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, vw: window.innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
    expect(m.left, 'el panel empieza dentro de la pantalla').toBeGreaterThanOrEqual(0);
    expect(m.right, 'el panel termina dentro de la pantalla').toBeLessThanOrEqual(m.vw + 0.5);
    expect(m.overflow, 'la página se desborda').toBe(false);
    for (const name of ['Español', 'English']) { const b = await dialog.getByRole('button', { name, exact: true }).boundingBox(); expect(b!.height, `${name} es un objetivo táctil`).toBeGreaterThanOrEqual(36); }
    expect(blocked, 'abrir el menú no escribe nada').toEqual([]);
  });
}
