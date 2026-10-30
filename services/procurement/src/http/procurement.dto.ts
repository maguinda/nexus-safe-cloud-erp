import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** La forma y los topes se validan aquí; las reglas de negocio las valida el dominio. */
export class CreateSupplierDto {
  @ApiProperty({ example: 'Redes del Norte', maxLength: 80 }) @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ enum: ['fixed', 'tender'], description: 'Fixed supplier or by tender' }) @IsString() @MaxLength(20) kind!: string;
  @ApiPropertyOptional({ example: 'Net 30 days', maxLength: 200 }) @IsOptional() @IsString() @MaxLength(300) terms?: string;
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
  @ApiProperty({ minimum: 1, maximum: 1000000000, description: 'Whole Colombian pesos per unit' }) @IsInt() unitPriceCop!: number;
}
export class AdjustDto {
  @ApiProperty({ example: -2, description: 'Whole number other than 0, up to 100000 either way' }) @IsInt() delta!: number;
  @ApiProperty({ example: 'Stock count', maxLength: 120 }) @IsString() @MaxLength(200) reason!: string;
}
