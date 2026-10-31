# Poner el ERP en producción (un servidor, Docker)

Esta guía deja el ERP **listo para venderlo**: lo único que falta es contratar el servidor y seguir estos pasos. No usa AWS ni nada que se pague aparte del servidor y el dominio. Está pensada para una empresa pequeña (unas 50 personas); si el cliente crece, ver el último apartado.

> **Lo que NO está resuelto y hay que decirle al cliente antes de venderle** (también en el README y en el informe):
> 1. La **factura electrónica es de prueba** (sandbox): no tiene validez legal ni llega a la DIAN. Para facturar de verdad hace falta contratar un proveedor tecnológico autorizado por la DIAN y conectarlo.
> 2. La **nómina** registra lo que le cuesta cada persona a la empresa; no es la nómina legal (no genera PILA, no liquida, no descuenta al empleado).
> 3. Los **porcentajes de prestaciones y seguridad social** son estimados de blogs de nómina, no de la ley. Un contador debe confirmarlos antes de usarlos, y el salario mínimo y el auxilio de transporte se actualizan cada año (`services/technical-capacity/src/domain/engineer.ts` y la función SQL `employer_daily_cost`, migración `0006_loaded_cost`).
> 4. Es **un solo servidor**: si se cae, el sistema se cae hasta que vuelva (con los respaldos de abajo se recupera). Alta disponibilidad es otro proyecto.

