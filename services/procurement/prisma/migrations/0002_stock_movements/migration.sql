-- Historial de movimientos de stock: una fila por cada cambio (apertura, recepción de pedido, ajuste manual), en la MISMA transacción que mueve el stock.
-- Solo se agrega (la base impide editar o borrar). No lleva llave foránea: el historial conserva el nombre del artículo aunque el artículo desaparezca.
CREATE TABLE "stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "item_id" UUID NOT NULL,
  "item_name" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "on_hand_after" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actor" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_movements_delta_check" CHECK ("delta" <> 0),
  CONSTRAINT "stock_movements_after_check" CHECK ("on_hand_after" >= 0),
  CONSTRAINT "stock_movements_source_check" CHECK ("source" IN ('opening', 'purchase_received', 'adjustment')),
  CONSTRAINT "stock_movements_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 200)
);
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" ("item_id", "created_at" DESC);
CREATE INDEX "stock_movements_created_idx" ON "stock_movements" ("created_at" DESC, "id");
CREATE OR REPLACE FUNCTION erp_stock_movements_immutable() RETURNS trigger AS $$
BEGIN
  IF current_setting('erp.allow_movement_delete', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stock_movements is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_movements_no_change BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION erp_stock_movements_immutable();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON "stock_movements" FOR EACH STATEMENT EXECUTE FUNCTION erp_stock_movements_immutable();
-- El stock que ya existía entra como «apertura», para que el historial sume el saldo.
INSERT INTO "stock_movements" ("item_id", "item_name", "delta", "on_hand_after", "source", "reason")
SELECT "id", "name", "on_hand", "on_hand", 'opening', 'Saldo inicial' FROM "items" WHERE "on_hand" > 0;
