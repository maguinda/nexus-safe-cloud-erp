-- Personal técnico: cargo (catálogo fijo), tipo (ingeniero o técnico) y sueldo MENSUAL de nómina.
-- El costo diario (daily_cost_cop) pasa a ser DERIVADO: sueldo mensual ÷ 22 días hábiles, redondeado. Lo usa Analytics para la rentabilidad.
ALTER TABLE "engineers" ADD COLUMN "position" TEXT;
ALTER TABLE "engineers" ADD COLUMN "kind" TEXT;
ALTER TABLE "engineers" ADD COLUMN "monthly_salary_cop" INTEGER;

UPDATE "engineers" SET "position" = CASE
  WHEN "role" ILIKE '%network%' THEN 'network_engineer'
  WHEN "role" ILIKE '%security%' THEN 'security_engineer'
  WHEN "role" ILIKE '%cloud%' OR "role" ILIKE '%devops%' THEN 'cloud_devops_engineer'
  WHEN "role" ILIKE '%lead%' OR "role" ILIKE '%architect%' THEN 'tech_lead'
  WHEN "role" ILIKE '%technician%' AND "role" ILIKE '%support%' THEN 'support_technician'
  WHEN "role" ILIKE '%technician%' THEN 'field_technician'
  ELSE 'software_engineer' END;
UPDATE "engineers" SET "kind" = CASE WHEN "position" IN ('field_technician', 'support_technician') THEN 'technician' ELSE 'engineer' END;
-- Lo que ya tenía costo diario conserva el mismo costo: sueldo = diario × 22.
UPDATE "engineers" SET "monthly_salary_cop" = "daily_cost_cop" * 22 WHERE "daily_cost_cop" IS NOT NULL;

ALTER TABLE "engineers" ALTER COLUMN "position" SET NOT NULL;
ALTER TABLE "engineers" ALTER COLUMN "kind" SET NOT NULL;
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_position_check" CHECK ("position" IN ('software_engineer', 'cloud_devops_engineer', 'security_engineer', 'network_engineer', 'tech_lead', 'field_technician', 'support_technician'));
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_kind_check" CHECK (("position" IN ('field_technician', 'support_technician') AND "kind" = 'technician') OR ("position" NOT IN ('field_technician', 'support_technician') AND "kind" = 'engineer'));
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_salary_check" CHECK ("monthly_salary_cop" IS NULL OR "monthly_salary_cop" BETWEEN 1 AND 200000000);
-- La base misma impide un costo diario que no salga del sueldo.
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_cost_from_salary_check" CHECK (("monthly_salary_cop" IS NULL AND "daily_cost_cop" IS NULL) OR ("monthly_salary_cop" IS NOT NULL AND "daily_cost_cop" = round("monthly_salary_cop" / 22.0)));
