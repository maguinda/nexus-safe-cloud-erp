-- Cotizaciones: ventas arma un proyecto con hitos y costos (materiales, insumos y mano de obra), pone el margen y gerencia aprueba.
-- Al aprobar nace el proyecto con sus hitos (aquí) y el contrato (Billing, por el evento QuoteApproved).
CREATE TABLE "quotes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "client" TEXT NOT NULL,
  "project_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "margin_pct" INTEGER NOT NULL DEFAULT 25,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "submitted_at" TIMESTAMPTZ(6),
  "decided_by" TEXT,
  "decided_at" TIMESTAMPTZ(6),
  "decision_note" TEXT,
  "project_id" TEXT,
  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotes_status_check" CHECK ("status" IN ('draft', 'pending', 'approved', 'rejected')),
  CONSTRAINT "quotes_margin_check" CHECK ("margin_pct" BETWEEN 0 AND 100),
  -- Solo una cotización aprobada tiene proyecto, y toda aprobada lo tiene.
  CONSTRAINT "quotes_project_check" CHECK (("status" = 'approved') = ("project_id" IS NOT NULL)),
  -- Aprobada o rechazada: dice quién y cuándo. Un rechazo explica por qué.
  CONSTRAINT "quotes_decision_check" CHECK (("status" IN ('approved', 'rejected')) = ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL) OR "status" = 'draft'),
  CONSTRAINT "quotes_reject_note_check" CHECK ("status" <> 'rejected' OR ("decision_note" IS NOT NULL AND length("decision_note") >= 3))
);
CREATE UNIQUE INDEX "quotes_number_key" ON "quotes"("number");
CREATE INDEX "quotes_created_by_idx" ON "quotes"("created_by");

CREATE TABLE "quote_milestones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "quote_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "quote_milestones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_milestones_quote_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE,
  CONSTRAINT "quote_milestones_position_check" CHECK ("position" BETWEEN 1 AND 30)
);
CREATE UNIQUE INDEX "quote_milestones_position_key" ON "quote_milestones"("quote_id", "position");

CREATE TABLE "quote_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "milestone_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost_cop" INTEGER NOT NULL,
  "ref" TEXT,
  CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_lines_milestone_fkey" FOREIGN KEY ("milestone_id") REFERENCES "quote_milestones"("id") ON DELETE CASCADE,
  CONSTRAINT "quote_lines_category_check" CHECK ("category" IN ('materials', 'supplies', 'labor')),
  CONSTRAINT "quote_lines_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100000),
  CONSTRAINT "quote_lines_unit_check" CHECK ("unit_cost_cop" BETWEEN 1 AND 1000000000),
  CONSTRAINT "quote_lines_position_check" CHECK ("position" BETWEEN 1 AND 40)
);
CREATE UNIQUE INDEX "quote_lines_position_key" ON "quote_lines"("milestone_id", "position");
