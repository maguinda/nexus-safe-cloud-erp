#!/usr/bin/env node
// Datos de EJEMPLO para que ninguna pantalla quede vacía (pocos, a propósito). Se corre DESPUÉS de reset-demo.sh:  ./scripts/reset-demo.sh --examples
// Todo se crea por la API real (con las cuentas de demostración), no con SQL suelto: así los ejemplos pasan por las mismas reglas y alimentan la bitácora,
// el flujo de caja, el costo real y las notificaciones. Lo único que se escribe en SQL son FECHAS (una orden o una deuda ya vencida no se puede crear por la API).
// Es seguro repetirlo: lo que ya existe responde 409 y se anota como «ya estaba».
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = existsSync(join(ROOT, '.env')) ? Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]])) : {};
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const PASSWORD = process.env.DEMO_PASSWORD ?? env.DEMO_PASSWORD ?? 'demo-password-1';
const INGEST_KEY = process.env.INGEST_KEY ?? env.INGEST_KEY ?? '';
const ACCOUNTS = { ana: 'ana.torres@nexus.example', manager: 'diana.vega@nexus.example', finance: 'fernanda.gil@nexus.example', billing: 'andres.mora@nexus.example', hugo: 'hugo.salazar@nexus.example' };
const HUGO = { id: '11111111-1111-4111-8111-111111111107', name: 'Hugo Salazar' };
const ANA = { id: '11111111-1111-4111-8111-111111111101', name: 'Ana Torres' };

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const prevMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const thisMonth = () => new Date().toISOString().slice(0, 7);

async function api(method, path, token, body, extra = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
}
async function login(role) {
  for (let i = 0; i < 6; i++) {
    const r = await api('POST', '/auth/login', null, { email: ACCOUNTS[role], password: PASSWORD });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 15_000)); continue; }
    if (r.status !== 200) throw new Error(`no se pudo iniciar sesión como ${role} (${r.status}); ¿la pila está arriba y con SEED_DEMO=true?`);
    return r.json.accessToken;
  }
  throw new Error('el límite de inicios de sesión no se liberó');
}
function sql(db, text) {
  return execFileSync('docker', ['compose', 'exec', '-T', '-e', `PGPASSWORD=${env.POSTGRES_ADMIN_PASSWORD}`, 'postgres', 'psql', '-h', 'localhost', '-U', env.POSTGRES_ADMIN_USER ?? 'postgres', '-d', db, '-Atc', text], { cwd: ROOT, encoding: 'utf8' }).trim();
}

// «OT-0665» → 665 (la base guarda el número entero).
const numOf = (o) => Number(String(o.number).replace(/\D/g, ''));
/** Fecha una deuda hacia atrás. La base solo deja pasar «por pagar → pagada» (trigger), así que en esta herramienta SOLO DE DEMOSTRACIÓN se apagan los triggers de la tabla dentro de la MISMA transacción del cambio: si algo falla, se deshace todo y quedan encendidos. */
const backdatePayable = (orderId, expr) => sql('procurement', `ALTER TABLE payables DISABLE TRIGGER USER; UPDATE payables SET due_date = ${expr} WHERE order_id = '${orderId}'; ALTER TABLE payables ENABLE TRIGGER USER;`);

