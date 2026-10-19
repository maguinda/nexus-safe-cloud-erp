-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued');

-- CreateTable
CREATE TABLE "milestone_facts" (
    "milestone_id" TEXT NOT NULL,
    "project_id" TEXT,
    "project_name" TEXT NOT NULL,
    "milestone_name" TEXT NOT NULL,
    "amount_cop" INTEGER NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "invoice_number" TEXT,
    "invoice_status" "InvoiceStatus",
    "tax_cop" INTEGER,
    "total_cop" INTEGER,
    "drafted_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_facts_pkey" PRIMARY KEY ("milestone_id")
);

-- CreateTable
CREATE TABLE "activity_entries" (
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_entries_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "milestone_facts_project_name_idx" ON "milestone_facts"("project_name");

-- CreateIndex
CREATE INDEX "activity_entries_occurred_at_idx" ON "activity_entries"("occurred_at");

