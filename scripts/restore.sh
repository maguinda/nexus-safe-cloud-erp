#!/bin/sh
# Restaura un respaldo hecho con ./scripts/backup.sh.
#   ./scripts/restore.sh <carpeta-del-respaldo> --check     ENSAYO: restaura cada base en una base temporal, cuenta las tablas y las borra. No toca los datos reales.
#   ./scripts/restore.sh <carpeta-del-respaldo> --yes       RESTAURA DE VERDAD: borra y reemplaza las 8 bases. Detén antes los servicios:  docker compose stop identity projects billing analytics notifications capacity operations procurement
set -e
cd "$(dirname "$0")/.."
. ./.env
SRC="${1:?Dime la carpeta del respaldo}"; MODE="${2:?Dime --check (ensayo) o --yes (restaurar de verdad)}"
[ -f "$SRC/COMPLETE" ] || { echo "Ese respaldo no está completo (falta COMPLETE)"; exit 1; }
( cd "$SRC" && shasum -a 256 -c SHA256SUMS >/dev/null ) || { echo "El respaldo está dañado: no coincide la suma de verificación"; exit 1; }
echo "✔ suma de verificación correcta"
psqlx() { docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" -e PGOPTIONS="-c client_min_messages=warning" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -At "$@"; }
for db in identity projects billing analytics notifications capacity operations procurement; do
  if [ "$MODE" = "--check" ]; then
    tmp="restore_check_$db"
    psqlx -d postgres -c "DROP DATABASE IF EXISTS $tmp" >/dev/null; psqlx -d postgres -c "CREATE DATABASE $tmp" >/dev/null
    err=$(mktemp)
    docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres pg_restore -h localhost -U "$POSTGRES_ADMIN_USER" -d "$tmp" --no-owner < "$SRC/$db.dump" >/dev/null 2>"$err" || true
    if grep -qi "error" "$err"; then echo "✘ $db: la restauración tuvo errores:"; head -5 "$err"; rm -f "$err"; psqlx -d postgres -c "DROP DATABASE IF EXISTS $tmp" >/dev/null; exit 1; fi
    rm -f "$err"
    tables=$(psqlx -d "$tmp" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
    migrations=$(psqlx -d "$tmp" -c "SELECT count(*) FROM _prisma_migrations" 2>/dev/null || echo 0)
    psqlx -d postgres -c "DROP DATABASE $tmp" >/dev/null
    [ "$tables" -gt 0 ] && [ "$migrations" -gt 0 ] || { echo "✘ $db: no se pudo restaurar (tablas=$tables, migraciones=$migrations)"; exit 1; }
    echo "✔ $db: restaura bien ($tables tablas, $migrations migraciones)"
  elif [ "$MODE" = "--yes" ]; then
    psqlx -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid()" >/dev/null
    err=$(mktemp)
    docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres pg_restore -h localhost -U "$POSTGRES_ADMIN_USER" -d "$db" --clean --if-exists --no-owner --role="$db" < "$SRC/$db.dump" >/dev/null 2>"$err" || true
    if grep -qi "error" "$err"; then echo "✘ $db: la restauración tuvo errores (NO sigas: revisa y vuelve a intentar):"; head -8 "$err"; rm -f "$err"; exit 1; fi
    rm -f "$err"
    echo "✔ $db restaurada"
  else
    echo "Modo desconocido: $MODE"; exit 1
  fi
done
[ "$MODE" = "--check" ] && echo "Ensayo completo: el respaldo se puede restaurar." || echo "Restauración completa. Levanta de nuevo los servicios."
