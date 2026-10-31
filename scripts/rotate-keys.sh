#!/bin/sh
# Cambia las llaves con las que Identity firma el login (JWT) y reinicia los 8 servicios para que lean la nueva.
#   ./scripts/rotate-keys.sh [--prod]
# Efecto: los tokens de acceso ya emitidos (hasta 15 min) dejan de valer; la pantalla pide uno nuevo sola con la sesión de renovación (que vive en la base),
# así que nadie tiene que volver a escribir su contraseña. Hay un corte de ~1 minuto. Hazlo DESPUÉS de un respaldo.
set -e
cd "$(dirname "$0")/.."
FILES="-f docker-compose.yml"
for a in "$@"; do case "$a" in --prod) FILES="-f docker-compose.yml -f docker-compose.prod.yml" ;; *) echo "Opción desconocida: $a"; exit 2 ;; esac; done
STAMP=$(date -u +%Y%m%dT%H%M%SZ); OLD="infra/.rotated/keys-$STAMP"
mkdir -p "$OLD" && chmod 700 infra/.rotated "$OLD"
cp infra/keys/*.pem "$OLD"/ 2>/dev/null || true
echo "Llaves anteriores guardadas en $OLD (bórralas cuando todo funcione: la privada firma sesiones)"
sh infra/keys/gen-keys.sh --force
SERVICES="identity projects billing analytics notifications capacity operations procurement"
# shellcheck disable=SC2086
docker compose $FILES restart $SERVICES >/dev/null
sleep 20
# shellcheck disable=SC2086
docker compose $FILES restart gateway >/dev/null
sleep 8
BAD=$(docker compose $FILES ps --format '{{.Name}} {{.Status}}' | grep -vc healthy || true)
[ "$BAD" -le 1 ] || { echo "✘ Hay servicios que no quedaron sanos: docker compose ps. Para volver atrás copia $OLD/*.pem a infra/keys/ y reinicia."; exit 1; }
echo "Listo: llaves nuevas en uso."
