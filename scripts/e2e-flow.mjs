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

// Analytics: el tablero del gerente se arma solo con eventos (aprobado -> borrador -> emitida), sin llamar a los demás servicios.
let dash = null;
for (let i = 0; i < 60 && !(dash?.projects?.some((p) => p.issuedTotalCop > 0) && dash?.recentActivity?.some((a) => a.kind === 'InvoiceIssued' && a.message.includes(draft.number))); i++) {
  dash = (await call('GET', '/dashboard', { token: manager.token })).json; if (!(dash?.recentActivity?.some((a) => a.kind === 'InvoiceIssued' && a.message.includes(draft.number)))) await new Promise((r) => setTimeout(r, 100));
}
ok(dash?.recentActivity?.some((a) => a.kind === 'InvoiceIssued' && a.message.includes(draft.number)), `el dashboard del gerente refleja la factura emitida ${draft.number} (modelo de lectura por eventos)`);
ok(dash?.totals?.issued?.totalCop === dash?.totals?.issued?.subtotalCop + dash?.totals?.issued?.taxCop && dash.totals.approvedCop > 0, 'el dashboard suma subtotal + IVA = total');
ok(dash?.freshness?.lastEventLagMs != null && dash.freshness.lastEventLagMs < 60000, `frescura: el último evento llegó ${dash?.freshness?.lastEventLagMs} ms después de ocurrir (meta ≤ 60 s)`);
for (const [nombre, u] of [['Project lead', lead], ['Billing analyst', bill], ['Sales', sales]]) ok((await call('GET', '/dashboard', { token: u.token })).status === 403, `${nombre} NO ve el dashboard (403)`);
ok((await call('GET', '/dashboard')).status === 401, 'dashboard sin token -> 401');

