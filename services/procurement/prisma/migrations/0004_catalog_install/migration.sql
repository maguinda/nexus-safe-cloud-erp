-- Catálogo por proveedor (qué vende cada uno, precio de referencia y plazo), datos de licitación y la instalación de equipos (de «en bodega» a «instalado»).
ALTER TABLE "suppliers" ADD COLUMN "tender_ref" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "valid_until" DATE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tender_check" CHECK (("tender_ref" IS NULL AND "valid_until" IS NULL) OR "kind" = 'tender');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tender_ref_check" CHECK ("tender_ref" IS NULL OR char_length("tender_ref") BETWEEN 2 AND 40);

CREATE TABLE "supplier_items" (
  "supplier_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "ref_price_cop" INTEGER NOT NULL,
  "lead_days" INTEGER NOT NULL,
  CONSTRAINT "supplier_items_pkey" PRIMARY KEY ("supplier_id", "item_id"),
  CONSTRAINT "supplier_items_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplier_items_item_fk" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE CASCADE,
  CONSTRAINT "supplier_items_price_check" CHECK ("ref_price_cop" BETWEEN 1 AND 1000000000),
  CONSTRAINT "supplier_items_lead_check" CHECK ("lead_days" BETWEEN 0 AND 365)
);

-- Cada instalación de un equipo: INS-0001, INS-0002… (baja 1 del stock y crea el activo en Operations).
CREATE TABLE "equipment_installs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "item_id" UUID NOT NULL,
  "item_name" TEXT NOT NULL,
  "installed_by" TEXT,
  "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "equipment_installs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "equipment_installs_number_key" ON "equipment_installs" ("number");

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_source_check";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_check" CHECK ("source" IN ('opening', 'purchase_received', 'adjustment', 'count', 'install'));

-- Catálogo de la demo (ids fijos del seed): el proveedor fijo vende los tres artículos; el de licitación, el sensor y la fuente.
INSERT INTO "supplier_items" ("supplier_id", "item_id", "ref_price_cop", "lead_days")
SELECT s.id, i.id, v.price, v.days FROM (VALUES
  ('22222222-2222-4222-8222-222222222201'::uuid, '33333333-3333-4333-8333-333333333303'::uuid, 2400000, 5),
  ('22222222-2222-4222-8222-222222222201'::uuid, '33333333-3333-4333-8333-333333333301'::uuid, 120000, 5),
  ('22222222-2222-4222-8222-222222222201'::uuid, '33333333-3333-4333-8333-333333333302'::uuid, 180000, 5),
  ('22222222-2222-4222-8222-222222222202'::uuid, '33333333-3333-4333-8333-333333333301'::uuid, 95000, 10),
  ('22222222-2222-4222-8222-222222222202'::uuid, '33333333-3333-4333-8333-333333333302'::uuid, 165000, 12)
) AS v(sid, iid, price, days) JOIN "suppliers" s ON s.id = v.sid JOIN "items" i ON i.id = v.iid ON CONFLICT DO NOTHING;
UPDATE "suppliers" SET "tender_ref" = 'LIC-2026-014', "valid_until" = '2027-06-30' WHERE id = '22222222-2222-4222-8222-222222222202' AND kind = 'tender';
