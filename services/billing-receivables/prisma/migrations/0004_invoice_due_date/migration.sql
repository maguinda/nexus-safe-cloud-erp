-- Fecha de vencimiento: solo las facturas emitidas la tienen (emisión + 30 días de calendario, en UTC).
ALTER TABLE "invoices" ADD COLUMN "due_date" TIMESTAMP(3);

-- Las facturas que ya estaban emitidas reciben su fecha con la misma regla (los timestamps sin zona se guardan en UTC).
UPDATE "invoices" SET "due_date" = "issued_at" + INTERVAL '30 days' WHERE "status" = 'issued';

-- La base se niega a guardar una combinación incoherente, aunque el código fallara:
--   * una factura emitida SIEMPRE tiene fecha de vencimiento, y un borrador NUNCA;
--   * el vencimiento no puede ser anterior a la emisión.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_due_when_issued" CHECK (("status" = 'issued') = ("due_date" IS NOT NULL)),
  ADD CONSTRAINT "invoices_due_after_issue" CHECK ("due_date" IS NULL OR ("issued_at" IS NOT NULL AND "due_date" >= "issued_at"));
