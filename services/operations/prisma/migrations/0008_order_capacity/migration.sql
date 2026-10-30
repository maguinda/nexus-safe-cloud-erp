-- Una orden de trabajo con responsable de la lista de Capacidad GASTA capacidad: porcentaje y fechas, y el estado de esa reserva.
-- none = sin reserva (sin responsable, o una orden anterior a esta regla); pending = se está confirmando con Capacidad; reserved = Capacidad la aceptó.
ALTER TABLE "work_orders" ADD COLUMN "capacity_percent" INTEGER;
ALTER TABLE "work_orders" ADD COLUMN "capacity_start" DATE;
ALTER TABLE "work_orders" ADD COLUMN "capacity_end" DATE;
ALTER TABLE "work_orders" ADD COLUMN "capacity_state" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_capacity_state_check" CHECK ("capacity_state" IN ('none', 'pending', 'reserved'));
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_capacity_check" CHECK (
  ("capacity_state" = 'none' AND "capacity_percent" IS NULL AND "capacity_start" IS NULL AND "capacity_end" IS NULL)
  OR ("capacity_state" <> 'none' AND "assigned_to_id" IS NOT NULL AND "capacity_percent" BETWEEN 1 AND 100 AND "capacity_start" IS NOT NULL AND "capacity_end" >= "capacity_start"));
