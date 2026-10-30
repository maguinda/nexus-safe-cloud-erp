-- Lo pagado contra la factura de cada hito (evento PaymentReceived de billing).
ALTER TABLE "milestone_facts" ADD COLUMN "paid_cop" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "milestone_facts" ADD CONSTRAINT "milestone_facts_paid_cop_check" CHECK ("paid_cop" >= 0);
