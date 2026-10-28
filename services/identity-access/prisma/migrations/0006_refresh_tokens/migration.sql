-- Renovación de sesión: un token opaco por sesión, rotado en cada uso. Del valor solo se guarda su hash.
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "family_expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_family_expires_at_idx" ON "refresh_tokens"("family_expires_at");

-- Si se borra a la persona, se borran sus sesiones.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas que Prisma no expresa: la base rechaza lo que la lógica nunca debería guardar.
-- Un hash SHA-256 en hexadecimal tiene 64 caracteres: nada más corto (un valor en claro) entra por error.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_hash_check" CHECK (length("token_hash") = 64 AND "token_hash" ~ '^[0-9a-f]{64}$');
-- El token no puede durar más que su familia.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_expiry_check" CHECK ("expires_at" <= "family_expires_at");
