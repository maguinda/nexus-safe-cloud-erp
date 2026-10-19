import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { correlationId } from './http/correlation-id.middleware';
import { ApiExceptionFilter } from './http/http-exception.filter';

/** Construye la app igual para producción y para las pruebas e2e. */
export async function createApp(httpsOptions?: HttpsOptions): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false, httpsOptions, logger: process.env.NODE_ENV === 'test' ? false : undefined });
  app.use(correlationId);
  // Todo lo de helmet por defecto, salvo upgrade-insecure-requests: Safari lo aplica también a localhost y pediría los scripts del Swagger
  // por HTTPS, pero el puerto de la demo (DOCS_HTTP_PORT) es HTTP simple y la página quedaba en blanco. Una API que solo devuelve JSON no lo necesita.
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } } }));
  app.use(json({ limit: '10kb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  if (process.env.SWAGGER_ENABLED !== 'false') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('identity-access').setVersion('0.1.0').addBearerAuth().build());
    SwaggerModule.setup('docs', app, doc);
  }
  return app;
}
