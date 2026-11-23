import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type AnswerInput, type AnswerProvider, type Price, type ProviderEvent, type Usage } from './types.js';

/** Models that take `output_config.effort`. Others refuse the parameter. */
const TAKES_EFFORT = /^claude-(haiku-5-5|sonnet-(4-6|5|5-5)|opus-(4-[6-8]|5|5-5)|fable-5)/;

/** Claude, through the official SDK. The key lives only in this process's environment. */
export class AnthropicProvider implements AnswerProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
    readonly price: Price,
    baseURL?: string,
  ) {
    // Retries and falling back are decided in one place (fallback.ts), not here as well.
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000, ...(baseURL ? { baseURL } : {}) });
  }

  async *answer({ system, messages, maxTokens, signal }: AnswerInput): AsyncGenerator<ProviderEvent> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const take = (u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) => {
      usage.inputTokens = u.input_tokens ?? usage.inputTokens;
      usage.outputTokens = u.output_tokens ?? usage.outputTokens;
      usage.cacheReadTokens = u.cache_read_input_tokens ?? usage.cacheReadTokens;
      usage.cacheWriteTokens = u.cache_creation_input_tokens ?? usage.cacheWriteTokens;
      return { type: 'usage' as const, ...usage };
    };
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: maxTokens,
          // The standing instructions never change, so they are cached; the excerpts and question come after.
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
          // Short, factual answers from given text: the lowest effort is enough and keeps cost and wait down.
          ...(TAKES_EFFORT.test(this.model) ? { output_config: { effort: 'low' as const } } : {}),
        },
        { signal },
      );
      let stop: string | null = null;
      for await (const event of stream) {
        if (event.type === 'message_start') yield take(event.message.usage);
        else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
        else if (event.type === 'message_delta') {
          stop = event.delta.stop_reason;
          yield take(event.usage);
        }
      }
      yield { type: 'done', stop: stop === 'refusal' ? 'refusal' : stop === 'max_tokens' ? 'length' : 'end' };
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw new ProviderError('stopped', false);
      if (err instanceof Anthropic.APIConnectionError) throw new ProviderError('could not be reached', true);
      if (err instanceof Anthropic.APIError)
        throw new ProviderError(`answered ${err.status ?? 'with an error'}`, err.status === undefined || err.status === 408 || err.status === 429 || err.status >= 500);
      throw err;
    }
  }
}
