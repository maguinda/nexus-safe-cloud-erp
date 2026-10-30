import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdjustStockUseCase, CancelOrderUseCase, CreateItemUseCase, CreateOrderUseCase, CreateSupplierUseCase, ListProcurementUseCase, ReceiveOrderUseCase } from '../application/procurement.use-cases';
import { Roles } from '../auth/auth.guard';
import { orderNumber } from '../domain/events';
import { AdjustDto, CreateItemDto, CreateOrderDto, CreateSupplierDto } from './procurement.dto';

export const LIST = 'PROC_LIST';
export const CREATE_SUPPLIER = 'PROC_CREATE_SUPPLIER';
export const CREATE_ITEM = 'PROC_CREATE_ITEM';
export const CREATE_ORDER = 'PROC_CREATE_ORDER';
export const RECEIVE_ORDER = 'PROC_RECEIVE_ORDER';
export const CANCEL_ORDER = 'PROC_CANCEL_ORDER';
export const ADJUST = 'PROC_ADJUST';

const READERS = ['manager', 'project_lead', 'billing_analyst'] as const;

@ApiTags('Procurement')
@ApiBearerAuth()
@Controller()
export class ProcurementController {
  constructor(
    @Inject(LIST) private readonly list: ListProcurementUseCase,
    @Inject(CREATE_SUPPLIER) private readonly createSupplier: CreateSupplierUseCase,
    @Inject(CREATE_ITEM) private readonly createItem: CreateItemUseCase,
    @Inject(CREATE_ORDER) private readonly createOrder: CreateOrderUseCase,
    @Inject(RECEIVE_ORDER) private readonly receiveOrder: ReceiveOrderUseCase,
    @Inject(CANCEL_ORDER) private readonly cancelOrder: CancelOrderUseCase,
    @Inject(ADJUST) private readonly adjust: AdjustStockUseCase,
  ) {}

  @Get('suppliers') @Roles(...READERS) @ApiOperation({ summary: 'Suppliers (fixed and by tender)' })
  suppliers() { return this.list.suppliers(); }

  @Post('suppliers') @Roles('manager') @ApiOperation({ summary: 'Add a supplier (role manager)' }) @ApiResponse({ status: 409, description: 'A supplier with that name already exists' })
  addSupplier(@Body() dto: CreateSupplierDto) { return this.createSupplier.execute(dto); }

  @Get('inventory') @Roles(...READERS) @ApiOperation({ summary: 'Stock of equipment and spare parts, online (US-08)' })
  inventory() { return this.list.inventory(); }

  @Get('inventory/suggestions') @Roles(...READERS) @ApiOperation({ summary: 'Recent sensor alerts with the spare parts that serve that measure (those in stock first)' })
  suggestions() { return this.list.suggestions(); }

  @Post('inventory/items') @Roles('manager') @ApiOperation({ summary: 'Add an item (equipment or spare part) with zero stock (role manager)' }) @ApiResponse({ status: 409, description: 'An item with that name already exists' })
  addItem(@Body() dto: CreateItemDto) { return this.createItem.execute(dto); }

  @Post('inventory/items/:id/adjust') @HttpCode(200) @Roles('manager') @ApiOperation({ summary: 'Adjust stock by hand (count, loss, return). Never below 0 (role manager)' }) @ApiResponse({ status: 409, description: 'The stock would go below 0' })
  adjustStock(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AdjustDto, @Req() req: Request) { return this.adjust.execute(id, dto, (req as any).correlationId ?? 'no-correlation'); }

  @Get('orders') @Roles(...READERS) @ApiOperation({ summary: 'Purchase orders, newest first' })
  orders() { return this.list.orders(); }

  @Post('orders') @Roles('manager') @ApiOperation({ summary: 'Create a purchase order (pending: it does not move the stock until it is received) (role manager)' })
  async addOrder(@Body() dto: CreateOrderDto) { const o = await this.createOrder.execute(dto); return { id: o.id, number: orderNumber(o.number), totalCop: o.totalCop, status: 'ordered' }; }

  @Post('orders/:id/receive') @HttpCode(200) @Roles('manager')
  @ApiOperation({ summary: 'Receive an order: the stock goes up ONCE and StockChanged (and EquipmentPurchased for equipment) is published (role manager)' })
  @ApiResponse({ status: 409, description: 'The order is not pending any more' })
  receive(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) { return this.receiveOrder.execute(id, (req as any).correlationId ?? 'no-correlation'); }

  @Post('orders/:id/cancel') @HttpCode(200) @Roles('manager') @ApiOperation({ summary: 'Cancel a pending order (role manager)' }) @ApiResponse({ status: 409, description: 'The order is not pending any more' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string) { return this.cancelOrder.execute(id); }
}
