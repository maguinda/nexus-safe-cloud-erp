#!/bin/sh
# Genera el par de llaves RSA con el que identity-access firma los JWT.
# La llave privada nunca va a Git (*.pem está ignorado). Solo identity-access la lee;
# los demás servicios usan la llave pública para verificar tokens.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/jwt-private.pem" ] && [ "$1" != "--force" ]; then
  echo "Las llaves ya existen en $DIR (usa --force para reemplazarlas)"; exit 0
fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$DIR/jwt-private.pem"
openssl pkey -in "$DIR/jwt-private.pem" -pubout -out "$DIR/jwt-public.pem"
chmod 600 "$DIR/jwt-private.pem"
echo "Llaves creadas en $DIR"
