# Nexus Safe-Cloud ERP (MVP)

MVP for the Software Architecture course (Equipo 2, Velocity Softworks). Four services behind one gateway,
a React frontend, PostgreSQL (one database per service) and RabbitMQ.

| Folder | What it is |
|---|---|
| `services/identity-access` | Login, JWT issuing and user administration for the manager (`GET/POST /users`, `PATCH /users/:id/role`) |
| `services/projects` | Projects, milestones, approval (writes the event to an outbox) |
| `services/billing-receivables` | Consumes `MilestoneApproved` and creates draft invoices; publishes `InvoiceDrafted` and `InvoiceIssued` |
| `services/analytics` | Read models built from the events and the manager dashboard (`GET /dashboard`), plus the Nexus network and IoT data loaded from the course folder (`GET /telemetry/summary`) |
| `web` | React + TypeScript frontend |
| `infra` | Infrastructure files (Postgres init script, later Terraform/Helm) |
| `docs` | `openapi.yaml` (API contract) and `events.md` (event contract) |

## Correr la demo en tu equipo (paso a paso, para el equipo)

Todo corre en tu computador con Docker; no necesitas AWS ni pagar nada. Las llaves y los certificados no están en Git: cada persona los genera con dos scripts.

**Antes de empezar necesitas**
- **Git** y acceso al repositorio (es privado: pídele a Marlon que te invite como colaborador).
- **Docker** con `docker compose`: Docker Desktop (Mac o Windows) o Colima (Mac). En Mac con Colima, clona dentro de tu carpeta personal (`$HOME`); fuera de ella no puede montar las llaves.
- **Node 20 o más nuevo**, solo para el script de comprobación del paso 7 (la demo en sí no lo necesita).
- **Windows:** corre todo dentro de WSL (Ubuntu), porque los scripts son de shell (`sh`, `bash`) y clona el repo dentro del disco de Linux de WSL.
- Los puertos **8080** (la app) y 4101-4104 (Swagger) deben estar libres.

**Pasos** (en una terminal, copia y pega uno por uno)
```sh
# 1. Clonar el repositorio
git clone https://github.com/maguinda/nexus-safe-cloud-erp.git
cd nexus-safe-cloud-erp

# 2. Generar las llaves del login (JWT) y los certificados de mTLS (una sola vez)
sh infra/keys/gen-keys.sh
sh infra/certs/gen-certs.sh

# 3. Crear tu archivo de configuración (Git lo ignora; los valores de ejemplo sirven para la demo local)
cp .env.example .env

# 4. Levantar todo: base de datos, RabbitMQ, 4 servicios, la web y el gateway
#    (la primera vez descarga imágenes y compila: puede tardar varios minutos; después tarda segundos)
docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d --build

# 5. Dejar los datos de la demo como al inicio (repítelo antes de cada ensayo)
./scripts/reset-demo.sh

# 6. Abrir la app
#    http://localhost:8080
```
Si el paso 6 muestra un error 502, espera unos segundos y, si sigue, corre `docker compose restart gateway`.

**Usuarios de la demo** (todos con la contraseña `demo-password-1`, la de `DEMO_PASSWORD` en tu `.env`)

| Usuario | Rol | Qué puede hacer |
|---|---|---|
| `laura.rios@nexus.example` | project lead | Ver proyectos, crear proyectos e hitos, aprobar hitos |
| `andres.mora@nexus.example` | billing analyst | Ver facturas y emitir la factura (aparece «Due») |
| `camila.soto@nexus.example` | sales | No ve Invoices: recibe 403 |
| `diana.vega@nexus.example` | manager | Dashboard de Analytics y pestaña Users |

