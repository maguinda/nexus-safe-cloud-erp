import { Controller, Get, Inject, Param, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IssueInvoiceUseCase } from '../application/invoices.use-cases';
import { ListInvoicesUseCase, ReconcileInvoicesUseCase } from '../application/invoices.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { Invoice } from '../domain/invoice';
import { InvoiceNumberPipe } from './invoice-number.pipe';

export const LIST_INVOICES = 'LIST_INVOICES';
export const ISSUE_INVOICE = 'ISSUE_INVOICE';
export const RECONCILE_INVOICES = 'RECONCILE_INVOICES';

/** Solo los campos del contrato (docs/openapi.yaml). */
const toDto = (i: Invoice) => ({ number: i.number, projectName: i.projectName, milestoneName: i.milestoneName, amountCop: i.amountCop, taxCop: i.taxCop, totalCop: i.totalCop, status: i.status, createdAt: i.createdAt.toISOString() });

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    @Inject(LIST_INVOICES) private readonly listInvoices: ListInvoicesUseCase,
    @Inject(ISSUE_INVOICE) private readonly issueInvoice: IssueInvoiceUseCase,
    @Inject(RECONCILE_INVOICES) private readonly reconcileInvoices: ReconcileInvoicesUseCase,
  ) {}

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
    return (await this.listInvoices.execute()).map(toDto);
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
    return toDto(await this.issueInvoice.execute(number, user.email, (req as any).correlationId));
  }
}
