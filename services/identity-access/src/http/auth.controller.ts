import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LoginUseCase } from '../application/login.use-case';
import { LoginDto } from './login.dto';

export const LOGIN_USE_CASE = 'LOGIN_USE_CASE';
export const LOGIN_RATE_LIMIT = Number(process.env.LOGIN_RATE_LIMIT ?? 10);

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(LOGIN_USE_CASE) private readonly login: LoginUseCase) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_RATE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in and get a JWT' })
  @ApiResponse({ status: 200, description: 'Signed in' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  execute(@Body() dto: LoginDto) {
    return this.login.execute(dto.email, dto.password);
  }
}
