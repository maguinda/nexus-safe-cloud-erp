-- Asignaciones de ingenieros a proyectos, armadas SOLO con los eventos EngineerAllocated / AllocationRemoved de Technical Capacity.
-- Con ellas y los hechos de facturación se calcula la rentabilidad por proyecto (enlace por valor: el nombre del proyecto).
CREATE TABLE "allocation_facts" (
  "allocation_id" UUID NOT NULL,
  "project_name" TEXT NOT NULL,
  "engineer_name" TEXT NOT NULL,
  "percent" INTEGER NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "daily_cost_cop" INTEGER,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "allocation_facts_pkey" PRIMARY KEY ("allocation_id"),
  CONSTRAINT "allocation_facts_percent_check" CHECK ("percent" BETWEEN 1 AND 100),
  CONSTRAINT "allocation_facts_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "allocation_facts_cost_check" CHECK ("daily_cost_cop" IS NULL OR "daily_cost_cop" BETWEEN 1 AND 50000000)
);
CREATE INDEX "allocation_facts_project_name_idx" ON "allocation_facts" ("project_name");
-- Marcas de asignaciones quitadas: si el aviso de quitar llega antes que el de asignar, la asignación no reaparece.
CREATE TABLE "removed_allocation_marks" (
  "allocation_id" UUID NOT NULL,
  "removed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "removed_allocation_marks_pkey" PRIMARY KEY ("allocation_id")
);
