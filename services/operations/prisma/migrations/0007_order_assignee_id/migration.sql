-- El responsable de una orden se elige de la lista del personal de Capacidad: además del nombre se guarda su id (Operations no verifica que exista en el otro servicio; lo garantiza la lista de la pantalla).
ALTER TABLE "work_orders" ADD COLUMN "assigned_to_id" UUID;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assignee_check" CHECK ("assigned_to_id" IS NULL OR "assigned_to" IS NOT NULL);
