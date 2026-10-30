-- Equipo de cada proyecto, armado SOLO con el evento EngineerAllocated de Technical Capacity (sin llamar a ese servicio).
-- La clave es la asignación: un evento repetido no duplica nada. El enlace con el proyecto es por valor (nombre del proyecto).
CREATE TABLE "project_team" (
  "allocation_id" UUID NOT NULL,
  "engineer_name" TEXT NOT NULL,
  "project_name" TEXT NOT NULL,
  "percent" INTEGER NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "project_team_pkey" PRIMARY KEY ("allocation_id"),
  CONSTRAINT "project_team_percent_check" CHECK ("percent" BETWEEN 1 AND 100),
  CONSTRAINT "project_team_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "project_team_names_check" CHECK (char_length("engineer_name") BETWEEN 1 AND 120 AND char_length("project_name") BETWEEN 1 AND 120)
);
CREATE INDEX "project_team_project_name_idx" ON "project_team" ("project_name");
