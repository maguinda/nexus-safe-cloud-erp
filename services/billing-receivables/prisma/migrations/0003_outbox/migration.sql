-- Bandeja de salida (outbox) de billing: mismos campos y restricciones que la de projects.
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

CREATE INDEX "outbox_events_published_at_idx" ON "outbox_events"("published_at");
CREATE UNIQUE INDEX "outbox_events_aggregate_id_type_key" ON "outbox_events"("aggregate_id", "type");