## 1. Qué necesitas
- Un servidor Linux (Ubuntu 22.04 o 24.04) con **2 vCPU, 4 GB de RAM y 40 GB de disco** (unos 10 a 20 USD al mes en cualquier proveedor).
- Un **dominio** apuntando al servidor (registro A) y los puertos **80 y 443** abiertos. Los demás (5432, 5672, 8080…) deben quedar cerrados: el compose de producción ya no los publica.
- Docker y el plugin de Compose: `curl -fsSL https://get.docker.com | sh`.
- Un correo para el certificado HTTPS (Let's Encrypt).

## 2. Primera instalación
```bash
git clone https://github.com/maguinda/nexus-safe-cloud-erp.git && cd nexus-safe-cloud-erp

# Llaves y certificados PROPIOS de este servidor (nunca los de desarrollo del repositorio):
rm -f infra/keys/*.pem infra/certs/*.pem
sh infra/keys/gen-keys.sh      # llaves del login (JWT)
sh infra/certs/gen-certs.sh    # CA y certificados de mTLS entre servicios
chmod 600 infra/keys/jwt-private.pem infra/certs/*-key.pem

cp .env.production.example .env && nano .env     # cambia TODO: contraseñas (openssl rand -hex 16), INGEST_KEY (openssl rand -hex 24), DOMAIN, ACME_EMAIL
./scripts/prod-preflight.sh                      # tiene que terminar con «Listo para producción»

docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile edge up -d --build
./scripts/create-admin.sh gerente@empresa.com "Nombre Apellido"   # el primer gerente (pide la contraseña por teclado)
```
Las migraciones de cada base se aplican solas al arrancar cada servicio. Abre `https://TU-DOMINIO`, entra con ese gerente y crea a los demás desde **Usuarios** (el ingeniero y el técnico se crean ligados a una persona del personal, que antes se da de alta en **Capacidad**).

Comprobación rápida: `./scripts/prod-smoke.sh https://TU-DOMINIO` (salud, encabezados de seguridad y que nada responda sin sesión).

## 3. Respaldos (lo más importante después de la seguridad)
```bash
./scripts/backup.sh /var/backups/erp 14        # las 8 bases + suma de verificación; conserva los últimos 14
```
- **Prográmalo todos los días** (`crontab -e`): `0 2 * * * cd /ruta/nexus-safe-cloud-erp && ./scripts/backup.sh /var/backups/erp 14`.
- **Copia la carpeta FUERA del servidor** (otro proveedor o un disco que no sea el mismo): si se pierde el servidor, se pierden también los respaldos que estén en él.
- **Ensáyalo una vez al mes**: `./scripts/restore.sh /var/backups/erp/<fecha> --check` restaura cada base en una temporal, cuenta las tablas y la borra, sin tocar los datos reales. Un respaldo que nunca se restauró no es un respaldo.
- Restaurar de verdad (con los servicios detenidos): `docker compose stop identity projects billing analytics notifications capacity operations procurement && ./scripts/restore.sh /var/backups/erp/<fecha> --yes`, y luego `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
- Objetivos honestos con un solo servidor y un respaldo diario: pérdida máxima de datos **hasta 24 horas**, tiempo para volver a estar en línea **de 1 a 2 horas** si el servidor nuevo ya está preparado.

## 4. Actualizar a una versión nueva
```bash
./scripts/backup.sh /var/backups/erp 14                      # SIEMPRE antes
git pull origin main
./scripts/prod-preflight.sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile edge up -d --build
./scripts/prod-smoke.sh https://TU-DOMINIO
```
Volver atrás: `git checkout <versión-anterior>` y el mismo `up -d --build`. Las migraciones nuevas no se deshacen solas: si una versión cambió la base y hay que volver, se restaura el respaldo de antes de actualizar.

## 5. Vigilar que esté vivo
- Salud: `https://TU-DOMINIO/health` responde 200. Un servicio de monitoreo gratuito (por ejemplo UptimeRobot) puede avisar por correo si deja de responder.
- Estado y consumo: `docker compose ps` y `docker stats --no-stream`. Los registros no llenan el disco (10 MB × 5 por contenedor): `docker compose logs --tail 100 <servicio>`.
- Mensajes que no se pudieron procesar: las colas `*.dlq` de RabbitMQ (se ven con `docker compose exec rabbitmq rabbitmqctl list_queues name messages | grep dlq`). Lo normal es 0.
- El disco: revisa `df -h` cada semana; las lecturas de sensores se conservan 365 días (`RETENTION_DAYS`).

## 6. Seguridad
- **Secretos:** solo en el `.env` del servidor (permisos 600, fuera de Git). Nunca por correo ni chat.
- **Rotar las llaves del login:** `./scripts/rotate-keys.sh --prod` (después de un respaldo). Guarda las anteriores en `infra/.rotated/`, genera nuevas y reinicia los 8 servicios (corte de ~1 minuto). Los accesos ya emitidos dejan de valer y la pantalla pide uno nuevo sola con la sesión de renovación, que vive en la base: nadie reescribe su contraseña (probado en vivo). Hazlo si la llave privada pudo filtrarse; si no, una vez al año. No hay rotación sin corte (dos llaves a la vez): sería un proyecto aparte.
- **Certificados de mTLS (los de servicio duran 1 año, la CA 5): se vencen y TODO deja de hablar.** Revisa cada mes `./scripts/cert-expiry.sh` (también lo hace `prod-preflight.sh` y falla con menos de 30 días). Renueva con `./scripts/rotate-certs.sh --prod`: mismos certificados nuevos con la MISMA CA, corte de ~1 minuto. Con `--new-ca` cambia también la CA (si su llave se filtró o va a vencer; anota el vencimiento de la CA en tu calendario: son 5 años). Pon un recordatorio a los 11 meses.
- **Borra `infra/.rotated/`** cuando todo funcione: guarda las llaves anteriores.
- **Cambiar una contraseña de base de datos:** cambiarla en el `.env` y en la base (`ALTER ROLE ... PASSWORD`), y reiniciar el servicio de esa base.
- **Sistema operativo:** `unattended-upgrades` activado, acceso por SSH solo con llave y sin entrar como root, y cortafuegos con solo 22, 80 y 443.
- **Navegador:** la política de contenido (CSP) del gateway sigue en modo «solo informe» a propósito: pasarla a bloqueo exige probar cada pantalla con la sesión real y revisar los avisos varios días; hacerlo en un cambio aparte y nunca directo.
- **Quién ve qué:** los sueldos, la nómina, las deudas y el flujo de caja solo los ven gerencia y finanzas; el ingeniero y el técnico solo ven lo suyo. Los roles se comprueban en cada servicio, no solo en la pantalla.

## 7. Datos personales (Colombia, Ley 1581 de 2012)
El ERP guarda nombres, correos, cargos y sueldos de empleados, y datos fiscales de clientes. Antes de entregarlo, la empresa debe tener su **política de tratamiento de datos**, avisar a las personas qué se guarda y para qué, limitar quién tiene cuenta de gerente o de finanzas, y definir cuánto tiempo conserva los datos. Los respaldos contienen todo: protégelos igual que la base (disco cifrado o respaldo cifrado).

## 8. Si el cliente crece
Este despliegue sirve para empezar. Cuando haga falta más (varios servidores, recuperación en minutos, escalar por servicio), el diseño de arquitectura del proyecto ya lo prevé (Kubernetes, bases gestionadas en varias zonas, observabilidad completa): es un proyecto aparte, con costo mensual, y no se toca mientras el servidor único alcance.

## 9. Lista antes de entregarlo
- [ ] `./scripts/prod-preflight.sh` sin errores y con los avisos leídos.
- [ ] Llaves y certificados generados EN el servidor (no copiados del repositorio).
- [ ] Primer gerente creado; ningún usuario de demostración existe (`SEED_DEMO=false`).
- [ ] HTTPS funcionando con el dominio y `./scripts/prod-smoke.sh` en verde.
- [ ] Recordatorio mensual de `./scripts/cert-expiry.sh` y anual de `rotate-certs.sh`.
- [ ] Respaldo diario programado, una copia fuera del servidor y **un ensayo de restauración hecho**.
- [ ] El cliente sabe lo de la factura electrónica (de prueba), la nómina (no legal) y los porcentajes (los confirma un contador).
- [ ] Política de datos personales de la empresa lista.