**Recorrido corto de la demo** (el guion completo con tiempos está en `corte_2/`, en el archivo de pitch y demo)
1. Entra como Laura y abre **Projects**.
2. Pulsa **Approve milestone** en un hito pendiente: la respuesta es inmediata y, unos segundos después, aparece una factura borrador en **Invoices**.
3. En otra pestaña entra como Diana: el **Dashboard** se actualiza solo por los eventos. Más abajo está el panel **Network & IoT** con los datos de Nexus que dejó la docente: 21 dispositivos y 4.200 lecturas (21 / 21 en línea, 39 advertencias, 3 alertas), una tabla por oficina, las últimas alertas y todos los dispositivos.
4. En una tercera pestaña entra como Andrés y pulsa **Issue invoice** en el borrador: el estado pasa a Issued y la columna **Due** muestra la fecha de vencimiento (emisión + 30 días).
5. Entra como Camila: Invoices responde 403. Con **Simulate expired token** la sesión se cierra con «Your session expired».
6. Swagger de cada servicio: http://localhost:4101/docs (identity), :4102 (projects), :4103 (billing), :4104 (analytics). Inicia sesión una vez en :4101 y pulsa Authorize en los demás.
7. Opcional: detén RabbitMQ con `docker compose stop rabbitmq`, aprueba otro hito (responde 200 igual), vuelve a arrancarlo con `docker compose start rabbitmq` y espera unos 15 segundos a que la factura aparezca.
8. Opcional: como Diana, pestaña **Usuarios**, crea un vendedor y entra con él en otra pestaña.
9. Idioma: pulsa el botón con tu rol (arriba, a la derecha) para abrir **Mi perfil** y cambia entre **Español** y **English**. La pantalla cambia al instante y el idioma queda guardado para esa persona, así que la sigue a cualquier computadora.

**Comprobar que todo funciona de punta a punta** (opcional)
```sh
node scripts/e2e-flow.mjs      # debe terminar sin ❌ (51 comprobaciones)
./scripts/reset-demo.sh        # deja la demo como al inicio
```

**Migraciones de la base de datos** (no tienes que ejecutarlas)
Cada servicio tiene su propia base y su propio historial de migraciones de Prisma (identity 3, projects 1, billing 4, analytics 1). Se aplican solas: al arrancar, cada contenedor corre `npx prisma migrate deploy`, así que el paso 4 deja las tablas creadas. Para comprobarlo:
```sh
docker compose logs billing | grep -i migration     # «4 migrations found» y «applied» o «No pending migrations to apply»
source .env
docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres \
  psql -h localhost -U "$POSTGRES_ADMIN_USER" -d billing \
  -Atc "select migration_name from _prisma_migrations order by started_at"
```
Cambia `billing` por `identity`, `projects` o `analytics` para ver los otros servicios. Si un servicio no arranca por la base, mira `docker compose logs <servicio> | tail`; para empezar de cero (borra los datos) corre `docker compose down -v` y vuelve al paso 4. No corras `prisma migrate dev` ni edites los archivos de `services/*/prisma/migrations`: un cambio de esquema es una migración nueva, en una rama aparte.

**Problemas frecuentes**
- **Error 429 al iniciar sesión:** el gateway deja 10 inicios de sesión por minuto por IP. Espera un minuto antes de volver a intentar. Los ensayos seguidos y `e2e-flow.mjs` consumen ese cupo.
- **La demo quedó «sucia»** (hitos ya aprobados, usuarios creados): corre `./scripts/reset-demo.sh`.
- **«address already in use» / puerto ocupado:** algo más usa el 8080; ciérralo o apaga la otra pila con `docker compose down`.
- **Error 502 después de recrear un contenedor:** `docker compose restart gateway`.
- **Swagger no abre:** levantaste sin el segundo archivo; usa el comando del paso 4 completo.
- **Apagar sin perder datos:** `docker compose stop`. **Borrar todo, datos incluidos:** `docker compose down -v`. Para volver a arrancar: `docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d`, luego `docker compose restart gateway` y `./scripts/reset-demo.sh`.

## Datos de Nexus (red e IoT) en Analytics

La docente dejó en la carpeta compartida del curso (`PROYECTO_NEXUS`) los datos que el ERP debe mostrar en la parte de análisis y dashboard. Se cargan en la base de **analytics** y el gerente los ve en el panel **Network & IoT** del Dashboard.

