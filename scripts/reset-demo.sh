#!/bin/sh
# Deja la demo en su estado inicial: hitos m2, m3, m5 y m6 pendientes, sin eventos ni facturas nuevas.
# Solo toca los datos de DEMOSTRACIÓN. Usa el superusuario de PostgreSQL del contenedor local.
set -e
cd "$(dirname "$0")/.."
. ./.env
psqlc() { docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d "$1" -Atc "$2" >/dev/null; }
psqlc projects "UPDATE milestones SET status='pending', approved_at=NULL, approved_by=NULL WHERE id IN ('m2','m3','m5','m6'); DELETE FROM outbox_events;"
psqlc billing "DELETE FROM invoices WHERE number NOT IN ('INV-0101','INV-0102'); DELETE FROM processed_events; SELECT setval('invoice_number_seq', 103, false);"
echo "Demo reiniciada: 4 hitos pendientes (m2, m3, m5, m6) y 2 facturas emitidas (INV-0101, INV-0102)."
