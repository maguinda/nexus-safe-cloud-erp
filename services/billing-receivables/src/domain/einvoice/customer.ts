import { InvalidCustomerError } from '../errors';
import { nitCheckDigit } from './nit';

/** Datos fiscales de a quién se factura. Son datos personales (NIT, correo, dirección): no van por el bus ni a los registros. */
export interface FiscalCustomer {
  name: string;
  nit: string;
  dv: number;
  email: string;
  address: string;
  city: string;
}

// Sin caracteres de control ni separadores de línea/párrafo: terminan en XML y en HTML.
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const EMAIL = /^[^\s@<>"',;:\\()[\]]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') throw new InvalidCustomerError(`${field} must be text`);
  const t = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (t.length === 0 || t.length > max || BAD_CHARS.test(t)) throw new InvalidCustomerError(`${field} must be 1 to ${max} characters without control characters`);
  return t;
}

/** Lo único que se acepta de afuera: nombre (el del cliente del proyecto), NIT con su DV (opcional: si viene debe cuadrar), correo, dirección y ciudad. */
export function validateCustomer(raw: unknown): FiscalCustomer {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidCustomerError('body must be an object');
  const r = raw as Record<string, unknown>;
  const name = text(r.name, 'name', 120);
  const nitText = typeof r.nit === 'string' ? r.nit.replace(/[.\s]/g, '') : r.nit;
  if (typeof nitText !== 'string' || !/^[0-9]{6,10}(-[0-9])?$/.test(nitText)) throw new InvalidCustomerError('nit must be 6 to 10 digits, optionally followed by -DV');
  const [nit, dvText] = nitText.split('-');
  const dv = nitCheckDigit(nit);
  if (dvText !== undefined && Number(dvText) !== dv) throw new InvalidCustomerError('the check digit of the NIT is wrong');
  const email = text(r.email, 'email', 254).toLowerCase();
  if (!EMAIL.test(email)) throw new InvalidCustomerError('email is not valid');
  return { name, nit, dv, email, address: text(r.address, 'address', 200), city: text(r.city, 'city', 80) };
}

/** Clave para buscar al cliente por el nombre que trae el proyecto: sin mayúsculas, tildes ni espacios de más. */
export const customerKey = (name: string): string => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
