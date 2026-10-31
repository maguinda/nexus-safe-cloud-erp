#!/bin/sh
# Revisa que el .env y las llaves sean aptos para producción ANTES de levantar el servidor. No cambia nada: solo lee y avisa.
# Uso: ./scripts/prod-preflight.sh [archivo-env]      (por defecto .env). Sale con 1 si hay algo que impide producción.
cd "$(dirname "$0")/.." || exit 1
ENVFILE="${1:-.env}"
[ -f "$ENVFILE" ] || { echo "No existe $ENVFILE"; exit 1; }
set -a; . "./$ENVFILE"; set +a
bad=0; warn=0
fail() { echo "✘ $1"; bad=$((bad + 1)); }
note() { echo "! $1"; warn=$((warn + 1)); }
ok() { echo "✔ $1"; }

for v in POSTGRES_ADMIN_PASSWORD DB_IDENTITY_PASSWORD DB_PROJECTS_PASSWORD DB_BILLING_PASSWORD DB_ANALYTICS_PASSWORD DB_NOTIFICATIONS_PASSWORD DB_CAPACITY_PASSWORD DB_OPERATIONS_PASSWORD DB_PROCUREMENT_PASSWORD RABBITMQ_PASSWORD; do
  val=$(eval echo "\$$v")
  if [ -z "$val" ]; then fail "$v está vacía"
  elif echo "$val" | grep -qi "changeme"; then fail "$v todavía es la de ejemplo"
  elif [ "${#val}" -lt 16 ]; then fail "$v es muy corta (mínimo 16 caracteres; usa openssl rand -hex 16)"
  elif ! echo "$val" | grep -Eq '^[A-Za-z0-9]+$'; then fail "$v tiene caracteres que no son letras ni números (el script de inicio de la base no los admite)"
  fi
done
# Contraseñas repetidas entre sí: si una se filtra, no deben caer las demás.
dups=$(for v in POSTGRES_ADMIN_PASSWORD DB_IDENTITY_PASSWORD DB_PROJECTS_PASSWORD DB_BILLING_PASSWORD DB_ANALYTICS_PASSWORD DB_NOTIFICATIONS_PASSWORD DB_CAPACITY_PASSWORD DB_OPERATIONS_PASSWORD DB_PROCUREMENT_PASSWORD RABBITMQ_PASSWORD; do eval echo "\$$v"; done | sort | uniq -d | wc -l | tr -d ' ')
[ "$dups" = "0" ] && ok "las 10 contraseñas son distintas entre sí" || fail "hay contraseñas repetidas entre sí"

[ "${SEED_DEMO:-false}" = "false" ] && ok "SEED_DEMO=false (sin datos ni usuarios de demostración)" || fail "SEED_DEMO debe ser false en producción"
[ -z "${DEMO_PASSWORD:-}" ] && ok "no hay DEMO_PASSWORD" || fail "DEMO_PASSWORD no debe existir en producción"
[ "${COOKIE_SECURE:-}" = "true" ] && ok "COOKIE_SECURE=true (la sesión solo viaja por HTTPS)" || fail "COOKIE_SECURE debe ser true"
[ "${#INGEST_KEY}" -ge 32 ] && ok "INGEST_KEY de al menos 32 caracteres" || fail "INGEST_KEY debe tener al menos 32 caracteres (openssl rand -hex 24)"
[ -n "${DOMAIN:-}" ] && ok "DOMAIN=$DOMAIN" || fail "falta DOMAIN"
echo "${ACME_EMAIL:-}" | grep -Eq '^[^@ ]+@[^@ ]+\.[^@ ]+$' && ok "ACME_EMAIL válido" || fail "falta un ACME_EMAIL válido (correo para el certificado HTTPS)"
[ -n "${TRUSTED_PROXIES:-}" ] && ok "TRUSTED_PROXIES=$TRUSTED_PROXIES" || note "TRUSTED_PROXIES vacío: el límite de intentos verá una sola IP (la del servidor HTTPS)"

# Llaves del login (JWT) y certificados de mTLS: tienen que ser de ESTE servidor, no los de desarrollo del repositorio.
[ -f infra/keys/jwt-private.pem ] && [ -f infra/keys/jwt-public.pem ] && ok "existen las llaves del login (JWT)" || fail "faltan las llaves del login: openssl genrsa -out infra/keys/jwt-private.pem 2048 (ver docs/DEPLOY.md)"
[ -f infra/certs/ca.pem ] && ok "existe la CA de mTLS" || fail "falta la CA de mTLS (ver docs/DEPLOY.md)"
if command -v git >/dev/null 2>&1 && git ls-files --error-unmatch infra/keys/jwt-private.pem >/dev/null 2>&1; then fail "la llave privada está en Git: hay que sacarla y generar otra"; fi
if [ -f infra/keys/jwt-private.pem ]; then
  perm=$(stat -f '%Lp' infra/keys/jwt-private.pem 2>/dev/null || stat -c '%a' infra/keys/jwt-private.pem 2>/dev/null)
  case "$perm" in 600|400|640|644) ok "permisos de la llave privada: $perm" ;; *) note "permisos raros en la llave privada: $perm" ;; esac
fi
[ "${EINVOICE_ENVIRONMENT:-sandbox}" = "sandbox" ] && note "la factura electrónica es de PRUEBA (sandbox): no tiene validez legal ni llega a la DIAN. Para facturar de verdad hace falta un proveedor tecnológico autorizado"
echo "${EINVOICE_TECHNICAL_KEY:-}" | grep -qi "sandbox" && note "EINVOICE_TECHNICAL_KEY es la de prueba"
echo "${EINVOICE_SUPPLIER_NIT:-}" | grep -Eq '^[0-9]{6,10}$' || note "EINVOICE_SUPPLIER_NIT vacío o raro"

echo "—"
if [ "$bad" -gt 0 ]; then echo "$bad problema(s) que impiden producción, $warn aviso(s)."; exit 1; fi
echo "Listo para producción ($warn aviso(s))."
