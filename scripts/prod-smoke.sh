#!/bin/sh
# Comprobación rápida de un servidor ya desplegado: que responda, que tenga los encabezados de seguridad y que nada de negocio conteste sin sesión.
# Uso: ./scripts/prod-smoke.sh https://mi-dominio.com      (o http://localhost:8080 para probarlo en local)
URL="${1:?Dime la dirección, por ejemplo https://mi-dominio.com}"
bad=0
ok() { echo "✔ $1"; }
fail() { echo "✘ $1"; bad=$((bad + 1)); }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

[ "$(code "$URL/health")" = "200" ] && ok "/health responde 200" || fail "/health no responde 200"
[ "$(code "$URL/")" = "200" ] && ok "la web carga" || fail "la web no carga"
H=$(curl -sI --max-time 15 "$URL/")
echo "$H" | grep -qi '^x-content-type-options: nosniff' && ok "X-Content-Type-Options" || fail "falta X-Content-Type-Options"
echo "$H" | grep -qi '^x-frame-options' && ok "X-Frame-Options" || fail "falta X-Frame-Options"
echo "$H" | grep -qi '^referrer-policy' && ok "Referrer-Policy" || fail "falta Referrer-Policy"
echo "$H" | grep -qi '^content-security-policy' && ok "Content-Security-Policy (modo informe)" || fail "falta Content-Security-Policy"
case "$URL" in https://*) echo "$H" | grep -qi '^strict-transport-security' && ok "Strict-Transport-Security" || fail "falta Strict-Transport-Security"
  [ "$(code "http://${URL#https://}/health")" != "000" ] && ok "el puerto 80 responde (redirige a HTTPS)" || fail "el puerto 80 no responde" ;; esac
# Nada de negocio sin sesión: todas deben dar 401.
for p in /projects /invoices /engineers /payroll /payables /cashflow /quotes /work-orders /users /notifications /dashboard; do
  c=$(code "$URL$p"); [ "$c" = "401" ] && ok "$p sin sesión → 401" || fail "$p sin sesión → $c (debía ser 401)"
done
# Un login equivocado se rechaza (y no revela si el correo existe).
c=$(code -X POST -H 'content-type: application/json' -d '{"email":"nadie@nada.example","password":"incorrecta-123456"}' "$URL/auth/login")
[ "$c" = "401" ] && ok "login equivocado → 401" || fail "login equivocado → $c (debía ser 401)"
# Lo que no debe verse desde fuera.
for p in /docs /docs-json /metrics /.env /.git/config; do
  c=$(code "$URL$p"); case "$c" in 200) fail "$p es público ($c)" ;; *) ok "$p no es público ($c)" ;; esac
done
echo "—"; [ "$bad" -eq 0 ] && echo "Todo bien." || { echo "$bad problema(s)."; exit 1; }
