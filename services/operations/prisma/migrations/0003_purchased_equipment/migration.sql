-- Equipos comprados que Compras anunció (EquipmentPurchased): una fila por unidad en el inventario de red.
-- La pareja (orden, unidad) evita duplicar si el aviso llega repetido. Las filas del Excel quedan con estos campos en NULL.
ALTER TABLE "network_devices" ADD COLUMN "source_order" TEXT;
ALTER TABLE "network_devices" ADD COLUMN "source_unit" INTEGER;
CREATE UNIQUE INDEX "network_devices_source_key" ON "network_devices" ("source_order", "source_unit") WHERE "source_order" IS NOT NULL;
ALTER TABLE "network_devices" ADD CONSTRAINT "network_devices_source_check" CHECK (("source_order" IS NULL AND "source_unit" IS NULL) OR ("source_order" ~ '^PO-[0-9]{4,9}$' AND "source_unit" BETWEEN 1 AND 100));
