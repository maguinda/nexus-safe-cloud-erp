-- Roles de ingeniero y de técnico: personas del personal técnico que inician sesión y ven SOLO su trabajo.
-- Cada cuenta de esos roles queda ligada a UNA persona del personal de Capacidad (staff_id); Identity no puede verificar que exista en el otro servicio: lo garantiza la lista de la pantalla.
ALTER TYPE "Role" ADD VALUE 'engineer';
ALTER TYPE "Role" ADD VALUE 'technician';
ALTER TABLE "users" ADD COLUMN "staff_id" UUID;
CREATE UNIQUE INDEX "users_staff_id_key" ON "users"("staff_id");
-- Comparado como texto: un valor nuevo de un enum no se puede usar en la misma transacción que lo crea.
ALTER TABLE "users" ADD CONSTRAINT "users_staff_role_check" CHECK (("role"::text IN ('engineer', 'technician')) = ("staff_id" IS NOT NULL));
