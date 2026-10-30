-- Enlace real entre contratos, facturas y proyectos: el id del proyecto (el de Projects), no solo su nombre.
-- En las facturas lo trae MilestoneApproved; las anteriores a este cambio quedan en NULL y se siguen enlazando por nombre.
ALTER TABLE "invoices" ADD COLUMN "project_id" TEXT;
ALTER TABLE "contracts" ADD COLUMN "project_id" TEXT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_check" CHECK ("project_id" IS NULL OR "project_id" ~ '^[A-Za-z0-9_-]{1,64}$');
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_check" CHECK ("project_id" IS NULL OR "project_id" ~ '^[A-Za-z0-9_-]{1,64}$');
CREATE INDEX "invoices_project_id_idx" ON "invoices" ("project_id");
CREATE INDEX "contracts_project_id_idx" ON "contracts" ("project_id");
