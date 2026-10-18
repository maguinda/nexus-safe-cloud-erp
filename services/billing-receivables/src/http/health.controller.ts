import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard';

@ApiExcludeController()
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  @Get()
  ok() {
    return { status: 'ok' };
  }
}
