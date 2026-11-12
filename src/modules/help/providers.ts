import Anthropic from '@anthropic-ai/sdk';
import type { HelpConfig } from '../../config/infra.config.js';
import type { Hit } from './retrieval.js';

export type ProviderEvent = { type: 'text'; text: string } | { type: 'done'; inputTokens: number; outputTokens: number; cacheReadTokens: number; refused: boolean };

export interface AnswerProvider {
  readonly model: string;
  answer(input: { system: string; messages: Anthropic.MessageParam[]; maxTokens: number; signal: AbortSignal; hits: Hit[] }): AsyncGenerator<ProviderEvent>;
}

/** US dollars per million tokens, for the budget. Unknown models are priced like Sonnet, to stay on the safe side. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};
export function costMicros(model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0): number {
  const p = PRICES[model] ?? PRICES['claude-sonnet-5-5'];
  return Math.ceil(inputTokens * p.input + outputTokens * p.output + cacheReadTokens * p.cacheRead);
}

/** Claude, through the official SDK. The key lives only in this process's environment. */
export class AnthropicProvider implements AnswerProvider {
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000 });
  }

  async *answer({ system, messages, maxTokens, signal }: Parameters<AnswerProvider['answer']>[0]): AsyncGenerator<ProviderEvent> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: maxTokens,
        // The standing instructions never change, so they are cached; the excerpts and question come after.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        // Short, factual answers from given text: the lowest effort is enough and keeps cost and wait down.
        output_config: { effort: 'low' },
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
    }
    const final = await stream.finalMessage();
    yield {
      type: 'done',
      inputTokens: (final.usage.input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0),
      outputTokens: final.usage.output_tokens ?? 0,
      cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
      refused: final.stop_reason === 'refusal',
    };
  }
}

/**
 * Offline answers for development and tests (AI_PROVIDER=mock): the opening of the best excerpt and a link to it.
 * No network, no cost.
 */
export class MockProvider implements AnswerProvider {
  readonly model = 'mock';
  async *answer({ hits }: Parameters<AnswerProvider['answer']>[0]): AsyncGenerator<ProviderEvent> {
    const top = hits[0];
    const sentences = top.chunk.text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]/g) ?? [top.chunk.text];
    const text = `From the documentation: ${sentences.slice(0, 2).join(' ').trim()}\n\nSee: [${top.chunk.heading ?? top.chunk.title}](${top.chunk.url})`;
    for (const word of text.split(/(?<= )/)) yield { type: 'text', text: word };
    yield { type: 'done', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, refused: false };
  }
}

export function createProvider(cfg: HelpConfig): AnswerProvider | null {
  if (!cfg.enabled) return null;
  if (cfg.provider === 'mock') return new MockProvider();
  return cfg.apiKey ? new AnthropicProvider(cfg.apiKey, cfg.model) : null;
}
