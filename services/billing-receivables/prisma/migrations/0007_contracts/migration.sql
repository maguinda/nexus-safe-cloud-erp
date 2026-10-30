-- Contratos con el cliente. Los hitos y facturas se enlazan por valor (nombre del proyecto), igual que el resto de servicios: sin llaves entre bases.
CREATE TABLE "contracts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_name" TEXT NOT NULL,
  "project_name" TEXT NOT NULL,
  "amount_cop" INTEGER NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by" TEXT NOT NULL,
  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contracts_amount_check" CHECK ("amount_cop" > 0),
  CONSTRAINT "contracts_dates_check" CHECK ("end_date" >= "start_date"),
  CONSTRAINT "contracts_status_check" CHECK ("status" IN ('active', 'closed', 'cancelled')),
  CONSTRAINT "contracts_names_check" CHECK (char_length("client_name") BETWEEN 2 AND 120 AND char_length("project_name") BETWEEN 2 AND 120)
);
CREATE INDEX "contracts_project_name_idx" ON "contracts" ("project_name");
