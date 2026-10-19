-- Segunda capa de defensa para la gestión de usuarios (la primera es el código):
--   * el email se guarda SIEMPRE en minúsculas, así «unique» vale también sin distinguir mayúsculas;
--   * tamaños razonables de email y nombre (los mismos topes que valida la API y la web).
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_email_length" CHECK (char_length("email") BETWEEN 3 AND 254),
  ADD CONSTRAINT "users_name_length" CHECK (char_length("name") BETWEEN 1 AND 120);
