-- El costo de una persona para la empresa NO es solo el sueldo: se suman las prestaciones y la seguridad social (octubre de 2026, empresa exonerada de salud, SENA e ICBF
-- porque gana menos de 10 salarios mínimos). Todo en enteros, en millonésimas de punto (por cien mil), para que SQL y el servicio den EXACTAMENTE lo mismo:
--   · prima + cesantías + intereses de cesantías: 17,66 % del sueldo + auxilio de transporte;  vacaciones: 4,17 % del sueldo
--   · pensión del empleador: 12 %;  caja de compensación: 4 %;  ARL según el riesgo del cargo: clase I 0,522 % (oficina), III 2,436 % (soporte), V 6,96 % (instalación, alturas)
--   · auxilio de transporte de 249.095 si el sueldo no pasa de 2 salarios mínimos (1.750.905 × 2)
-- Los porcentajes salen de blogs y medios de nómina, NO de la norma: un contador debe confirmarlos. Cada año hay que actualizar el salario mínimo y el auxilio.
CREATE OR REPLACE FUNCTION staff_arl_ppm(pos text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE pos WHEN 'field_technician' THEN 6960 WHEN 'support_technician' THEN 2436 ELSE 522 END
$$;
CREATE OR REPLACE FUNCTION staff_transport_aid(salary integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN salary <= 2 * 1750905 THEN 249095 ELSE 0 END
$$;
-- Costo mensual del empleador multiplicado por 100.000 (así no hay decimales).
CREATE OR REPLACE FUNCTION employer_monthly_scaled(salary integer, pos text) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT (salary::bigint + staff_transport_aid(salary)) * 100000
       + (salary::bigint + staff_transport_aid(salary)) * 17660
       + salary::bigint * (4170 + 12000 + 4000 + staff_arl_ppm(pos))
$$;
-- Costo por día hábil: el costo mensual ÷ 22, redondeado al peso (mitad hacia arriba).
CREATE OR REPLACE FUNCTION employer_daily_cost(salary integer, pos text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT ((2 * employer_monthly_scaled(salary, pos) + 2200000) / 4400000)::integer
$$;

ALTER TABLE "engineers" DROP CONSTRAINT "engineers_cost_from_salary_check";
UPDATE "engineers" SET "daily_cost_cop" = employer_daily_cost("monthly_salary_cop", "position") WHERE "monthly_salary_cop" IS NOT NULL;
ALTER TABLE "engineers" ADD CONSTRAINT "engineers_cost_from_salary_check" CHECK (("monthly_salary_cop" IS NULL AND "daily_cost_cop" IS NULL) OR ("monthly_salary_cop" IS NOT NULL AND "daily_cost_cop" = employer_daily_cost("monthly_salary_cop", "position")));
