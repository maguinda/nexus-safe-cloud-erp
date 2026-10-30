import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsDefined, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** La forma y los topes se validan aquí; las reglas de negocio las valida el dominio. */
export class CreateSupplierDto {
  @ApiProperty({ example: 'Redes del Norte', maxLength: 80 }) @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ enum: ['fixed', 'tender'], description: 'Fixed supplier or by tender' }) @IsString() @MaxLength(20) kind!: string;
  @ApiPropertyOptional({ example: 'Net 30 days', maxLength: 200 }) @IsOptional() @IsString() @MaxLength(300) terms?: string;
  @ApiPropertyOptional({ example: 'LIC-2026-014', description: 'Only for suppliers by tender' }) @IsOptional() @IsString() @MaxLength(60) tenderRef?: string;
  @ApiPropertyOptional({ example: '2027-06-30', description: 'Only for suppliers by tender: end of the tender' }) @IsOptional() @IsString() @MaxLength(12) validUntil?: string;
}
export class CatalogDto {
  @ApiProperty({ example: 2400000, description: 'Reference price per unit, whole pesos' }) @IsDefined() refPriceCop!: number;
  @ApiProperty({ example: 5, description: 'Delivery time in days (0 to 365)' }) @IsDefined() leadDays!: number;
}
export class CreateItemDto {
  @ApiProperty({ example: 'Temperature sensor TH-10', maxLength: 80 }) @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ enum: ['equipment', 'spare'] }) @IsString() @MaxLength(20) kind!: string;
  @ApiPropertyOptional({ example: ['TEMP', 'HUMIDITY'], description: 'Sensor measures this spare part serves (up to 10)' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) forKinds?: string[];
}
export class CreateOrderDto {
  @ApiProperty() @IsString() @MaxLength(40) supplierId!: string;
  @ApiProperty() @IsString() @MaxLength(40) itemId!: string;
  @ApiProperty({ minimum: 1, maximum: 100000 }) @IsInt() quantity!: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 1000000000, description: 'Whole Colombian pesos per unit; empty = the supplier’s reference price' }) @IsOptional() @IsInt() unitPriceCop?: number;
}
export class CountedDto {
  @ApiProperty({ example: 7, description: 'What was physically counted, whole number from 0 to 1.000.000' }) @IsDefined() counted!: number;
}

export class RetireDto {
  @ApiProperty({ enum: ['storage', 'retired'], description: 'storage = back to the storage (stock +1); retired = taken out of service' }) @IsString() @MaxLength(20) destination!: string;
}

export class AdjustDto {
  @ApiProperty({ example: -2, description: 'Whole number other than 0, up to 100000 either way' }) @IsInt() delta!: number;
  @ApiProperty({ example: 'Stock count', maxLength: 120 }) @IsString() @MaxLength(200) reason!: string;
}
