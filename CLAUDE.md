# erp · código del proyecto (Nexus Safe-Cloud)

Repositorio **privado**: https://github.com/maguinda/nexus-safe-cloud-erp (monorepo; esta carpeta es la raíz del repositorio; la carpeta padre `arquitectura_software` NO es un repo).
Contexto, decisiones y stack: ver el `CLAUDE.md` de la carpeta padre y `../corte_2/`. Alcance del MVP aprobado por Marlon el 2026-10-18 = el boceto `../corte_2/boceto_mvp.html`; no agregar módulos sin que él lo pida.

## Estado (2026-10-18)
MVP completo y verificado: 3 servicios NestJS + React + PostgreSQL + RabbitMQ + gateway nginx, en contenedores, con CI en GitHub Actions. PR mezclados #1 a #11 (IVA y conciliación en #11); mTLS en curso. Probado además clonando el repo desde cero y siguiendo el README.

| Pieza | Qué es | Puerto |
|---|---|---|
| `services/identity-access` | login, JWT RS256 con rol | 4101 (interno) |
| `services/projects` | proyectos, hitos, aprobar → outbox → RabbitMQ | 4102 (interno) |
| `services/billing-receivables` | consume `MilestoneApproved`, factura borrador; emitir | 4103 (interno) |
| `web` | React 19 + TS + Vite, CSS Modules y tokens | vía gateway |
| `infra/gateway` | nginx: único puerto publicado `127.0.0.1:8080` | 8080 |

Pruebas: unitarias (identity 9, projects 5, billing 28, web 17), e2e de servicios con PostgreSQL y RabbitMQ reales (23 + 34 + 27), flujo completo `scripts/e2e-flow.mjs` (19 comprobaciones), y navegador `web/` (12 funcionales + 24 auditorías de pantalla en Chromium y WebKit, iPhone SE, iPhone 13, Pixel 5 y 320 px).

## Cómo correr
```sh
sh infra/keys/gen-keys.sh && sh infra/certs/gen-certs.sh && cp .env.example .env    # una vez (llaves, certificados y .env están en .gitignore)
docker compose up -d --build                           # pila completa; demo en http://localhost:8080
./scripts/reset-demo.sh                                # deja la demo como al inicio (hacerlo antes de presentar)
node scripts/e2e-flow.mjs                              # flujo de punta a punta por el gateway
cd web && npm run test:e2e                             # navegador (necesita `npx playwright install chromium webkit` una vez)
docker compose -f docker-compose.yml -f docker-compose.docs.yml up -d   # además publica Swagger en 127.0.0.1:4101-4103/docs (solo demo)
```
Logins de demostración (contraseña en `.env`, `DEMO_PASSWORD`): laura.rios@ (project_lead), andres.mora@ (billing_analyst), camila.soto@ (sales), todos `@nexus.example`.

## Trampas aprendidas
- Colima (motor de contenedores) solo comparte `$HOME` con su VM: un repo/clon fuera de tu carpeta personal no puede montar las llaves.
- El gateway limita el login (10 por minuto por IP): el setup de Playwright reutiliza las sesiones guardadas; si ves 429, espera un minuto.
- Los tests funcionales de `web/` escriben datos de demo; correr `./scripts/reset-demo.sh` después.
- Los puertos 3000/3001 los usaba Eventify (otro proyecto de Marlon); estos servicios usan 4101-4103 y 8080.
- Un RabbitMQ recién creado no tiene las colas: los tests no deben consultarlas antes de que el consumidor las cree.
- La política de contenido (CSP) del gateway está en modo solo-reporte (`/csp-report`); falta pasarla a bloqueo en un PR aparte. En WebKit la propia captura de Playwright inyecta estilos y genera un reporte (la auditoría los separa).

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
- Informe, slides y pitch del Corte 2 **en inglés** (UML del dominio, matriz de tecnologías, ≥ 3 riesgos, vistas 4+1; el artifact `../corte_2/arquitectura_diagrama.html` ya trae el UML, los datos y las vistas de proceso, despliegue y desarrollo).
- Opcionales aprobables: rol de gerente y dashboard (US-03), política de contenido en bloqueo, TLS en el despliegue, probar en celular real y Android.
- Verificar en la documentación de AWS: mTLS en API Gateway, Istio con la versión de EKS, tiempo real de failover de RDS Multi-AZ (solo afecta lo dicho en la sustentación sobre la arquitectura objetivo).