let failures = 0;
const done = [];
async function step(name, fn) {
  try { const r = await fn(); console.log(`✔ ${name}${r ? ` (${r})` : ''}`); done.push(name); return true; }
  catch (e) {
    if (e.already) { console.log(`• ${name}: ya estaba`); return false; }
    failures++; console.log(`✘ ${name}: ${e.message}`); return false;
  }
}
const need = (r, ok, what) => { if (r.status === 409) { const e = new Error(what); e.already = true; throw e; } if (!ok.includes(r.status)) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`); return r.json; };

const t = { manager: await login('manager'), finance: await login('finance'), billing: await login('billing'), hugo: await login('hugo'), ana: await login('ana') };

// Si ya hay ejemplos, no se repiten (cada corrida compraría de nuevo): se reinicia con `./scripts/reset-demo.sh --examples`.
{
  const p = await api('GET', '/payables', t.finance);
  if (p.status === 200 && p.json.payables.length > 0) { console.log('Ya hay ejemplos cargados (cuentas por pagar existentes). Para empezar de cero: ./scripts/reset-demo.sh --examples'); process.exit(0); }
}

// 1. Una cotización pendiente se aprueba: nace el proyecto, sus hitos, el contrato y la fila de «costo real contra lo cotizado».
let approvedProject = null;
await step('Cotización pendiente aprobada (proyecto + contrato)', async () => {
  const list = need(await api('GET', '/quotes', t.manager), [200], 'listar cotizaciones');
  const q = list.find((x) => x.status === 'pending');
  if (!q) { const e = new Error('sin pendientes'); e.already = true; throw e; }
  need(await api('POST', `/quotes/${q.id}/approve`, t.manager), [200], 'aprobar la cotización');
  approvedProject = q.projectName;
  return q.number;
});

// 1b. Una persona del equipo asignada al proyecto nuevo (así «Equipo del proyecto» y el costo real de mano de obra tienen datos).
await step('Ingeniera asignada al proyecto nuevo', async () => {
  if (!approvedProject) { const e = new Error('sin proyecto nuevo'); e.already = true; throw e; }
  need(await api('POST', '/engineers/11111111-1111-4111-8111-111111111103/allocations', t.manager, { projectName: approvedProject, percent: 40, startDate: day(-3), endDate: day(25) }), [200, 201], 'asignar a Marcela Díaz');
  return 'Marcela Díaz al 40 %';
});

// 2. Compras recibidas = cuentas por pagar: una pagada, una vencida y una por vencer.
const SUP = { north: '22222222-2222-4222-8222-222222222201', andina: '22222222-2222-4222-8222-222222222202' };
const ITEM = { sensor: '33333333-3333-4333-8333-333333333301', spare: '33333333-3333-4333-8333-333333333302', switch: '33333333-3333-4333-8333-333333333303' };
async function purchase(supplierId, itemId, quantity, projectName) {
  const o = need(await api('POST', '/orders', t.manager, { supplierId, itemId, quantity, ...(projectName ? { projectName } : {}) }), [200, 201], 'crear el pedido');
  need(await api('POST', `/orders/${o.id}/receive`, t.manager), [200], 'recibir el pedido');
  return o;
}
const payableOf = async (orderId) => { const r = need(await api('GET', '/payables', t.finance), [200], 'listar cuentas por pagar'); return r.payables.find((p) => p.orderId === orderId); };
await step('Compra recibida y pagada al proveedor', async () => {
  const o = await purchase(SUP.north, ITEM.switch, 2, approvedProject);
  const p = await payableOf(o.id);
  need(await api('POST', `/payables/${p.id}/pay`, t.finance, { method: 'transfer', reference: 'TR-8841' }), [200], 'pagar');
  return p.number;
});
await step('Compra recibida con deuda VENCIDA', async () => {
  const o = await purchase(SUP.andina, ITEM.sensor, 3);
  backdatePayable(o.id, 'CURRENT_DATE - 5'); // la API no permite crear una deuda ya vencida
  return (await payableOf(o.id))?.number;
});
await step('Compra recibida con deuda que vence pronto', async () => {
  const o = await purchase(SUP.north, ITEM.spare, 5);
  backdatePayable(o.id, 'CURRENT_DATE + 4');
  return (await payableOf(o.id))?.number;
});

// 3. Nómina: el mes pasado pagada y el actual generada, sin pagar.
await step('Nómina del mes pasado generada y pagada', async () => {
  const r = need(await api('POST', '/payroll', t.finance, { period: prevMonth() }), [200, 201], 'generar la nómina');
  need(await api('POST', `/payroll/${r.id}/pay`, t.finance), [200], 'pagar la nómina');
  return prevMonth();
});
await step('Nómina del mes actual generada (sin pagar)', async () => { need(await api('POST', '/payroll', t.finance, { period: thisMonth() }), [200, 201], 'generar la nómina'); return thisMonth(); });

// 4. Un cobro parcial de una factura emitida.
await step('Cobro parcial de la factura INV-0101', async () => {
  need(await api('POST', '/invoices/INV-0101/payments', t.billing, { amountCop: 5_000_000, method: 'transfer', reference: 'Bank transfer 8841' }), [200, 201], 'registrar el cobro');
  return '5.000.000 COP';
});

// 5. Órdenes de trabajo para Hugo (técnico) y Ana (ingeniera): 2 hechas, 1 en curso y vencida, 2 por hacer y 1 de Ana.
async function workOrder(spec) {
  const body = { type: spec.type, targetKind: spec.kind, targetRef: spec.ref, description: spec.description, priority: spec.priority, dueDate: day(spec.due), assignedTo: spec.who.name, assignedToId: spec.who.id, capacityPercent: spec.percent, capacityStart: day(spec.from), capacityEnd: day(spec.to) };
  const r = await api('POST', '/work-orders', t.manager, body);
  // Un 409 de CAPACIDAD (se pasaría de 100 %) es un error de este guion, no «ya estaba»: solo es «ya estaba» si ya hay una orden abierta igual.
  if (r.status === 409 && !/already|open work order|OT-\d+/i.test(JSON.stringify(r.json))) throw new Error(`crear la orden «${spec.description.slice(0, 30)}» → 409 ${JSON.stringify(r.json)?.slice(0, 200)}`);
  return need(r, [200, 201], `crear la orden «${spec.description.slice(0, 30)}»`);
}
const orders = {};
await step('Órdenes de trabajo creadas', async () => {
  orders.w0 = await workOrder({ type: 'inspection', kind: 'sensor', ref: 'IOT-OF1-06', description: 'Revisar la lectura de potencia del tablero de la bodega', priority: 'normal', who: HUGO, percent: 5, from: 0, to: 0, due: 1 });
  orders.w1 = await workOrder({ type: 'preventive', kind: 'sensor', ref: 'IOT-OF2-01', description: 'Limpiar el lente y revisar el soporte de la cámara de la oficina 2', priority: 'low', who: HUGO, percent: 5, from: 0, to: 0, due: 1 });
  orders.w2 = await workOrder({ type: 'corrective', kind: 'sensor', ref: 'IOT-OF2-02', description: 'Cambiar la fuente del monitor de temperatura de la oficina 2', priority: 'critical', who: HUGO, percent: 60, from: 0, to: 4, due: 3 });
  orders.w3 = await workOrder({ type: 'preventive', kind: 'device', ref: 1, description: 'Actualizar el firmware del equipo de distribución de energía', priority: 'high', who: HUGO, percent: 30, from: 0, to: 4, due: 2 });
  orders.w4 = await workOrder({ type: 'inspection', kind: 'device', ref: 2, description: 'Medir el estado del switch multicapa', priority: 'normal', who: HUGO, percent: 10, from: 3, to: 6, due: 14 });
  orders.w5 = await workOrder({ type: 'inspection', kind: 'sensor', ref: 'IOT-OF2-01', description: 'Revisar la resolución de la cámara con el cliente', priority: 'normal', who: ANA, percent: 20, from: 0, to: 3, due: 5 }); // antes de que empiece su segundo proyecto (si no, pasaría de 100 %)
  orders.w6 = await workOrder({ type: 'inspection', kind: 'device', ref: 3, description: 'Revisar la configuración del switch multicapa 2', priority: 'low', who: ANA, percent: 5, from: 0, to: 0, due: 1 });
  return '7';
});
await step('Hugo termina 2 órdenes y empieza 1 (y Ana termina 1)', async () => {
  const prog = async (o, status, note) => need(await api('PATCH', `/work-orders/${o.id}/progress`, t.hugo, { status, ...(note ? { note } : {}) }), [200], `orden ${o.number} → ${status}`);
  await prog(orders.w0, 'done', 'Lectura revisada: estaba bien, era un falso aviso');
  await prog(orders.w1, 'done', 'Lente limpio y soporte reapretado');
  await prog(orders.w2, 'in_progress');
  need(await api('PATCH', `/work-orders/${orders.w6.id}/progress`, t.ana, { status: 'done', note: 'Configuración correcta, sin cambios' }), [200], 'orden de Ana → done');
  sql('operations', `UPDATE work_orders SET due_date = CURRENT_DATE - 8, closed_at = now() - interval '6 days' WHERE number = ${numOf(orders.w6)}`);
  // La API no deja crear fechas pasadas: lo ya hecho se «fecha» hacia atrás y la orden en curso queda vencida hace 2 días.
  sql('operations', `UPDATE work_orders SET due_date = CURRENT_DATE - 12, closed_at = now() - interval '9 days' WHERE number = ${numOf(orders.w0)}`);
  sql('operations', `UPDATE work_orders SET due_date = CURRENT_DATE - 6, closed_at = now() - interval '3 days' WHERE number = ${numOf(orders.w1)}`);
  sql('operations', `UPDATE work_orders SET due_date = CURRENT_DATE - 2 WHERE number = ${numOf(orders.w2)}`);
  return '';
});

// 5b. Un conteo físico del inventario (abre, anota lo contado y cierra: aplica la diferencia como movimiento).
await step('Conteo físico del inventario cerrado', async () => {
  const inv = need(await api('GET', '/inventory', t.manager), [200], 'leer el inventario');
  const items = Array.isArray(inv) ? inv : inv.items;
  const c = need(await api('POST', '/counts', t.manager), [200, 201], 'abrir el conteo');
  for (const [i, it] of items.entries()) need(await api('PATCH', `/counts/${c.id}/lines/${it.id}`, t.manager, { counted: Math.max(0, it.onHand - (i === 0 ? 1 : 0)) }), [200], `anotar ${it.name}`); // el primer artículo: 1 menos de lo esperado (merma)
  need(await api('POST', `/counts/${c.id}/close`, t.manager), [200], 'cerrar el conteo');
  return `${items.length} artículos`;
});

// 6. Un aviso de sensor (alimenta la campana y la bitácora). OJO con la fecha: los datos de sensores viven en TIEMPO VIRTUAL (13-sep-2026) y la pantalla mide sus
// rangos desde la lectura más reciente; una lectura fechada «hoy» dejaría la ventana de 24 h casi vacía. Esta continúa la serie un minuto después de la última del Excel.
await step('Aviso de un sensor en alerta', async () => {
  if (!INGEST_KEY) throw new Error('falta INGEST_KEY en el .env');
  const r = await api('POST', '/telemetry/readings', null, { readings: [{ deviceId: 'IOT-OF2-02', recordedAt: '2026-09-13T11:22:00.000Z', status: 'ALERT', value: 41.2, unit: '°C' }] }, { 'x-ingest-key': INGEST_KEY });
  if (r.status !== 200) throw new Error(`ingesta → ${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);
  return 'ALERT 41,2 °C';
});

