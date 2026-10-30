import type { TFn } from '../i18n';

/** Mismos criterios que el servidor (domain/engineer.ts): sueldo mensual en pesos enteros de 1 a 200.000.000; vacío = quitarlo. */
export const MAX_SALARY = 200_000_000;
export const WORKING_DAYS_PER_MONTH = 22;
/** Costo por día hábil que calcula el servidor: sueldo ÷ 22, redondeado (mitad hacia arriba). */
export const dailyFromSalary = (salary: number): number => Math.floor((salary * 2 + WORKING_DAYS_PER_MONTH) / (WORKING_DAYS_PER_MONTH * 2));
export function checkSalary(t: TFn, text: string): { error?: string; value?: number | null } {
  const v = text.trim();
  if (v === '') return { value: null };
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > MAX_SALARY) return { error: t('cost.v.cost', { max: MAX_SALARY.toLocaleString('es-CO') }) };
  return { value: Number(v) };
}
