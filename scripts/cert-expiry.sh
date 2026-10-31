#!/bin/sh
# Cuándo vence cada certificado de mTLS y la CA (infra/certs). Si un certificado vence, los servicios dejan de hablar entre sí:
# esto se revisa cada mes (ver docs/DEPLOY.md). Sale con 1 si algo vence en menos de WARN_DAYS (30 por defecto), ya venció o no se pudo leer.
#   ./scripts/cert-expiry.sh            (carpeta por defecto infra/certs)    ./scripts/cert-expiry.sh /otra/carpeta [dias]
# Usa `openssl x509 -checkend` (exacto y igual en macOS y Linux): nunca se salta un archivo sin decirlo.
DIR="${1:-infra/certs}"; WARN="${2:-30}"
[ -f "$DIR/ca.pem" ] || { echo "No hay certificados en $DIR"; exit 2; }
bad=0
for f in "$DIR"/*.pem; do
  case "$f" in *-key.pem) continue ;; esac
  name=$(basename "$f")
  if ! end=$(openssl x509 -in "$f" -noout -enddate 2>/dev/null | sed 's/notAfter=//') || [ -z "$end" ]; then echo "✘ $name: no se pudo leer"; bad=1; continue; fi
  if ! openssl x509 -in "$f" -noout -checkend 0 >/dev/null 2>&1; then echo "✘ $name: VENCIDO ($end)"; bad=1
  elif ! openssl x509 -in "$f" -noout -checkend $((WARN * 86400)) >/dev/null 2>&1; then echo "! $name: vence pronto ($end)"; bad=1
  else echo "✔ $name: vence $end"; fi
done
[ "$bad" -eq 0 ] && echo "Certificados al día." || echo "Hay certificados por vencer: ./scripts/rotate-certs.sh"
exit "$bad"
