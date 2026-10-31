#!/bin/sh
# Renueva los certificados de mTLS (los de servicio duran 1 año) y reinicia los servicios para que los lean.
#   ./scripts/rotate-certs.sh             renueva con la MISMA CA (la renovación anual; nadie deja de confiar en nadie)
#   ./scripts/rotate-certs.sh --new-ca    CA nueva (si la llave de la CA se filtró o la CA va a vencer)
#   añade --prod en el servidor de producción (usa docker-compose.prod.yml)
# Hay un corte de ~1 minuto: mientras los servicios reinician no se pueden hablar. Hazlo fuera del horario de trabajo y DESPUÉS de un respaldo.
set -e
cd "$(dirname "$0")/.."
MODE="--renew"; FILES="-f docker-compose.yml"
for a in "$@"; do case "$a" in --new-ca) MODE="--force" ;; --prod) FILES="-f docker-compose.yml -f docker-compose.prod.yml" ;; *) echo "Opción desconocida: $a"; exit 2 ;; esac; done
STAMP=$(date -u +%Y%m%dT%H%M%SZ); OLD="infra/.rotated/certs-$STAMP"
mkdir -p "$OLD" && chmod 700 infra/.rotated "$OLD"
cp infra/certs/*.pem "$OLD"/ 2>/dev/null || true
echo "Certificados anteriores guardados en $OLD (bórralos cuando todo funcione: contienen llaves privadas)"
sh infra/certs/gen-certs.sh "$MODE"
SERVICES="identity projects billing analytics notifications capacity operations procurement"
# shellcheck disable=SC2086
docker compose $FILES restart $SERVICES >/dev/null
sleep 20
# shellcheck disable=SC2086
docker compose $FILES restart gateway >/dev/null
sleep 8
BAD=$(docker compose $FILES ps --format '{{.Name}} {{.Status}}' | grep -vc healthy || true)
[ "$BAD" -le 1 ] || { echo "✘ Hay servicios que no quedaron sanos: docker compose ps. Para volver atrás copia $OLD/*.pem a infra/certs/ y repite el reinicio."; exit 1; }
./scripts/cert-expiry.sh infra/certs 30 | tail -1
echo "Listo: certificados renovados y servicios reiniciados."