| Qué | Dónde |
|---|---|
| Datos usados | `Datos PacketTracer.xlsx`: 21 dispositivos IoT (cámaras, temperatura, humedad, movimiento, humo, calefacción y cerraduras en 3 oficinas) y 4.200 lecturas del 13 de septiembre de 2026, 08:01 a 11:20. Las marcas de tiempo no traen zona horaria y se leen como UTC |
| Archivos en el repo | `services/analytics/prisma/data/iot-devices.json` y `iot-readings.json`, más `convert-iot.py`, el script que los genera desde el Excel |
| Tablas | `iot_devices` e `iot_readings` (migración `0002_iot_telemetry`, con clave foránea, único por dispositivo e instante y tres CHECK) |
| Carga | `prisma/seed.ts` (con `SEED_DEMO=true`, al arrancar el contenedor) llama a `prisma/iot-load.ts`. Se puede repetir sin duplicar nada |
| API | `GET /telemetry/summary`, `/telemetry/trends`, `/telemetry/readings` (paginada y ordenable) y `/telemetry/facets`, solo para el gerente (403 para los demás roles) |
| Pantalla | panel **Network & IoT** en el Dashboard y la pantalla **Sensores** (hallazgos con su evidencia, cifras, filtros, gráficos y tabla de lecturas; un hallazgo filtra la tabla) |

Para volver a generar los JSON desde el Excel (necesita `openpyxl`): `python3 services/analytics/prisma/data/convert-iot.py "<ruta>/Datos PacketTracer.xlsx"`. `./scripts/reset-demo.sh` no toca estos datos.

### Inventario de red (`Data para Proveedor ERP.xlsx`)

| Qué | Dónde |
|---|---|
| Datos usados | Hojas «01 Inventario» (76 dispositivos), «03 Enlaces» (74 enlaces) y «06 Monitoreo» (estado de monitoreo de los 10 equipos de infraestructura). Las demás hojas no se cargan |
| Archivos en el repo | `prisma/data/network-devices.json`, `network-links.json`, `network-monitoring.json` y `convert-network.py` |
| Tablas | `network_devices`, `network_links`, `network_monitoring` (migración `0003_network_inventory`) |
| Carga | `prisma/network-load.ts` desde `prisma/seed.ts`, idempotente, igual que la telemetría |
| API | `GET /network/summary`, `/network/devices`, `/network/links` y `/network/facets`, solo gerente |
| Pantalla | **Red**: «qué atender», cifras, matriz de monitoreo de los equipos de infraestructura (ninguno tiene Syslog, SNMP ni NTP) y explorador con filtros; de un equipo se salta a sus enlaces |

Quedan sin cargar la captura de paquetes (`captura_tcp-2…xlsx`) y las demás hojas del inventario; no hay pantalla para subir archivos ni cálculo en tiempo real. Ningún dato está fijo en el código de la web: todo sale de la API.

### Asesor de decisiones («Qué hacer primero»)

Un panel en el Tablero del gerente que ordena los hallazgos de Sensores y Red por urgencia y dice, para cada uno, **por qué importa, qué hacer y en qué evidencia se apoya**, con un botón que abre la pantalla correspondiente.

