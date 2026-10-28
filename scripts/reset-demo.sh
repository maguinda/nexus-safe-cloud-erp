#!/bin/sh
# Deja la demo en su estado inicial: hitos m2, m3, m5 y m6 pendientes, sin eventos ni facturas nuevas, las lecturas de telemetría que llegaron por la API de ingesta o el simulador (id > 4200; las 4.200 del Excel no se tocan) y solo los 4 usuarios de demostración con su rol, en español y con el tema «system».
# Solo toca los datos de DEMOSTRACIÓN. Usa el superusuario de PostgreSQL del contenedor local.
set -e
cd "$(dirname "$0")/.."
. ./.env
psqlc() { docker compose exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" postgres psql -h localhost -U "$POSTGRES_ADMIN_USER" -d "$1" -Atc "$2" >/dev/null; }
psqlc projects "DELETE FROM milestones WHERE id LIKE 'm-%'; DELETE FROM projects WHERE id LIKE 'p-%'; UPDATE milestones SET status='pending', approved_at=NULL, approved_by=NULL WHERE id IN ('m2','m3','m5','m6'); DELETE FROM outbox_events;"
psqlc identity "DELETE FROM refresh_tokens; DELETE FROM users WHERE email NOT IN ('laura.rios@nexus.example','andres.mora@nexus.example','camila.soto@nexus.example','diana.vega@nexus.example'); UPDATE users SET role='project_lead', language='es', theme='system' WHERE email='laura.rios@nexus.example'; UPDATE users SET role='billing_analyst', language='es', theme='system' WHERE email='andres.mora@nexus.example'; UPDATE users SET role='sales', language='es', theme='system' WHERE email='camila.soto@nexus.example'; UPDATE users SET role='manager', language='es', theme='system' WHERE email='diana.vega@nexus.example';"
psqlc billing "DELETE FROM invoices WHERE number NOT IN ('INV-0101','INV-0102'); DELETE FROM processed_events; DELETE FROM outbox_events; SELECT setval('invoice_number_seq', 103, false);"
psqlc analytics "DELETE FROM milestone_facts WHERE milestone_id NOT IN ('m1','m4'); DELETE FROM processed_events; DELETE FROM activity_entries; DELETE FROM iot_readings WHERE id > 4200;"
echo "Demo reiniciada: 4 hitos pendientes (m2, m3, m5, m6) y 2 facturas emitidas (INV-0101, INV-0102)."
