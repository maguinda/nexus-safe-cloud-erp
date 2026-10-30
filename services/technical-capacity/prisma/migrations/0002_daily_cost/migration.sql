-- Costo diario del ingeniero (lo escribe gerencia). Es opcional: sin costo, la rentabilidad del proyecto avisa que está incompleta.
ALTER TABLE "engineers" ADD COLUMN "daily_cost_cop" INTEGER;
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_daily_cost_check" CHECK ("daily_cost_cop" IS NULL OR "daily_cost_cop" BETWEEN 1 AND 50000000);
