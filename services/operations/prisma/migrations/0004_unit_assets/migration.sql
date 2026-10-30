-- Datos de cada unidad comprada: número de serie real (el de la orden es provisional), garantía y a quién se asignó.
-- Solo las filas que vinieron de una compra pueden llevarlos. El serial real no se repite entre equipos comprados.
ALTER TABLE "network_devices" ADD COLUMN "warranty_until" DATE;
ALTER TABLE "network_devices" ADD COLUMN "assigned_to" TEXT;
ALTER TABLE "network_devices" ADD CONSTRAINT "network_devices_unit_assets_check" CHECK (("warranty_until" IS NULL AND "assigned_to" IS NULL) OR "source_order" IS NOT NULL);
ALTER TABLE "network_devices" ADD CONSTRAINT "network_devices_assigned_check" CHECK ("assigned_to" IS NULL OR char_length("assigned_to") BETWEEN 2 AND 80);
CREATE UNIQUE INDEX "network_devices_bought_serial_key" ON "network_devices" (lower("serial")) WHERE "source_order" IS NOT NULL;
