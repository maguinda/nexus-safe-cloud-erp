-- Bitácora de auditoría: una fila por cada evento que circula por el bus (quién lo hizo si el evento lo dice, qué pasó y cuándo).
-- Solo se agrega: la base impide editar o borrar (la limpieza de pruebas usa la bandera erp.allow_audit_delete).
CREATE TABLE "audit_entries" (
  "event_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "actor" TEXT,
  "summary" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "audit_entries_type_check" CHECK ("type" ~ '^[A-Za-z]{1,60}$'),
  CONSTRAINT "audit_entries_summary_check" CHECK (char_length("summary") BETWEEN 1 AND 300)
);
CREATE INDEX "audit_entries_occurred_at_idx" ON "audit_entries" ("occurred_at" DESC, "event_id");
CREATE INDEX "audit_entries_type_idx" ON "audit_entries" ("type");
CREATE OR REPLACE FUNCTION erp_audit_immutable() RETURNS trigger AS $$
BEGIN
  IF current_setting('erp.allow_audit_delete', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_entries_no_change BEFORE UPDATE OR DELETE ON "audit_entries" FOR EACH ROW EXECUTE FUNCTION erp_audit_immutable();
CREATE TRIGGER audit_entries_no_truncate BEFORE TRUNCATE ON "audit_entries" FOR EACH STATEMENT EXECUTE FUNCTION erp_audit_immutable();
