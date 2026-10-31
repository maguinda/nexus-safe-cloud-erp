#!/bin/sh
# Respaldo de las 8 bases de datos (formato comprimido de pg_dump) más un archivo de verificación (SHA-256). Funciona con el stack levantado.
# Uso: ./scripts/backup.sh [carpeta-destino] [cuantos-respaldos-guardar]     (por defecto ./backups y 14)
# Programarlo todos los días con cron en el servidor, por ejemplo:   0 2 * * * cd /ruta/erp && ./scripts/backup.sh /var/backups/erp 14
# IMPORTANTE: un respaldo que nunca se ha restaurado no es un respaldo. Hay que ensayar ./scripts/restore.sh (con --check) y copiar la carpeta FUERA del servidor.
set -e
cd "$(dirname "$0")/.."
. ./.env
DEST="${1:-./backups}"; KEEP="${2:-14}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR="$DEST/$STAMP"
mkdir -p "$DIR"
umask 077
for db in identity projects billing analytics notifications capacity operations procurement; do
  docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres pg_dump -h localhost -U "$POSTGRES_ADMIN_USER" -Fc --no-owner "$db" > "$DIR/$db.dump"
  [ -s "$DIR/$db.dump" ] || { echo "El respaldo de $db salió vacío"; rm -rf "$DIR"; exit 1; }
  echo "✔ $db ($(wc -c < "$DIR/$db.dump" | tr -d ' ') bytes)"
done
# Las colas de RabbitMQ y sus definiciones se reconstruyen solas al arrancar los servicios; los eventos pendientes están en la bandeja de salida (outbox) de cada base.
( cd "$DIR" && shasum -a 256 *.dump > SHA256SUMS )
echo "$STAMP" > "$DIR/COMPLETE"
echo "Respaldo completo en $DIR"
# Conserva solo los últimos $KEEP respaldos COMPLETOS.
ls -1d "$DEST"/*/ 2>/dev/null | sort | awk -v k="$KEEP" '{a[NR]=$0} END{for (i = 1; i <= NR - k; i++) print a[i]}' | while read -r old; do [ -f "$old/COMPLETE" ] && rm -rf "$old"; done || true
