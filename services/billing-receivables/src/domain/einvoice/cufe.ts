import { createHash } from 'crypto';

/** Pesos en pesos con dos decimales y punto, como lo pide el Anexo Técnico de la DIAN: «1000000.00». Los montos de este servicio son enteros. */
export const money = (cop: number): string => {
  if (!Number.isSafeInteger(cop) || cop < 0) throw new RangeError('money must be a non-negative integer number of pesos');
  return `${cop}.00`;
};

export interface CufeInput {
  /** Prefijo + consecutivo, p. ej. «FE1000». */
  number: string;
  /** AAAA-MM-DD en hora de Colombia. */
  issueDate: string;
  /** HH:MM:SS-05:00 en hora de Colombia. */
  issueTime: string;
  subtotalCop: number;
  ivaCop: number;
  totalCop: number;
  /** NIT del emisor sin dígito de verificación. */
  supplierNit: string;
  /** NIT del adquirente sin dígito de verificación. */
  customerNit: string;
  technicalKey: string;
  /** «1» producción, «2» habilitación/pruebas. */
  environmentCode: string;
}

/**
 * CUFE según el Anexo Técnico de la factura electrónica de venta: SHA-384 de la concatenación
 * NumFac + FecFac + HorFac + ValFac + CodImp1 + ValImp1 + CodImp2 + ValImp2 + CodImp3 + ValImp3 + ValTot + NitOFE + NumAdq + ClTec + TipoAmb
 * (01 = IVA; 04 = INC y 03 = ICA van en cero porque este ERP solo cobra IVA). Con la clave técnica de PRUEBA que se configure aquí el resultado NO es un CUFE
 * oficial: solo la DIAN, con la clave técnica de la resolución real, lo puede validar.
 */
export function computeCufe(i: CufeInput): string {
  const raw = [i.number, i.issueDate, i.issueTime, money(i.subtotalCop), '01', money(i.ivaCop), '04', money(0), '03', money(0), money(i.totalCop), i.supplierNit, i.customerNit, i.technicalKey, i.environmentCode].join('');
  return createHash('sha384').update(raw, 'utf8').digest('hex');
}
