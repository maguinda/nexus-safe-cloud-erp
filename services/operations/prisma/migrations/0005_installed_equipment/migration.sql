-- Los equipos ahora entran al inventario de red cuando se INSTALAN (INS-0001), no cuando se recibe la compra (PO-0001): se aceptan los dos orígenes.
ALTER TABLE "network_devices" DROP CONSTRAINT "network_devices_source_check";
ALTER TABLE "network_devices" ADD CONSTRAINT "network_devices_source_check" CHECK (("source_order" IS NULL AND "source_unit" IS NULL) OR ("source_order" ~ '^(PO|INS)-[0-9]{4,9}$' AND "source_unit" BETWEEN 1 AND 100));
