import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verify } from 'jsonwebtoken';

export const ROLES = ['project_lead', 'billing_analyst', 'sales', 'manager', 'finance', 'engineer', 'technician'] as const;
export type Role = (typeof ROLES)[number];
/** `staffId` solo lo traen el ingeniero y el técnico: la persona del personal técnico a la que pertenece la cuenta (viene del token firmado). */
export interface AuthUser { id: string; email: string; role: Role; staffId?: string }
const STAFF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const AUTH_OPTIONS = 'AUTH_OPTIONS';
export interface AuthOptions { publicKey: string; issuer: string; audience: string }

const BEARER = /^Bearer\s+([A-Za-z0-9._-]{10,4096})$/i;

/** Zero Trust: TODA ruta exige un JWT válido salvo las marcadas @Public(). La firma se verifica con la llave pública. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(AUTH_OPTIONS) private readonly opts: AuthOptions) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const match = BEARER.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Missing or malformed bearer token');
    try {
      const c: any = verify(match[1], this.opts.publicKey, { algorithms: ['RS256'], issuer: this.opts.issuer, audience: this.opts.audience, clockTolerance: 5 });
      if (!ROLES.includes(c.role) || typeof c.sub !== 'string' || typeof c.email !== 'string') throw new Error('bad claims');
      // Un ingeniero o un técnico sin la persona a la que pertenece no es un token válido.
      const staffId = typeof c.staffId === 'string' && STAFF_UUID.test(c.staffId) ? c.staffId.toLowerCase() : undefined;
      if ((c.role === 'engineer' || c.role === 'technician') !== (staffId !== undefined)) throw new Error('bad staff claim');
      req.user = { id: c.sub, email: c.email, role: c.role, ...(staffId ? { staffId } : {}) } as AuthUser;
      return true;
    } catch {
      // Mismo mensaje para firma mala, token vencido, audiencia errónea...: no se da pistas.
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/** El rol sale del token firmado, nunca del cuerpo ni de un encabezado que el cliente pueda fabricar. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!allowed) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !allowed.includes(user.role)) throw new ForbiddenException(`Role ${user?.role ?? 'unknown'} is not allowed to do this`);
    return true;
  }
}
