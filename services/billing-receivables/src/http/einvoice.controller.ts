import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Response } from 'express';
import { GenerateElectronicInvoiceUseCase, GetElectronicInvoiceUseCase, ListCustomersUseCase, RegisterEInvoiceDeliveryUseCase, SubmitElectronicInvoiceUseCase, UpsertCustomerUseCase } from '../application/einvoice.use-cases';
import { Roles } from '../auth/auth.guard';
import { LEGAL_NOTICE_EN, LEGAL_NOTICE_ES } from '../domain/einvoice/legal';
import { StoredEInvoice } from '../domain/ports';
import { InvoiceNumberPipe } from './invoice-number.pipe';

export const GENERATE_EINVOICE = 'GENERATE_EINVOICE';
export const GET_EINVOICE = 'GET_EINVOICE';
export const SUBMIT_EINVOICE = 'SUBMIT_EINVOICE';
export const DELIVER_EINVOICE = 'DELIVER_EINVOICE';
export const LIST_CUSTOMERS = 'LIST_CUSTOMERS';
export const UPSERT_CUSTOMER = 'UPSERT_CUSTOMER';

/**
 * Lo que se cuenta de un documento SIN datos personales del cliente (ni NIT, ni correo, ni dirección: esos solo van dentro del XML y de la
 * representación HTML). `validForDian` y `signed` van siempre en falso mientras el servicio sea de sandbox.
 */
const toDto = (d: StoredEInvoice) => ({
  invoiceNumber: d.invoiceNumber, number: d.number, cufe: d.cufe, environment: d.environment, status: d.status, signed: false, validForDian: false,
  legalNotice: { es: LEGAL_NOTICE_ES, en: LEGAL_NOTICE_EN },
  customerName: d.customer.name, issueDate: d.issueDate, issueTime: d.issueTime, dueDate: d.dueDate,
  providerRef: d.providerRef, submittedAt: d.submittedAt ? d.submittedAt.toISOString() : null, deliveries: d.deliveries, createdAt: d.createdAt.toISOString(),
});

@ApiTags('Electronic invoice (sandbox)')
@ApiBearerAuth()
@Controller('invoices/:invoiceNumber/electronic')
export class ElectronicInvoiceController {
  constructor(
    @Inject(GENERATE_EINVOICE) private readonly generate: GenerateElectronicInvoiceUseCase,
    @Inject(GET_EINVOICE) private readonly get: GetElectronicInvoiceUseCase,
    @Inject(SUBMIT_EINVOICE) private readonly submit: SubmitElectronicInvoiceUseCase,
    @Inject(DELIVER_EINVOICE) private readonly deliver: RegisterEInvoiceDeliveryUseCase,
  ) {}

  @Post()
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Generate the SANDBOX electronic document (UBL 2.1 + CUFE + QR) of an issued invoice. Idempotent. NOT legally valid (role billing_analyst)' })
  @ApiResponse({ status: 201, description: 'Generated now' })
  @ApiResponse({ status: 200, description: 'Already existed (same document)' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'Not ready: not issued, no client, fiscal data of the client missing, or the numbering range is exhausted' })
  async create(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.generate.execute(number);
    res.status(r.created ? 201 : 200);
    return toDto(r.document);
  }

  @Get()
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Status of the electronic document (no personal data of the client) (role billing_analyst)' })
  @ApiResponse({ status: 404, description: 'The invoice has no electronic document' })
  async status(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string) {
    return toDto(await this.get.metadata(number));
  }

  @Get('xml')
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Download the UBL 2.1 XML (unsigned, sandbox) (role billing_analyst)' })
  @ApiResponse({ status: 404, description: 'The invoice has no electronic document' })
  async xml(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string, @Res({ passthrough: true }) res: Response) {
    const d = await this.get.xml(number);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${d.number}.xml"`); // el número sale del prefijo (A-Z) y de un entero: nunca trae comillas
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return d.xml;
  }

  @Get('html')
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Printable representation with the QR (sandbox banner) (role billing_analyst)' })
  @ApiResponse({ status: 404, description: 'The invoice has no electronic document' })
  async html(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string, @Res({ passthrough: true }) res: Response) {
    const page = await this.get.html(number);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Sin scripts, sin recursos externos, sin incrustarse en otra página; solo el estilo en línea de la propia página y el QR (imagen SVG en línea).
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return page;
  }

  @Post('submit')
  @HttpCode(200)
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'SIMULATE sending to the provider: the status becomes sandbox_simulated, never accepted (role billing_analyst)' })
  @ApiResponse({ status: 404, description: 'The invoice has no electronic document' })
  async send(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string) {
    return toDto(await this.submit.execute(number));
  }

  @Post('deliveries')
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'REGISTER a delivery by email to the client address stored in the document. Nothing is sent: no mail server is connected (role billing_analyst)' })
  @ApiResponse({ status: 404, description: 'The invoice has no electronic document' })
  async register(@Param('invoiceNumber', new InvoiceNumberPipe()) number: string) {
    return { ...toDto(await this.deliver.execute(number)), note: 'Registered only: no email was sent.' };
  }
}

export class CustomerDto {
  @ApiProperty({ example: 'Banco Andino (example)', maxLength: 120, description: 'The client name of the project (it is how invoices are matched)' })
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
  @ApiProperty({ example: '900.000.001-2', description: 'NIT with 6 to 10 digits, optionally with -DV (it must match the computed check digit)' })
  @IsString() @MinLength(6) @MaxLength(16)
  nit!: string;
  @ApiProperty({ example: 'cuentas@banco.example' })
  @IsString() @MinLength(3) @MaxLength(254)
  email!: string;
  @ApiProperty({ example: 'Carrera 7 # 8-9' })
  @IsString() @MinLength(1) @MaxLength(200)
  address!: string;
  @ApiProperty({ example: 'Bogotá' })
  @IsString() @MinLength(1) @MaxLength(80)
  city!: string;
}

@ApiTags('Customers (fiscal data)')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(LIST_CUSTOMERS) private readonly list: ListCustomersUseCase,
    @Inject(UPSERT_CUSTOMER) private readonly upsert: UpsertCustomerUseCase,
  ) {}

  @Get()
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Fiscal data of the clients (personal data: only the billing analyst)' })
  async customers() {
    return (await this.list.execute()).map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() }));
  }

  @Put()
  @Roles('billing_analyst')
  @ApiOperation({ summary: 'Create or update the fiscal data of a client. Documents already generated keep their own copy (role billing_analyst)' })
  @ApiBody({ type: CustomerDto })
  @ApiResponse({ status: 400, description: 'Invalid data (NIT, check digit, email, texts)' })
  async put(@Body() dto: CustomerDto) {
    return this.upsert.execute(dto);
  }
}
