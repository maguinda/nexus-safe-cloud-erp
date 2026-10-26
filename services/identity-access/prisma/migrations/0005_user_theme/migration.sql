-- Tema de la interfaz de cada persona (Sistema, Claro u Oscuro). Aditiva: las filas que ya existen quedan en «system» (siguen el modo de su equipo).
ALTER TABLE "users" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "users" ADD CONSTRAINT "users_theme_check" CHECK ("theme" IN ('system', 'light', 'dark'));
