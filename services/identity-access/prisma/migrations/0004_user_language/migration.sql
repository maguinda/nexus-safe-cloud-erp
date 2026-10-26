-- Idioma de la interfaz de cada persona. Aditiva: las filas que ya existen quedan en español (el valor por defecto).
ALTER TABLE "users" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'es';
ALTER TABLE "users" ADD CONSTRAINT "users_language_check" CHECK ("language" IN ('es', 'en'));
