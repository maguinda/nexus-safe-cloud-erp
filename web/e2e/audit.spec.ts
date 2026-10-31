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
  const billing = q('billing', `select (select count(*) from invoices) || '/' || (select count(*) from processed_events) || '/' || (select count(*) from payments) || '/' || (select count(*) from contracts)`);
  const analytics = q('analytics', `select (select count(*) from milestone_facts) || '/' || (select count(*) from processed_events)`);
  const operations = q('operations', `select (select count(*) from iot_readings) || '/' || (select count(*) from network_devices)`);
  const procurement = q('procurement', `select (select count(*) from purchase_orders) || '/' || (select count(*) from suppliers) || '/' || (select sum(on_hand) from items) || '/' || (select count(*) from outbox_events)`);
  const capacity = q('capacity', `select (select count(*) from engineers) || '/' || (select count(*) from allocations) || '/' || (select count(*) from outbox_events)`);
  return `${projects} | ${billing} | ${analytics} | ${capacity} | ${operations} | ${procurement}`;
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
    // El asesor pide por POST pero solo LEE (y sin IA no gasta nada): pasa únicamente con ai:false; con ai:true se bloquea como cualquier otra escritura.
    if (r.method() === 'POST' && r.url().endsWith('/advisor/brief') && r.postDataJSON()?.ai === false) return route.continue();
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
    // El analista ve además el panel de factura electrónica (sandbox); en la segunda variante el formulario de datos fiscales ya está abierto.
    { name: 'invoices-billing', role: 'billing', go: async (p) => { await p.getByRole('button', { name: T('nav.invoices') }).click(); await p.getByRole('heading', { name: T('einv.title') }).waitFor(); } },
    { name: 'invoices-billing-form', role: 'billing', go: async (p) => { await p.getByRole('button', { name: T('nav.invoices') }).click(); await p.getByRole('heading', { name: T('einv.title') }).waitFor(); await p.getByRole('button', { name: new RegExp(`^${T('einv.action.data')}:`) }).first().click(); await p.getByRole('heading', { name: /Datos fiscales de|Fiscal data of/ }).waitFor(); } },
    { name: 'dashboard', role: 'manager', go: async (p) => { await p.getByRole('region', { name: T('advisor.title') }).getByRole('listitem').first().waitFor(); await p.getByRole('heading', { name: T('dashboard.title'), exact: true }).waitFor(); await p.getByRole('heading', { name: T('iot.devices'), exact: true }).waitFor(); } }, // incluye el panel Network & IoT
    { name: 'sensors', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.sensors'), exact: true }).click(); await p.getByRole('heading', { name: T('sensors.table.title'), exact: true }).waitFor(); await p.locator('table:visible').filter({ has: p.locator('caption') }).last().locator('tbody tr').first().waitFor(); await p.getByRole('img').nth(3).waitFor(); } },
    { name: 'network', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.network'), exact: true }).click(); await p.getByRole('heading', { name: T('netview.explorer.title'), exact: true }).waitFor(); await p.locator('table:visible').filter({ has: p.locator('caption') }).last().locator('tbody tr').nth(5).waitFor(); await p.getByRole('img').nth(2).waitFor(); } },
    { name: 'users', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.users') }).click(); await p.getByRole('heading', { name: T('users.form.newUser') }).waitFor(); await p.getByRole('table').waitFor(); } },
    // Gerencia: formulario de ingeniero y el de asignar abierto (el más ancho); ventas: solo lectura.
    { name: 'capacity-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.capacity'), exact: true }).click(); await p.getByRole('heading', { name: 'Ana Torres' }).waitFor(); await p.getByRole('button', { name: T('capacity.allocateFor', { name: 'Ana Torres' }) }).click(); await p.getByRole('form', { name: T('capacity.allocateFor', { name: 'Ana Torres' }) }).waitFor(); } },
    // Cotizaciones: ventas con el borrador abierto (el editor es la pantalla más ancha) y gerencia con las tarifas y el rechazo abiertos.
    { name: 'quotes-sales', role: 'sales', go: async (p) => { await p.getByRole('button', { name: T('nav.quotes'), exact: true }).click(); await p.getByRole('button', { name: T('q.openFor', { number: 'COT-0001' }) }).click(); await p.getByRole('form', { name: T('q.openFor', { number: 'COT-0001' }) }).waitFor(); await p.getByLabel(T('q.f.milestone', { n: 1 })).waitFor(); } },
    { name: 'quotes-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.quotes'), exact: true }).click(); await p.getByRole('button', { name: T('q.rates.show') }).click(); await p.getByRole('heading', { name: T('q.rates.title') }).waitFor(); await p.getByRole('button', { name: T('q.rejectFor', { number: 'COT-0002' }) }).click(); await p.getByRole('form', { name: T('q.rejectFor', { number: 'COT-0002' }) }).waitFor(); } },
    // Nómina: sin corridas (la demo arranca vacía) se ve el formulario; finanzas ve solo esta pantalla.
    { name: 'payroll-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.payroll'), exact: true }).click(); await p.getByRole('heading', { name: T('payroll.title') }).waitFor(); } },
    { name: 'payroll-finance', role: 'finance', go: async (p) => { await p.getByRole('heading', { name: T('payroll.title') }).waitFor(); } },
    { name: 'payables-finance', role: 'finance', go: async (p) => { await p.getByRole('button', { name: T('nav.payables'), exact: true }).click(); await p.getByRole('heading', { name: T('ap.title') }).waitFor(); } },
    { name: 'cashflow-finance', role: 'finance', go: async (p) => { await p.getByRole('button', { name: T('nav.cashflow'), exact: true }).click(); await p.getByRole('heading', { name: T('cf.title'), exact: true }).waitFor(); await p.locator('[data-cf-totals]').waitFor(); } },
    { name: 'quotes-lead', role: 'lead', go: async (p) => { await p.getByRole('button', { name: T('nav.quotes'), exact: true }).click(); await p.getByRole('button', { name: T('q.openFor', { number: 'COT-0002' }) }).click(); await p.getByText(T('q.readonly')).waitFor(); } },
    { name: 'capacity-sales', role: 'sales', go: async (p) => { await p.getByRole('button', { name: T('nav.capacity'), exact: true }).click(); await p.getByRole('heading', { name: 'Ana Torres' }).waitFor(); } },
    { name: 'procurement-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.procurement'), exact: true }).click(); await p.getByRole('heading', { name: T('proc.new.order') }).waitFor(); await p.getByRole('button', { name: T('proc.adjustFor', { name: 'Sensor de temperatura TH-10' }) }).click(); await p.getByRole('form', { name: T('proc.adjustFor', { name: 'Sensor de temperatura TH-10' }) }).waitFor(); } },
    { name: 'procurement-lead', role: 'lead', go: async (p) => { await p.getByRole('button', { name: T('nav.procurement'), exact: true }).click(); await p.getByRole('heading', { name: T('proc.stock.title') }).waitFor(); } },
    { name: 'workorders-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.workorders'), exact: true }).click(); await p.getByRole('heading', { name: T('wo.title'), exact: true }).waitFor(); } },
    // El diálogo con un responsable elegido: aparecen el porcentaje, las fechas y la casilla (lo más ancho del diálogo).
    { name: 'workorder-dialog-capacity', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.network'), exact: true }).click(); await p.getByRole('button', { name: new RegExp('^' + T('wo.createFor', { name: '' }).replace(/\s+$/, '')) }).first().click(); await p.getByRole('dialog').waitFor(); await p.getByRole('dialog').getByRole('button', { name: new RegExp('^Hugo Salazar') }).click(); await p.getByText(T('wo.cap.title')).waitFor(); } },
    { name: 'workorder-dialog', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.network'), exact: true }).click(); await p.getByRole('button', { name: new RegExp('^' + T('wo.createFor', { name: '' }).replace(/\s+$/, '')) }).first().click(); await p.getByRole('dialog').waitFor(); } },
    { name: 'cameras-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.cameras'), exact: true }).click(); await p.getByRole('heading', { name: T('cam.title'), exact: true }).waitFor(); await p.getByRole('heading', { name: T('cam.net.title') }).waitFor(); } },
    { name: 'audit-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.audit'), exact: true }).click(); await p.getByRole('heading', { name: T('audit.title'), exact: true }).waitFor(); } },
    { name: 'profitability-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.profitability') }).click(); await p.getByRole('heading', { name: T('prof.title'), exact: true }).waitFor(); } },
    { name: 'contracts-manager', role: 'manager', go: async (p) => { await p.getByRole('button', { name: T('nav.contracts') }).click(); await p.getByRole('heading', { name: T('con.title'), exact: true }).waitFor(); await p.getByRole('button', { name: T('con.new') }).click(); await p.getByRole('form', { name: T('con.new') }).waitFor(); } },
    { name: 'payments-billing', role: 'billing', go: async (p) => { await p.getByRole('button', { name: T('nav.invoices') }).click(); await p.getByRole('heading', { name: T('pay.title'), exact: true }).waitFor(); await p.getByRole('button', { name: T('pay.registerFor', { n: 'INV-0102' }) }).click(); await p.getByRole('form', { name: T('pay.registerFor', { n: 'INV-0102' }) }).waitFor(); } },
    { name: 'forbidden', role: 'sales', go: async (p) => { await p.getByRole('button', { name: T('nav.invoices') }).click(); await p.getByText(T('invoices.denied.title')).waitFor(); } },
  ];
};

