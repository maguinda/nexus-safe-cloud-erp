import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { LANGUAGES } from '../domain/language';

export class SetLanguageDto {
  @ApiProperty({ enum: LANGUAGES, example: 'en' })
  @IsIn(LANGUAGES)
  language!: string;
}