| Qué | Cómo |
|---|---|
| Por defecto | **Reglas**: plantillas en español e inglés sobre los hallazgos que ya calculan Sensores y Red. No hace llamadas externas y siempre responde |
| Con IA | Botón «Redactar con IA»: un modelo de Claude redacta las recomendaciones. Solo **lee** los hallazgos (no tiene herramientas ni puede cambiar datos). El servidor revisa la respuesta: todo `evidenceId` debe existir y todo número debe estar en los hallazgos; si algo no cuadra se descarta y se muestran las reglas, con el motivo |
| Llave | `ANTHROPIC_API_KEY` en tu `.env` (Git lo ignora; no la pegues en chats ni commits) y opcional `ADVISOR_MODEL` (por defecto `claude-sonnet-5-5`). Sin llave el botón queda apagado y avisa por qué |
| Costo | Tope de 6 llamadas a la IA por minuto para todo el servicio; las de reglas no lo gastan. Si se pasa, responde con reglas y el motivo `limit` |
| API | `POST /advisor/brief` con `{ "language": "es" \| "en", "ai": true \| false }`, solo gerente (403 a los demás) |
| Base del negocio (playbook) | `services/analytics/src/domain/playbook.ts`: qué significa cada cosa (umbral ≠ lectura, equipo crítico, monitoreo básico), cómo priorizar y reglas de redacción. **No lleva cifras, nombres ni fechas de hoy**: eso solo sale de los hallazgos. Está versionado (`PLAYBOOK_VERSION`, visible en el panel y en la respuesta); al cambiar un criterio se sube la versión |
| Cómo se evalúa | `src/domain/advice-eval.ts`, determinista (misma respuesta → mismo veredicto). Una respuesta de la IA se **descarta entera** (y se muestran las reglas, con los códigos de lo que falló en `violations`) si: cita un hallazgo que no existe, escribe un número o un nombre de equipo que no está en los hallazgos, afirma un incidente que ninguno menciona (incendio, ataque…), da una causa como hecho, presenta el umbral como si fuera una lectura, recomienda borrar datos, rompe el orden de prioridad u omite un hallazgo de prioridad alta |
| Casos de oro | `src/domain/advisor-golden.ts` (5 situaciones fijas, incluida una con un nombre de dispositivo que da órdenes). Las respuestas por reglas también tienen que pasar el mismo evaluador |
| Medir a la IA real | `ADVISOR_LIVE_EVAL=1 EVAL_RUNS=3 npx jest --config jest.e2e.config.js test/advisor-live-eval.e2e.ts` (con la llave en el entorno; cuesta unas monedas y no corre en el CI). Imprime una tarjeta de calificaciones por caso e idioma |
| Aprende? | **No entrena el modelo.** Mejora cuando el equipo revisa la tarjeta y ajusta el playbook (se sube la versión y se vuelve a medir). Guardar decisiones del gerente y alimentar el playbook con ellas queda como trabajo futuro, con revisión humana |
| Seguridad | Los nombres que vienen del Excel se envían como **datos** dentro de un bloque JSON y el modelo no obedece instrucciones que estén ahí; lo peor que puede pasar es una respuesta descartada |

### Idioma, tema y login

La interfaz está en español por defecto y en inglés a elegir desde «Mi perfil»; ahí mismo se elige el tema (Sistema, Claro u Oscuro). Ambas preferencias se guardan por persona en la base (`users.language`, `users.theme`; `PATCH /me/language` y `/me/theme`). Lo que viene de la base de datos no se traduce. El login es móvil primero (una columna) y de pantalla dividida desde 900 px.

## Idioma de la interfaz (español e inglés)

La interfaz está en **español por defecto** y cada persona puede pasarla a inglés desde su perfil.

- **Qué se traduce:** todo lo que es de la aplicación (pantallas, menús, botones, tablas, avisos y validaciones). **No** se traduce lo que viene de la base de datos: nombres de proyectos e hitos, la frase de «Actividad reciente», y las notas y tipos de dispositivo de los datos de la docente se muestran como están.
- **Dónde se guarda:** en la base de identity (`users.language`, `es` o `en`, con un CHECK; migración `0004_user_language`). Por eso el idioma sigue a la persona a cualquier computadora. El login devuelve `user.language` y la pantalla abre en él. Los usuarios nuevos y los que ya existían quedan en español. Antes de iniciar sesión, la pantalla de entrada usa el último idioma que se usó en ese navegador.
- **API:** `PATCH /me/language` con `{ "language": "es" | "en" }`, cualquier rol con un token válido. La persona sale del token, nunca del cuerpo; un campo de más se rechaza (400).
- **En la web:** `web/src/i18n/` (diccionarios `es/` y `en/` por área, con las mismas claves: si falta una en un idioma, no compila) y el menú `ProfileMenu`. Los avisos que manda el servidor en inglés se traducen en pantalla (`i18n/server.ts`); si uno no se reconoce, se muestra el original.
- `./scripts/reset-demo.sh` deja a los 4 usuarios de la demo en español.

## Where things live

```
erp/
├─ services/                  the 4 microservices; each one is its own program with its own database
│  ├─ identity-access/        login and token
│  ├─ projects/               projects, milestones, approval
│  ├─ billing-receivables/    invoices, IVA, reconciliation
│  └─ analytics/              read models and the manager dashboard
├─ web/                       the screen (React)
├─ infra/                     everything that is not business code
│  ├─ gateway/nginx.conf      the gateway
│  ├─ certs/gen-certs.sh      the mTLS certificates
│  └─ keys/gen-keys.sh        the JWT keys
├─ docs/                      the API contract (openapi.yaml) and the event contract (events.md)
├─ scripts/                   test scripts and the demo reset
└─ docker-compose.yml         starts everything together
```

