import type { Hit } from '../retrieval.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** `usage` is the running total so far, so an answer that fails half-way is still charged. */
export type ProviderEvent = { type: 'text'; text: string } | ({ type: 'usage' } & Usage) | { type: 'done'; stop: 'end' | 'length' | 'refusal' };

export interface AnswerInput {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
  hits: Hit[];
}

export interface AnswerProvider {
  readonly name: 'anthropic' | 'openai-compatible' | 'mock';
  readonly model: string;
  readonly price: Price;
  answer(input: AnswerInput): AsyncGenerator<ProviderEvent>;
}

/** The provider could not answer. `retryable`: busy, down or unreachable, so another provider may be tried. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** US dollars per million tokens, which is the same number as millionths of a dollar per token. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const costMicros = (p: Price, u: Usage): number => Math.ceil(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite);

/** The most one answer can cost: every character a token would be far too many, so three characters a token, all uncached. */
export const worstCaseMicros = (p: Price, input: Pick<AnswerInput, 'system' | 'messages' | 'maxTokens'>): number => {
  const chars = input.system.length + input.messages.reduce((n, m) => n + m.content.length, 0);
  return costMicros(p, { inputTokens: 0, outputTokens: input.maxTokens, cacheReadTokens: 0, cacheWriteTokens: Math.ceil(chars / 3) });
};
