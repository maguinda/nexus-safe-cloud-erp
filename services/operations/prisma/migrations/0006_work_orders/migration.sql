-- Órdenes de trabajo (OT-0001…) de inspección, mantenimiento preventivo o correctivo, creadas desde una alerta o un equipo del monitoreo.
CREATE TABLE "work_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "target_kind" TEXT NOT NULL,
  "target_ref" TEXT NOT NULL,
  "target_name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "source_note" TEXT,
  "due_date" DATE,
  "assigned_to" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "closed_by" TEXT,
  "closed_at" TIMESTAMPTZ(6),
  CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_orders_type_check" CHECK ("type" IN ('inspection', 'preventive', 'corrective')),
  CONSTRAINT "work_orders_status_check" CHECK ("status" IN ('open', 'in_progress', 'done', 'cancelled')),
  CONSTRAINT "work_orders_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT "work_orders_target_check" CHECK ("target_kind" IN ('sensor', 'device')),
  CONSTRAINT "work_orders_description_check" CHECK (char_length("description") BETWEEN 3 AND 300),
  CONSTRAINT "work_orders_assigned_check" CHECK ("assigned_to" IS NULL OR char_length("assigned_to") BETWEEN 2 AND 80),
  CONSTRAINT "work_orders_closed_check" CHECK (("status" IN ('open', 'in_progress') AND "closed_at" IS NULL) OR ("status" IN ('done', 'cancelled') AND "closed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "work_orders_number_key" ON "work_orders" ("number");
-- Una sola orden ABIERTA por equipo y tipo: dos clics a la vez no crean dos.
CREATE UNIQUE INDEX "work_orders_one_open_key" ON "work_orders" ("target_kind", "target_ref", "type") WHERE "status" IN ('open', 'in_progress');
CREATE INDEX "work_orders_status_idx" ON "work_orders" ("status", "created_at" DESC);

-- Historial de cada cambio de estado (quién, cuándo y la nota). Solo se agrega.
CREATE TABLE "work_order_log" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "actor" TEXT,
  "note" TEXT,
  "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "work_order_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_order_log_order_fk" FOREIGN KEY ("order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE,
  CONSTRAINT "work_order_log_note_check" CHECK ("note" IS NULL OR char_length("note") <= 300)
);
CREATE INDEX "work_order_log_order_idx" ON "work_order_log" ("order_id", "at");
