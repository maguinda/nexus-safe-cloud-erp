import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Warehouse Wi-Fi rollout', maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'Nexus Safe-Cloud', maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120)
  client!: string;
}

export class CreateMilestoneDto {
  @ApiProperty({ example: 'Site survey and design', maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 12000000, description: 'Whole Colombian pesos, 1 to 1,000,000,000', minimum: 1, maximum: 1000000000 })
  @IsInt() @Min(1) @Max(1_000_000_000)
  amountCop!: number;
}
