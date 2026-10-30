-- Pagos registrados contra facturas emitidas. Solo se agregan: no se editan ni se borran (la base lo impide).
CREATE TABLE "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoice_number" TEXT NOT NULL,
  "amount_cop" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "reference" TEXT,
  "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "registered_by" TEXT NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_amount_check" CHECK ("amount_cop" > 0),
  CONSTRAINT "payments_method_check" CHECK ("method" IN ('transfer', 'cash', 'card', 'other')),
  CONSTRAINT "payments_reference_check" CHECK ("reference" IS NULL OR length("reference") BETWEEN 1 AND 60),
  CONSTRAINT "payments_invoice_number_fkey" FOREIGN KEY ("invoice_number") REFERENCES "invoices"("number") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payments_invoice_number_idx" ON "payments"("invoice_number");

-- Inmutables: ni UPDATE ni DELETE ni TRUNCATE, salvo el reinicio de la demo, que lo declara a propósito en su sesión.
CREATE FUNCTION erp_payments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('erp.allow_payment_delete', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'payments are append-only (% is not allowed)', TG_OP USING ERRCODE = '23000';
END;
$$;
CREATE TRIGGER payments_no_change BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION erp_payments_immutable();
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON "payments" FOR EACH STATEMENT EXECUTE FUNCTION erp_payments_immutable();
