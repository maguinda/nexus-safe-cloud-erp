-- Cuándo se creó el hito (lo dice el evento MilestoneCreated). Nullable: los hitos anteriores a ese evento no lo tienen y no cuentan como «pendientes».
ALTER TABLE "milestone_facts" ADD COLUMN "created_at" TIMESTAMP(3);
