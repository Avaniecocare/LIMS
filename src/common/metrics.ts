import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { logger } from './logger.js';

/**
 * Numbers for monitoring, served on the internal operations port only. Labels are fixed words (routes, queue names,
 * outcomes), never ids, names or addresses: those would be customer data, and would grow without end.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });
const registers = [registry];

export const httpDuration = new Histogram({
  name: 'lims_http_request_duration_seconds',
  help: 'API requests, by route',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers,
});
export const jobsTotal = new Counter({ name: 'lims_jobs_total', help: 'Background jobs finished', labelNames: ['queue', 'result'] as const, registers });
export const jobDuration = new Histogram({
  name: 'lims_job_duration_seconds',
  help: 'Background job time',
  labelNames: ['queue'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers,
});
export const taskLastSuccess = new Gauge({ name: 'lims_scheduled_task_last_success_timestamp_seconds', help: 'When each scheduled task last finished', labelNames: ['task'] as const, registers });
export const helpAnswers = new Counter({ name: 'lims_help_answers_total', help: 'Help assistant questions', labelNames: ['outcome', 'model'] as const, registers });
export const helpTokens = new Counter({ name: 'lims_help_tokens_total', help: 'Help assistant tokens', labelNames: ['direction', 'model'] as const, registers });
export const helpCost = new Counter({ name: 'lims_help_cost_dollars_total', help: 'Help assistant spending, US dollars', labelNames: ['model'] as const, registers });
export const helpLatency = new Histogram({ name: 'lims_help_answer_duration_seconds', help: 'Help assistant answer time, model answers only', buckets: [0.5, 1, 2, 4, 8, 15, 30, 45], registers });
export const helpProviderErrors = new Counter({
  name: 'lims_help_provider_errors_total',
  help: 'A provider that failed to answer',
  labelNames: ['provider', 'model', 'retryable'] as const,
  registers,
});

const measureErrors = new Gauge({ name: 'lims_metric_error', help: '1 when a metric could not be measured', labelNames: ['metric'] as const, registers });

/** Measured when asked for, by whichever process has the answer. */
export function measured(name: string, help: string, labelNames: string[], read: () => Promise<{ labels?: Record<string, string>; value: number }[]>): void {
  registry.removeSingleMetric(name);
  new Gauge({
    name,
    help,
    labelNames,
    registers,
    async collect() {
      this.reset();
      try {
        for (const { labels, value } of await read()) this.set(labels ?? {}, value);
        measureErrors.labels(name).set(0);
      } catch (err) {
        // One thing that cannot be measured (the database is down) must not take the rest away.
        measureErrors.labels(name).set(1);
        logger.warn({ err, metric: name }, 'a metric could not be measured');
      }
    },
  });
}
