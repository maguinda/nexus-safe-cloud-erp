import { ApiError } from '../lib/api';
import { MsgKey, TFn } from './index';

type Rule = [RegExp | string, MsgKey] | [RegExp | string, MsgKey, (m: RegExpMatchArray) => Record<string, string>];
const ROLES = ['project_lead', 'billing_analyst', 'sales', 'manager'];

/** Los avisos de los servicios, tal como los escriben en inglés. Lo que no está aquí se muestra sin traducir. */
const RULES: Rule[] = [
  [/^Role (\w+) is not allowed to do this$/, 'server.roleNotAllowed', (m) => ({ role: m[1] })],
  ['Invalid or expired token', 'server.invalidToken'],
  ['Missing or malformed bearer token', 'server.missingToken'],
  [/^Milestone (.+) is already approved$/, 'server.milestoneAlreadyApproved', (m) => ({ id: m[1] })],
  [/^Milestone (.+) not found$/, 'server.milestoneNotFound', (m) => ({ id: m[1] })],
  [/^Project (.+) not found$/, 'server.projectNotFound', (m) => ({ id: m[1] })],
  [/^Invoice (.+) is not a draft$/, 'server.invoiceNotDraft', (m) => ({ number: m[1] })],
  [/^Invoice (.+) not found$/, 'server.invoiceNotFound', (m) => ({ number: m[1] })],
  [/^Invoice (.+) has no electronic document$/, 'server.einvNoDocument', (m) => ({ number: m[1] })],
  ['Electronic invoice not ready: the invoice is not issued yet', 'server.einvNotIssued'],
  ['Electronic invoice not ready: the invoice has no client (it is older than the client field)', 'server.einvNoClient'],
  ['Electronic invoice not ready: the fiscal data of the client has not been entered yet', 'server.einvNoCustomerData'],
  ['Electronic invoice not ready: the numbering resolution is not valid for the issue date', 'server.einvResolution'],
  ['Electronic invoice not ready: the invoice totals do not follow the 19 % IVA rule', 'server.einvTaxRule'],
  ['The authorized numbering range is exhausted', 'server.einvExhausted'],
  [/^The delivery registry of this document is full \((\d+) records\)$/, 'server.einvDeliveryFull', (m) => ({ n: m[1] })],
  [/^Invalid customer data: /, 'server.einvCustomerInvalid'],
  ['Invalid id', 'server.invalidId'],
  ['Invalid invoice number', 'server.invalidInvoiceNumber'],
  ['Invalid credentials', 'server.invalidCredentials'],
  ['Your role is no longer manager. Sign in again.', 'server.noLongerManager'],
  ['That email is already registered', 'server.emailTaken'],
  ['User not found', 'server.userNotFound'],
  ['You cannot change your own role', 'server.ownRole'],
  ['The last manager cannot lose the manager role', 'server.lastManager'],
  ['Language must be es or en', 'server.invalidLanguage'],
  [/^The password must have at least (\d+) characters\.$/, 'server.passwordShort', (m) => ({ n: m[1] })],
  [/^The password must not be longer than (\d+) bytes\.$/, 'server.passwordLong', (m) => ({ n: m[1] })],
  ['The password must not start or end with spaces.', 'server.passwordSpaces'],
  ['The password must not contain the email address or the name part of it.', 'server.passwordEmail'],
  [/^The password must use at least (\d+) different characters\.$/, 'server.passwordSimple', (m) => ({ n: m[1] })],
  ['Unexpected error', 'server.unexpected'],
  ['Internal Server Error', 'server.unexpected'],
  ['Malformed request', 'server.malformed'],
  ['Request body too large', 'server.tooLarge'],
  [/^(ThrottlerException: )?Too Many (Requests|Attempts)$/i, 'server.tooMany'],
  [/^Request failed \((\d+)\)$/, 'server.requestFailed', (m) => ({ status: m[1] })],
];

/** Traduce un aviso del servidor; si no lo reconoce, lo devuelve igual (mejor inglés que nada). El rol, si es uno conocido, también se traduce. */
export function serverText(message: string, t: TFn): string {
  for (const rule of RULES) {
    const [pattern, key] = rule;
    const params = rule[2];
    const m = typeof pattern === 'string' ? (message === pattern ? ([message] as RegExpMatchArray) : null) : message.match(pattern);
    if (!m) continue;
    const p = params?.(m) ?? {};
    if (p.role && ROLES.includes(p.role)) p.role = t(`role.${p.role}` as MsgKey);
    return t(key, p);
  }
  return message;
}

/** El texto de un error para mostrarlo: si viene del servidor se traduce; si no (red caída, etc.), el texto propio de la pantalla. */
export const errorText = (e: unknown, t: TFn, fallback: MsgKey): string => (e instanceof ApiError ? serverText(e.message, t) : t(fallback));
