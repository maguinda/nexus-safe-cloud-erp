// Prueba de punta a punta a través del gateway (http://localhost:8080). Uso: node scripts/e2e-flow.mjs
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1';
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) failed++; };
const call = async (method, path, { token, body, headers = {} } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json, headers: res.headers };
};
const login = async (email) => { const r = await call('POST', '/auth/login', { body: { email, password: PASSWORD } }); return { token: r.json?.accessToken, user: r.json?.user, status: r.status }; };

const lead = await login('laura.rios@nexus.example');
const bill = await login('andres.mora@nexus.example');
const sales = await login('camila.soto@nexus.example');
const manager = await login('diana.vega@nexus.example');
ok(lead.status === 200 && bill.status === 200 && sales.status === 200, 'login de los 3 roles');
ok(lead.user?.role === 'project_lead' && bill.user?.role === 'billing_analyst' && sales.user?.role === 'sales' && manager.user?.role === 'manager', 'cada login trae su rol');
for (const [ruta, metodo] of [['/projects', 'GET'], ['/invoices', 'GET'], ['/invoices/reconciliation', 'GET'], ['/milestones/m2/approve', 'POST']]) ok((await call(metodo, ruta, { token: manager.token })).status === 403, `El gerente recibe 403 en ${metodo} ${ruta}`);
if (failed) { console.log('No se pudo iniciar sesión; ¿corrió el seed (SEED_DEMO=true) y la pila está arriba?'); process.exit(1); }

ok((await call('GET', '/invoices', { token: sales.token })).status === 403, 'Sales recibe 403 en /invoices');
ok((await call('GET', '/invoices/reconciliation', { token: sales.token })).status === 403, 'Sales recibe 403 en /invoices/reconciliation');
const projects = await call('GET', '/projects', { token: lead.token });
ok(projects.status === 200 && projects.json.length >= 3, 'Project lead ve los proyectos (al menos los 3 de la demo)');

// Crear datos reales por la API: un proyecto y un hito nuevos, y solo el project_lead puede.
const newProject = await call('POST', '/projects', { token: lead.token, body: { name: 'Flow check project', client: 'Nexus Safe-Cloud' } });
ok(newProject.status === 201 && /^p-/.test(newProject.json?.id), 'el project_lead crea un proyecto (201)');
const newMilestone = await call('POST', `/projects/${newProject.json?.id}/milestones`, { token: lead.token, body: { name: 'Flow check milestone', amountCop: 1000000 } });
ok(newMilestone.status === 201 && newMilestone.json?.status === 'pending', 'y le agrega un hito pendiente (201)');
ok((await call('POST', '/projects', { token: sales.token, body: { name: 'X', client: 'Y' } })).status === 403, 'Sales NO puede crear proyectos (403)');
ok((await call('POST', '/projects', { token: manager.token, body: { name: 'X', client: 'Y' } })).status === 403, 'El gerente NO puede crear proyectos (403)');
ok((await call('POST', '/projects', { token: lead.token, body: { name: '', client: 'Y' } })).status === 400, 'un proyecto sin nombre se rechaza (400)');
ok((await call('POST', `/projects/${newProject.json?.id}/milestones`, { token: lead.token, body: { name: 'N', amountCop: -5 } })).status === 400, 'un monto negativo se rechaza (400)');

let target = null;
for (const p of projects.json) {
  const ms = await call('GET', `/projects/${p.id}/milestones`, { token: lead.token });
  const pending = ms.json.find((m) => m.status === 'pending');
  if (pending) { target = pending; break; }
}
if (newMilestone.json?.id) target = newMilestone.json; // se aprueba el hito recién creado: crear -> aprobar -> factura
if (!target) { console.log('No hay hitos pendientes: corre scripts/reset-demo.sh'); process.exit(1); }
console.log(`   hito elegido: ${target.id} "${target.name}" (${target.amountCop} COP)`);

const before = (await call('GET', '/invoices', { token: bill.token })).json.length;
ok((await call('POST', `/milestones/${target.id}/approve`, { token: sales.token })).status === 403, 'Sales NO puede aprobar (403)');
ok((await call('POST', `/milestones/${target.id}/approve`, { token: bill.token })).status === 403, 'Billing analyst NO puede aprobar (403)');
const t0 = Date.now();
const approve = await call('POST', `/milestones/${target.id}/approve`, { token: lead.token });
ok(approve.status === 200 && approve.json.milestone.status === 'approved', `Project lead aprueba el hito (200 en ${Date.now() - t0} ms)`);

let draft = null;
while (!draft && Date.now() - t0 < 15000) {
  const inv = await call('GET', '/invoices', { token: lead.token });
  draft = inv.json.find((i) => i.milestoneName === target.name && i.status === 'draft') ?? null;
  if (!draft) await new Promise((r) => setTimeout(r, 100));
}
ok(!!draft, `la factura borrador apareció sola ${draft ? `(${draft.number}, ${Date.now() - t0} ms después de aprobar)` : ''}`);
const rec = (await call('GET', '/invoices/reconciliation', { token: bill.token })).json;
const recRow = rec?.rows?.find((r) => r.invoiceNumber === draft?.number);
ok(recRow?.milestoneId === target.id && recRow?.approvedBy === lead.user?.email && rec.summary.inconsistent === 0, 'la conciliación enlaza el hito con su factura y todo cuadra');
ok(draft?.amountCop === target.amountCop, 'el subtotal de la factura es el monto del hito');
ok(draft?.taxCop === Math.floor((target.amountCop * 19 + 50) / 100) && draft?.totalCop === draft?.amountCop + draft?.taxCop, 'la factura trae IVA 19 % y total que cuadran');

ok((await call('PATCH', `/invoices/${draft.number}/issue`, { token: lead.token })).status === 403, 'Project lead NO puede emitir (403)');
const issued = await call('PATCH', `/invoices/${draft.number}/issue`, { token: bill.token });
ok(issued.status === 200 && issued.json.status === 'issued', 'Billing analyst emite la factura (200)');
ok((await call('PATCH', `/invoices/${draft.number}/issue`, { token: bill.token })).status === 409, 'emitir otra vez da 409');
ok((await call('POST', `/milestones/${target.id}/approve`, { token: lead.token })).status === 409, 'aprobar otra vez da 409');
await new Promise((r) => setTimeout(r, 1000));
ok((await call('GET', '/invoices', { token: bill.token })).json.length === before + 1, 'no se creó una segunda factura');

const parts = lead.token.split('.');
const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.co', role: 'billing_analyst', iss: 'identity-access', aud: 'erp-api', exp: 9999999999 })).toString('base64url')}.${parts[2]}`;
ok((await call('GET', '/invoices', { token: tampered })).status === 401, 'token alterado -> 401');
ok((await call('GET', '/invoices')).status === 401, 'sin token -> 401');

const docs = await call('GET', '/docs'); const other = await call('GET', '/auth/jwks'); const health = await call('GET', '/health', { headers: { 'x-correlation-id': 'trace-gw-0001' } });
ok(docs.status === 404 && other.status === 404, 'Swagger y rutas internas NO se exponen por el gateway');
ok(health.headers.get('x-correlation-id') === 'trace-gw-0001' && health.headers.get('x-content-type-options') === 'nosniff' && !health.headers.get('server')?.match(/\d/), 'gateway: correlación, nosniff y sin versión del servidor');

console.log(failed ? `\n${failed} comprobación(es) FALLARON` : '\nTodo el flujo de punta a punta funciona');
process.exit(failed ? 1 : 0);
