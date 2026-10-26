import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { CannotChangeOwnRoleError, EmailTakenError, InvalidCredentialsError, InvalidLanguageError, LastManagerError, NotAManagerError, UserNotFoundError, WeakPasswordError } from '../domain/errors';

/** Todas las respuestas de error tienen la misma forma (ver docs/openapi.yaml, schema Error). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const correlationId = (req as any).correlationId;
    let statusCode = 500;
    let error = 'Internal Server Error';
    let message = 'Unexpected error';

    if (err instanceof InvalidCredentialsError) {
      statusCode = 401; error = 'Unauthorized'; message = err.message;
    } else if (err instanceof WeakPasswordError || err instanceof InvalidLanguageError) {
      statusCode = 400; error = 'Bad Request'; message = err.message;
    } else if (err instanceof NotAManagerError) {
      statusCode = 403; error = 'Forbidden'; message = err.message;
    } else if (err instanceof UserNotFoundError) {
      statusCode = 404; error = 'Not Found'; message = err.message;
    } else if (err instanceof EmailTakenError || err instanceof CannotChangeOwnRoleError || err instanceof LastManagerError) {
      statusCode = 409; error = 'Conflict'; message = err.message;
    } else if (err instanceof HttpException) {
      statusCode = err.getStatus();
      const body: any = err.getResponse();
      error = typeof body === 'object' && body.error ? body.error : err.name;
      const m = typeof body === 'object' ? body.message : body;
      message = Array.isArray(m) ? m.join('; ') : String(m);
    } else if (typeof (err as any)?.status === 'number' && (err as any).status >= 400 && (err as any).status < 500) {
      // Errores del parser de Express (cuerpo muy grande, JSON mal formado): su código es del cliente, no un fallo nuestro.
      statusCode = (err as any).status;
      error = statusCode === 413 ? 'Payload Too Large' : 'Bad Request';
      message = statusCode === 413 ? 'Request body too large' : 'Malformed request';
    } else {
      // No se filtra el detalle al cliente: queda en el log con el correlationId.
      this.log.error(`${correlationId} ${err instanceof Error ? err.stack : String(err)}`);
    }
    res.status(statusCode).json({ statusCode, error, message, correlationId });
  }
}
