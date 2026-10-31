-- Flujo de caja: cada cobro de un cliente, cada nómina pagada y cada pago a un proveedor es una fila (solo agregar). Y lo que se cotizó de cada proyecto aprobado, para compararlo con lo real.
CREATE TABLE "cash_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "entry_date" DATE NOT NULL,
  "direction" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amount_cop" BIGINT NOT NULL,
  "ref" TEXT NOT NULL,
  "project_name" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_entries_amount_check" CHECK ("amount_cop" > 0),
  CONSTRAINT "cash_entries_kind_check" CHECK (("category" = 'customer' AND "direction" = 'in') OR ("category" IN ('payroll', 'supplier') AND "direction" = 'out'))
);
CREATE UNIQUE INDEX "cash_entries_event_key" ON "cash_entries"("event_id");
CREATE INDEX "cash_entries_date_idx" ON "cash_entries"("entry_date");
CREATE INDEX "cash_entries_project_idx" ON "cash_entries"("project_name");

CREATE TABLE "quote_facts" (
  "quote_number" TEXT NOT NULL,
  "event_id" UUID NOT NULL,
  "project_id" TEXT NOT NULL,
  "project_name" TEXT NOT NULL,
  "price_cop" INTEGER NOT NULL,
  "cost_cop" INTEGER NOT NULL,
  "margin_pct" INTEGER NOT NULL,
  "approved_by" TEXT NOT NULL,
  "approved_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "quote_facts_pkey" PRIMARY KEY ("quote_number"),
  CONSTRAINT "quote_facts_amounts_check" CHECK ("price_cop" > 0 AND "cost_cop" >= 0 AND "margin_pct" BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX "quote_facts_event_key" ON "quote_facts"("event_id");
CREATE INDEX "quote_facts_project_idx" ON "quote_facts"("project_name");

CREATE OR REPLACE FUNCTION cash_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cash entries are append-only'; END $$;
CREATE TRIGGER cash_entries_no_change BEFORE UPDATE OR DELETE ON "cash_entries" FOR EACH ROW EXECUTE FUNCTION cash_entries_immutable();
