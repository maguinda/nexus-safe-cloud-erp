import { CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

export const INGEST_KEY = 'INGEST_KEY';
/** Una clave más corta se trata como «no configurada»: es mejor no aceptar lecturas que aceptarlas con una clave adivinable. */
export const INGEST_KEY_MIN_LENGTH = 32;
export const INGEST_KEY_HEADER = 'x-ingest-key';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Clave de servicio para los emisores de telemetría (sensores, simulador): no son personas, así que no tienen JWT ni rol. La clave NO sirve
 * para nada más (el resto de la API sigue pidiendo JWT) y un JWT de persona, ni siquiera el del gerente, NO sirve para ingerir.
 * Se compara el hash de ambas (misma longitud) con comparación en tiempo constante.
 */
@Injectable()
export class ServiceKeyGuard implements CanActivate {
  constructor(@Inject(INGEST_KEY) private readonly key: string) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.key.length < INGEST_KEY_MIN_LENGTH) throw new ServiceUnavailableException('Telemetry ingestion is not configured');
    const given = ctx.switchToHttp().getRequest().headers[INGEST_KEY_HEADER];
    // Mismo mensaje si falta o si está mal: no se da pistas.
    if (typeof given !== 'string' || !timingSafeEqual(digest(given), digest(this.key))) throw new UnauthorizedException('Invalid ingestion key');
    return true;
  }
}
