import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard';

@Public()
@ApiExcludeController()
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  ok() {
    return { status: 'ok' };
  }
}
