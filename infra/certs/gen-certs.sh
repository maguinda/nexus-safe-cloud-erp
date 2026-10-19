#!/bin/sh
# Genera la autoridad certificadora (CA) propia y los certificados para mTLS entre el gateway y los servicios.
#   ca.pem / ca-key.pem          la CA (ca-key.pem NUNCA se monta en un contenedor: solo sirve para emitir)
#   <servicio>.pem / -key.pem    carné de identity, projects y billing (sirve como servidor y, para su healthcheck, como cliente)
#   gateway.pem / gateway-key.pem  carné del gateway (solo cliente)
# Nada de esto va a Git (*.pem está ignorado). Son certificados de DESARROLLO: curva P-256, 1 año.
set -e
# CERT_DIR permite a las pruebas generar sus propios certificados en una carpeta temporal.
DIR="${CERT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
mkdir -p "$DIR"
if [ -f "$DIR/ca.pem" ] && [ "$1" != "--force" ]; then
  echo "Los certificados ya existen en $DIR (usa --force para reemplazarlos)"; exit 0
fi
DAYS=365
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# CA: puede firmar certificados finales, pero no sub-CAs (pathlen:0).
openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/ca-key.pem"
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n' > "$TMP/ca.ext"
openssl req -new -key "$DIR/ca-key.pem" -subj "/O=Nexus ERP (dev)/CN=Nexus ERP internal CA" -out "$TMP/ca.csr"
openssl x509 -req -in "$TMP/ca.csr" -signkey "$DIR/ca-key.pem" -days "$DAYS" -extfile "$TMP/ca.ext" -out "$DIR/ca.pem" 2>/dev/null

# emitir <nombre> <usos> <san>   (el CN es el nombre: así el servidor sabe QUIÉN le habla)
emitir() {
  nombre="$1"; usos="$2"; san="$3"
  openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/$nombre-key.pem"
  openssl req -new -key "$DIR/$nombre-key.pem" -subj "/O=Nexus ERP (dev)/CN=$nombre" -out "$TMP/$nombre.csr"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=%s\nsubjectAltName=%s\n' "$usos" "$san" > "$TMP/$nombre.ext"
  openssl x509 -req -in "$TMP/$nombre.csr" -CA "$DIR/ca.pem" -CAkey "$DIR/ca-key.pem" -CAcreateserial -CAserial "$TMP/ca.srl" \
    -days "$DAYS" -extfile "$TMP/$nombre.ext" -out "$DIR/$nombre.pem" 2>/dev/null
}
for s in identity projects billing; do emitir "$s" "serverAuth,clientAuth" "DNS:$s,DNS:localhost,IP:127.0.0.1"; done
emitir gateway "clientAuth" "DNS:gateway"

chmod 600 "$DIR"/*-key.pem
echo "Certificados creados en $DIR (CA + identity, projects, billing, gateway)"
