# erp · código del proyecto (Nexus Safe-Cloud)

Aquí va el código de todos los módulos del ERP (los servicios, el frontend y la infraestructura). Contexto, decisiones y stack: ver el `CLAUDE.md` de la carpeta padre y `../corte_2/`.

## Estado
Repositorio git creado el 2026-10-18 con `git init -b main` **dentro de `erp/`** (la carpeta padre `arquitectura_software` NO es un repositorio). Aún no hay commits ni remoto en GitHub: Marlon lo crea y conecta. Tiene `.gitignore` (node_modules, .env, claves, datos locales) y las carpetas con un `.gitkeep` para que Git las registre.

## Estructura (un solo repositorio; una carpeta por servicio para que el CI por ruta funcione)
```
erp/
  services/
    identity-access/       (MVP: login y emisión de JWT)
    projects/              (MVP: proyectos, hitos, «Approve milestone»)
    billing-receivables/   (MVP: factura borrador creada por evento)
  web/                     (frontend React + TypeScript)
  infra/                   (Terraform, Helm)
  .github/workflows/       (un workflow por servicio con `paths:` + plantilla reutilizable)
```
Los otros 5 servicios del diseño (technical-capacity, operations-telemetry, procurement-inventory, analytics, notifications) NO se crean para el MVP; se agregan como carpetas nuevas si hace falta. `docker-compose.yml` (RabbitMQ + PostgreSQL) va en la raíz de `erp/` cuando se escriba.
Cada servicio: NestJS + TypeScript, núcleo hexagonal (dominio sin imports de frameworks), su propia base PostgreSQL, API documentada con OpenAPI. **Alcance del MVP aprobado por Marlon el 2026-10-18:** exactamente lo del boceto `../corte_2/boceto_mvp.html` (Projects + Invoices, 3 roles, login con JWT, aprobar hito → evento → factura borrador, 403 para Sales en Invoices, 401 con token vencido). No agregar módulos sin que él lo pida.

## Reglas cuando haya código (del `CLAUDE.md` global)
- Primer commit: lo decide Marlon (un commit inicial en `main` es lo normal; después, una rama por cambio y él hace el merge).
- Nunca commit en `main`; una rama por cambio; verificar `git branch --show-current` antes de editar.
- Declarar riesgo (🟢/🟡/🔴) y atributos de calidad antes de tocar código; probar en vivo antes de decir «funciona».
- Los secretos nunca van a Git (variables de entorno o archivo ignorado).
