#!/bin/sh
# `.env.example` lo leen DOS cosas: docker compose y el shell (`set -a; . ./.env`, que usan e2e-flow y la CI). Lo que compose acepta, el shell puede rechazarlo
# (espacios y paréntesis sin comillas son un error de sintaxis). Esta comprobación hace que un valor mal escrito falle ANTES de llegar a la CI.
set -u
cd "$(dirname "$0")/.."
out=$(sh -c 'set -a; . ./.env.example' 2>&1) || { echo "❌ .env.example no se puede cargar con el shell: $out"; exit 1; }
# Y compose debe leer los mismos valores (comillas incluidas bien interpretadas): se comparan los de la factura electrónica.
sh_name=$(sh -c 'set -a; . ./.env.example; printf %s "$EINVOICE_SUPPLIER_NAME"')
[ "$sh_name" = "Velocity Softworks (sandbox)" ] || { echo "❌ el shell lee EINVOICE_SUPPLIER_NAME como «$sh_name»"; exit 1; }
echo "✅ .env.example se puede cargar con el shell y con compose"
