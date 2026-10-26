import type { TFn } from '../i18n';
import type { Invoice } from './types';

export type StatusFilter = 'all' | 'draft' | 'issued';
export type SortKey = 'number' | 'project' | 'total' | 'due' | 'created';
export type SortDir = 'asc' | 'desc';

/** Filtra en el navegador (el listado ya viene completo del servidor): por estado y por texto en número, proyecto o hito. */
export function filterInvoices(list: Invoice[], f: { status: StatusFilter; query: string }): Invoice[] {
  const q = f.query.trim().toLowerCase();
  return list.filter((i) => (f.status === 'all' || i.status === f.status)
    && (q === '' || `${i.number} ${i.projectName} ${i.milestoneName}`.toLowerCase().includes(q)));
}

const numberOf = (n: string): number => { const m = /(\d+)$/.exec(n); return m ? Number(m[1]) : Number.NaN; };
const time = (iso: string): number => Date.parse(iso);

/**
 * Ordena sin modificar la lista. Es estable (los empates conservan el orden que llegó) y el borrador, que no tiene
 * vencimiento, queda SIEMPRE al final al ordenar por «due», en ambos sentidos.
 */
export function sortInvoices(list: Invoice[], key: SortKey, dir: SortDir): Invoice[] {
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = (a: Invoice, b: Invoice): number => {
    switch (key) {
      case 'number': { const x = numberOf(a.number), y = numberOf(b.number); return Number.isNaN(x) || Number.isNaN(y) ? sign * a.number.localeCompare(b.number) : sign * (x - y); }
      case 'project': return sign * a.projectName.localeCompare(b.projectName, 'en', { sensitivity: 'base' });
      case 'total': return sign * (a.totalCop - b.totalCop);
      case 'created': return sign * (time(a.createdAt) - time(b.createdAt));
      case 'due': {
        if (a.dueDate === null && b.dueDate === null) return 0;
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return sign * (time(a.dueDate) - time(b.dueDate));
      }
    }
  };
  return [...list].sort(cmp); // Array.prototype.sort es estable: los empates conservan el orden recibido
}

export type DueState = { state: 'none' | 'ok' | 'soon' | 'overdue'; days: number | null };
export const SOON_DAYS = 7;
const utcDay = (ms: number): number => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/** Días de calendario (UTC, igual que el servidor) que faltan para vencer: negativo = ya venció; de 0 a 7 = pronto. */
export function dueState(dueIso: string | null, nowMs: number): DueState {
  if (dueIso === null) return { state: 'none', days: null };
  const days = Math.round((utcDay(Date.parse(dueIso)) - utcDay(nowMs)) / 86_400_000);
  return { state: days < 0 ? 'overdue' : days <= SOON_DAYS ? 'soon' : 'ok', days };
}

/** El texto del chip de vencimiento (solo «pronto» y «vencida» tienen chip; en cualquier otro caso, null). */
export function dueChip(due: DueState, t: TFn): string | null {
  if (due.state === 'overdue') return t('invoices.due.overdue', { n: Math.abs(due.days as number) });
  if (due.state === 'soon') return due.days === 0 ? t('invoices.due.today') : t('invoices.due.in', { n: due.days as number });
  return null;
}

export function countByStatus(list: Invoice[]): Record<StatusFilter, number> {
  return { all: list.length, draft: list.filter((i) => i.status === 'draft').length, issued: list.filter((i) => i.status === 'issued').length };
}
