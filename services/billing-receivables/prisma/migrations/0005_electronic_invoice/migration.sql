-- Factura electrónica (SANDBOX). Solo aditiva: no toca las facturas ya emitidas ni les inventa un documento.

-- A quién se factura: el cliente del proyecto (viene en MilestoneApproved). Nullable: las facturas anteriores no lo tienen.
ALTER TABLE "invoices" ADD COLUMN "client_name" TEXT;

-- Datos fiscales de los clientes. Son datos personales: no viajan por el bus ni van a los registros.
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "dv" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customers_nit_check" CHECK ("nit" ~ '^[0-9]{6,10}$'),
    CONSTRAINT "customers_dv_check" CHECK ("dv" BETWEEN 0 AND 9)
);
CREATE UNIQUE INDEX "customers_key_key" ON "customers"("key");

-- Rango de numeración de la resolución (UNA fila). El consecutivo se toma con UPDATE ... RETURNING dentro de la transacción de generación:
-- sin huecos por rollback (una secuencia sí los deja) y sin pasarse del tope.
CREATE TABLE "einvoice_numbering" (
    "id" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "range_from" INTEGER NOT NULL,
    "range_to" INTEGER NOT NULL,
    "next_number" INTEGER NOT NULL,
    "resolution" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "einvoice_numbering_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "einvoice_numbering_single" CHECK ("id" = 1),
    CONSTRAINT "einvoice_numbering_prefix" CHECK ("prefix" ~ '^[A-Z]{1,6}$'),
    CONSTRAINT "einvoice_numbering_range" CHECK ("range_from" >= 1 AND "range_to" >= "range_from"),
    CONSTRAINT "einvoice_numbering_next" CHECK ("next_number" >= "range_from" AND "next_number" <= "range_to" + 1),
    CONSTRAINT "einvoice_numbering_validity" CHECK ("valid_to" > "valid_from")
);
-- Rango de PRUEBA (sandbox). Una resolución real de la DIAN lo reemplazaría.
INSERT INTO "einvoice_numbering" ("id","prefix","range_from","range_to","next_number","resolution","valid_from","valid_to")
VALUES (1, 'FE', 1000, 1999, 1000, 'SANDBOX-SIN-RESOLUCION', '2026-01-01T05:00:00Z', '2028-01-01T04:59:59Z'); -- 00:00 del 1-ene-2026 a 23:59:59 del 31-dic-2027, hora de Colombia (UTC-5)

CREATE TABLE "electronic_invoices" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "prefix" TEXT NOT NULL,
    "consecutive" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "issue_date" TEXT NOT NULL,
    "issue_time" TEXT NOT NULL,
    "due_date" TEXT NOT NULL,
    "cufe" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "xml" TEXT NOT NULL,
    "qr_text" TEXT NOT NULL,
    "supplier" JSONB NOT NULL,
    "customer" JSONB NOT NULL,
    -- Los montos y nombres de la factura TAL COMO eran al generar: la representación HTML se arma con esto, no con la fila viva de `invoices`.
    "invoice_snapshot" JSONB NOT NULL,
    "provider_ref" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "electronic_invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "electronic_invoices_invoice_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "electronic_invoices_dates_check" CHECK ("issue_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "due_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "issue_time" ~ '^[0-9]{2}:[0-9]{2}:[0-9]{2}-05:00$'),
    CONSTRAINT "electronic_invoices_cufe_check" CHECK ("cufe" ~ '^[0-9a-f]{96}$'),
    CONSTRAINT "electronic_invoices_environment_check" CHECK ("environment" = 'sandbox'),
    -- No existe «accepted»: el sandbox no habla con la DIAN.
    CONSTRAINT "electronic_invoices_status_check" CHECK ("status" IN ('generated','sandbox_simulated')),
    CONSTRAINT "electronic_invoices_submitted_check" CHECK (("status" = 'generated') = ("submitted_at" IS NULL AND "provider_ref" IS NULL)),
    CONSTRAINT "electronic_invoices_number_check" CHECK ("number" = "prefix" || "consecutive"::text)
);
CREATE UNIQUE INDEX "electronic_invoices_invoice_id_key" ON "electronic_invoices"("invoice_id");
CREATE UNIQUE INDEX "electronic_invoices_number_key" ON "electronic_invoices"("number");
CREATE UNIQUE INDEX "electronic_invoices_cufe_key" ON "electronic_invoices"("cufe");
CREATE UNIQUE INDEX "electronic_invoices_prefix_consecutive_key" ON "electronic_invoices"("prefix","consecutive");

