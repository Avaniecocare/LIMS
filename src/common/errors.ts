import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { FastifyReply } from 'fastify';
import { getContext, REAUTH_WINDOW_MS } from './context.js';
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
    } else if (isPrismaError(exception, 'P2034') || isPgError(exception, '40P01') || isPgError(exception, '40001')) {
      // Deadlock or serialisation failure: nothing was saved, and trying again normally works.
      status = 409;
      code = 'CONFLICT';
      message = 'Someone else changed this at the same moment. Nothing was saved, so please try again.';
    } else if (isPrismaError(exception, 'P2028')) {
      status = 503;
      code = 'BUSY';
      message = 'The system is busy and could not finish in time. Nothing was saved, so please try again.';
    } else if (isPrismaError(exception, 'P2003') || isPgError(exception, '23503')) {
      status = 409;
      code = 'IN_USE';
      message = 'This record is linked to other records, so it cannot be changed this way.';
    } else if (hasStatusCode(exception)) {
      // Fastify-originated (payload too large, malformed JSON, ...)
      status = exception.statusCode;
      code = CODE_BY_STATUS[status] ?? 'ERROR';
      message = status < 500 ? exception.message : message;
    }

    if (status === 403 && code === 'FORBIDDEN') {
      const userId = getContext()?.user?.id;
      // The refusal still goes out; a failure to record it for the security alerts is logged, not shown to the user.
      if (userId && forbiddenHook) void forbiddenHook(userId).catch((err: unknown) => logger.warn({ err }, 'could not record a refused request'));
    }
    if (status >= 500) {
      logger.error({ err: exception, requestId }, 'unhandled error');
      reportError(exception, { requestId });
    }
    const body: ApiErrorBody = { error: { code, message, requestId, fields } };
    void reply.status(status).send(body);
  }
}

/** Set by the security module to watch for someone repeatedly trying things they may not do. */
let forbiddenHook: ((userId: string) => Promise<void>) | null = null;
export const setForbiddenHook = (fn: typeof forbiddenHook) => {
  forbiddenHook = fn;
};

function isPrismaError(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === code;
}

/** A Postgres SQLSTATE surfaced by the driver adapter, directly or as the cause of a Prisma error. */
function isPgError(e: unknown, sqlState: string): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const c = cur as { code?: unknown; cause?: unknown; meta?: { code?: unknown; driverAdapterError?: unknown } };
    if (c.code === sqlState || c.meta?.code === sqlState) return true;
    cur = c.cause ?? c.meta?.driverAdapterError;
  }
  return false;
}

function hasStatusCode(e: unknown): e is { statusCode: number; message: string } {
  return typeof e === 'object' && e !== null && typeof (e as { statusCode?: unknown }).statusCode === 'number';
}

/**
 * Sensitive actions (granting roles, changing role permissions, deactivating users, bulk exports) need the
 * person's password confirmed in this session within the last ten minutes. The UI answers REAUTH_REQUIRED by
 * asking for the password and retrying.
 */
export function requireRecentAuth(): void {
  const at = getContext()?.user?.reauthAt;
  if (!at || Date.now() - at > REAUTH_WINDOW_MS) throw new AppError('REAUTH_REQUIRED', 403, 'Confirm your password to continue with this change.');
}
