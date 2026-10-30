import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { ListPaymentsUseCase, RegisterPaymentUseCase } from '../application/payments.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { Payment } from '../domain/payment';
import { InvoiceNumberPipe } from './invoice-number.pipe';

export const REGISTER_PAYMENT = 'REGISTER_PAYMENT';
export const LIST_PAYMENTS = 'LIST_PAYMENTS';

class RegisterPaymentDto {
  @ApiProperty({ example: 5000000, description: 'Whole pesos, greater than 0 and not above the balance of the invoice' }) @IsInt() amountCop!: number;
  @ApiProperty({ enum: ['transfer', 'cash', 'card', 'other'] }) @IsString() @MaxLength(20) method!: string;
  @ApiPropertyOptional({ example: 'Bank transfer 8841', maxLength: 60 }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

/** Solo los campos del contrato (docs/openapi.yaml): sin quién lo registró. */
const toDto = (p: Payment) => ({ id: p.id, invoiceNumber: p.invoiceNumber, amountCop: p.amountCop, method: p.method, reference: p.reference, paidAt: p.paidAt.toISOString() });

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class PaymentsController {
  constructor(@Inject(REGISTER_PAYMENT) private readonly register: RegisterPaymentUseCase, @Inject(LIST_PAYMENTS) private readonly list: ListPaymentsUseCase) {}

  @Post(':invoiceNumber/payments')
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Register a payment (full or partial) against an ISSUED invoice (role billing_analyst)' })
  @ApiResponse({ status: 400, description: 'Invalid amount, method or reference' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'The invoice is not issued, or the payment is higher than its balance' })
  async create(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string, @Body() dto: RegisterPaymentDto, @Req() req: Request) {
    // Quién registra sale del token verificado, nunca del cuerpo.
    const user = (req as any).user as AuthUser;
    const r = await this.register.execute(number, dto, user.email, (req as any).correlationId);
    return { ...toDto(r.payment), paidCop: r.paidCop, balanceCop: r.balanceCop, paymentStatus: r.status };
  }

  @Get(':invoiceNumber/payments')
  @Roles('project_lead', 'billing_analyst')
  @ApiOperation({ summary: 'Payments of an invoice, newest first (roles project_lead and billing_analyst)' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async payments(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string) {
    return (await this.list.execute(number)).map(toDto);
  }
}
