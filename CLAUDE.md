# erp · código del proyecto (Nexus Safe-Cloud)

Repositorio **privado**: https://github.com/maguinda/nexus-safe-cloud-erp (monorepo; esta carpeta es la raíz del repositorio; la carpeta padre `arquitectura_software` NO es un repo).
Contexto, decisiones y stack: ver el `CLAUDE.md` de la carpeta padre y `../corte_2/`. Alcance del MVP aprobado por Marlon el 2026-10-18 = el boceto `../corte_2/boceto_mvp.html`; no agregar módulos sin que él lo pida.

## Estado (2026-10-19, tarde)
MVP completo y verificado: 4 servicios NestJS (identity, projects, billing, analytics) + React + PostgreSQL + RabbitMQ + gateway nginx, en contenedores, con CI en GitHub Actions. 31 PR mezclados: IVA y conciliación (#11), mTLS gateway→servicios (#12), rol `manager` (#15), servicio Analytics y su API de dashboard (#19), pantalla del dashboard (este cambio), billing publica `InvoiceDrafted`/`InvoiceIssued` por outbox y arreglo del consumidor (#16), crear proyectos e hitos por API y por pantalla (#17). Probado clonando el repo desde cero (2026-10-18).

| Pieza | Qué es | Puerto |
|---|---|---|
| `services/identity-access` | login, JWT RS256 con rol | 4101 (interno) |
| `services/projects` | proyectos, hitos, aprobar → outbox → RabbitMQ | 4102 (interno) |
| `services/billing-receivables` | consume `MilestoneApproved`, factura borrador; emitir | 4103 (interno) |
| `services/analytics` | modelos de lectura por eventos y `GET /dashboard` (solo `manager`) | 4104 (interno) |
| `web` | React 19 + TS + Vite, CSS Modules y tokens | vía gateway |
| `infra/gateway` | nginx: único puerto publicado `127.0.0.1:8080` | 8080 |

Pruebas (2026-10-19): unitarias 305 (identity 24, projects 52, billing 106, analytics 57, web 66), e2e con PostgreSQL y RabbitMQ reales 200 (identity 30, projects 81, billing 44, analytics 45), flujo completo `scripts/e2e-flow.mjs` (38 comprobaciones), y navegador `web/` 58 (28 funcionales + 30 auditorías de pantalla en Chromium y WebKit, iPhone SE, iPhone 13, Pixel 5 y 320 px).

## Cómo correr
```sh
sh infra/keys/gen-keys.sh && sh infra/certs/gen-certs.sh && cp .env.example .env    # una vez (llaves, certificados y .env están en .gitignore)
docker compose up -d --build                           # pila completa; demo en http://localhost:8080
./scripts/reset-demo.sh                                # deja la demo como al inicio (hacerlo antes de presentar)
node scripts/e2e-flow.mjs                              # flujo de punta a punta por el gateway
cd web && npm run test:e2e                             # navegador (necesita `npx playwright install chromium webkit` una vez)
docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d   # además publica Swagger en 127.0.0.1:4101-4103/docs (solo demo)
```
Logins de demostración (contraseña en `.env`, `DEMO_PASSWORD`): laura.rios@ (project_lead), andres.mora@ (billing_analyst), camila.soto@ (sales), diana.vega@ (manager: solo ve el Dashboard de Analytics; 403 en el resto), todos `@nexus.example`.

## Trampas aprendidas
- Colima (motor de contenedores) solo comparte `$HOME` con su VM: un repo/clon fuera de tu carpeta personal no puede montar las llaves.
- El gateway limita el login (10 por minuto por IP): el setup de Playwright reutiliza las sesiones guardadas; si ves 429, espera un minuto.
- Los tests funcionales de `web/` escriben datos de demo; correr `./scripts/reset-demo.sh` después.
- Los puertos 3000/3001 los usaba Eventify (otro proyecto de Marlon); estos servicios usan 4101-4103 y 8080.
- `scripts/reset-demo.sh` reinicia la secuencia de facturas a 103, así que debe limpiar TAMBIÉN el outbox de billing (restricción única por factura y tipo); si no, el siguiente borrador (INV-0103 otra vez) choca, el evento termina en la cola de mensajes muertos y «la factura no aparece». En producción los números no se reutilizan. Lo encontró la CI de GitHub (WebKit) y se reprodujo 6 de 6 en local.
- Con `docker compose` arriba, el contenedor de billing/projects CONSUME los mismos mensajes que las pruebas e2e: para correr tests de cola, `docker compose stop billing` (o projects) antes.
- Un mensaje que ya espera en la cola cuando arranca el consumidor se perdía (`this.ch` se asignaba tras `consume`): arreglado en #16; la regresión es `consumer-backlog.e2e.ts`.
- Un RabbitMQ recién creado no tiene las colas: los tests no deben consultarlas antes de que el consumidor las cree.
- La política de contenido (CSP) del gateway está en modo solo-reporte (`/csp-report`); falta pasarla a bloqueo en un PR aparte. En WebKit la propia captura de Playwright inyecta estilos y genera un reporte (la auditoría los separa).

## Fecha de vencimiento de facturas (2026-10-19)
`domain/due-date.ts` (`dueDate(issuedAt, 30)`, días de calendario en UTC) se aplica en `issue()`: solo las facturas **emitidas** tienen `dueDate`; el borrador es `null`. Migración `0004` con relleno de las ya emitidas y dos CHECK (emitida ⇔ con fecha; vence ≥ emisión). Sale en `GET /invoices` y en `InvoiceIssued`; la tabla web tiene la columna «Due». Límite: aún no hay detección de facturas vencidas (`OverdueDetected`) ni pagos. En 320 px la tabla de facturas se desplaza de lado y «Due» queda fuera de la vista hasta deslizar.

## Pantalla Invoices (2026-10-19, #28 y #29)
Tabla con buscador (número, proyecto, hito), filtro All/Draft/Issued con conteos, columnas ordenables (`aria-sort`; el borrador queda al final al ordenar por Due), encabezado fijo, chip ámbar si vence en 7 días o menos y rojo si ya venció (días UTC), y estados de carga y vacío. La lógica pura está en `web/src/lib/invoice-table.ts` (25 pruebas). Un chip ámbar o rojo se prueba en el navegador ajustando solo la respuesta de `/invoices` (la base no cambia). En ≤ 640 px los 5 botones «Sort by» caben en una fila y las filas pasan a tarjetas con la pieza compartida `.cardsOnPhone` de `ui.module.css` (el dashboard la usa también) y los botones «Sort by» reemplazan los encabezados. Trampa: un `<select>` nativo sale de 21 px en WebKit y dispara un aviso de la política de contenido; por eso son botones. Referencias de diseño: Dribbble «erp dashboard» y el estilo Data-Dense Dashboard de ui-ux-pro-max.

## mTLS (2026-10-18, US-01)
Gateway → servicios va por HTTPS con certificado en ambos lados (CA propia, `infra/certs/gen-certs.sh`, P-256, 1 año, solo desarrollo). Cada servicio exige un carné firmado por esa CA **y** que su nombre (CN) esté en `TLS_ALLOWED_CLIENTS` (`gateway` + él mismo para su healthcheck): un servicio vulnerado no puede llamar a otro. El JWT se sigue verificando en cada ruta. `TLS_ENABLED=true` sin sus variables impide arrancar. Pruebas con apretón de manos real en `services/*/test/mtls.e2e.ts` (generan sus propios certificados con `CERT_DIR`).
- Swagger en el navegador: `docker-compose.docs.yml` abre un segundo puerto SIN mTLS (`DOCS_HTTP_PORT`, solo 127.0.0.1); el JWT sigue exigido. Es una decisión a mencionar en la sustentación.
- Trampa: el `openssl` de macOS (LibreSSL) firma con SHA-1 por defecto y Node lo rechaza; el script fija `-sha256`.
- Trampa: tras recrear un contenedor de servicio, `docker compose restart gateway` (nginx guarda las IP; si no, 502).
- No cubierto: rotación de certificados, revocación y una CA real (en AWS lo haría Istio; aquí es un prototipo).

## Cómo trabajar aquí (autorizado por Marlon el 2026-10-18)
- Una rama por cambio, commits pequeños (un tema por commit), PR con riesgo (🟢🟡🔴), atributos de calidad, verificación y cómo revertir; **Claude puede hacer commits y mezclar los PR en este repo** con commit de merge (`gh pr merge --merge`), para poder revertir con `git revert -m 1`.
- Nunca commit directo en `main` (solo el commit inicial); `git branch --show-current` antes de editar.
- Si una prueba nueva pasa sin el arreglo, no prueba nada: hacer una mutación (romper la regla) y ver que falla.
- Concurrencia: ≥ 30 rondas e invariante, no una sola pasada. Pruebas de pantalla: bloquear escrituras y comparar la base.
- Los secretos nunca van a Git (`.env`, `*.pem`, `*.key` ignorados). `npm install` siempre con `--ignore-scripts`.

## Pendiente
- Corte 2 (en `../corte_2/`): informe PDF, slides y guion de pitch y demo ya escritos el 2026-10-19; falta que Marlon y Edwin ensayen la demo y los 10 minutos.
- Opcionales aprobables: evento al crear hitos (para que el dashboard muestre los pendientes), política de contenido en bloqueo, TLS en el despliegue, probar en celular real y Android.
- Verificar en la documentación de AWS: mTLS en API Gateway, Istio con la versión de EKS, tiempo real de failover de RDS Multi-AZ (solo afecta lo dicho en la sustentación sobre la arquitectura objetivo).
