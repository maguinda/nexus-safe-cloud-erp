-- IVA 19 % y trazabilidad. Se agregan con valor provisional para poder rellenar las filas que ya existen.
ALTER TABLE "invoices"
  ADD COLUMN "tax_cop" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "total_cop" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approved_by" TEXT,
  ADD COLUMN "approved_at" TIMESTAMP(3);

-- Mismo cálculo que el dominio (enteros, mitades hacia arriba). bigint para que 19 x monto no desborde.
UPDATE "invoices" SET "tax_cop" = (("amount_cop"::bigint * 19 + 50) / 100)::integer;
UPDATE "invoices" SET "total_cop" = "amount_cop" + "tax_cop";

-- Desde ahora toda factura debe traer sus valores calculados (sin valor por omisión)...
ALTER TABLE "invoices" ALTER COLUMN "tax_cop" DROP DEFAULT, ALTER COLUMN "total_cop" DROP DEFAULT;

-- ...y la base se niega a guardar una factura que no cuadre, aunque el código fallara.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amount_positive" CHECK ("amount_cop" > 0),
  ADD CONSTRAINT "invoices_total_consistent" CHECK ("total_cop" = "amount_cop" + "tax_cop"),
  ADD CONSTRAINT "invoices_tax_nonnegative" CHECK ("tax_cop" >= 0);