-- Un documento generado NO se edita: solo avanza su estado de envío (una vez), y NO se borra. Corregir algo es generar otro documento (nota crédito), nunca
-- cambiar ni quitar este. Borrar solo lo hace el reinicio de la demo y las pruebas, que lo declaran con `erp.allow_einvoice_delete = on` dentro de su transacción.
CREATE FUNCTION "electronic_invoices_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id" OR NEW."prefix" IS DISTINCT FROM OLD."prefix" OR NEW."consecutive" IS DISTINCT FROM OLD."consecutive"
     OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."issue_date" IS DISTINCT FROM OLD."issue_date" OR NEW."issue_time" IS DISTINCT FROM OLD."issue_time"
     OR NEW."due_date" IS DISTINCT FROM OLD."due_date" OR NEW."cufe" IS DISTINCT FROM OLD."cufe" OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."xml" IS DISTINCT FROM OLD."xml" OR NEW."qr_text" IS DISTINCT FROM OLD."qr_text" OR NEW."supplier" IS DISTINCT FROM OLD."supplier"
     OR NEW."customer" IS DISTINCT FROM OLD."customer" OR NEW."invoice_snapshot" IS DISTINCT FROM OLD."invoice_snapshot" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'an electronic invoice document cannot be modified' USING ERRCODE = '23000';
  END IF;
  -- El envío solo avanza (generated -> sandbox_simulated) y, ya enviado, ni el estado ni la referencia ni la fecha cambian.
  IF OLD."status" = 'sandbox_simulated' AND (NEW."status" <> 'sandbox_simulated' OR NEW."provider_ref" IS DISTINCT FROM OLD."provider_ref" OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at") THEN
    RAISE EXCEPTION 'a submitted electronic invoice cannot change' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "electronic_invoices_immutable" BEFORE UPDATE ON "electronic_invoices" FOR EACH ROW EXECUTE FUNCTION "electronic_invoices_immutable"();

CREATE FUNCTION "einvoice_no_delete"() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('erp.allow_einvoice_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'electronic invoice documents cannot be deleted' USING ERRCODE = '23000';
  END IF;
  IF TG_LEVEL = 'ROW' THEN RETURN OLD; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "electronic_invoices_no_delete" BEFORE DELETE ON "electronic_invoices" FOR EACH ROW EXECUTE FUNCTION "einvoice_no_delete"();
CREATE TRIGGER "electronic_invoices_no_truncate" BEFORE TRUNCATE ON "electronic_invoices" FOR EACH STATEMENT EXECUTE FUNCTION "einvoice_no_delete"();

-- Registro de envíos por correo. HOY solo se REGISTRA: no hay servidor de correo conectado.
CREATE TABLE "einvoice_deliveries" (
    "id" UUID NOT NULL,
    "einvoice_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "einvoice_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "einvoice_deliveries_einvoice_fkey" FOREIGN KEY ("einvoice_id") REFERENCES "electronic_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "einvoice_deliveries_channel_check" CHECK ("channel" = 'email'),
    CONSTRAINT "einvoice_deliveries_status_check" CHECK ("status" = 'logged')
);
CREATE INDEX "einvoice_deliveries_einvoice_id_idx" ON "einvoice_deliveries"("einvoice_id");

-- El registro de envíos tampoco se edita ni se borra (solo se agrega).
CREATE FUNCTION "einvoice_deliveries_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'delivery records cannot be modified' USING ERRCODE = '23000'; END IF;
  IF COALESCE(current_setting('erp.allow_einvoice_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'delivery records cannot be deleted' USING ERRCODE = '23000';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "einvoice_deliveries_guard" BEFORE UPDATE OR DELETE ON "einvoice_deliveries" FOR EACH ROW EXECUTE FUNCTION "einvoice_deliveries_guard"();
