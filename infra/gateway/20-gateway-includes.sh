#!/bin/sh
# Gancho de arranque del contenedor nginx (se ejecuta antes de nginx): arma dos archivos que nginx.conf incluye dentro de `server {}`.
#
# 1) real-ip.inc — la IP REAL de quien llama cuando hay un balanceador o CDN delante del gateway. Sin esto todas las personas llegan con la IP del
#    balanceador y comparten una sola bolsa en cada `limit_req` (el límite de login de una persona bloquearía a todas). Se activa SOLO con
#    TRUSTED_PROXIES (CIDR separados por comas, p. ej. «10.0.0.0/8,172.18.0.1»): únicamente las conexiones que vienen de esas direcciones pueden decir
#    la IP del cliente en X-Forwarded-For; con `real_ip_recursive on` nginx toma la entrada MÁS A LA DERECHA que no sea de confianza, así que agregar
#    entradas falsas a la izquierda no cambia de bolsa. Vacía (por defecto) no se confía en nadie y el X-Forwarded-For que mande el cliente se ignora.
# 2) tls.inc — un segundo puerto con HTTPS (8443) solo si hay certificado montado (docker-compose.https.yml; es para probar la cookie `Secure`).
set -eu
dir=/etc/nginx/conf.d

: > "$dir/real-ip.inc"
if [ -n "${TRUSTED_PROXIES:-}" ]; then
  for cidr in $(printf '%s' "$TRUSTED_PROXIES" | tr ',' ' '); do
    # Solo dígitos, letras hexadecimales y «:./» (IPv4, IPv6 y CIDR): lo que llega por el entorno nunca se escribe tal cual en la configuración.
    case "$cidr" in
      *[!0-9a-fA-F:./]*) echo "TRUSTED_PROXIES: valor no válido «$cidr»" >&2; exit 1 ;;
    esac
    printf 'set_real_ip_from %s;\n' "$cidr" >> "$dir/real-ip.inc"
  done
  printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' >> "$dir/real-ip.inc"
fi

: > "$dir/tls.inc"
if [ -f /etc/nginx/certs/server.pem ] && [ -f /etc/nginx/certs/server-key.pem ]; then
  {
    printf 'listen 8443 ssl;\n'
    printf 'ssl_certificate /etc/nginx/certs/server.pem;\n'
    printf 'ssl_certificate_key /etc/nginx/certs/server-key.pem;\n'
    printf 'ssl_protocols TLSv1.2 TLSv1.3;\n'
  } >> "$dir/tls.inc"
fi
