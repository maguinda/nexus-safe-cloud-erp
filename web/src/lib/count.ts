import type { TFn } from '../i18n';
export const MAX_COUNTED = 1_000_000;
/** Mismo criterio que el servidor: entero de 0 a 1.000.000. */
export function checkCounted(t: TFn, text: string): { error?: string; value?: number } {
  const v = text.trim();
  if (!/^\d{1,7}$/.test(v) || Number(v) > MAX_COUNTED) return { error: t('count.v.counted') };
  return { value: Number(v) };
}
