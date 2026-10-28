#!/bin/sh
# Prueba la IP real detrás de un balanceador en el gateway (infra/gateway/20-gateway-includes.sh + limit_req de nginx).
# Levanta DOS gateways de prueba junto a la pila en marcha (no toca el de la demo): uno que confía en quien le habla (TRUSTED_PROXIES) y otro que no.
# Cada uno tiene sus propias bolsas de límite en memoria. Se usa el login (10 por minuto, ráfaga de 5) con un usuario que no existe: responde 401 hasta
# que nginx limita con 429. Uso: ./scripts/gateway-real-ip-check.sh   (con `docker compose up -d` hecho)
set -u
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.docs.yml"
TRUST=gw-realip-trust; PLAIN=gw-realip-plain
fail=0
cleanup() { docker rm -f "$TRUST" "$PLAIN" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
cleanup

# La dirección con la que el gateway ve a quien le habla desde este equipo (la puerta de la red de contenedores): sale de su propio registro de accesos.
curl -s -o /dev/null http://127.0.0.1:8080/
PEER=$(docker compose logs --no-log-prefix --tail=1 gateway 2>/dev/null | awk '{print $1}')
case "$PEER" in *[!0-9a-fA-F:.]*|"") echo "❌ no pude saber con qué dirección ve el gateway a este equipo ($PEER)"; exit 1 ;; esac

$COMPOSE run -d --no-deps --name "$TRUST" -p 127.0.0.1:18080:8080 -e TRUSTED_PROXIES="$PEER" gateway >/dev/null 2>&1 || { echo "❌ no pude levantar el gateway de prueba"; exit 1; }
$COMPOSE run -d --no-deps --name "$PLAIN" -p 127.0.0.1:18081:8080 -e TRUSTED_PROXIES="" gateway >/dev/null 2>&1 || { echo "❌ no pude levantar el gateway sin confianza"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -s -o /dev/null http://127.0.0.1:18080/ && curl -s -o /dev/null http://127.0.0.1:18081/ && break; sleep 1
done

# login PUERTO "X-Forwarded-For que manda el cliente" -> código HTTP
# Un 429 puede venir de nginx (cuerpo HTML: lo que se prueba aquí) o del límite propio del servicio de identidad (JSON, por la IP que le reenvía el gateway):
# solo el de nginx cuenta como «429»; el del servicio se devuelve como «429-servicio» para que no tape el resultado.
login() {
  out=$(curl -s -w '\n%{http_code}' -X POST "http://127.0.0.1:$1/auth/login" -H 'content-type: application/json' ${2:+-H "X-Forwarded-For: $2"} -d '{"email":"nadie@nexus.example","password":"x"}')
  code=$(printf '%s' "$out" | tail -n 1)
  if [ "$code" = "429" ] && ! printf '%s' "$out" | grep -qi '<html'; then echo "429-servicio"; else echo "$code"; fi
}
# burst PUERTO XFF N -> cuántas de N respuestas fueron 429
burst() { n=0; i=0; while [ $i -lt "$3" ]; do [ "$(login "$1" "$2")" = "429" ] && n=$((n+1)); i=$((i+1)); done; echo $n; }
check() { if [ "$2" = "ok" ]; then echo "✅ $1"; else echo "❌ $1"; fail=1; fi; }

# 1) Con confianza: cada IP real tiene su bolsa.
a=$(burst 18080 198.51.100.10 14)
[ "$a" -ge 5 ] && r=ok || r=no; check "con confianza: 14 intentos de la IP A -> $a limitados con 429" "$r"
b=$(login 18080 198.51.100.11)
[ "$b" = "401" ] && r=ok || r=no; check "con confianza: la IP B (otra persona) sigue pasando (respuesta $b, debía ser 401)" "$r"
# 2) Con confianza, entradas falsas a la izquierda no cambian de bolsa (se toma la más a la derecha que no es de confianza).
c=$(login 18080 "203.0.113.99, 198.51.100.10")
[ "$c" = "429" ] && r=ok || r=no; check "con confianza: «falsa, A» cae en la bolsa de A (respuesta $c, debía ser 429)" "$r"
c2=$(login 18080 "203.0.113.98, 203.0.113.97, 198.51.100.10")
[ "$c2" = "429" ] && r=ok || r=no; check "con confianza: dos entradas falsas tampoco la cambian (respuesta $c2, debía ser 429)" "$r"
# 2b) Cadena de dos proxies: el último salto también es de confianza (aquí, el propio equipo); hay que saltarlo y tomar la IP del cliente que va antes.
c3=$(login 18080 "198.51.100.10, $PEER")
[ "$c3" = "429" ] && r=ok || r=no; check "con confianza: «A, proxy de confianza» cae en la bolsa de A (respuesta $c3, debía ser 429)" "$r"
# 3) Sin confianza: el X-Forwarded-For del cliente se IGNORA (si no, cualquiera elegiría su propia bolsa y se saltaría el límite).
d=$(burst 18081 198.51.100.20 14)
[ "$d" -ge 5 ] && r=ok || r=no; check "sin confianza: 14 intentos con la IP A -> $d limitados" "$r"
e=$(login 18081 198.51.100.21)
[ "$e" = "429" ] && r=ok || r=no; check "sin confianza: cambiar el X-Forwarded-For NO da otra bolsa (respuesta $e, debía ser 429)" "$r"
# 4) El valor mal escrito en TRUSTED_PROXIES impide arrancar (nunca se escribe tal cual en la configuración).
if docker run --rm -e TRUSTED_PROXIES='1.2.3.4; return 200' -v "$PWD/infra/gateway/20-gateway-includes.sh:/h.sh:ro" nginx:1.27-alpine sh -c 'mkdir -p /etc/nginx/conf.d && sh /h.sh' >/dev/null 2>&1; then check "un TRUSTED_PROXIES con «; return 200» se rechaza" no; else check "un TRUSTED_PROXIES con «; return 200» se rechaza" ok; fi
exit $fail
