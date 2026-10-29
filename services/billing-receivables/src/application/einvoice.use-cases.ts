import { Party } from '../domain/einvoice/document';
import { buildElectronicInvoice } from '../domain/einvoice/document';
import { customerKey, validateCustomer } from '../domain/einvoice/customer';
import { buildInvoiceHtml } from '../domain/einvoice/html';
import { EInvoiceEnvironment } from '../domain/einvoice/legal';
import { EInvoiceProvider } from '../domain/einvoice/provider';
import { EInvoiceNotFoundError, EInvoiceNotReadyError, InvoiceNotFoundError } from '../domain/errors';
import { CustomerRepository, EInvoiceRepository, EInvoiceUnitOfWork, QrRenderer, StoredEInvoice } from '../domain/ports';

export interface EInvoiceSettings { supplier: Party; environment: EInvoiceEnvironment; technicalKey: string; verifyUrlBase: string }

/**
 * Convierte una factura EMITIDA en su documento electrónico (sandbox). Es idempotente: pedirla dos veces (doble clic, reintento) devuelve el mismo documento,
 * y la base lo garantiza con un único documento por factura. Una sola transacción, con los bloqueos siempre en el mismo orden (factura, cliente, contador):
 * si algo falla no queda un consecutivo gastado ni un documento a medias. La emisión de la factura NO depende de esto.
 */
export class GenerateElectronicInvoiceUseCase {
  constructor(private readonly uow: EInvoiceUnitOfWork, private readonly settings: EInvoiceSettings) {}

  execute(invoiceNumber: string): Promise<{ created: boolean; document: StoredEInvoice }> {
    return this.uow.run(async (tx) => {
      const invoice = await tx.findInvoiceForUpdate(invoiceNumber);
      if (!invoice) throw new InvoiceNotFoundError(invoiceNumber);
      if (invoice.status !== 'issued' || !invoice.issuedAt || !invoice.dueDate) throw new EInvoiceNotReadyError('the invoice is not issued yet');
      const existing = await tx.findElectronic(invoiceNumber); // releído DENTRO del bloqueo de la factura
      if (existing) return { created: false, document: existing };
      if (!invoice.clientName) throw new EInvoiceNotReadyError('the invoice has no client (it is older than the client field)');
      const customer = await tx.findCustomerForShare(customerKey(invoice.clientName));
      if (!customer) throw new EInvoiceNotReadyError('the fiscal data of the client has not been entered yet');
      const numbering = await tx.takeNextConsecutive();
      if (invoice.issuedAt < numbering.validFrom || invoice.issuedAt > numbering.validTo) throw new EInvoiceNotReadyError('the numbering resolution is not valid for the issue date');
      const doc = buildElectronicInvoice({
        invoice: { number: invoice.number, projectName: invoice.projectName, milestoneName: invoice.milestoneName, amountCop: invoice.amountCop, taxCop: invoice.taxCop, totalCop: invoice.totalCop, issuedAt: invoice.issuedAt, dueDate: invoice.dueDate },
        supplier: this.settings.supplier, customer: { nit: customer.nit, dv: customer.dv, name: customer.name, address: customer.address, city: customer.city, email: customer.email },
        numbering: { prefix: numbering.prefix, consecutive: numbering.consecutive }, environment: this.settings.environment, technicalKey: this.settings.technicalKey, verifyUrlBase: this.settings.verifyUrlBase,
      });
      const document = await tx.insertElectronic({ invoiceNumber, prefix: doc.prefix, consecutive: doc.consecutive, number: doc.number, issueDate: doc.issueDate, issueTime: doc.issueTime, dueDate: doc.dueDate, cufe: doc.cufe, xml: doc.xml, qrText: doc.qrText, supplier: doc.supplier, customer: doc.customer, invoice: { number: invoice.number, milestoneName: invoice.milestoneName, projectName: invoice.projectName, amountCop: invoice.amountCop, taxCop: invoice.taxCop, totalCop: invoice.totalCop } });
      return { created: true, document };
    });
  }
}

export class GetElectronicInvoiceUseCase {
  constructor(private readonly repo: EInvoiceRepository, private readonly qr: QrRenderer) {}
  async metadata(invoiceNumber: string): Promise<StoredEInvoice> {
    const d = await this.repo.findByInvoiceNumber(invoiceNumber);
    if (!d) throw new EInvoiceNotFoundError(invoiceNumber);
    return d;
  }
  async xml(invoiceNumber: string): Promise<{ number: string; xml: string }> {
    const d = await this.metadata(invoiceNumber);
    return { number: d.number, xml: d.xml };
  }
  async html(invoiceNumber: string): Promise<string> {
    const d = await this.metadata(invoiceNumber);
    return buildInvoiceHtml({ number: d.number, prefix: '', consecutive: 0, issueDate: d.issueDate, issueTime: d.issueTime, dueDate: d.dueDate, cufe: d.cufe, qrText: d.qrText, xml: d.xml, supplier: d.supplier, customer: d.customer }, d.invoice, await this.qr.toSvg(d.qrText));
  }
}

/** Envío al proveedor. Con el adaptador de sandbox solo SIMULA: el estado queda `sandbox_simulated`, nunca «aceptada». */
export class SubmitElectronicInvoiceUseCase {
  constructor(private readonly repo: EInvoiceRepository, private readonly provider: EInvoiceProvider, private readonly clock: () => Date = () => new Date()) {}
  async execute(invoiceNumber: string): Promise<StoredEInvoice> {
    const d = await this.repo.findByInvoiceNumber(invoiceNumber);
    if (!d) throw new EInvoiceNotFoundError(invoiceNumber);
    if (d.status !== 'generated') return d; // ya enviada: la primera gana
    const sub = await this.provider.submit({ number: d.number, cufe: d.cufe });
    const done = await this.repo.markSubmitted(invoiceNumber, sub.ref, this.clock());
    if (!done) throw new EInvoiceNotFoundError(invoiceNumber);
    return done;
  }
}

/** Registra un envío al correo del cliente que quedó en el documento (nunca a otra dirección). Hoy solo se REGISTRA: no hay servidor de correo. */
export class RegisterEInvoiceDeliveryUseCase {
  constructor(private readonly repo: EInvoiceRepository) {}
  async execute(invoiceNumber: string): Promise<StoredEInvoice> {
    const d = await this.repo.findByInvoiceNumber(invoiceNumber);
    if (!d) throw new EInvoiceNotFoundError(invoiceNumber);
    const out = await this.repo.addDelivery(invoiceNumber, d.customer.email);
    if (!out) throw new EInvoiceNotFoundError(invoiceNumber);
    return out;
  }
}

export class ListCustomersUseCase {
  constructor(private readonly repo: CustomerRepository) {}
  execute() { return this.repo.list(); }
}

export class UpsertCustomerUseCase {
  constructor(private readonly repo: CustomerRepository) {}
  /** Un cliente por nombre normalizado. Editarlo NO cambia los documentos ya generados (llevan su propia copia). */
  async execute(raw: unknown) {
    const c = validateCustomer(raw);
    return this.repo.upsert(c, customerKey(c.name));
  }
}
