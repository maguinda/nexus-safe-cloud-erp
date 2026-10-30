import type { TFn } from '../i18n';

/** Mismos criterios que el servidor (domain/engineer.ts): pesos enteros de 1 a 50.000.000; vacío = quitar el costo. */
export const MAX_DAILY_COST = 50_000_000;
export function checkDailyCost(t: TFn, text: string): { error?: string; value?: number | null } {
  const v = text.trim();
  if (v === '') return { value: null };
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > MAX_DAILY_COST) return { error: t('cost.v.cost', { max: MAX_DAILY_COST.toLocaleString('es-CO') }) };
  return { value: Number(v) };
}
