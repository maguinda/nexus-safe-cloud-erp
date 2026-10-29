#!/bin/sh
# Copia los datos de telemetría y de red de la base de ANALYTICS a la de OPERATIONS (el servicio Operations & Telemetry salió de Analytics el 2026-10-29).
#
# - Es seguro repetirlo: los INSERT llevan ON CONFLICT DO NOTHING, así que lo que ya está copiado (o ingerido después en operations) no se toca ni se duplica.
# - NO borra nada de analytics: las tablas viejas se quedan como copia de seguridad hasta que un PR posterior las elimine.
# - Corre las comprobaciones al final (conteos, id más alto, última lectura y el estado de la secuencia). Si algo no cuadra, sale con error.
# - Para una copia sin pérdidas, PARA antes a quien escribe lecturas (el simulador de scripts/simulate-telemetry.mjs) y vuelve a correrlo después del corte
#   si hiciera falta: el delta se recoge solo.
#
# Uso (desde la raíz del repo, con la pila levantada): ./scripts/migrate-telemetry-to-operations.sh
set -e
cd "$(dirname "$0")/.."
. ./.env

psqlx() { docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -v ON_ERROR_STOP=1 "$@"; }
dumpx() { docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres pg_dump -h localhost -U "$POSTGRES_ADMIN_USER" "$@"; }

echo "Copiando de analytics a operations (iot_devices, iot_readings, network_*)…"
# Solo datos (--data-only), en el orden que respeta las llaves foráneas; --inserts con ON CONFLICT para poder repetir.
dumpx -d analytics --data-only --inserts --rows-per-insert=500 --on-conflict-do-nothing \
  -t iot_devices -t iot_readings -t network_devices -t network_links -t network_monitoring | psqlx -d operations -q

# La secuencia de iot_readings.id debe quedar por ENCIMA del id más alto copiado: si no, la siguiente lectura ingerida chocaría con una ya copiada.
psqlx -d operations -Atq -c "SELECT setval(pg_get_serial_sequence('iot_readings','id'), GREATEST((SELECT COALESCE(max(id), 1) FROM iot_readings), 1))" >/dev/null

echo "Comprobación (analytics → operations):"
check() {
  a=$(psqlx -d analytics -Atq -c "$2"); o=$(psqlx -d operations -Atq -c "$2")
  if [ "$a" = "$o" ]; then echo "  ✅ $1: $a"; else echo "  ⚠️  $1: analytics=$a operations=$o"; [ "$3" = "strict" ] && FAIL=1; fi
}
FAIL=0
check "dispositivos IoT" "SELECT count(*) FROM iot_devices" strict
check "dispositivos de red" "SELECT count(*) FROM network_devices" strict
check "enlaces" "SELECT count(*) FROM network_links" strict
check "monitoreo" "SELECT count(*) FROM network_monitoring" strict
# Las lecturas pueden ser MÁS en operations (ingeridas después del corte): nunca menos.
A=$(psqlx -d analytics -Atq -c "SELECT count(*) FROM iot_readings"); O=$(psqlx -d operations -Atq -c "SELECT count(*) FROM iot_readings")
if [ "$O" -ge "$A" ]; then echo "  ✅ lecturas: analytics=$A operations=$O"; else echo "  ❌ lecturas: analytics=$A operations=$O (faltan)"; FAIL=1; fi
check "última lectura (instante)" "SELECT max(recorded_at) FROM iot_readings"
SEQ=$(psqlx -d operations -Atq -c "SELECT (SELECT max(id) FROM iot_readings) < nextval(pg_get_serial_sequence('iot_readings','id'))")
if [ "$SEQ" = "t" ]; then echo "  ✅ la secuencia de ids queda por encima del id más alto"; else echo "  ❌ la secuencia de ids está por debajo del id más alto"; FAIL=1; fi
[ "$FAIL" = "0" ] && echo "Listo." || { echo "Hay diferencias: no cambies el gateway todavía."; exit 1; }
