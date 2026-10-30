-- Conteo físico: se abre (foto del stock esperado de cada artículo), se anota lo contado y se cierra aplicando la diferencia como ajuste.
CREATE TABLE "stock_counts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "opened_by" TEXT,
  "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "closed_by" TEXT,
  "closed_at" TIMESTAMPTZ(6),
  CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_counts_status_check" CHECK ("status" IN ('open', 'closed', 'cancelled')),
  CONSTRAINT "stock_counts_closed_check" CHECK (("status" = 'open' AND "closed_at" IS NULL) OR ("status" <> 'open' AND "closed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "stock_counts_number_key" ON "stock_counts" ("number");
-- Un solo conteo abierto a la vez: dos personas contando a la vez se pisarían.
CREATE UNIQUE INDEX "stock_counts_one_open_key" ON "stock_counts" ((true)) WHERE "status" = 'open';

CREATE TABLE "stock_count_lines" (
  "count_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "item_name" TEXT NOT NULL,
  "expected" INTEGER NOT NULL,
  "counted" INTEGER,
  "counted_by" TEXT,
  "counted_at" TIMESTAMPTZ(6),
  "applied_delta" INTEGER,
  CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("count_id", "item_id"),
  CONSTRAINT "stock_count_lines_count_fk" FOREIGN KEY ("count_id") REFERENCES "stock_counts" ("id") ON DELETE CASCADE,
  CONSTRAINT "stock_count_lines_expected_check" CHECK ("expected" >= 0),
  CONSTRAINT "stock_count_lines_counted_check" CHECK ("counted" IS NULL OR ("counted" >= 0 AND "counted" <= 1000000))
);

ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_source_check";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_source_check" CHECK ("source" IN ('opening', 'purchase_received', 'adjustment', 'count'));
