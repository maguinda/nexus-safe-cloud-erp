-- Las funciones del costo con prestaciones (migración 0006) llamaban a otras por su nombre sin esquema. Al RESTAURAR un respaldo, pg_dump/pg_restore corre con el esquema de búsqueda vacío
-- y el CHECK de «engineers» no encontraba la función: la tabla del personal quedaba VACÍA. Con el esquema fijado en cada función, restaurar funciona (y es mejor práctica de seguridad).
CREATE OR REPLACE FUNCTION staff_arl_ppm(pos text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE pos WHEN 'field_technician' THEN 6960 WHEN 'support_technician' THEN 2436 ELSE 522 END
$$;
CREATE OR REPLACE FUNCTION staff_transport_aid(salary integer) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN salary <= 2 * 1750905 THEN 249095 ELSE 0 END
$$;
CREATE OR REPLACE FUNCTION employer_monthly_scaled(salary integer, pos text) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (salary::bigint + staff_transport_aid(salary)) * 100000
       + (salary::bigint + staff_transport_aid(salary)) * 17660
       + salary::bigint * (4170 + 12000 + 4000 + staff_arl_ppm(pos))
$$;
CREATE OR REPLACE FUNCTION employer_daily_cost(salary integer, pos text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ((2 * employer_monthly_scaled(salary, pos) + 2200000) / 4400000)::integer
$$;
