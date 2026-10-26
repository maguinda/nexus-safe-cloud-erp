import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { GetAdviceUseCase } from '../application/get-advice.use-case';
import { Roles } from '../auth/auth.guard';

export const GET_ADVICE = 'GET_ADVICE';

export class AdviceRequestDto {
  @ApiProperty({ enum: ['es', 'en'] }) @IsIn(['es', 'en']) language!: 'es' | 'en';
  @ApiPropertyOptional({ default: false, description: 'true asks the model to write the recommendation (needs a configured key); false uses the rule templates' }) @IsOptional() @IsBoolean() ai: boolean = false;
}

@ApiTags('Advisor')
@ApiBearerAuth()
@Controller('advisor')
export class AdvisorController {
  constructor(@Inject(GET_ADVICE) private readonly advice: GetAdviceUseCase) {}

  /** Solo el gerente. Es POST porque con `ai: true` hace una llamada externa que cuesta: no debe dispararse por un prefetch ni por un GET en caché. */
  @Post('brief')
  @HttpCode(200)
  @Roles('manager')
  @Throttle({ default: { limit: Number(process.env.ADVISOR_RATE_LIMIT ?? 60), ttl: 60_000 } })
  @ApiOperation({ summary: 'What to do first: the findings of Sensors and Network ranked, written by rules or by the model and always tied to their evidence (role manager)' })
  @ApiResponse({ status: 400, description: 'The body is not valid' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  @ApiResponse({ status: 429, description: 'More than 60 requests in a minute' })
  brief(@Body() body: AdviceRequestDto) {
    return this.advice.execute(body.language, body.ai);
  }
}
