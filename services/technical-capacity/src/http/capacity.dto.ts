import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** La forma y los topes se validan aquí; las reglas de negocio (fechas reales, 1 a 100 %, sin repetidas) las valida el dominio. */
export class CreateEngineerDto {
  @ApiProperty({ example: 'Ana Torres', maxLength: 80 }) @IsString() @MaxLength(120) name!: string;
  @ApiProperty({ example: 'Network engineer', maxLength: 60 }) @IsString() @MaxLength(120) role!: string;
  @ApiPropertyOptional({ example: ['Cisco', 'Terraform'], description: 'Up to 20 items' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) skills?: string[];
  @ApiPropertyOptional({ example: ['CCNP'], description: 'Up to 20 items' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) certifications?: string[];
  @ApiPropertyOptional({ example: 450000, description: 'Manager only: daily cost in whole pesos' }) @IsOptional() dailyCostCop?: number;
}

export class SetCostDto {
  @ApiProperty({ example: 450000, nullable: true, description: 'Daily cost in whole pesos (1 to 50.000.000) or null to clear it. Applies to allocations made after the change.' }) @IsOptional() dailyCostCop?: number | null;
}

export class AllocateDto {
  @ApiProperty({ example: 'Branch network upgrade', maxLength: 80 }) @IsString() @MaxLength(120) projectName!: string;
  @ApiProperty({ example: 50, minimum: 1, maximum: 100, description: 'Share of the working time, whole percent' }) @IsInt() percent!: number;
  @ApiProperty({ example: '2026-11-02', description: 'First day (inclusive)' }) @IsString() @MaxLength(10) startDate!: string;
  @ApiProperty({ example: '2026-11-30', description: 'Last day (inclusive)' }) @IsString() @MaxLength(10) endDate!: string;
  @ApiPropertyOptional({ description: 'Manager only: accept going over 100% on purpose. It is announced as OverAllocationDetected.' }) @IsOptional() @IsBoolean() allowOverallocation?: boolean;
}
