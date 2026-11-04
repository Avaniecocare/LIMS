import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { FastifyReply } from 'fastify';
import { getContext } from './context.js';
import { logger, reportError } from './logger.js';

export interface FieldError {
  field: string;
  message: string;
}

/** The single error envelope used by every endpoint. */
export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string | null; fields: FieldError[] };
}

export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    status: number,
    message: string,
    public readonly fields: FieldError[] = [],
  ) {
    super(message, status);
  }
}

export const notFound = (what = 'Record') => new AppError('NOT_FOUND', 404, `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') => new AppError('FORBIDDEN', 403, message);
export const badRequest = (message: string, fields: FieldError[] = []) => new AppError('BAD_REQUEST', 400, message, fields);
export const conflict = (message = 'This record was changed by someone else. Reload and try again.') =>
  new AppError('CONFLICT', 409, message);
export const invalidTransition = (from: string, to: string) =>
  new AppError('INVALID_TRANSITION', 422, `Cannot move from ${from} to ${to}`);
export const reasonRequired = () =>
  new AppError('REASON_REQUIRED', 422, 'A reason is required', [{ field: 'reason', message: 'A reason is required' }]);
export const rule = (code: string, message: string) => new AppError(code, 422, message);

export function flattenValidation(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field: path, message }));
    return [...own, ...flattenValidation(e.children ?? [], path)];
  });
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = getContext()?.requestId ?? null;
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Quote the request ID when reporting this.';
    let fields: FieldError[] = [];

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      fields = exception.fields;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? 'ERROR';
      message = exception.message;
    } else if (isPrismaError(exception, 'P2002')) {
      status = 409;
      code = 'DUPLICATE';
      message = 'A record with this value already exists';
    } else if (isPrismaError(exception, 'P2025')) {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Record not found';
    } else if (hasStatusCode(exception)) {
      // Fastify-originated (payload too large, malformed JSON, ...)
      status = exception.statusCode;
      code = CODE_BY_STATUS[status] ?? 'ERROR';
      message = status < 500 ? exception.message : message;
    }

    if (status >= 500) {
      logger.error({ err: exception, requestId }, 'unhandled error');
      reportError(exception, { requestId });
    }
    const body: ApiErrorBody = { error: { code, message, requestId, fields } };
    void reply.status(status).send(body);
  }
}

function isPrismaError(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === code;
}

function hasStatusCode(e: unknown): e is { statusCode: number; message: string } {
  return typeof e === 'object' && e !== null && typeof (e as { statusCode?: unknown }).statusCode === 'number';
}
