import { Body, Controller, ForbiddenException, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LoginUseCase } from '../application/login.use-case';
import { SessionService } from '../application/session.service';
import { InvalidSessionError } from '../domain/errors';
import { Public } from '../auth/auth.guard';
import { LoginDto } from './login.dto';
import { clearedRefreshCookie, readRefreshCookie, refreshCookie, REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from './session-cookie';

export const LOGIN_USE_CASE = 'LOGIN_USE_CASE';
export const SESSION_SERVICE = 'SESSION_SERVICE';
export const COOKIE_SECURE = 'COOKIE_SECURE';
export const LOGIN_RATE_LIMIT = Number(process.env.LOGIN_RATE_LIMIT ?? 10);
export const REFRESH_RATE_LIMIT = Number(process.env.REFRESH_RATE_LIMIT ?? 60);

/** Defensa extra contra CSRF (además de SameSite=Strict): un sitio ajeno no puede poner una cabecera propia sin permiso del navegador. */
function requireRequestedWith(req: Request): void {
  if (req.headers[REQUESTED_WITH_HEADER] !== REQUESTED_WITH_VALUE) throw new ForbiddenException(`Missing or wrong ${REQUESTED_WITH_HEADER} header`);
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(LOGIN_USE_CASE) private readonly login: LoginUseCase,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(COOKIE_SECURE) private readonly secure: boolean,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_RATE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in: returns a JWT and sets the session-renewal cookie' })
  @ApiResponse({ status: 200, description: 'Signed in. The renewal token travels ONLY in the HttpOnly cookie, never in the body' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  async execute(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, ...body } = await this.login.execute(dto.email, dto.password);
    if (refreshToken) res.setHeader('Set-Cookie', refreshCookie(refreshToken, { secure: this.secure }));
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: REFRESH_RATE_LIMIT, ttl: 60_000 } })
  @ApiHeader({ name: REQUESTED_WITH_HEADER, description: `Must be "${REQUESTED_WITH_VALUE}"`, required: true })
  @ApiOperation({ summary: 'Renew the session: trades the renewal cookie for a new JWT and a new cookie (rotation)' })
  @ApiResponse({ status: 200, description: 'New JWT and user data; the cookie is replaced' })
  @ApiResponse({ status: 401, description: 'No cookie, or it does not exist, expired, was revoked, or the person no longer exists: sign in again (the cookie is cleared)' })
  @ApiResponse({ status: 403, description: `Missing ${REQUESTED_WITH_HEADER} header` })
  @ApiResponse({ status: 409, description: 'Another renewal with the same cookie won a moment ago: retry (nothing is revoked)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireRequestedWith(req);
    try {
      const { refreshToken, ...body } = await this.sessions.renew(readRefreshCookie(req.headers.cookie));
      res.setHeader('Set-Cookie', refreshCookie(refreshToken, { secure: this.secure }));
      res.setHeader('Cache-Control', 'no-store');
      return body;
    } catch (e) {
      // Una sesión que no sirve se borra del navegador; una carrera («reintenta») NO: la cookie que ya tiene es la buena.
      if (e instanceof InvalidSessionError) res.setHeader('Set-Cookie', clearedRefreshCookie({ secure: this.secure }));
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiHeader({ name: REQUESTED_WITH_HEADER, description: `Must be "${REQUESTED_WITH_VALUE}"`, required: true })
  @ApiOperation({ summary: 'Sign out: revokes the whole session and clears the renewal cookie' })
  @ApiResponse({ status: 204, description: 'Signed out (also when there was no session)' })
  @ApiResponse({ status: 403, description: `Missing ${REQUESTED_WITH_HEADER} header` })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireRequestedWith(req);
    await this.sessions.end(readRefreshCookie(req.headers.cookie));
    res.setHeader('Set-Cookie', clearedRefreshCookie({ secure: this.secure }));
  }
}
