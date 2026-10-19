import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

/** Cada petición lleva un id para seguirla entre servicios. Solo se acepta el que llega si tiene formato seguro. */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-correlation-id');
  const id = incoming && VALID.test(incoming) ? incoming : randomUUID();
  (req as any).correlationId = id;
  res.setHeader('x-correlation-id', id);
  next();
}
