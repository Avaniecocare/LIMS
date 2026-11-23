import { helpProviderErrors } from '../../common/metrics.js';
import { costMicros, NO_USAGE, ProviderError, type AnswerInput, type AnswerProvider, type ProviderEvent, type Usage } from './providers/types.js';

/** The whole answer, every provider included. */
const TOTAL_MS = 45_000;
/** How long the first provider has to say something when there is another to ask. */
const FIRST_WORD_MS = 15_000;

export type AnswerEvent = Extract<ProviderEvent, { type: 'text' | 'done' }> | { type: 'spent'; usage: Usage; cost: number; model: string; attempts: number };

const tokens = (chars: number) => Math.ceil(chars / 3);

/**
 * Asks the providers in order. The next one is tried only when the one before was busy, down or too slow AND had not
 * said anything yet: two half answers are worse than none. `spent` is the running total over every attempt, sent
 * before each thing that can be interrupted, so whoever stops listening already knows the cost.
 */
export async function* answerFrom(providers: AnswerProvider[], request: Omit<AnswerInput, 'signal'>, visitor: AbortSignal): AsyncGenerator<AnswerEvent> {
  const overall = AbortSignal.any([visitor, AbortSignal.timeout(TOTAL_MS)]);
  const inputChars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
  let before = 0;
  let attempts = 0;
  for (const [i, provider] of providers.entries()) {
    attempts++;
    const last = i === providers.length - 1;
    const slow = new AbortController();
    const timer = last ? null : setTimeout(() => slow.abort(), FIRST_WORD_MS);
    let usage: Usage | null = null;
    let written = 0;
    const spent = (u: Usage): AnswerEvent => ({ type: 'spent', usage: u, cost: before + costMicros(provider.price, u), model: provider.model, attempts });
    // Output is reported only at the end, so until then what has been written is counted.
    const soFar = (): Usage => ({ ...(usage ?? NO_USAGE), outputTokens: Math.max(usage?.outputTokens ?? 0, written ? tokens(written) : 0) });
    try {
      for await (const ev of provider.answer({ ...request, signal: AbortSignal.any([overall, slow.signal]) })) {
        if (ev.type === 'usage') {
          usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, cacheReadTokens: ev.cacheReadTokens, cacheWriteTokens: ev.cacheWriteTokens };
          yield spent(soFar());
        } else if (ev.type === 'text') {
          if (timer) clearTimeout(timer);
          written += ev.text.length;
          yield spent(soFar());
          yield ev;
        } else {
          // The real figure now; an over-estimate of the output is dropped.
          yield spent(usage ?? soFar());
          yield ev;
          return;
        }
      }
      throw new ProviderError('was cut off', true);
    } catch (err) {
      const late = slow.signal.aborted && !overall.aborted;
      // Cut off with nothing reported: the provider may well have read the question, so that is charged.
      const stopped = err instanceof ProviderError && (err.message === 'stopped' || err.message === 'was cut off');
      const u = usage || written ? soFar() : stopped ? { ...NO_USAGE, inputTokens: tokens(inputChars) } : NO_USAGE;
      yield spent(u);
      before += costMicros(provider.price, u);
      if (!visitor.aborted) helpProviderErrors.inc({ provider: provider.name, model: provider.model, retryable: String(late || (err instanceof ProviderError && err.retryable)) });
      const another = !last && !written && !overall.aborted && (late || (err instanceof ProviderError && err.retryable));
      if (!another) throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
