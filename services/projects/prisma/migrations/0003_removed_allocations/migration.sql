-- Asignaciones que Technical Capacity anunció como quitadas (AllocationRemoved). Sirve para que, si el aviso de quitar llega ANTES que el de asignar,
-- la asignación no reaparezca en el equipo.
CREATE TABLE "removed_allocations" (
  "allocation_id" UUID NOT NULL,
  "removed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "removed_allocations_pkey" PRIMARY KEY ("allocation_id")
);
