-- Technical Capacity: ingenieros, asignaciones por período y outbox.
CREATE TABLE "engineers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "certifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "engineers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "engineer_id" UUID NOT NULL,
  "project_name" TEXT NOT NULL,
  "percent" INTEGER NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "over_allocated" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "allocations_percent_check" CHECK ("percent" BETWEEN 1 AND 100),
  CONSTRAINT "allocations_period_check" CHECK ("end_date" >= "start_date"),
  CONSTRAINT "allocations_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "allocations_engineer_id_start_date_end_date_idx" ON "allocations"("engineer_id", "start_date", "end_date");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "routing_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMP(3),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outbox_events_aggregate_id_type_key" ON "outbox_events"("aggregate_id", "type");
CREATE INDEX "outbox_events_published_at_idx" ON "outbox_events"("published_at");
