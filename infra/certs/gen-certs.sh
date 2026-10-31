#!/bin/sh
# Genera la autoridad certificadora (CA) propia y los certificados para mTLS entre el gateway y los servicios.
#   ca.pem / ca-key.pem          la CA (ca-key.pem NUNCA se monta en un contenedor: solo sirve para emitir)
#   <servicio>.pem / -key.pem    carné de identity, projects y billing (sirve como servidor y, para su healthcheck, como cliente)
#   gateway.pem / gateway-key.pem  carné del gateway (solo cliente)
#   server.pem / server-key.pem    certificado HTTPS que el gateway presenta a los NAVEGADORES en el puerto 8443 (docker-compose.https.yml); es de la CA de desarrollo,
#                                   que ningún navegador conoce: las pruebas lo aceptan con `ignoreHTTPSErrors`
# Nada de esto va a Git (*.pem está ignorado). Curva P-256. Los certificados de servicio duran 1 año y la CA 5 años (CA_DAYS).
#   sh gen-certs.sh            solo crea lo que falta
#   sh gen-certs.sh --renew    emite de nuevo TODOS los certificados de servicio con la MISMA CA (la renovación anual: nadie deja de confiar en nadie)
#   sh gen-certs.sh --force    CA nueva y todo nuevo (hay que reiniciar todo a la vez)
set -e
# CERT_DIR permite a las pruebas generar sus propios certificados en una carpeta temporal.
DIR="${CERT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
mkdir -p "$DIR"
FORCE="$1"
DAYS=365
CA_DAYS="${CA_DAYS:-1825}"
# --renew: la CA se queda; solo se vuelven a emitir los certificados de servicio.
NEWCA=no; [ "$FORCE" = "--force" ] && NEWCA=yes
[ "$FORCE" = "--renew" ] && FORCE="--force"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# CA: puede firmar certificados finales, pero no sub-CAs (pathlen:0). Solo se crea si falta (o con --force).
if [ ! -f "$DIR/ca.pem" ] || [ "$NEWCA" = "yes" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/ca-key.pem"
  printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n' > "$TMP/ca.ext"
  openssl req -new -key "$DIR/ca-key.pem" -subj "/O=Nexus ERP (dev)/CN=Nexus ERP internal CA" -out "$TMP/ca.csr"
  openssl x509 -req -sha256 -in "$TMP/ca.csr" -signkey "$DIR/ca-key.pem" -days "$CA_DAYS" -extfile "$TMP/ca.ext" -out "$DIR/ca.pem" 2>/dev/null
  FORCE="--force"   # una CA nueva invalida todos los certificados anteriores: se emiten de nuevo
fi

# emitir <nombre> <usos> <san>   (el CN es el nombre: así el servidor sabe QUIÉN le habla)
emitir() {
  nombre="$1"; usos="$2"; san="$3"
  # Solo emite lo que falta: agregar un servicio nuevo no obliga a cambiar los certificados que ya funcionan.
  if [ -f "$DIR/$nombre.pem" ] && [ "$FORCE" != "--force" ]; then return 0; fi
  openssl ecparam -name prime256v1 -genkey -noout -out "$DIR/$nombre-key.pem"
  openssl req -new -key "$DIR/$nombre-key.pem" -subj "/O=Nexus ERP (dev)/CN=$nombre" -out "$TMP/$nombre.csr"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=%s\nsubjectAltName=%s\n' "$usos" "$san" > "$TMP/$nombre.ext"
  openssl x509 -req -sha256 -in "$TMP/$nombre.csr" -CA "$DIR/ca.pem" -CAkey "$DIR/ca-key.pem" -CAcreateserial -CAserial "$TMP/ca.srl" \
    -days "$DAYS" -extfile "$TMP/$nombre.ext" -out "$DIR/$nombre.pem" 2>/dev/null
}
for s in identity projects billing analytics notifications capacity operations procurement; do emitir "$s" "serverAuth,clientAuth" "DNS:$s,DNS:localhost,IP:127.0.0.1"; done
emitir gateway "clientAuth" "DNS:gateway"
emitir server "serverAuth" "DNS:localhost,IP:127.0.0.1"

chmod 600 "$DIR"/*-key.pem
echo "Certificados listos en $DIR (CA + identity, projects, billing, analytics, notifications, capacity, operations, procurement, gateway, server)"
