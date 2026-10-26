# erp · código del proyecto (Nexus Safe-Cloud)

Repositorio **privado**: https://github.com/maguinda/nexus-safe-cloud-erp (monorepo; esta carpeta es la raíz del repositorio; la carpeta padre `arquitectura_software` NO es un repo).
Contexto, decisiones y stack: ver el `CLAUDE.md` de la carpeta padre y `../corte_2/`. Alcance del MVP aprobado por Marlon el 2026-10-18 = el boceto `../corte_2/boceto_mvp.html`; no agregar módulos sin que él lo pida.

## Estado (2026-10-19, tarde)
MVP completo y verificado: 4 servicios NestJS (identity, projects, billing, analytics) + React + PostgreSQL + RabbitMQ + gateway nginx, en contenedores, con CI en GitHub Actions. 39 PR mezclados: IVA y conciliación (#11), mTLS gateway→servicios (#12), rol `manager` (#15), servicio Analytics y su API de dashboard (#19), pantalla del dashboard (este cambio), billing publica `InvoiceDrafted`/`InvoiceIssued` por outbox y arreglo del consumidor (#16), crear proyectos e hitos por API y por pantalla (#17). Probado clonando el repo desde cero (2026-10-18).

| Pieza | Qué es | Puerto |
|---|---|---|
| `services/identity-access` | login, JWT RS256 con rol y **administración de usuarios** (solo `manager`: `GET/POST /users`, `PATCH /users/:id/role`) | 4101 (interno) |
| `services/projects` | proyectos, hitos, aprobar → outbox → RabbitMQ | 4102 (interno) |
| `services/billing-receivables` | consume `MilestoneApproved`, factura borrador; emitir | 4103 (interno) |
| `services/analytics` | modelos de lectura por eventos, `GET /dashboard` y `GET /telemetry/summary` con los datos de red e IoT de Nexus (ambos solo `manager`) | 4104 (interno) |
| `web` | React 19 + TS + Vite, CSS Modules y tokens | vía gateway |
| `infra/gateway` | nginx: único puerto publicado `127.0.0.1:8080` | 8080 |

Pruebas (2026-10-26): unitarias 898 (identity 86, projects 52, billing 106, analytics 171, web 483), e2e con PostgreSQL y RabbitMQ reales 552 (identity 183, projects 83, billing 46, analytics 240; más 10 de evaluación contra la IA real, opt-in), flujo completo `scripts/e2e-flow.mjs`, y navegador `web/` 316 (100 funcionales en Chromium y WebKit + 216 auditorías de pantalla en claro y oscuro, español e inglés, escritorio, WebKit, iPhone SE, iPhone 13, Pixel 5 y 320 px). Incluye las pantallas Sensores y Red. No probado: celular real, teclado virtual, Android real.

## Cómo correr
```sh
sh infra/keys/gen-keys.sh && sh infra/certs/gen-certs.sh && cp .env.example .env    # una vez (llaves, certificados y .env están en .gitignore)
docker compose up -d --build                           # pila completa; demo en http://localhost:8080
./scripts/reset-demo.sh                                # deja la demo como al inicio (hacerlo antes de presentar)
node scripts/e2e-flow.mjs                              # flujo de punta a punta por el gateway
cd web && npm run test:e2e                             # navegador (necesita `npx playwright install chromium webkit` una vez)
docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d   # además publica Swagger en 127.0.0.1:4101-4103/docs (solo demo)
```
Logins de demostración (contraseña en `.env`, `DEMO_PASSWORD`): laura.rios@ (project_lead), andres.mora@ (billing_analyst), camila.soto@ (sales), diana.vega@ (manager: ve el Dashboard de Analytics y administra usuarios en la pestaña Users; 403 en el resto), todos `@nexus.example`.

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

- **Formato de los CSS:** Marlon los formatea en su editor y quiere que tengan formato legible. Se mantiene con Prettier (`cd web && npm run format:css`, o `format:css:check`; configuración en `web/.prettierrc.json`, 2 espacios). Un formateo no debe cambiar cómo se ve: se comprueba comparando el CSS compilado tras normalizar los sufijos de clase de CSS Modules (hash y número de línea). Antes de cada commit revisar `git status` y `git diff --stat` por archivos que no se tocaron.
- **Swagger en Safari:** `upgrade-insecure-requests` (valor por defecto de helmet) hacía que Safari pidiera los scripts del Swagger por HTTPS y la página saliera en blanco (error de TLS; Chrome lo perdona en localhost). Se quitó esa directiva en los 4 servicios; hay una prueba `test/docs.e2e.ts` por servicio. Tras reconstruir un servicio, levantar SIEMPRE con `-f docker-compose.yml -f docker-compose.docs.yml`; sin el segundo archivo el puerto 41xx del Swagger no existe.
- **Mutaciones en la web:** una mutación que no compila (TypeScript prohíbe variables sin usar) deja el contenedor con el código bueno y la prueba «pasa» sin probar nada. Comprobar que el hash del bundle servido cambie tras reconstruir.

## Idioma de la interfaz: español por defecto, inglés a elegir (2026-10-26)
Pedido de Marlon: lo que ve el usuario (pantallas y opciones) en español, con selector en el perfil; **lo que viene de la base se muestra como es** (no se traduce la «Actividad reciente», ni nombres de proyecto, ni notas y tipos de dispositivo de los datos de la docente). Marlon eligió guardar la preferencia **en la base de datos** (opción B), no en el navegador.
- **Backend (identity):** migración `0004_user_language` (`users.language` TEXT NOT NULL DEFAULT 'es' + CHECK es|en, aditiva); `PATCH /me/language` (cualquier rol; la persona sale del token, el DTO rechaza campos de más; un token de alguien que ya no existe da 404); el login devuelve `user.language`. Ruta `/me/language` en el gateway. `reset-demo.sh` pone a los 4 usuarios en español.
- **Web:** `web/src/i18n/` con diccionarios por área (`es/` es la fuente de las claves; `en/` tiene que tener las mismas o no compila; pruebas de claves, marcadores `{x}` y claves repetidas entre áreas), `session.tsx` (`lang`, `t`, `setLanguage`, `<html lang>`), `ProfileMenu` (botón del rol → «Mi perfil» con Español | English), `i18n/server.ts` (traduce los avisos del servicio que llegan en inglés; lo desconocido se muestra tal cual). Fechas y conteos se arman a mano (`lib/format.ts`): el abreviado del mes y el separador de miles cambian entre navegadores.
- **Glosario fijo (español):** Dashboard→Tablero, Users→Usuarios, Projects→Proyectos, Invoices→Facturas, Milestone→Hito, Approve milestone→Aprobar hito, Issue invoice→Emitir factura, Draft→Borrador, Issued→Emitida, Due→Vence, Manager→Gerente, Project lead→Líder de proyecto, Billing analyst→Analista de facturación, Sales→Ventas, Network & IoT→Red e IoT.
- **Pruebas del navegador:** siguen en inglés (`openAs(page, rol, 'en')` fija el idioma de la sesión y `preferLanguage` el de la pantalla de entrada); las nuevas en español usan `translate('es', clave)` del propio diccionario. La auditoría mide cada pantalla en los dos idiomas y abre el menú de perfil.
- **Trampas:** (1) las pruebas no deben usar el login para leer el idioma guardado: el gateway deja pasar 10 por minuto (el 429 llega como HTML de nginx); se lee de la base. (2) El menú de perfil se salía por la izquierda en celular: en ≤ 640 px se ancla a la barra completa. (3) La prueba del vendedor nuevo dependía de qué proyecto quedaba seleccionado («Read only» solo sale en un hito pendiente) y fallaba a veces en el CI: ahora crea su propio proyecto.
- **Límites:** el orden por nombre de proyecto usa el criterio del inglés; los avisos de error ya a la vista no se re-traducen hasta la siguiente carga; un idioma nuevo pide una columna con CHECK nuevo y las claves en un diccionario más.

## Datos de Nexus: red e IoT en Analytics (2026-10-25)
La docente pidió subir al ERP, en análisis y dashboard, los datos de la carpeta compartida `PROYECTO_NEXUS` (copia en `../corte_2/PROYECTO_NEXUS/`, no va a Git). Se cargó `Datos PacketTracer.xlsx`: 21 dispositivos IoT y 4.200 lecturas (2026-09-13, sin zona horaria: se leen como UTC).
- **Base:** migración `0002_iot_telemetry` en analytics (`iot_devices`, `iot_readings`; FK, único (dispositivo, instante) y 3 CHECK). Trampa: en PostgreSQL `NaN = NaN` es verdadero, así que un CHECK `value = value` no rechaza NaN; se compara con el literal. El cliente de Prisma ya rechaza NaN antes de llegar a la base, por eso la prueba de esa regla usa SQL directo.
- **Carga:** `prisma/iot-load.ts` desde `prisma/seed.ts` (idempotente: el id de cada lectura viene de la fuente). Los JSON salen de `prisma/data/convert-iot.py`. El Dockerfile copia `prisma/`, por eso los JSON y el cargador viajan en la imagen (el seed no puede importar de `src/`).
- **API:** `GET /telemetry/summary` (solo `manager`). El repositorio entrega agregados (nunca las 4.200 filas); el estado de cada dispositivo sale de su ÚLTIMA lectura; la lista de atención pone las alertas antes que las advertencias.
- **Pantalla:** panel `Network & IoT` en el Dashboard (`TelemetryPanel.tsx`). Fecha armada a mano en UTC (el abreviado del mes cambia entre motores) y conteos con formato fijo en-US. En celular la lista de 21 dispositivos empieza plegada (el panel pasó de 6.525 a 2.099 px a 320 px).
- **Inventario de red (2026-10-26):** `Data para Proveedor ERP.xlsx` (hojas 01, 03 y 06) cargado con la migración `0003_network_inventory` y `prisma/network-load.ts`: 76 dispositivos, 74 enlaces y el monitoreo de 10 equipos de infraestructura. Endpoints `/telemetry/{summary,trends,readings,facets}` y `/network/{summary,devices,links,facets}`, todos solo `manager`. Pantallas **Sensores** y **Red** (hallazgos por reglas puras con su evidencia, filtros reales, gráficos propios en SVG con tabla alternativa, tablas paginadas). Hooks pequeños en `web/src/hooks`, estilos solo en CSS Modules con tokens, móvil primero.
- **Asesor de decisiones (2026-10-26):** `POST /advisor/brief` (solo `manager`) y el panel «Qué hacer primero» del Tablero. Reglas por defecto (plantillas es/en sobre los hallazgos de Sensores y Red); con `ANTHROPIC_API_KEY` y `ai:true`, un modelo de Claude redacta y el servidor valida (todo `evidenceId` existe y todo número está en los hallazgos) o devuelve las reglas con el motivo. Solo lee; tope de 6 llamadas de IA por minuto; las de reglas no se limitan (la auditoría de navegador pasa por el Tablero cientos de veces). Detalle en el README. Trampa: la auditoría bloquea todo POST, así que deja pasar solo `/advisor/brief` con `ai:false`. Trampa 3: la auditoría completa de navegador debe correr con la demo recién reseteada (`./scripts/reset-demo.sh`): las pruebas funcionales dejan proyectos creados y con 5 en vez de 3 la pantalla de la líder agota el límite del servicio de Proyectos (429 en los hitos; 2 casos de 320 px fallaban siempre; con reset, 216 de 216). Trampa 2: las pruebas e2e del consumidor de RabbitMQ con mensajes pendientes **fallan si hay un Analytics vivo** (se queda con los mensajes): detén el contenedor `analytics` antes de correrlas (4 de 4 fallan con él vivo y 4 de 4 pasan sin él).
- **Playbook y evaluación del asesor (2026-10-26):** `playbook.ts` (criterios del negocio, sin cifras; versionado), `advice-eval.ts` (evaluador determinista: ids, números, nombres, incidentes inventados, causa como hecho, umbral como lectura, borrar datos, orden, hallazgo alto omitido), `advisor-golden.ts` (5 casos de oro) y `test/advisor-live-eval.e2e.ts` (mide a la IA real; opt-in con `ADVISOR_LIVE_EVAL=1`). Medido con la IA real: playbook .2, ~86 corridas con 2 descartadas (ambas «the cause is»); playbook .3 (aclara que Velocity Softworks es la consultora y Nexus Safe-Cloud el cliente), 60 de 60. Lecciones de la medición: la IA hacía restas (10 − 4 = 6) y daba cifras derivadas → se le prohibió en el playbook; el modelo gasta tokens pensando y con `max_tokens` 1500 la respuesta llegaba cortada; Sonnet 5.5 rechaza `temperature`.
- **Tema e idioma:** `users.language` y `users.theme` (migraciones 0004 y 0005), `PATCH /me/language` y `/me/theme`; login rediseñado (PR #54). Un deadlock real (40P01) al cambiar roles a la vez se arregló con un advisory lock; la prueba nueva falla 9 de 12 sin el arreglo.
- **Límite:** la captura de paquetes y las demás hojas del inventario no están cargadas; no hay pantalla para «subir un archivo»; no se calcula nada en tiempo real (es un conjunto fijo del 13 de septiembre).
- `reset-demo.sh` no toca estas tablas. El e2e de telemetría las borra y las vuelve a cargar al terminar.

## Fecha de vencimiento de facturas (2026-10-19)
`domain/due-date.ts` (`dueDate(issuedAt, 30)`, días de calendario en UTC) se aplica en `issue()`: solo las facturas **emitidas** tienen `dueDate`; el borrador es `null`. Migración `0004` con relleno de las ya emitidas y dos CHECK (emitida ⇔ con fecha; vence ≥ emisión). Sale en `GET /invoices` y en `InvoiceIssued`; la tabla web tiene la columna «Due». Límite: aún no hay detección de facturas vencidas (`OverdueDetected`) ni pagos. En 320 px la tabla de facturas se desplaza de lado y «Due» queda fuera de la vista hasta deslizar.

## Pantalla Invoices (2026-10-19, #28 y #29)
Tabla con buscador (número, proyecto, hito), filtro All/Draft/Issued con conteos, columnas ordenables (`aria-sort`; el borrador queda al final al ordenar por Due), encabezado fijo, chip ámbar si vence en 7 días o menos y rojo si ya venció (días UTC), y estados de carga y vacío. La lógica pura está en `web/src/lib/invoice-table.ts` (25 pruebas). Un chip ámbar o rojo se prueba en el navegador ajustando solo la respuesta de `/invoices` (la base no cambia). En ≤ 640 px los 5 botones «Sort by» caben en una fila y las filas pasan a tarjetas con la pieza compartida `.cardsOnPhone` de `ui.module.css` (el dashboard la usa también) y los botones «Sort by» reemplazan los encabezados. Trampa: un `<select>` nativo sale de 21 px en WebKit y dispara un aviso de la política de contenido; por eso son botones. Referencias de diseño: Dribbble «erp dashboard» y el estilo Data-Dense Dashboard de ui-ux-pro-max.

## Administración de usuarios (2026-10-19, #34 y #35)
Solo el gerente, en identity-access: `GET /users`, `POST /users` (email, nombre, rol, contraseña inicial) y `PATCH /users/:id/role`; por el gateway (`/users`, límite por IP) y con la pestaña **Users** de la web. Antes los 4 usuarios solo existían por el seed.
- Cada acción **relee el rol actual en la base** (el token dura 15 min): un gerente degradado pierde el acceso aunque su token siga vigente.
- Cambio de rol: bloquea primero las filas de los gerentes (`SELECT … FOR UPDATE`), nadie cambia su propio rol y el último gerente nunca lo pierde (prueba de 30 rondas con dos gerentes que se degradan a la vez). Un bloqueo extra por fila era redundante y se quitó.
- Contraseña: 12 caracteres como mínimo, 72 bytes como máximo (límite de bcrypt), sin contener el email ni su parte de nombre, 4 caracteres distintos; solo se guarda el hash. Email en minúsculas por el código y por un `CHECK` (migración 0003). La web valida con las mismas reglas (`web/src/lib/user-validate.ts`) y el servidor vuelve a validar.
- Identity ahora **verifica** tokens (antes solo los firmaba): guard cerrado por defecto, login y salud `@Public()`; la llave pública se deriva de la privada.
- Límites: sin eventos `UserCreated`/`RoleChanged` (identity no tiene outbox), sin cambiar la propia contraseña, sin desactivar usuarios ni revocar tokens; el rol nuevo vale desde el siguiente inicio de sesión; un gerente puede crear otro gerente.
- `reset-demo.sh` borra los usuarios creados y restaura los 4 roles. El flujo `scripts/e2e-flow.mjs` usa exactamente 6 inicios de sesión (el gateway deja pasar 6 seguidos por IP).

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
