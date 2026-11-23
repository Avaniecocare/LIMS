import { createServer, type Server } from 'node:http';
import { logger } from '../common/logger.js';
import { registry } from '../common/metrics.js';

export interface Probes {
  /** false: restart this process */
  live: () => boolean;
  /** rejects: do not send it work yet */
  ready: () => Promise<unknown>;
}

const within = (ms: number, p: Promise<unknown>) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms).unref())]);

/**
 * The internal operations port: health and metrics. Never published or put behind the proxy; in Kubernetes a network
 * policy lets only monitoring reach it. It answers even when the main server is busy.
 */
export function startOpsServer(port: number, probes: Probes): Server {
  const server = createServer((req, res) => {
    const send = (status: number, body: string, type = 'text/plain') => res.writeHead(status, { 'Content-Type': type }).end(body);
    const path = req.url?.split('?')[0];
    if (req.method !== 'GET') send(405, 'method not allowed');
    else if (path === '/live') {
      const live = probes.live();
      send(live ? 200 : 503, live ? 'ok' : 'not running');
    } else if (path === '/ready')
      within(4_000, probes.ready()).then(
        () => send(200, 'ok'),
        () => send(503, 'not ready'),
      );
    else if (path === '/metrics')
      within(10_000, registry.metrics()).then(
        (text) => send(200, text as string, registry.contentType),
        (err) => {
          logger.warn({ err }, 'metrics could not be collected');
          send(500, 'metrics could not be collected');
        },
      );
    else send(404, 'not found');
  });
  server.headersTimeout = 5_000;
  server.on('error', (err) => logger.error({ err, port }, 'the operations port could not be opened'));
  server.listen(port, '0.0.0.0', () => logger.info({ port }, 'operations port listening'));
  return server;
}
