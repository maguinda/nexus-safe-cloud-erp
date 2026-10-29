-- Cuándo se supo que la factura del hito venció (evento InvoiceOverdue de billing). Nullable: solo las facturas que ya pasaron su vencimiento lo tienen.
ALTER TABLE "milestone_facts" ADD COLUMN "overdue_at" TIMESTAMP(3);
ALTER TABLE "milestone_facts" ADD COLUMN "overdue_days" INTEGER;
ALTER TABLE "milestone_facts" ADD CONSTRAINT "milestone_facts_overdue_check" CHECK (("overdue_at" IS NULL) = ("overdue_days" IS NULL) AND ("overdue_days" IS NULL OR "overdue_days" >= 1));
