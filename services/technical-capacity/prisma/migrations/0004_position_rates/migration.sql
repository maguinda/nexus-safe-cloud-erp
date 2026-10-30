-- Tarifa de referencia por cargo (sueldo mensual de nómina estimado del mercado colombiano, octubre de 2026). Sirve para cotizar ANTES de saber quién irá al proyecto:
-- el costo por día hábil es sueldo ÷ 22. Gerencia la puede ajustar. Son estimados, no cifras oficiales: las fuentes varían mucho (ver el campo note).
CREATE TABLE "position_rates" (
  "position" TEXT NOT NULL,
  "monthly_salary_cop" INTEGER NOT NULL,
  "note" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_by" TEXT,
  CONSTRAINT "position_rates_pkey" PRIMARY KEY ("position"),
  CONSTRAINT "position_rates_position_check" CHECK ("position" IN ('software_engineer', 'cloud_devops_engineer', 'security_engineer', 'network_engineer', 'tech_lead', 'field_technician', 'support_technician')),
  CONSTRAINT "position_rates_salary_check" CHECK ("monthly_salary_cop" BETWEEN 1 AND 200000000),
  CONSTRAINT "position_rates_note_check" CHECK (length("note") BETWEEN 3 AND 400)
);
INSERT INTO "position_rates" ("position", "monthly_salary_cop", "note") VALUES
  ('software_engineer', 5500000, 'Estimado oct-2026. Promedio nacional ~5 millones (Indeed Colombia, ~68 salarios); junior 3-4,5 y nivel medio 5-8 millones; Medellín ~7,5.'),
  ('cloud_devops_engineer', 8000000, 'Estimado oct-2026. Rango 6-12 millones (Pulzo; oferta de ingeniero cloud 6-8 millones en Elempleo). Indeed da ~4,7 con solo 8 datos.'),
  ('security_engineer', 6000000, 'Estimado oct-2026. Ingeniero de seguridad ~3,2 y especialista ~4,3 (Magneto); 5-10 millones para expertos (Pulzo); analista junior Bogotá 3,5-6.'),
  ('network_engineer', 5000000, 'Estimado oct-2026. Promedio ~4,65 (Magneto); ofertas 3,8-4,5 (Medellín) y 6-8 millones (Cali).'),
  ('tech_lead', 10000000, 'Estimado oct-2026. Tech lead en la nube Bogotá 8-10 millones (Elempleo); líder técnico ~8,3 y arquitecto ~9,3 (Talentup, Payscale); senior internacional >12.'),
  ('field_technician', 2400000, 'Estimado oct-2026. Ofertas de técnico de cableado e instalación en Bogotá 2-2,5 millones (Elempleo); el mínimo de 2026 es 1.750.905.'),
  ('support_technician', 2600000, 'Estimado oct-2026. Técnico de soporte TI en Bogotá 1,5-3,2 millones (Elempleo, Cazvid); promedio ~1,9 (Magneto).');
