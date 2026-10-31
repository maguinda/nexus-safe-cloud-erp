-- Cada hito puede tener un INGENIERO responsable (la persona del personal de Technical Capacity; se guarda por valor: id y nombre) y varias ACTIVIDADES,
-- que el ingeniero crea y se asigna a TÉCNICOS (también por valor). Las órdenes de mantenimiento NO viven aquí: no pertenecen a ningún proyecto.
ALTER TABLE "milestones" ADD COLUMN "owner_id" UUID, ADD COLUMN "owner_name" TEXT;
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_owner_check" CHECK (
  (owner_id IS NULL) = (owner_name IS NULL) AND (owner_name IS NULL OR char_length(owner_name) BETWEEN 2 AND 100)
);
CREATE INDEX "milestones_owner_id_idx" ON "milestones"("owner_id");

CREATE TABLE "milestone_activities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "milestone_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "due_date" DATE,
  "assigned_to" TEXT NOT NULL,
  "assigned_to_id" UUID NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "started_at" TIMESTAMPTZ(6),
  "done_at" TIMESTAMPTZ(6),
  "done_by" TEXT,
  "done_note" TEXT,
  "cancelled_at" TIMESTAMPTZ(6),
  "cancelled_by" TEXT,
  CONSTRAINT "milestone_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "milestone_activities_milestone_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE CASCADE,
  CONSTRAINT "milestone_activities_title_check" CHECK (char_length(title) BETWEEN 3 AND 120),
  CONSTRAINT "milestone_activities_description_check" CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 300),
  CONSTRAINT "milestone_activities_assignee_check" CHECK (char_length(assigned_to) BETWEEN 2 AND 100),
  CONSTRAINT "milestone_activities_status_check" CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  CONSTRAINT "milestone_activities_note_check" CHECK (done_note IS NULL OR char_length(done_note) BETWEEN 1 AND 300),
  -- Las marcas de cierre y de cancelación existen si y solo si el estado lo dice (IS NOT NULL: un NULL no hace fallar un CHECK).
  CONSTRAINT "milestone_activities_done_check" CHECK ((status = 'done') = (done_at IS NOT NULL AND done_by IS NOT NULL)),
  CONSTRAINT "milestone_activities_cancel_check" CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
  CONSTRAINT "milestone_activities_note_only_done_check" CHECK (done_note IS NULL OR status = 'done')
);
CREATE UNIQUE INDEX "milestone_activities_number_key" ON "milestone_activities"("number");
CREATE INDEX "milestone_activities_milestone_id_idx" ON "milestone_activities"("milestone_id");
CREATE INDEX "milestone_activities_assigned_to_id_status_idx" ON "milestone_activities"("assigned_to_id", "status");
