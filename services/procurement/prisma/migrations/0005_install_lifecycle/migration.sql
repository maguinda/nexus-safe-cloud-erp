-- Ciclo de vida de una instalación: instalada → devuelta a bodega o dada de baja.
ALTER TABLE "equipment_installs" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'installed';
ALTER TABLE "equipment_installs" ADD COLUMN "ended_at" TIMESTAMPTZ(6);
ALTER TABLE "equipment_installs" ADD COLUMN "ended_by" TEXT;
ALTER TABLE "equipment_installs" ADD CONSTRAINT "equipment_installs_status_check" CHECK ("status" IN ('installed', 'returned', 'retired'));
ALTER TABLE "equipment_installs" ADD CONSTRAINT "equipment_installs_ended_check" CHECK (("status" = 'installed' AND "ended_at" IS NULL) OR ("status" <> 'installed' AND "ended_at" IS NOT NULL));
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_source_check";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_check" CHECK ("source" IN ('opening', 'purchase_received', 'adjustment', 'count', 'install', 'return'));
