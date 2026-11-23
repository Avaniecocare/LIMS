import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { runWithContext } from './common/context.js';
import { AllExceptionsFilter, AppError, flattenValidation } from './common/errors.js';
import { installErrorWebhook } from './common/error-webhook.js';
import { logger } from './common/logger.js';
import { httpDuration } from './common/metrics.js';
import { INFRA_CONFIG, parseTrustProxy, type InfraConfig } from './config/infra.config.js';

/** Builds the API. Tests use this too, so they exercise the same middleware as production. */
export async function createApp(options: { trustProxy?: boolean | number | string } = {}): Promise<NestFastifyApplication> {
  const trust = options.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY);
  // This Fastify takes a hop count only as a function: the nearest `trust` addresses are ours.
  const adapter = new FastifyAdapter({ trustProxy: typeof trust === 'number' ? (_address: string, hop: number) => hop < trust : trust, bodyLimit: 2 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: ['warn', 'error'], rawBody: true }); // raw bodies: webhook signatures
  const infra = app.get<InfraConfig>(INFRA_CONFIG);
  installErrorWebhook(infra.errorTrackingDsn, 'lims');
  const fastify = app.getHttpAdapter().getInstance();

  // Request id plus AsyncLocalStorage context, for logs and the audit trail.
  fastify.addHook('onRequest', (req, reply, done) => {
    const header = req.headers['x-request-id'];
    const requestId = typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : randomUUID();
    void reply.header('X-Request-Id', requestId);
    (req as unknown as { startedAt: number }).startedAt = Date.now();
    runWithContext({ requestId, ip: req.ip ?? null, userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null }, done);
  });
  fastify.addHook('onResponse', (req, reply, done) => {
    // The route's pattern, not its address: addresses hold record ids.
    const route = (req as unknown as { routeOptions?: { url?: string } }).routeOptions?.url ?? 'none';
    httpDuration.observe({ method: req.method, route, status: String(reply.statusCode) }, reply.elapsedTime / 1000);
    if (req.url.startsWith('/health/') && reply.statusCode < 400) return done();
    logger.info(
      {
        requestId: reply.getHeader('X-Request-Id'),
        method: req.method,
        url: req.url.split('?')[0],
        status: reply.statusCode,
        ms: Date.now() - (req as unknown as { startedAt: number }).startedAt,
      },
      'request',
    );
    done();
  });

  await app.register(helmet as never, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const appCors = {
    origin: infra.frontendOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'X-Requested-With'],
    exposedHeaders: ['X-Request-Id'],
  };
  // The help site may live on another address (ALLOWED_ORIGINS); it is allowed for the help endpoints only.
  const helpCors = { ...appCors, origin: infra.help.allowedOrigins, methods: ['GET', 'POST'] };
  await app.register(cors as never, () => (req: { url: string }, cb: (e: Error | null, o: object) => void) => cb(null, req.url.startsWith('/api/v1/help/') ? helpCors : appCors));
  await app.register(cookie as never);
  await app.register(multipart as never, { limits: { fileSize: infra.maxUploadBytes, files: 1 } });

  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health/{*path}', method: RequestMethod.GET }] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new AppError('VALIDATION_FAILED', 400, 'Please check the highlighted fields', flattenValidation(errors)),
    }),
  );
  return app;
}

/** OpenAPI generated from the code. */
export function buildOpenApi(app: NestFastifyApplication) {
  const config = new DocumentBuilder().setTitle('LIMS API').setVersion('1').addCookieAuth('lims_sid').build();
  return SwaggerModule.createDocument(app, config);
}
