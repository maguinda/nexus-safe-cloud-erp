import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { ROLES, Role } from '../domain/role';
import { normalizeEmail, normalizeName } from '../domain/user-admin';

const str = (f: (s: string) => string) => ({ value }: { value: unknown }) => (typeof value === 'string' ? f(value) : value);

export class CreateUserDto {
  @ApiProperty({ example: 'carlos.perez@nexus.example', maxLength: 254 })
  @Transform(str(normalizeEmail))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Carlos Pérez', minLength: 1, maxLength: 120 })
  @Transform(str(normalizeName))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/^[^\p{C}]+$/u, { message: 'name must not contain control characters' })
  name!: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: Role;

  @ApiPropertyOptional({ description: 'Required for engineer and technician (the staff member the account belongs to) and forbidden for the other roles' })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiProperty({ description: 'Initial password: 12 characters at least, 72 bytes at most (the rules are checked by the domain)', maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: Role;
}
