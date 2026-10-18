/** IVA general en Colombia: 19 %. */
export const IVA_PERCENT = 19;

/** Tope del subtotal: con IVA el total (1,19 × tope) sigue cabiendo en un entero de 32 bits de la base de datos. */
export const MAX_SUBTOTAL_COP = 1_000_000_000;

export interface Totals {
  subtotalCop: number;
  taxCop: number;
  totalCop: number;
}

/**
 * Subtotal, IVA y total en pesos enteros. Aritmética entera (sin decimales flotantes): el IVA se redondea al peso más
 * cercano y las mitades suben. Ej.: 50 COP -> 9,5 -> 10; 3 COP -> 0,57 -> 1; 1 COP -> 0,19 -> 0.
 */
export function computeTotals(subtotalCop: number): Totals {
  if (!Number.isInteger(subtotalCop) || subtotalCop < 1 || subtotalCop > MAX_SUBTOTAL_COP) {
    throw new RangeError(`subtotal must be an integer between 1 and ${MAX_SUBTOTAL_COP}`);
  }
  const taxCop = Math.floor((subtotalCop * IVA_PERCENT + 50) / 100);
  return { subtotalCop, taxCop, totalCop: subtotalCop + taxCop };
}
