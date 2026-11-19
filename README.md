# Nexus Safe-Cloud ERP (MVP)

MVP de la materia Arquitectura de Software (Equipo 2, Velocity Softworks). **Ocho servicios** detrás de un solo gateway
(identity-access, projects, billing-receivables, analytics, notifications, technical-capacity, operations, procurement),
un frontend en React con **siete roles**, PostgreSQL (una base por servicio) y RabbitMQ (eventos con outbox transaccional).

**Qué cubre hoy (2026-11-01):** una cotización aprobada crea el proyecto, los hitos y el contrato → cada hito tiene un ingeniero
responsable que crea actividades y las asigna a técnicos → facturación, pagos y detección de facturas vencidas → personal y
capacidad (nadie pasa de 100 %) → compras, inventario, instalación y conteo físico → órdenes de mantenimiento (no son parte de ningún
proyecto y sí gastan capacidad) → nómina, cuentas por pagar, flujo de caja y costo real contra lo cotizado → datos de sensores y de red.
La factura electrónica y la nómina son **de prueba (sandbox), sin validez legal**. Está listo para desplegarse en un servidor
(`docs/DEPLOY.md`), pero **no se ha desplegado**, y la plataforma en AWS (EKS, Istio, Kinesis) es un diseño, no algo que corra hoy.
El alcance completo y honesto (y lo que NO está) está en `CLAUDE.md` y en el documento SAD de la entrega (secciones 6 y 7).

## Arquitectura en una página

```
 Navegador (React, 7 roles)
        │ HTTPS
        ▼
 Gateway nginx  ──(mTLS + JWT RS256)──►  8 microservicios NestJS (núcleo hexagonal)
 (único puerto 8080)                      identity · projects · billing · analytics ·
                                          notifications · technical-capacity · operations · procurement
                                                │ una base PostgreSQL por servicio (Prisma)
                                                ▼
                                   RabbitMQ topic exchange «erp.events»
                                   (outbox transaccional → relé → colas por consumidor + cola de mensajes muertos)
```

- **Un servicio por contexto delimitado**, cada uno con su base y su propio rol de base de datos; entre servicios se referencian
  los datos por valor, nunca con llaves foráneas.
- **Eventos con outbox:** el servicio guarda el cambio y el evento en la misma transacción; un relé lo publica después. La entrega es
  al menos una vez y los consumidores son idempotentes. Contrato de cada evento en `docs/events.md`.
- **Zero Trust:** cada servicio verifica un JWT RS256 (emisor, audiencia y rol) y exige el certificado del gateway (mTLS).
- **Núcleo hexagonal:** la lógica de negocio no depende del framework ni de la base de datos y se prueba sin ellos.
- **Objetivo en AWS (diseño):** EKS en tres zonas, RDS PostgreSQL Multi-AZ, RabbitMQ dentro de EKS, Kinesis para telemetría y API Gateway. El
  documento completo (SAD) tiene la topología, el presupuesto en USD/COP y los ADR.

## Qué hay en cada carpeta

| Carpeta | Qué es |
|---|---|
| `services/identity-access` | Inicio de sesión, emisión del JWT, renovación y cierre de sesión en todas partes, siete roles y administración de usuarios para el gerente (`GET/POST /users`, `PATCH /users/:id/role`); publica `UserCreated` y `RoleChanged` |
| `services/projects` | Proyectos, hitos, aprobación (escribe el evento en el outbox), cotizaciones de ventas, el ingeniero responsable de cada hito y sus actividades para técnicos |
| `services/billing-receivables` | Consume `MilestoneApproved` y crea facturas borrador; publica `InvoiceDrafted` e `InvoiceIssued`; pagos, conciliación y facturas vencidas |
| `services/analytics` | Modelos de lectura construidos con los eventos de negocio y el tablero del gerente (`GET /dashboard`) |
| `services/operations` | Operaciones y telemetría: los datos de red e IoT de Nexus de la carpeta de la materia (`GET /telemetry/*`, `GET /network/*`), la ingesta de telemetría (clave de servicio) y el asesor de decisiones (`POST /advisor/brief`). Publica `ThresholdBreached` cuando un sensor empeora. Base propia, mTLS, puerto 4107 |
| `services/procurement` | Proveedores, órdenes de compra e inventario de equipos y repuestos. Una orden solo mueve el inventario al recibirse (una sola vez, con bloqueo de filas); el stock nunca baja de 0; sugiere repuestos cuando un sensor entra en alerta. Base propia, mTLS, puerto 4108 |
| `services/notifications` | Mensajero: convierte los eventos de alerta (facturas vencidas, umbrales de sensores, sobreasignación) en notificaciones dentro de la app por rol, con marca de lectura por persona (la campana de la web). Base propia, mTLS, puerto 4105 |
| `services/technical-capacity` | Ingenieros, habilidades y asignaciones por período. Nadie pasa de 100 % de carga en ningún día (bloqueo de fila y relectura dentro del bloqueo); el gerente puede permitirlo a propósito y eso publica `OverAllocationDetected`. Base propia, mTLS, puerto 4106 |
| `web` | Frontend en React y TypeScript |
| `infra` | Archivos de infraestructura (gateway, certificados, llaves, producción) |
| `docs` | `openapi.yaml` (contrato de la API), `events.md` (contrato de los eventos) y `DEPLOY.md` (despliegue) |