// 7. Verificación: por la API, que nada de lo que prometen los ejemplos quedó vacío.
await step('Verificación: nada quedó vacío', async () => {
  const miss = [];
  const count = async (what, path, token, pick, min) => { const r = await api('GET', path, token); const n = r.status === 200 ? pick(r.json) : -1; if (!(n >= min)) miss.push(`${what} (${n} < ${min})`); };
  await count('nóminas', '/payroll', t.finance, (j) => (Array.isArray(j) ? j : j.runs ?? []).length, 2);
  await count('cuentas por pagar', '/payables', t.finance, (j) => j.payables.length, 3);
  await count('movimientos de caja (meses con datos)', '/cashflow?months=6', t.finance, (j) => j.months.filter((m) => m.inCop + m.outCop > 0).length, 1);
  await count('costo real contra lo cotizado', '/project-costs', t.finance, (j) => j.projects.length, 1);
  await count('contratos', '/contracts', t.manager, (j) => (Array.isArray(j) ? j : j.contracts ?? []).length, 1);
  await count('órdenes de trabajo', '/work-orders', t.manager, (j) => (Array.isArray(j) ? j : j.orders ?? []).length, 5);
  await count('mis órdenes (Hugo)', '/work-orders/mine', t.hugo, (j) => (Array.isArray(j) ? j : j.orders ?? []).length, 5);
  await count('mis órdenes (Ana)', '/work-orders/mine', t.ana, (j) => (Array.isArray(j) ? j : j.orders ?? []).length, 2);
  await count('bitácora', '/audit?limit=50', t.manager, (j) => j.entries.length, 8);
  await count('avisos (campana del gerente)', '/notifications', t.manager, (j) => (Array.isArray(j) ? j : j.notifications ?? j.items ?? []).length, 1);
  if (miss.length) throw new Error(`quedó vacío: ${miss.join('; ')}`);
  return 'todo con datos';
});

console.log(failures === 0 ? `\nEjemplos listos (${done.length} pasos).` : `\n${failures} paso(s) fallaron: revisa arriba.`);
process.exit(failures === 0 ? 0 : 1);