for (const lang of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const s of screensFor(lang)) {
  test(`layout: ${s.name} [${lang}] [${theme}]`, async ({ page }, info) => {
    if (s.role) await openAs(page, s.role, lang, theme); else await preferLanguage(page, lang, theme);
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
          if (b.hasAttribute('data-in-field')) return; // acciones dentro del campo a propósito (ver la contraseña)
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
    // Contraste del texto (WCAG): cada texto visible contra el primer fondo opaco que tiene detrás. Debajo de 3 es ilegible; debajo de 4,5 se informa.
    const contrast = await page.evaluate(() => {
      const parse = (c: string) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
      const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      const lum = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const bgOf = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a >= 0.9) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
      const low: string[] = []; const weak: string[] = [];
      document.querySelectorAll('body *').forEach((el) => {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);
        const r = el.getBoundingClientRect(); if (!own || r.width === 0 || r.height === 0) return;
        const st = getComputedStyle(el); if (st.visibility === 'hidden' || Number(st.opacity) < 0.5 || (el as HTMLButtonElement).disabled) return;
        const fg = parse(st.color), bg = bgOf(el); const a = lum(fg), b = lum(bg);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const label = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}" ${ratio.toFixed(1)}:1`;
        if (ratio < 3) low.push(label); else if (ratio < 4.5) weak.push(label);
      });
      return { low, weak };
    });
    if (contrast.weak.length) console.log(`   (info) ${info.project.name} ${s.name} [${lang}][${theme}]: ${contrast.weak.length} textos entre 3:1 y 4,5:1 → ${contrast.weak.slice(0, 3).join(' · ')}`);
    expect(contrast.low, 'texto con contraste menor de 3:1').toEqual([]);
    const violationsBeforeShot = [...cspReports];
    await page.screenshot({ path: `test-results/shots/${info.project.name}-${s.name}-${lang}-${theme}.png`, fullPage: false, caret: 'initial', animations: 'allow' });
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
for (const lang of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`layout: profile menu inside the screen [${lang}] [${theme}]`, async ({ page }) => {
    await openAs(page, 'manager', lang, theme);
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

// La campana de avisos se abre desde la barra superior: con un aviso largo debe quedar entera dentro de la pantalla y sus botones deben poder tocarse.
for (const lang of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`layout: notifications bell inside the screen [${lang}] [${theme}]`, async ({ page }) => {
    // Un aviso de prueba con texto largo, escrito directo en la base de Notifications (la auditoría no escribe por la API).
    const sql = `INSERT INTO notifications (event_id, kind, severity, audience_roles, params, correlation_id, occurred_at) VALUES (gen_random_uuid(), 'OverdueDetected', 'warning', ARRAY['manager'], '{\\"invoiceNumber\\":\\"INV-0999\\",\\"projectName\\":\\"Proyecto con un nombre larguísimo para probar el ajuste de línea\\",\\"milestoneName\\":\\"Hito con nombre también muy largo\\",\\"totalCop\\":1190000000,\\"daysOverdue\\":120}', 'audit-trace-0001', now() - interval '3 hours')`;
    execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d notifications -Atc "${sql}"`, { cwd: root, stdio: 'ignore' });
    try {
      await openAs(page, 'manager', lang, theme);
      await page.getByRole('button', { name: /^(Notifications|Avisos) \(/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await expect(dialog.getByText(/INV-0999/)).toBeVisible();
      const m = await page.evaluate(() => { const r = document.querySelector('[role=dialog]')!.getBoundingClientRect(); return { left: r.left, right: r.right, vw: window.innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
      expect(m.left, 'el panel empieza dentro de la pantalla').toBeGreaterThanOrEqual(0);
      expect(m.right, 'el panel termina dentro de la pantalla').toBeLessThanOrEqual(m.vw + 0.5);
      expect(m.overflow, 'la página se desborda').toBe(false);
      for (const name of [translate(lang, 'notif.markOne'), translate(lang, 'notif.markAll')]) { const b = await dialog.getByRole('button', { name, exact: true }).boundingBox(); expect(b!.height, `${name} es un objetivo táctil`).toBeGreaterThanOrEqual(36); }
      expect(blocked, 'abrir la campana no escribe nada').toEqual([]);
    } finally {
      execSync(`. ./.env && docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d notifications -Atc "DELETE FROM notifications WHERE correlation_id = 'audit-trace-0001'"`, { cwd: root, stdio: 'ignore' });
    }
  });
}
