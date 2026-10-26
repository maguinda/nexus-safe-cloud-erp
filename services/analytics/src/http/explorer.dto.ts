import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

// Nombres de oficina, tipos, categorías, dispositivos: letras (con tildes), números y los signos que traen los datos. Nada que se parezca a una consulta.
const NAME = /^[\p{L}\p{N} ._()/&-]{1,60}$/u;
const NAME_MSG = 'must be a name of up to 60 letters, numbers, spaces and . _ ( ) / & -';
export const MAX_LIMIT = 200;

class Page {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = 50;
  @ApiPropertyOptional({ minimum: 0, maximum: 100000, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset: number = 0;
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' }) @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'desc';
}

export class ReadingsQueryDto extends Page {
  @ApiPropertyOptional({ example: 'Oficina 1' }) @IsOptional() @Matches(NAME, { message: `location ${NAME_MSG}` }) location?: string;
  @ApiPropertyOptional({ example: 'Temperature Monitor' }) @IsOptional() @Matches(NAME, { message: `deviceKind ${NAME_MSG}` }) deviceKind?: string;
  @ApiPropertyOptional({ example: 'IOT-OF1-02' }) @IsOptional() @Matches(/^[A-Za-z0-9_-]{1,40}$/, { message: 'deviceId must be 1 to 40 letters, numbers, _ or -' }) deviceId?: string;
  @ApiPropertyOptional({ enum: ['normal', 'warning', 'alert'] }) @IsOptional() @IsIn(['normal', 'warning', 'alert']) severity?: 'normal' | 'warning' | 'alert';
  @ApiPropertyOptional({ example: 'WARNING' }) @IsOptional() @Matches(/^[A-Z_]{2,20}$/, { message: 'status must be 2 to 20 capital letters' }) status?: string;
  @ApiPropertyOptional({ example: '2026-09-13T09:00:00Z' }) @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @ApiPropertyOptional({ example: '2026-09-13T10:00:00Z' }) @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @ApiPropertyOptional({ enum: ['at', 'value', 'status', 'device'], default: 'at' }) @IsOptional() @IsIn(['at', 'value', 'status', 'device']) sort: 'at' | 'value' | 'status' | 'device' = 'at';
}

export class DevicesQueryDto extends Page {
  @ApiPropertyOptional({ example: 'Switch Acceso' }) @IsOptional() @Matches(NAME, { message: `category ${NAME_MSG}` }) category?: string;
  @ApiPropertyOptional({ enum: ['Crítica', 'Alta', 'Media'] }) @IsOptional() @IsIn(['Crítica', 'Alta', 'Media']) criticality?: string;
  @ApiPropertyOptional({ enum: ['yes', 'no'], description: 'yes: the 10 pieces of infrastructure with a monitoring row; no: all the others' }) @IsOptional() @IsIn(['yes', 'no']) monitored?: 'yes' | 'no';
  @ApiPropertyOptional({ example: '3560', description: 'Text inside the name, model, role or IP' }) @IsOptional() @IsString() @MaxLength(60) @Matches(/^[\p{L}\p{N} ._()/&;:-]*$/u, { message: 'q has characters that are not allowed' }) q?: string;
  @ApiPropertyOptional({ enum: ['id', 'name', 'category', 'criticality', 'model'], default: 'name' }) @IsOptional() @IsIn(['id', 'name', 'category', 'criticality', 'model']) sort: 'id' | 'name' | 'category' | 'criticality' | 'model' = 'name';
}

export class LinksQueryDto extends Page {
  @ApiPropertyOptional({ example: 'eCopper' }) @IsOptional() @Matches(NAME, { message: `linkType ${NAME_MSG}` }) linkType?: string;
  @ApiPropertyOptional({ enum: ['Crítica', 'Alta', 'Media'] }) @IsOptional() @IsIn(['Crítica', 'Alta', 'Media']) criticality?: string;
  @ApiPropertyOptional({ enum: ['yes', 'no', 'unknown'] }) @IsOptional() @IsIn(['yes', 'no', 'unknown']) functional?: 'yes' | 'no' | 'unknown';
  @ApiPropertyOptional({ example: 'Multilayer Switch0', description: 'Exact device name, as origin or destination' }) @IsOptional() @Matches(NAME, { message: `device ${NAME_MSG}` }) device?: string;
  @ApiPropertyOptional({ example: 'Fa0/1' }) @IsOptional() @IsString() @MaxLength(60) @Matches(/^[\p{L}\p{N} ._()/&;:-]*$/u, { message: 'q has characters that are not allowed' }) q?: string;
  @ApiPropertyOptional({ enum: ['id', 'origin', 'destination', 'criticality', 'length'], default: 'id' }) @IsOptional() @IsIn(['id', 'origin', 'destination', 'criticality', 'length']) sort: 'id' | 'origin' | 'destination' | 'criticality' | 'length' = 'id';
}
