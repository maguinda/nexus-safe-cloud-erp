-- Nómina mensual: una corrida por mes con una FOTO de cada persona (sueldo, auxilio, prestaciones, pensión, caja, ARL y costo para la empresa).
-- Las líneas no se editan ni se borran (solo agregar), la corrida no se borra y solo pasa una vez de «generada» a «pagada».
CREATE TABLE "payroll_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "period" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'generated',
  "total_cop" BIGINT NOT NULL,
  "headcount" INTEGER NOT NULL,
  "generated_by" TEXT NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "paid_by" TEXT,
  "paid_at" TIMESTAMPTZ(6),
  CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_runs_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "payroll_runs_status_check" CHECK ("status" IN ('generated', 'paid')),
  CONSTRAINT "payroll_runs_total_check" CHECK ("total_cop" > 0 AND "headcount" > 0),
  CONSTRAINT "payroll_runs_paid_check" CHECK (("status" = 'paid') = ("paid_by" IS NOT NULL AND "paid_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "payroll_runs_period_key" ON "payroll_runs"("period");

CREATE TABLE "payroll_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "engineer_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "salary_cop" INTEGER NOT NULL,
  "transport_aid_cop" INTEGER NOT NULL,
  "prestaciones_cop" INTEGER NOT NULL,
  "pension_cop" INTEGER NOT NULL,
  "caja_cop" INTEGER NOT NULL,
  "arl_cop" INTEGER NOT NULL,
  "employer_cost_cop" INTEGER NOT NULL,
  CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_lines_run_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id"),
  CONSTRAINT "payroll_lines_amounts_check" CHECK ("salary_cop" > 0 AND "transport_aid_cop" >= 0 AND "prestaciones_cop" >= 0 AND "pension_cop" >= 0 AND "caja_cop" >= 0 AND "arl_cop" >= 0 AND "employer_cost_cop" >= "salary_cop")
);
CREATE UNIQUE INDEX "payroll_lines_person_key" ON "payroll_lines"("run_id", "engineer_id");

-- Solo agregar: ni UPDATE ni DELETE en las líneas; la corrida no se borra y su único cambio permitido es generada → pagada.
CREATE OR REPLACE FUNCTION payroll_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'payroll lines are append-only'; END $$;
CREATE TRIGGER payroll_lines_no_change BEFORE UPDATE OR DELETE ON "payroll_lines" FOR EACH ROW EXECUTE FUNCTION payroll_lines_immutable();
CREATE OR REPLACE FUNCTION payroll_runs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payroll runs cannot be deleted'; END IF;
  IF OLD.status <> 'generated' OR NEW.status <> 'paid' OR NEW.period <> OLD.period OR NEW.total_cop <> OLD.total_cop OR NEW.headcount <> OLD.headcount OR NEW.generated_by <> OLD.generated_by OR NEW.generated_at <> OLD.generated_at THEN
    RAISE EXCEPTION 'a payroll run can only go from generated to paid, once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_runs_no_change BEFORE UPDATE OR DELETE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION payroll_runs_guard();
