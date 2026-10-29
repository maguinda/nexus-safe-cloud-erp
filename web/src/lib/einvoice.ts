import type { MsgKey } from '../i18n';
import type { EInvoiceListStatus } from './types';

export type ChipTone = 'neutral' | 'warn' | 'ok';

/** Cómo se dice cada estado del documento electrónico. Ninguno dice «aceptada» ni «válida»: el sandbox no habla con la DIAN. */
export const E_STATUS: Record<EInvoiceListStatus, { label: MsgKey; tone: ChipTone }> = {
  not_issued: { label: 'einv.status.not_issued', tone: 'neutral' },
  not_applicable: { label: 'einv.status.not_applicable', tone: 'neutral' },
  pending_customer_data: { label: 'einv.status.pending_customer_data', tone: 'warn' },
  ready: { label: 'einv.status.ready', tone: 'warn' },
  generated: { label: 'einv.status.generated', tone: 'ok' },
  sandbox_simulated: { label: 'einv.status.sandbox_simulated', tone: 'ok' },
};

/** Las facturas que tienen algo que hacer o que mostrar en el panel: las emitidas (un borrador todavía no se puede convertir). */
export const forPanel = <T extends { status: string }>(invoices: T[]): T[] => invoices.filter((i) => i.status === 'issued');

/** Qué acciones ofrece cada estado. */
export const actionsFor = (s: EInvoiceListStatus): { data: boolean; generate: boolean; view: boolean; submit: boolean; deliver: boolean } => ({
  data: s === 'pending_customer_data' || s === 'ready',
  generate: s === 'ready',
  view: s === 'generated' || s === 'sandbox_simulated',
  submit: s === 'generated',
  deliver: s === 'generated' || s === 'sandbox_simulated',
});

/** Nombre del archivo que se descarga: solo letras y dígitos del número del documento (viene del servidor, pero no se confía en él para armar un nombre de archivo). */
export const xmlFileName = (number: string): string => `${number.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'factura'}.xml`;

// ---- validación del formulario de datos fiscales: los MISMOS criterios del servidor (domain/einvoice/customer.ts), para que un rechazo se vea antes y con aviso propio.

const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
/** Dígito de verificación del NIT (módulo 11 de la DIAN). */
export function nitCheckDigit(nit: string): number {
  let sum = 0;
  for (let i = 0; i < nit.length; i++) sum += Number(nit[nit.length - 1 - i]) * WEIGHTS[i];
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

export const FIELD_MAX = { nit: 16, email: 254, address: 200, city: 80 } as const;
const EMAIL = /^[^\s@<>"',;:\\()[\]]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export type FormErrors = Partial<Record<'nit' | 'email' | 'address' | 'city', 'required' | 'nitInvalid' | 'emailInvalid' | 'textInvalid'>>;

/** Qué campos están mal (clave del texto que se muestra). Los textos se limpian como en el servidor: espacios repetidos a uno. */
export function validateFiscalForm(f: { nit: string; email: string; address: string; city: string }): FormErrors {
  const e: FormErrors = {};
  const nit = f.nit.replace(/[.\s]/g, '');
  if (!nit) e.nit = 'required';
  else if (!/^[0-9]{6,10}(-[0-9])?$/.test(nit)) e.nit = 'nitInvalid';
  else { const [n, dv] = nit.split('-'); if (dv !== undefined && Number(dv) !== nitCheckDigit(n)) e.nit = 'nitInvalid'; }
  const email = f.email.trim().toLowerCase();
  if (!email) e.email = 'required'; else if (email.length > FIELD_MAX.email || !EMAIL.test(email)) e.email = 'emailInvalid';
  for (const k of ['address', 'city'] as const) {
    const v = f[k].replace(/\s+/g, ' ').trim();
    if (!v) e[k] = 'required'; else if (v.length > FIELD_MAX[k] || CONTROL.test(v)) e[k] = 'textInvalid';
  }
  return e;
}
