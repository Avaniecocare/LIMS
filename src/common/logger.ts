import { pino } from 'pino';

/** Structured logs. Redaction is a backstop; callers must not log sensitive values at all. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'password',
      'currentPassword',
      'newPassword',
      'passwordHash',
      'totpSecret',
      'cookie',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'authorization',
      '*.password',
      '*.passwordHash',
      '*.totpSecret',
    ],
    censor: '[redacted]',
  },
  base: { service: 'lims' },
});

export type ErrorReporter = (error: unknown, context: Record<string, unknown>) => void;
let reporter: ErrorReporter | null = null;

/** Error tracking hook: wire Sentry or similar here without touching call sites. */
export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  try {
    reporter?.(error, context);
  } catch (e) {
    logger.warn({ err: e }, 'error reporter failed');
  }
}