Inside every service the code is split in layers, so a rule never depends on the framework or the database:

```
services/<name>/
├─ src/
│  ├─ http/            receives the request and answers (routes + controllers, no logic)
│  ├─ application/     one use case per action: the story of what happens
│  ├─ domain/          the business rules, plain functions with their unit tests
│  ├─ infrastructure/  the database, RabbitMQ and other tools
│  ├─ auth/            the guard: verifies the JWT and the role
│  └─ tls.ts           mTLS: requires the caller's certificate
├─ prisma/             schema, migrations and demo seed
├─ test/               end-to-end tests against real PostgreSQL and RabbitMQ
└─ Dockerfile
```

### Where the mTLS lives

| What | Where |
|---|---|
| Create the certificates | `infra/certs/gen-certs.sh` |
| Require the caller's certificate in each service | `services/*/src/tls.ts` (the same file in the three services) |
| Start with TLS | `services/*/src/main.ts` |
| Handshake tests | `services/*/test/mtls.e2e.ts` |
| The gateway presenting its certificate | `infra/gateway/nginx.conf` |
| Pass everything to the containers | `docker-compose.yml` |

## Run the whole stack (containers + gateway)

```sh
sh infra/keys/gen-keys.sh                 # once: JWT key pair (git-ignored)
sh infra/certs/gen-certs.sh               # once: internal CA + mTLS certificates (git-ignored)
cp .env.example .env                      # then change the passwords
docker compose up -d --build              # postgres, rabbitmq, 3 services, nginx gateway
./scripts/reset-demo.sh                   # demo data back to its initial state
node scripts/e2e-flow.mjs                 # whole flow through the gateway
```

### mTLS between the gateway and the services
The services are **not** reachable over plain HTTP. Each one serves HTTPS and requires a client certificate signed by the internal CA (`infra/certs/gen-certs.sh`) **and** whose name is in its allow-list (`TLS_ALLOWED_CLIENTS`: the gateway, plus the service itself for its healthcheck). A compromised service cannot call another one, even from inside the network. The JWT is still verified on every route: mTLS proves *which service* is calling, the JWT proves *which user*.

`docker-compose.docs.yml` (demo only) opens a second plain-HTTP port per service on `127.0.0.1` so Swagger opens in a browser; the JWT stays mandatory there. Without that file the door does not exist. After recreating a service container, run `docker compose restart gateway` (nginx caches the upstream addresses).

The only published port is the gateway, `127.0.0.1:8080`. Services have no published ports; the gateway exposes just
`POST /auth/login`, `/users`, `/projects`, `/milestones`, `/invoices`, `/dashboard`, `/telemetry`, `/health`. It does not authenticate: every service verifies the JWT again.
For the demo, Swagger of each service: `docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d`
then http://localhost:4101/docs (identity), :4102/docs (projects), :4103/docs (billing) and :4104/docs (analytics). Each service documents only its own routes; the JWT is the same for all (log in once on :4101 and press Authorize in the others). The whole contract is in `docs/openapi.yaml`.

The web app is served by the same gateway: open http://localhost:8080. Tests: `cd web && npm run test:e2e` (see `web/README.md`).

Demo logins (password in `.env`, `DEMO_PASSWORD`): `laura.rios@nexus.example` (project lead),
`andres.mora@nexus.example` (billing analyst), `camila.soto@nexus.example` (sales), `diana.vega@nexus.example` (manager: reads the Analytics dashboard and administers users in the Users tab, 403 everywhere else). `scripts/reset-demo.sh` removes any user created in the demo and restores these four roles.

## Run the infrastructure locally

```sh
cp .env.example .env      # then change the passwords
docker compose up -d      # PostgreSQL 16 and RabbitMQ 3.13
docker compose ps         # both should be "healthy"
```

Ports are published on `127.0.0.1` only. RabbitMQ management UI: http://localhost:15672.
Never commit `.env` or any `*.pem` / `*.key` file.
