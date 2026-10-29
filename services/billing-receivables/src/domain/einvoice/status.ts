import { Invoice } from '../invoice';
import { EInvoiceStatus } from './legal';

/**
 * Qué se le dice a la pantalla sobre el documento electrónico de una factura:
 *  not_issued             es un borrador: todavía no hay nada que convertir
 *  not_applicable         emitida, pero sin cliente (anterior al campo): no se puede generar
 *  pending_customer_data  emitida, falta cargar los datos fiscales del cliente
 *  ready                  emitida y con datos del cliente: se puede generar
 *  generated | sandbox_simulated   ya existe el documento
 */
export type EInvoiceListStatus = 'not_issued' | 'not_applicable' | 'pending_customer_data' | 'ready' | EInvoiceStatus;

export function electronicStatusOf(invoice: Pick<Invoice, 'status' | 'clientName'>, doc: EInvoiceStatus | null, customerExists: boolean): EInvoiceListStatus {
  if (doc) return doc;
  if (invoice.status !== 'issued') return 'not_issued';
  if (!invoice.clientName) return 'not_applicable';
  return customerExists ? 'ready' : 'pending_customer_data';
}