## Correr la demo en tu equipo (paso a paso, para el equipo)

Todo corre en tu computador con Docker; no necesitas AWS ni pagar nada. Las llaves y los certificados no están en Git: cada persona los genera con dos scripts.

**Antes de empezar necesitas**
- **Git** (el repositorio es público: https://github.com/maguinda/nexus-safe-cloud-erp).
- **Docker** con `docker compose`: Docker Desktop (Mac o Windows) o Colima (Mac). En Mac con Colima, clona dentro de tu carpeta personal (`$HOME`); fuera de ella no puede montar las llaves.
- **Node 20 o más nuevo**, solo para el script de comprobación del paso 7 (la demo en sí no lo necesita).
- **Windows:** corre todo dentro de WSL (Ubuntu), porque los scripts son de shell (`sh`, `bash`) y clona el repo dentro del disco de Linux de WSL.
- Los puertos **8080** (la app) y 4101-4108 (Swagger) deben estar libres.

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

# 4. Levantar todo: base de datos, RabbitMQ, los 8 servicios, la web y el gateway
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
| `fernanda.gil@nexus.example` | finance | Resumen del cierre del mes, Nómina, Cuentas por pagar y Flujo de caja |
| `ana.torres@nexus.example` | engineer | «Mi trabajo»: su carga, sus asignaciones (seleccionables), sus hitos y las actividades que asigna a técnicos |
| `hugo.salazar@nexus.example` | technician | «Mi trabajo»: su carga, sus asignaciones, sus actividades y sus órdenes de mantenimiento |

**Recorrido corto de la demo** (el recorrido con tiempos se muestra en el video y en la presentación de la entrega)
1. Entra como Laura y abre **Projects**.
2. Pulsa **Approve milestone** en un hito pendiente: la respuesta es inmediata y, unos segundos después, aparece una factura borrador en **Invoices**.
3. En otra pestaña entra como Diana: el **Dashboard** se actualiza solo por los eventos. Más abajo está el panel **Network & IoT** con los datos de Nexus que dejó la docente: 21 dispositivos y 4.200 lecturas (21 / 21 en línea, 39 advertencias, 3 alertas), una tabla por oficina, las últimas alertas y todos los dispositivos.
4. En una tercera pestaña entra como Andrés y pulsa **Issue invoice** en el borrador: el estado pasa a Issued y la columna **Due** muestra la fecha de vencimiento (emisión + 30 días).
5. Entra como Camila: Invoices responde 403. Después, con otra persona, abre **JWT sample** y pulsa **Simulate expired token**: el token «vence» y la app lo **renueva sola** con su cookie (sigues dentro y el contador «token expires in» vuelve a ~15:00). La sesión solo se cierra si ya no hay cookie, a los 30 minutos sin renovar o a las 8 horas en total (ver «Sesión»).
6. Swagger de cada servicio: http://localhost:4101/docs (identity), :4102 (projects), :4103 (billing), :4104 (analytics), :4105 (notifications), :4106 (capacity), :4107 (operations), :4108 (procurement). Inicia sesión una vez en :4101 y pulsa Authorize en los demás.
7. Opcional: detén RabbitMQ con `docker compose stop rabbitmq`, aprueba otro hito (responde 200 igual), vuelve a arrancarlo con `docker compose start rabbitmq` y espera unos 15 segundos a que la factura aparezca.
8. Opcional: como Diana, pestaña **Usuarios**, crea un vendedor y entra con él en otra pestaña.
9. Idioma: pulsa el botón con tu rol (arriba, a la derecha) para abrir **Mi perfil** y cambia entre **Español** y **English**. La pantalla cambia al instante y el idioma queda guardado para esa persona, así que la sigue a cualquier computadora.

**Comprobar que todo funciona de punta a punta** (opcional)
```sh
node scripts/e2e-flow.mjs      # debe terminar sin ❌ (72 comprobaciones)
./scripts/reset-demo.sh        # deja la demo como al inicio (la base: la que usan las pruebas y el guion)
./scripts/reset-demo.sh --examples   # lo mismo + unos pocos datos de ejemplo por la API real para que ninguna pantalla se vea vacía
```

**Migraciones de la base de datos** (no tienes que ejecutarlas)
Cada servicio tiene su propia base y su propio historial de migraciones de Prisma (identity 6, projects 1, billing 4, analytics 6, notifications 1, capacity 1, operations 1). Se aplican solas: al arrancar, cada contenedor corre `npx prisma migrate deploy`, así que el paso 4 deja las tablas creadas. Para comprobarlo:
```sh
docker compose logs billing | grep -i migration     # «4 migrations found» y «applied» o «No pending migrations to apply»
source .env
docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres \
  psql -h localhost -U "$POSTGRES_ADMIN_USER" -d billing \
  -Atc "select migration_name from _prisma_migrations order by started_at"
```
Cambia `billing` por `identity`, `projects` o `analytics` para ver los otros servicios. Si un servicio no arranca por la base, mira `docker compose logs <servicio> | tail`; para empezar de cero (borra los datos) corre `docker compose down -v` y vuelve al paso 4. No corras `prisma migrate dev` ni edites los archivos de `services/*/prisma/migrations`: un cambio de esquema es una migración nueva, en una rama aparte.

**Si ya tenías la pila creada de antes (el volumen de Postgres existe)**
El script de `infra/postgres/init` solo corre cuando el volumen es nuevo. Cada servicio que se agregó después (notifications, capacity, operations) necesita, **una sola vez**: (1) los certificados nuevos (`sh infra/certs/gen-certs.sh`, no toca los que ya tienes), (2) su contraseña en tu `.env` (`DB_NOTIFICATIONS_PASSWORD`, `DB_CAPACITY_PASSWORD`, `DB_OPERATIONS_PASSWORD`; mira `.env.example`) y (3) su rol y su base. Ejemplo para `operations` (cambia el nombre para los otros):
```sh
source .env
docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d postgres \
  -c "CREATE ROLE operations LOGIN PASSWORD '$DB_OPERATIONS_PASSWORD'" -c "CREATE DATABASE operations OWNER operations" -c "REVOKE CONNECT ON DATABASE operations FROM PUBLIC"
docker compose up -d --build
```
Para pasar a `operations` los datos de sensores y de red que estaban en Analytics: `./scripts/migrate-telemetry-to-operations.sh` (se puede repetir; compara conteos y avisa si algo no cuadra).

**Problemas frecuentes**
- **La ingesta de telemetría responde 503:** falta `INGEST_KEY` en tu `.env` (vacía, o de menos de 32 caracteres). Genérala con `openssl rand -hex 24` y recrea Analytics (`docker compose up -d analytics`).
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
| Archivos en el repo | `services/operations/prisma/data/iot-devices.json` y `iot-readings.json`, más `convert-iot.py`, el script que los genera desde el Excel |
| Tablas | `iot_devices` e `iot_readings` (migración `0002_iot_telemetry`, con clave foránea, único por dispositivo e instante y tres CHECK) |
| Carga | `prisma/seed.ts` (con `SEED_DEMO=true`, al arrancar el contenedor) llama a `prisma/iot-load.ts`. Se puede repetir sin duplicar nada |
| API | `GET /telemetry/summary`, `/telemetry/trends?range=1d\|7d\|30d\|180d\|365d` (por defecto `1d`), `/telemetry/readings` (paginada y ordenable) y `/telemetry/facets`, solo para el gerente (403 para los demás roles); `POST /telemetry/readings` es para los sensores, con clave de servicio (ver «Telemetría en vivo») |
| Pantalla | panel **Network & IoT** en el Dashboard y la pantalla **Sensores** (hallazgos con su evidencia, cifras, filtros, gráficos y tabla de lecturas; un hallazgo filtra la tabla) |

Para volver a generar los JSON desde el Excel (necesita `openpyxl`): `python3 services/operations/prisma/data/convert-iot.py "<ruta>/Datos PacketTracer.xlsx"`. `./scripts/reset-demo.sh` no toca estos datos.

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
| Base del negocio (playbook) | `services/operations/src/domain/playbook.ts`: qué significa cada cosa (umbral ≠ lectura, equipo crítico, monitoreo básico), cómo priorizar y reglas de redacción. **No lleva cifras, nombres ni fechas de hoy**: eso solo sale de los hallazgos. Está versionado (`PLAYBOOK_VERSION`, visible en el panel y en la respuesta); al cambiar un criterio se sube la versión |
| Cómo se evalúa | `src/domain/advice-eval.ts`, determinista (misma respuesta → mismo veredicto). Una respuesta de la IA se **descarta entera** (y se muestran las reglas, con los códigos de lo que falló en `violations`) si: cita un hallazgo que no existe, escribe un número o un nombre de equipo que no está en los hallazgos, afirma un incidente que ninguno menciona (incendio, ataque…), da una causa como hecho, presenta el umbral como si fuera una lectura, recomienda borrar datos, rompe el orden de prioridad u omite un hallazgo de prioridad alta |
| Casos de oro | `src/domain/advisor-golden.ts` (5 situaciones fijas, incluida una con un nombre de dispositivo que da órdenes). Las respuestas por reglas también tienen que pasar el mismo evaluador |
| Medir a la IA real | `ADVISOR_LIVE_EVAL=1 EVAL_RUNS=3 npx jest --config jest.e2e.config.js test/advisor-live-eval.e2e.ts` (con la llave en el entorno; cuesta unas monedas y no corre en el CI). Imprime una tarjeta de calificaciones por caso e idioma |
| Aprende? | **No entrena el modelo.** Mejora cuando el equipo revisa la tarjeta y ajusta el playbook (se sube la versión y se vuelve a medir). Guardar decisiones del gerente y alimentar el playbook con ellas queda como trabajo futuro, con revisión humana |
| Seguridad | Los nombres que vienen del Excel se envían como **datos** dentro de un bloque JSON y el modelo no obedece instrucciones que estén ahí; lo peor que puede pasar es una respuesta descartada |

### Idioma, tema y login

La interfaz está en español por defecto y en inglés a elegir desde «Mi perfil»; ahí mismo se elige el tema (Sistema, Claro u Oscuro). Ambas preferencias se guardan por persona en la base (`users.language`, `users.theme`; `PATCH /me/language` y `/me/theme`). Lo que viene de la base de datos no se traduce. El login es móvil primero (una columna) y de pantalla dividida desde 900 px.

## Telemetría en vivo, rangos y sesión

### Telemetría en vivo: clave de ingesta y simulador
Los sensores (o el simulador) envían lecturas con `POST /telemetry/readings`. **No usa el login de ninguna persona**: lleva una clave de servicio en la cabecera `x-ingest-key`.
1. Pon una clave en tu `.env`: `INGEST_KEY=` con `openssl rand -hex 24` (mínimo 32 caracteres). Vacía, la ruta responde 503. Nunca se sube a Git.
2. Recrea Analytics: `docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d analytics`.
3. Corre el simulador, que repite las 4.200 lecturas del Excel como si siguieran llegando (continúa el 13 de septiembre a las 11:21 UTC; las fechas nuevas son de ese día, no de hoy): `node scripts/simulate-telemetry.mjs` (un lote de 21 lecturas cada 5 s, un ciclo ≈ 17 min; `--dry-run` no envía nada; `--max-batches 12` es una prueba corta).
4. Abre **Sensores** como Diana: se actualiza sola cada 10 s, dice «En vivo · actualizado hace X s» y cuenta las lecturas nuevas desde que la abriste. Lo que llegó por la ingesta lo borra `./scripts/reset-demo.sh`; las 4.200 del Excel no se tocan.

Un lote tiene de 1 a 50 lecturas y es **todo o nada**: si una es inválida no se guarda ninguna y el 400 las lista todas. Enviar el mismo lote otra vez no duplica nada.

### Rangos de tiempo en Sensores
Sensores abre en las **últimas 24 horas** y tiene botones para 24 horas, 1 semana, 1 mes, 6 y 12 meses. El rango se cuenta hacia atrás desde la lectura más reciente guardada (no desde el reloj) y el tramo de cada punto se ensancha con el rango (10 minutos, 2 horas, 6 horas, 2 días y 4 días), así que la respuesta no crece con la cantidad de lecturas. Las cifras, los hallazgos y los gráficos siguen el rango; la tabla de lecturas de abajo explora todas. La pantalla **Red** se vuelve a pedir sola cada minuto mientras la pestaña se ve (el inventario de red es fijo, así que hoy no muestra nada nuevo).

### Sesión: se renueva sola
El token de acceso (JWT) dura 15 minutos. Al iniciar sesión, identity también pone una cookie `erp_refresh` (`HttpOnly`, `SameSite=Strict`, solo para `/auth`) que la pantalla usa para renovarlo en silencio 2 minutos antes de que venza, así que un monitor «en vivo» no vuelve al login cada 15 minutos.
- Cada renovación gasta el token de renovación y entrega uno nuevo; si alguien reusa uno ya gastado se cierra toda la sesión. La sesión termina a los 30 minutos sin renovar o a las 8 horas en total (`REFRESH_IDLE_MINUTES`, `SESSION_MAX_HOURS`).
- **Cerrar sesión** la revoca de verdad en el servidor (`POST /auth/logout`).
- Límites: un token ya emitido vale hasta 15 minutos aunque se revoque la sesión; no hay «cerrar todas mis sesiones».

### Opcionales para un despliegue (no hacen falta para la demo)
- **Detrás de un balanceador:** pon sus direcciones en `TRUSTED_PROXIES` (CIDR separados por comas) para que el límite de peticiones use la IP real de cada persona. Vacío (lo normal) no se confía en nadie y el `X-Forwarded-For` del cliente se ignora. Se comprueba con `./scripts/gateway-real-ip-check.sh`.
- **HTTPS y cookie `Secure`:** `docker compose -f docker-compose.yml -f docker-compose.docs.yml -f docker-compose.https.yml up -d identity gateway` abre `https://localhost:8443` con un certificado de la CA de desarrollo y pone `COOKIE_SECURE=true`; `cd web && npm run test:e2e:https` lo prueba en Chromium y WebKit. No lo dejes puesto para la demo normal.

## Factura electrónica (modo de prueba, SIN validez legal)
Desde **Facturas**, el analista de facturación (`andres.mora@`) ve el panel **«Factura electrónica (modo de prueba)»**. Cada factura emitida puede convertirse en un documento UBL 2.1 con su CUFE y su código QR; se puede ver, descargar el XML, simular el envío y registrar el envío por correo.
- **Léelo antes de usarlo:** es un *sandbox*. El documento **no está firmado, no se envía a la DIAN y no es una factura electrónica de venta válida**; el aviso va en el XML, en la página y en la API. Para que tuviera validez hacen falta un proveedor tecnológico autorizado por la DIAN, un certificado de firma, una resolución de numeración real y el ambiente de producción, que no están conectados. «Enviar» solo SIMULA (el estado es `sandbox_simulated`, nunca «aceptada») y «Registrar envío por correo» solo REGISTRA: no hay servidor de correo.
- **Datos del cliente:** la primera vez que se factura a un cliente hay que cargar sus datos fiscales (botón «Datos del cliente»: NIT con su dígito de verificación, correo, dirección y ciudad). Los tres clientes de la demo (Banco Andino, Retail Norte y Pyme Sur) ya traen datos **ficticios**; un cliente nuevo hace que el documento espere en «Faltan datos del cliente» y la factura queda emitida igual.
- **Numeración:** rango de PRUEBA FE1000–FE1999 en la tabla `einvoice_numbering`; el consecutivo no tiene huecos aunque algo falle a mitad. `./scripts/reset-demo.sh` lo reinicia y borra los documentos de prueba.
- **Variables** (todas opcionales; ver `.env.example`): `EINVOICE_SUPPLIER_*` (datos del emisor, ficticios por defecto) y `EINVOICE_TECHNICAL_KEY` (clave técnica de PRUEBA: el CUFE no es oficial). `EINVOICE_ENVIRONMENT=production` no existe: billing no arranca.
- **API:** `POST|GET /invoices/{n}/electronic`, `GET …/xml`, `GET …/html`, `POST …/submit`, `POST …/deliveries` y `GET|PUT /customers` (todas solo `billing_analyst`); detalle en `docs/openapi.yaml`.

## Idioma de la interfaz (español e inglés)

La interfaz está en **español por defecto** y cada persona puede pasarla a inglés desde su perfil.

- **Qué se traduce:** todo lo que es de la aplicación (pantallas, menús, botones, tablas, avisos y validaciones). **No** se traduce lo que viene de la base de datos: nombres de proyectos e hitos, la frase de «Actividad reciente», y las notas y tipos de dispositivo de los datos de la docente se muestran como están.
- **Dónde se guarda:** en la base de identity (`users.language`, `es` o `en`, con un CHECK; migración `0004_user_language`). Por eso el idioma sigue a la persona a cualquier computadora. El login devuelve `user.language` y la pantalla abre en él. Los usuarios nuevos y los que ya existían quedan en español. Antes de iniciar sesión, la pantalla de entrada usa el último idioma que se usó en ese navegador.
- **API:** `PATCH /me/language` con `{ "language": "es" | "en" }`, cualquier rol con un token válido. La persona sale del token, nunca del cuerpo; un campo de más se rechaza (400).
- **En la web:** `web/src/i18n/` (diccionarios `es/` y `en/` por área, con las mismas claves: si falta una en un idioma, no compila) y el menú `ProfileMenu`. Los avisos que manda el servidor en inglés se traducen en pantalla (`i18n/server.ts`); si uno no se reconoce, se muestra el original.
- `./scripts/reset-demo.sh` deja a los 4 usuarios de la demo en español.


## Dónde vive cada cosa

```
erp/
├─ services/                  los 8 microservicios; cada uno es un programa propio con su propia base de datos
│  ├─ identity-access/        inicio de sesión y token
│  ├─ projects/               proyectos, hitos, cotizaciones, aprobación
│  ├─ billing-receivables/    facturas, IVA, pagos, conciliación
│  ├─ analytics/              modelos de lectura y tablero del gerente
│  ├─ notifications/          alertas por rol
│  ├─ technical-capacity/     ingenieros, asignaciones y nómina
│  ├─ operations/             red, IoT, telemetría y órdenes de trabajo
│  └─ procurement/            compras, inventario y cuentas por pagar
├─ web/                       la pantalla (React)
├─ infra/                     todo lo que no es código de negocio
│  ├─ gateway/nginx.conf      el gateway
│  ├─ certs/gen-certs.sh      los certificados de mTLS
│  └─ keys/gen-keys.sh        las llaves del JWT
├─ docs/                      contrato de la API (openapi.yaml), de los eventos (events.md) y el despliegue (DEPLOY.md)
├─ scripts/                   scripts de prueba, de la demo, respaldo y rotación
└─ docker-compose.yml         levanta todo junto
```

Dentro de cada servicio el código se divide en capas, para que una regla de negocio nunca dependa del framework ni de la base de datos:

```
services/<nombre>/
├─ src/
│  ├─ http/            recibe la petición y responde (rutas y controladores, sin lógica)
│  ├─ application/     un caso de uso por acción: la historia de lo que pasa
│  ├─ domain/          las reglas de negocio, funciones puras con sus pruebas unitarias
│  ├─ infrastructure/  la base de datos, RabbitMQ y otras herramientas
│  ├─ auth/            el guardia: verifica el JWT y el rol
│  └─ tls.ts           mTLS: exige el certificado de quien llama
├─ prisma/             esquema, migraciones y datos de demo
├─ test/               pruebas de extremo a extremo contra PostgreSQL y RabbitMQ reales
└─ Dockerfile
```

### Dónde vive el mTLS

| Qué | Dónde |
|---|---|
| Crear los certificados | `infra/certs/gen-certs.sh` |
| Exigir el certificado de quien llama en cada servicio | `services/*/src/tls.ts` (el mismo archivo en todos los servicios) |
| Arrancar con TLS | `services/*/src/main.ts` |
| Pruebas del handshake | `services/*/test/mtls.e2e.ts` |
| El gateway presentando su certificado | `infra/gateway/nginx.conf` |
| Pasar todo a los contenedores | `docker-compose.yml` |

## Levantar todo (contenedores + gateway)

```sh
sh infra/keys/gen-keys.sh                 # una vez: par de llaves del JWT (Git las ignora)
sh infra/certs/gen-certs.sh               # una vez: CA interna y certificados de mTLS (Git los ignora)
cp .env.example .env                      # y luego cambia las contraseñas
docker compose up -d --build              # postgres, rabbitmq, los 8 servicios, la web y el gateway nginx
./scripts/reset-demo.sh                   # deja los datos de la demo como al inicio
node scripts/e2e-flow.mjs                 # recorre todo el flujo a través del gateway
```

### mTLS entre el gateway y los servicios
Los servicios **no** son alcanzables por HTTP plano. Cada uno atiende HTTPS y exige un certificado de cliente firmado por la CA interna
(`infra/certs/gen-certs.sh`) **y** cuyo nombre esté en su lista de permitidos (`TLS_ALLOWED_CLIENTS`: el gateway y, para su chequeo de salud, el
propio servicio). Un servicio comprometido no puede llamar a otro, ni siquiera desde dentro de la red. El JWT se sigue verificando en cada ruta:
el mTLS prueba *qué servicio* llama; el JWT prueba *qué persona*.

`docker-compose.docs.yml` (solo para la demo) abre un segundo puerto HTTP plano por servicio en `127.0.0.1` para que Swagger abra en un navegador;
el JWT sigue siendo obligatorio allí. Sin ese archivo la puerta no existe. Después de recrear el contenedor de un servicio, corre
`docker compose restart gateway` (nginx guarda en caché las direcciones).

El único puerto publicado es el del gateway, `127.0.0.1:8080`. Los servicios no publican puertos; el gateway solo expone las rutas
necesarias (`POST /auth/login`, `/users`, `/projects`, `/milestones`, `/invoices`, `/dashboard`, `/telemetry`, `/health`, entre otras). El gateway
no autentica: cada servicio verifica el JWT otra vez.
Para el Swagger de cada servicio: `docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d` y luego http://localhost:4101/docs
(identity), :4102/docs (projects), :4103/docs (billing), :4104/docs (analytics), :4105/docs (notifications), :4106/docs (capacity),
:4107/docs (operations) y :4108/docs (procurement). Cada servicio documenta solo sus rutas; el JWT es el mismo (inicia sesión una vez en :4101 y
pulsa Authorize en los demás). El contrato completo está en `docs/openapi.yaml`.

La aplicación web la sirve el mismo gateway: abre http://localhost:8080. Pruebas de navegador: `cd web && npm run test:e2e` (ver `web/README.md`).

Usuarios de la demo (la contraseña está en `.env`, `DEMO_PASSWORD`): ver la tabla de usuarios más arriba.

## Despliegue

- **En un servidor propio con Docker** (lo que está listo): `docs/DEPLOY.md` explica los archivos de producción, el respaldo y la restauración
  (`scripts/backup.sh`, `scripts/restore.sh`), la rotación de llaves y certificados y la verificación previa (`scripts/prod-preflight.sh`,
  `scripts/prod-smoke.sh`). **No se ha desplegado en un servidor real.**
- **En AWS (diseño, no implementado):** EKS en tres zonas de disponibilidad, RDS PostgreSQL Multi-AZ, RabbitMQ dentro de EKS, Kinesis para la
  telemetría y API Gateway; el presupuesto mensual estimado (≈ US$ 456) y los ADR están en el documento SAD de la entrega.

## Solo la infraestructura

```sh
cp .env.example .env      # y luego cambia las contraseñas
docker compose up -d      # PostgreSQL 16 y RabbitMQ 3.13
docker compose ps         # ambos deben estar «healthy»
```

Los puertos se publican solo en `127.0.0.1`. Consola de RabbitMQ: http://localhost:15672.
Nunca subas a Git el `.env` ni ningún archivo `*.pem` o `*.key`.
