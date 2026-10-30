-- IRREVERSIBLE. Elimina de la base de Analytics las tablas de telemetría y de red que pasaron al servicio Operations & Telemetry (2026-10-29).
-- ANTES de aplicarla en un entorno con datos: correr ./scripts/migrate-telemetry-to-operations.sh y comprobar que sale «Listo.» (copia los datos a la base
-- `operations` y compara conteos). Después de esta migración, el único origen de esos datos es la base de Operations.
DROP TABLE IF EXISTS "iot_readings";
DROP TABLE IF EXISTS "iot_devices";
DROP TABLE IF EXISTS "network_monitoring";
DROP TABLE IF EXISTS "network_links";
DROP TABLE IF EXISTS "network_devices";
