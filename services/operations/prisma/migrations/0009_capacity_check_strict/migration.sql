-- La regla de la reserva de capacidad dejaba pasar un porcentaje NULL (en un CHECK, NULL no es un fallo): se exige explícitamente que no sea NULL.
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_capacity_check";
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_capacity_check" CHECK (
  ("capacity_state" = 'none' AND "capacity_percent" IS NULL AND "capacity_start" IS NULL AND "capacity_end" IS NULL)
  OR ("capacity_state" <> 'none' AND "assigned_to_id" IS NOT NULL AND "capacity_percent" IS NOT NULL AND "capacity_percent" BETWEEN 1 AND 100
      AND "capacity_start" IS NOT NULL AND "capacity_end" IS NOT NULL AND "capacity_end" >= "capacity_start"));
