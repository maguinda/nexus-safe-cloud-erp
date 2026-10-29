-- Estado de alerta por dispositivo (para avisar una vez cuando EMPEORA) y outbox de eventos.
ALTER TABLE "iot_devices" ADD COLUMN "alert_state" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "iot_devices" ADD COLUMN "alert_state_at" TIMESTAMP(3);
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_alert_state_check" CHECK ("alert_state" IN ('normal', 'warning', 'alert'));

-- Estado inicial desde la ÚLTIMA lectura de cada dispositivo: sin esto, al desplegar todo dispositivo que ya estaba en alerta avisaría de golpe.
UPDATE "iot_devices" d
SET "alert_state" = CASE l."status" WHEN 'ALERT' THEN 'alert' WHEN 'WARNING' THEN 'warning' ELSE 'normal' END,
    "alert_state_at" = l."recorded_at"
FROM (SELECT DISTINCT ON ("device_id") "device_id", "status", "recorded_at" FROM "iot_readings" ORDER BY "device_id", "recorded_at" DESC) l
WHERE l."device_id" = d."id";

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
