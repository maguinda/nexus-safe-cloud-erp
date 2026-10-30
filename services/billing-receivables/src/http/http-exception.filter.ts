import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ContractNotFoundError, ContractStateError, InvalidContractError, InvalidPaymentError, OverpaymentError, PaymentNotAllowedError, DeliveryLimitError, EInvoiceNotFoundError, EInvoiceNotReadyError, InvalidCustomerError, InvoiceNotDraftError, InvoiceNotFoundError, NumberingExhaustedError } from '../domain/errors';

/** Todas las respuestas de error tienen la misma forma (docs/openapi.yaml, schema Error). */
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

    if (err instanceof InvoiceNotFoundError || err instanceof EInvoiceNotFoundError) {
      statusCode = 404; error = 'Not Found'; message = err.message;
    } else if (err instanceof InvalidCustomerError) {
      statusCode = 400; error = 'Bad Request'; message = err.message;
    } else if (err instanceof EInvoiceNotReadyError || err instanceof NumberingExhaustedError || err instanceof DeliveryLimitError) {
      statusCode = 409; error = 'Conflict'; message = err.message;
    } else if (err instanceof ContractNotFoundError) {
      statusCode = 404; error = 'Not Found'; message = err.message;
    } else if (err instanceof InvalidContractError) {
      statusCode = 400; error = 'Bad Request'; message = err.message;
    } else if (err instanceof ContractStateError) {
      statusCode = 409; error = 'Conflict'; message = err.message;
    } else if (err instanceof InvalidPaymentError) {
      statusCode = 400; error = 'Bad Request'; message = err.message;
    } else if (err instanceof PaymentNotAllowedError || err instanceof OverpaymentError) {
      statusCode = 409; error = 'Conflict'; message = err.message;
    } else if (err instanceof InvoiceNotDraftError) {
      statusCode = 409; error = 'Conflict'; message = err.message;
    } else if (err instanceof HttpException) {
      statusCode = err.getStatus();
      const body: any = err.getResponse();
      error = typeof body === 'object' && body.error ? body.error : err.name;
      const m = typeof body === 'object' ? body.message : body;
      message = Array.isArray(m) ? m.join('; ') : String(m);
    } else if (typeof (err as any)?.status === 'number' && (err as any).status >= 400 && (err as any).status < 500) {
      statusCode = (err as any).status;
      error = statusCode === 413 ? 'Payload Too Large' : 'Bad Request';
      message = statusCode === 413 ? 'Request body too large' : 'Malformed request';
    } else {
      this.log.error(`${correlationId} ${err instanceof Error ? err.stack : String(err)}`);
    }
    res.status(statusCode).json({ statusCode, error, message, correlationId });
  }
}
