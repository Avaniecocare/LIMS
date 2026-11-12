import { logger, setErrorReporter } from './logger.js';

/**
 * Sends server errors to an HTTPS endpoint as JSON, so any tracker (Sentry relay, Slack/Teams webhook, a log
 * collector) can receive them without a vendor library. Best effort: never blocks a request, at most 30 a minute,
 * and only the error's name, message and stack plus ids from the context, never request bodies.
 */
export function installErrorWebhook(url: string | null, service: string): void {
  if (!url) return;
  if (!/^https:\/\//.test(url)) {
    logger.warn('ERROR_TRACKING_DSN must be an https:// URL; error reporting is off');
    return;
  }
  let windowStart = Date.now();
  let sent = 0;
  setErrorReporter((error, context) => {
    if (Date.now() - windowStart > 60_000) {
      windowStart = Date.now();
      sent = 0;
    }
    if (++sent > 30) return;
    const e = error instanceof Error ? error : new Error(String(error));
    const ids = Object.fromEntries(Object.entries(context).filter(([k, v]) => /(Id|^queue)$/.test(k) && (typeof v === 'string' || typeof v === 'number')));
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service, time: new Date().toISOString(), name: e.name, message: e.message, stack: e.stack?.split('\n').slice(0, 20).join('\n'), context: ids }),
      signal: AbortSignal.timeout(3000),
    }).catch((err: unknown) => logger.warn({ err }, 'error webhook failed'));
  });
}
