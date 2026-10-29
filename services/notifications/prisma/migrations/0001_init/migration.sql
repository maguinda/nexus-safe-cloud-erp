-- Notifications: avisos que nacen de eventos y quién ya los leyó.
CREATE TABLE "processed_events" (
  "event_id" UUID NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "audience_roles" TEXT[] NOT NULL,
  "params" JSONB NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('OverdueDetected', 'ThresholdBreached', 'OverAllocationDetected')),
  CONSTRAINT "notifications_severity_check" CHECK ("severity" IN ('info', 'warning', 'critical')),
  CONSTRAINT "notifications_audience_check" CHECK (cardinality("audience_roles") >= 1 AND "audience_roles" <@ ARRAY['project_lead', 'billing_analyst', 'sales', 'manager']::TEXT[])
);
CREATE UNIQUE INDEX "notifications_event_id_key" ON "notifications"("event_id");
CREATE INDEX "notifications_occurred_at_idx" ON "notifications"("occurred_at" DESC);

CREATE TABLE "notification_reads" (
  "notification_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("notification_id", "user_id"),
  CONSTRAINT "notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "notification_reads_user_id_idx" ON "notification_reads"("user_id");
