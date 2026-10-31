-- Cuentas por pagar: recibir un pedido genera la deuda con el proveedor (monto del pedido, vence a 30 días de recibido) hasta que finanzas la paga, una sola vez.
-- Un pedido puede ligarse a un proyecto para saber cuánto costaron de verdad los materiales de ese proyecto.
ALTER TABLE "purchase_orders" ADD COLUMN "project_name" TEXT;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_check" CHECK ("project_name" IS NULL OR length("project_name") BETWEEN 2 AND 80);

CREATE TABLE "payables" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "order_id" UUID NOT NULL,
  "supplier_name" TEXT NOT NULL,
  "amount_cop" INTEGER NOT NULL,
  "due_date" DATE NOT NULL,
  "project_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "paid_at" TIMESTAMPTZ(6),
  "paid_by" TEXT,
  "method" TEXT,
  "reference" TEXT,
  CONSTRAINT "payables_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payables_order_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id"),
  CONSTRAINT "payables_amount_check" CHECK ("amount_cop" > 0),
  CONSTRAINT "payables_status_check" CHECK ("status" IN ('open', 'paid')),
  CONSTRAINT "payables_method_check" CHECK ("method" IS NULL OR "method" IN ('transfer', 'cash', 'card', 'check')),
  CONSTRAINT "payables_paid_check" CHECK (("status" = 'paid') = ("paid_at" IS NOT NULL AND "paid_by" IS NOT NULL AND "method" IS NOT NULL)),
  CONSTRAINT "payables_reference_check" CHECK ("reference" IS NULL OR length("reference") BETWEEN 3 AND 60)
);
CREATE UNIQUE INDEX "payables_number_key" ON "payables"("number");
CREATE UNIQUE INDEX "payables_order_key" ON "payables"("order_id");
CREATE INDEX "payables_status_due_idx" ON "payables"("status", "due_date");

-- Los pedidos que ya estaban recibidos también deben plata.
INSERT INTO "payables" ("order_id", "supplier_name", "amount_cop", "due_date", "project_name")
  SELECT o.id, s.name, o.total_cop, (o.received_at + interval '30 days')::date, o.project_name
  FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.status = 'received' AND o.received_at IS NOT NULL;

-- Solo se puede pasar de «abierta» a «pagada», una vez; ni se borra ni se cambia el monto.
CREATE OR REPLACE FUNCTION payables_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payables cannot be deleted'; END IF;
  IF OLD.status <> 'open' OR NEW.status <> 'paid' OR NEW.amount_cop <> OLD.amount_cop OR NEW.order_id <> OLD.order_id OR NEW.supplier_name <> OLD.supplier_name OR NEW.due_date <> OLD.due_date OR NEW.project_name IS DISTINCT FROM OLD.project_name THEN
    RAISE EXCEPTION 'a payable can only go from open to paid, once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payables_no_change BEFORE UPDATE OR DELETE ON "payables" FOR EACH ROW EXECUTE FUNCTION payables_guard();
