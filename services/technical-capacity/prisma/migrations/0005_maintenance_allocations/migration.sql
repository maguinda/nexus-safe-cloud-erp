-- Las órdenes de trabajo (mantenimiento) GASTAN capacidad: una asignación de tipo «maintenance» ligada a la orden (work_order_id, único).
-- Suma bajo la misma regla del 100 % que las asignaciones de proyecto, pero NO es un proyecto: no sale en el equipo del proyecto ni en la rentabilidad.
ALTER TABLE "allocations" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'project';
ALTER TABLE "allocations" ADD COLUMN "work_order_id" UUID;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_kind_check" CHECK ("kind" IN ('project', 'maintenance'));
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_check" CHECK (("kind" = 'maintenance') = ("work_order_id" IS NOT NULL));
CREATE UNIQUE INDEX "allocations_work_order_key" ON "allocations"("work_order_id");