// --- Administración de usuarios: solo el gerente, y por el gateway ---
const NEW_PW = 'Flow-Passw0rd-2026';
const newEmail = `flow.vendedor.${Date.now()}@nexus.example`;
ok((await call('GET', '/users', { token: sales.token })).status === 403, 'Sales NO lista usuarios (403)');
// Idioma de la interfaz: cada persona cambia el suyo (cualquier rol), con un valor válido y con un token.
ok((await call('PATCH', '/me/language', { token: sales.token, body: { language: 'en' } })).json?.language === 'en', 'Sales cambia su propio idioma a inglés (200)');
ok((await call('PATCH', '/me/language', { token: sales.token, body: { language: 'fr' } })).status === 400, 'un idioma que no es es ni en se rechaza (400)');
ok((await call('PATCH', '/me/language', { body: { language: 'en' } })).status === 401, 'cambiar el idioma sin token -> 401');
ok((await call('PATCH', '/me/language', { token: sales.token, body: { language: 'es' } })).json?.language === 'es', 'y lo deja otra vez en español (200)');
// Tema de la interfaz (Sistema, Claro u Oscuro): igual que el idioma, cada persona cambia el suyo.
ok((await call('PATCH', '/me/theme', { token: sales.token, body: { theme: 'dark' } })).json?.theme === 'dark', 'Sales cambia su propio tema a oscuro (200)');
ok((await call('PATCH', '/me/theme', { token: sales.token, body: { theme: 'blue' } })).status === 400, 'un tema que no es system, light ni dark se rechaza (400)');
ok((await call('PATCH', '/me/theme', { body: { theme: 'dark' } })).status === 401, 'cambiar el tema sin token -> 401');
ok((await call('PATCH', '/me/theme', { token: sales.token, body: { theme: 'system' } })).json?.theme === 'system', 'y lo deja otra vez en «system» (200)');
ok((await call('POST', '/users', { token: lead.token, body: { email: newEmail, name: 'X', role: 'manager', password: NEW_PW } })).status === 403, 'Project lead NO crea usuarios (403)');
ok((await call('GET', '/users')).status === 401, 'listar usuarios sin token -> 401');
const userList = await call('GET', '/users', { token: manager.token });
ok(userList.status === 200 && userList.json.length >= 4 && !JSON.stringify(userList.json).match(/hash|\$2[aby]\$|password/i), 'el gerente lista usuarios y no aparece ningún hash ni contraseña');
const createdUser = await call('POST', '/users', { token: manager.token, body: { email: newEmail.toUpperCase(), name: '  Flow   Vendedor ', role: 'sales', password: NEW_PW } });
ok(createdUser.status === 201 && createdUser.json.email === newEmail && createdUser.json.name === 'Flow Vendedor' && createdUser.json.role === 'sales', 'el gerente crea un vendedor (201; email en minúsculas y nombre normalizado)');
const asSales = await call('POST', '/auth/login', { body: { email: newEmail, password: NEW_PW } });
ok(asSales.status === 200 && asSales.json.user.role === 'sales', 'el vendedor nuevo inicia sesión con rol sales');
ok((await call('GET', '/invoices', { token: asSales.json.accessToken })).status === 403 && (await call('GET', '/users', { token: asSales.json.accessToken })).status === 403, 'y se comporta como Sales: sin facturas ni usuarios (403)');
ok((await call('POST', '/users', { token: manager.token, body: { email: newEmail, name: 'Otra', role: 'sales', password: NEW_PW } })).status === 409, 'un email repetido (aunque cambien las mayúsculas) -> 409');
ok((await call('POST', '/users', { token: manager.token, body: { email: `flow.debil.${Date.now()}@nexus.example`, name: 'Débil', role: 'sales', password: 'corta' } })).status === 400, 'una contraseña débil -> 400');
ok((await call('POST', '/users', { token: manager.token, body: { email: `flow.extra.${Date.now()}@nexus.example`, name: 'Extra', role: 'sales', password: NEW_PW, passwordHash: 'x' } })).status === 400, 'un campo de más (passwordHash) -> 400');
const dianaId = userList.json.find((u) => u.email === 'diana.vega@nexus.example')?.id;
ok((await call('PATCH', `/users/${dianaId}/role`, { token: manager.token, body: { role: 'sales' } })).status === 409, 'el gerente NO puede cambiar su propio rol (409)');
const changed = await call('PATCH', `/users/${createdUser.json?.id}/role`, { token: manager.token, body: { role: 'billing_analyst' } });
ok(changed.status === 200 && changed.json.role === 'billing_analyst', 'el gerente cambia el rol del vendedor a billing_analyst (200)');
ok((await call('POST', '/auth/login', { body: { email: newEmail, password: NEW_PW } })).json?.user?.role === 'billing_analyst', 'el nuevo rol vale desde el siguiente inicio de sesión');
// Ojo: el gateway deja pasar 6 inicios de sesión seguidos por IP (1 + ráfaga de 5); este flujo usa exactamente 6.

const parts = lead.token.split('.');
const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.co', role: 'billing_analyst', iss: 'identity-access', aud: 'erp-api', exp: 9999999999 })).toString('base64url')}.${parts[2]}`;
ok((await call('GET', '/invoices', { token: tampered })).status === 401, 'token alterado -> 401');
ok((await call('GET', '/invoices')).status === 401, 'sin token -> 401');

const docs = await call('GET', '/docs'); const other = await call('GET', '/auth/jwks'); const health = await call('GET', '/health', { headers: { 'x-correlation-id': 'trace-gw-0001' } });
ok(docs.status === 404 && other.status === 404, 'Swagger y rutas internas NO se exponen por el gateway');
ok(health.headers.get('x-correlation-id') === 'trace-gw-0001' && health.headers.get('x-content-type-options') === 'nosniff' && !health.headers.get('server')?.match(/\d/), 'gateway: correlación, nosniff y sin versión del servidor');

console.log(failed ? `\n${failed} comprobación(es) FALLARON` : '\nTodo el flujo de punta a punta funciona');
process.exit(failed ? 1 : 0);
