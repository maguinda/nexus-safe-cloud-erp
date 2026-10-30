import { Controller, Get, Inject, Logger, Param, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { GenerateElectronicInvoiceUseCase } from '../application/einvoice.use-cases';
import { IssueInvoiceUseCase } from '../application/invoices.use-cases';
import { ListInvoicesUseCase, ReconcileInvoicesUseCase } from '../application/invoices.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { EInvoiceNotReadyError } from '../domain/errors';
import { Invoice } from '../domain/invoice';
import { paymentStatusOf } from '../domain/payment';
import { GENERATE_EINVOICE } from './einvoice.controller';
import { InvoiceNumberPipe } from './invoice-number.pipe';

export const LIST_INVOICES = 'LIST_INVOICES';
export const ISSUE_INVOICE = 'ISSUE_INVOICE';
export const RECONCILE_INVOICES = 'RECONCILE_INVOICES';

/** Solo los campos del contrato (docs/openapi.yaml). */
const toDto = (i: Invoice, electronicStatus: string = 'not_issued', paidCop = 0) => ({ paidCop, balanceCop: i.totalCop - paidCop, paymentStatus: paymentStatusOf(i.totalCop, paidCop), number: i.number, clientName: i.clientName, electronicStatus, projectName: i.projectName, milestoneName: i.milestoneName, amountCop: i.amountCop, taxCop: i.taxCop, totalCop: i.totalCop, status: i.status, createdAt: i.createdAt.toISOString(), dueDate: i.dueDate ? i.dueDate.toISOString() : null });

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    @Inject(LIST_INVOICES) private readonly listInvoices: ListInvoicesUseCase,
    @Inject(ISSUE_INVOICE) private readonly issueInvoice: IssueInvoiceUseCase,
    @Inject(RECONCILE_INVOICES) private readonly reconcileInvoices: ReconcileInvoicesUseCase,
    @Inject(GENERATE_EINVOICE) private readonly generateEInvoice: GenerateElectronicInvoiceUseCase,
  ) {}
  private readonly log = new Logger('Invoices');

  @Get('reconciliation')
  @Roles('project_lead', 'billing_analyst')
  @ApiOperation({ summary: 'Milestone-to-invoice reconciliation with tax totals (roles project_lead and billing_analyst)' })
  @ApiResponse({ status: 403, description: 'Role not allowed (sales)' })
  async reconciliation() {
    return this.reconcileInvoices.execute();
  }

  @Get()
  @Roles('project_lead', 'billing_analyst')
  @ApiOperation({ summary: 'List invoices (roles project_lead and billing_analyst)' })
  @ApiResponse({ status: 403, description: 'Role not allowed (sales)' })
  async list() {
    return (await this.listInvoices.execute()).map((i) => toDto(i, i.electronicStatus, i.paidCop));
  }

  @Patch(':invoiceNumber/issue')
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Issue a draft invoice (role billing_analyst)' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'The invoice is not a draft' })
  async issue(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string, @Req() req: Request) {
    // Quién emite sale del token verificado, nunca del cuerpo de la petición.
    const user = (req as any).user as AuthUser;
    const issued = await this.issueInvoice.execute(number, user.email, (req as any).correlationId);
    // Emitir es lo que cuenta (dinero): el documento electrónico se intenta DESPUÉS, en su propia transacción, y si no se puede (falta el cliente o sus datos
    // fiscales) la factura queda emitida igual y el documento se genera cuando haya datos. Nunca se deshace una emisión por esto.
    let electronicStatus = 'ready';
    try {
      electronicStatus = (await this.generateEInvoice.execute(number)).document.status;
    } catch (e) {
      if (e instanceof EInvoiceNotReadyError) electronicStatus = issued.clientName ? 'pending_customer_data' : 'not_applicable';
      else this.log.warn(`${(req as any).correlationId} the electronic document of ${number} could not be generated now: ${e instanceof Error ? e.name : 'error'}`);
    }
    return toDto(issued, electronicStatus);
  }
}
