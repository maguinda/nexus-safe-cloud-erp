# erp · código del proyecto (Nexus Safe-Cloud)

Repositorio **privado**: https://github.com/maguinda/nexus-safe-cloud-erp (monorepo; esta carpeta es la raíz del repositorio; la carpeta padre `arquitectura_software` NO es un repo).
Contexto, decisiones y stack: ver el `CLAUDE.md` de la carpeta padre y `../corte_2/`. Alcance del MVP aprobado por Marlon el 2026-10-18 = el boceto `../corte_2/boceto_mvp.html`; no agregar módulos sin que él lo pida.

## Estado (2026-10-18)
MVP completo y verificado: 3 servicios NestJS + React + PostgreSQL + RabbitMQ + gateway nginx, en contenedores, con CI en GitHub Actions. 8 PR mezclados (#1 a #8). Probado además clonando el repo desde cero y siguiendo el README.

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
sh infra/keys/gen-keys.sh && cp .env.example .env    # una vez (llaves y .env están en .gitignore)
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

## Cómo trabajar aquí (autorizado por Marlon el 2026-10-18)
- Una rama por cambio, commits pequeños (un tema por commit), PR con riesgo (🟢🟡🔴), atributos de calidad, verificación y cómo revertir; **Claude puede hacer commits y mezclar los PR en este repo** con commit de merge (`gh pr merge --merge`), para poder revertir con `git revert -m 1`.
- Nunca commit directo en `main` (solo el commit inicial); `git branch --show-current` antes de editar.
- Si una prueba nueva pasa sin el arreglo, no prueba nada: hacer una mutación (romper la regla) y ver que falla.
- Concurrencia: ≥ 30 rondas e invariante, no una sola pasada. Pruebas de pantalla: bloquear escrituras y comparar la base.
- Los secretos nunca van a Git (`.env`, `*.pem`, `*.key` ignorados). `npm install` siempre con `--ignore-scripts`.

## Pendiente
- Informe, slides y pitch del Corte 2 **en inglés** (UML del dominio, matriz de tecnologías, ≥ 3 riesgos, vistas 4+1; el artifact `../corte_2/arquitectura_diagrama.html` ya trae el UML, los datos y las vistas de proceso, despliegue y desarrollo).
- Opcionales aprobables: IVA 19 % y conciliación (US-05), rol de gerente, mTLS, política de contenido en bloqueo, TLS en el despliegue, probar en celular real y Android.
- Verificar en la documentación de AWS: mTLS en API Gateway, Istio con la versión de EKS, tiempo real de failover de RDS Multi-AZ (solo afecta lo dicho en la sustentación sobre la arquitectura objetivo).
