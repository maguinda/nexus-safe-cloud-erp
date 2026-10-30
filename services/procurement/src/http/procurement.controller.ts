import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Delete, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdjustStockUseCase, CancelOrderUseCase, CreateItemUseCase, CreateOrderUseCase, CreateSupplierUseCase, InstallEquipmentUseCase, ListMovementsUseCase, ListProcurementUseCase, ReceiveOrderUseCase, SetCatalogUseCase } from '../application/procurement.use-cases';
import { Roles } from '../auth/auth.guard';
import { CountsService } from '../infrastructure/prisma-counts';
import { orderNumber } from '../domain/events';
import { AdjustDto, CatalogDto, CountedDto, CreateItemDto, CreateOrderDto, CreateSupplierDto } from './procurement.dto';

export const LIST = 'PROC_LIST';
export const CREATE_SUPPLIER = 'PROC_CREATE_SUPPLIER';
export const CREATE_ITEM = 'PROC_CREATE_ITEM';
export const CREATE_ORDER = 'PROC_CREATE_ORDER';
export const RECEIVE_ORDER = 'PROC_RECEIVE_ORDER';
export const CANCEL_ORDER = 'PROC_CANCEL_ORDER';
export const ADJUST = 'PROC_ADJUST';
export const LIST_MOVEMENTS = 'PROC_LIST_MOVEMENTS';
export const COUNTS = 'PROC_COUNTS';
export const CATALOG = 'PROC_CATALOG';
export const INSTALL = 'PROC_INSTALL';

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
    @Inject(LIST_MOVEMENTS) private readonly listMovements: ListMovementsUseCase,
    @Inject(COUNTS) private readonly counts: CountsService,
    @Inject(CATALOG) private readonly catalog: SetCatalogUseCase,
    @Inject(INSTALL) private readonly install: InstallEquipmentUseCase,
  ) {}

  @Get('suppliers') @Roles(...READERS) @ApiOperation({ summary: 'Suppliers (fixed and by tender)' })
  suppliers() { return this.list.suppliers(); }

  @Post('suppliers') @Roles('manager') @ApiOperation({ summary: 'Add a supplier (role manager)' }) @ApiResponse({ status: 409, description: 'A supplier with that name already exists' })
  addSupplier(@Body() dto: CreateSupplierDto) { return this.createSupplier.execute(dto); }

  @Put('suppliers/:id/catalog/:itemId') @Roles('manager') @ApiOperation({ summary: 'Say that a supplier sells an item, with a reference price and a delivery time (role manager)' }) @ApiResponse({ status: 404, description: 'Supplier or item not found' })
  setCatalog(@Param('id', new ParseUUIDPipe()) id: string, @Param('itemId', new ParseUUIDPipe()) itemId: string, @Body() dto: CatalogDto) { return this.catalog.execute(id, itemId, dto); }

  @Delete('suppliers/:id/catalog/:itemId') @HttpCode(204) @Roles('manager') @ApiOperation({ summary: 'Remove an item from a supplier’s catalog (existing orders are not touched)' }) @ApiResponse({ status: 404, description: 'Not in the catalog' })
  async removeCatalog(@Param('id', new ParseUUIDPipe()) id: string, @Param('itemId', new ParseUUIDPipe()) itemId: string) { await this.catalog.remove(id, itemId); }

  @Post('inventory/items/:id/install') @HttpCode(200) @Roles('manager') @ApiOperation({ summary: 'Install ONE unit of an equipment item: it leaves the stock and becomes an asset in the network inventory (role manager)' }) @ApiResponse({ status: 409, description: 'No stock, or the item is a spare part' })
  installUnit(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) { return this.install.execute(id, (req as any).correlationId ?? 'no-correlation', (req as any).user?.email ?? null); }

  @Get('inventory') @Roles(...READERS) @ApiOperation({ summary: 'Stock of equipment and spare parts, online (US-08)' })
  inventory() { return this.list.inventory(); }

  @Get('inventory/movements') @Roles(...READERS) @ApiOperation({ summary: 'Stock movement history (opening, received orders, manual adjustments), newest first. Filter by item; 1 to 200 rows' }) @ApiResponse({ status: 400, description: 'Bad itemId or limit' })
  movements(@Query('itemId') itemId?: string, @Query('limit') limit?: string) {
    if (itemId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) throw new BadRequestException('itemId must be a UUID');
    let n = 100;
    if (limit !== undefined) { if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 200) throw new BadRequestException('limit must be a whole number from 1 to 200'); n = Number(limit); }
    return this.listMovements.execute({ itemId: itemId?.toLowerCase(), limit: n });
  }

  @Get('counts') @Roles(...READERS) @ApiOperation({ summary: 'Physical counts, newest first (last 20)' })
  listCounts() { return this.counts.list(); }

  @Get('counts/:id') @Roles(...READERS) @ApiOperation({ summary: 'One count with its lines (expected, counted, variance)' }) @ApiResponse({ status: 404, description: 'Count not found' })
  getCount(@Param('id', new ParseUUIDPipe()) id: string) { return this.counts.get(id); }

  @Post('counts') @Roles('manager') @ApiOperation({ summary: 'Open a physical count: a snapshot of the expected stock of every item (role manager). Only one can be open' }) @ApiResponse({ status: 409, description: 'There is already an open count' })
  openCount(@Req() req: Request) { return this.counts.open((req as any).user?.email ?? null); }

  @Patch('counts/:id/lines/:itemId') @Roles('manager') @ApiOperation({ summary: 'Write what was counted for an item (0 to 1.000.000) while the count is open (role manager)' }) @ApiResponse({ status: 409, description: 'The count is not open' })
  setCounted(@Param('id', new ParseUUIDPipe()) id: string, @Param('itemId', new ParseUUIDPipe()) itemId: string, @Body() dto: CountedDto, @Req() req: Request) { return this.counts.setCounted(id, itemId, dto.counted, (req as any).user?.email ?? null); }

  @Post('counts/:id/close') @HttpCode(200) @Roles('manager') @ApiOperation({ summary: 'Close the count: each counted item gets an adjustment of counted − expected (movement + StockChanged). All or nothing' }) @ApiResponse({ status: 409, description: 'Not open, or an item would end below zero' })
  closeCount(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) { return this.counts.close(id, (req as any).user?.email ?? null, (req as any).correlationId ?? 'no-correlation'); }

  @Post('counts/:id/cancel') @HttpCode(200) @Roles('manager') @ApiOperation({ summary: 'Cancel an open count without touching the stock (role manager)' }) @ApiResponse({ status: 409, description: 'The count is not open' })
  cancelCount(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) { return this.counts.cancel(id, (req as any).user?.email ?? null); }

  @Get('inventory/suggestions') @Roles(...READERS) @ApiOperation({ summary: 'Recent sensor alerts with the spare parts that serve that measure (those in stock first)' })
  suggestions() { return this.list.suggestions(); }

  @Post('inventory/items') @Roles('manager') @ApiOperation({ summary: 'Add an item (equipment or spare part) with zero stock (role manager)' }) @ApiResponse({ status: 409, description: 'An item with that name already exists' })
  addItem(@Body() dto: CreateItemDto) { return this.createItem.execute(dto); }

  @Post('inventory/items/:id/adjust') @HttpCode(200) @Roles('manager') @ApiOperation({ summary: 'Adjust stock by hand (count, loss, return). Never below 0 (role manager)' }) @ApiResponse({ status: 409, description: 'The stock would go below 0' })
  adjustStock(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AdjustDto, @Req() req: Request) { return this.adjust.execute(id, dto, (req as any).correlationId ?? 'no-correlation', (req as any).user?.email ?? null); }

  @Get('orders') @Roles(...READERS) @ApiOperation({ summary: 'Purchase orders, newest first' })
  orders() { return this.list.orders(); }

  @Post('orders') @Roles('manager') @ApiOperation({ summary: 'Create a purchase order (pending: it does not move the stock until it is received) (role manager)' })
  async addOrder(@Body() dto: CreateOrderDto) { const o = await this.createOrder.execute(dto); return { id: o.id, number: orderNumber(o.number), unitPriceCop: o.unitPriceCop, totalCop: o.totalCop, status: 'ordered' }; }

  @Post('orders/:id/receive') @HttpCode(200) @Roles('manager')
  @ApiOperation({ summary: 'Receive an order: the stock goes up ONCE and StockChanged (and EquipmentPurchased for equipment) is published (role manager)' })
  @ApiResponse({ status: 409, description: 'The order is not pending any more' })
  receive(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) { return this.receiveOrder.execute(id, (req as any).correlationId ?? 'no-correlation', (req as any).user?.email ?? null); }

  @Post('orders/:id/cancel') @HttpCode(200) @Roles('manager') @ApiOperation({ summary: 'Cancel a pending order (role manager)' }) @ApiResponse({ status: 409, description: 'The order is not pending any more' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string) { return this.cancelOrder.execute(id); }
}
