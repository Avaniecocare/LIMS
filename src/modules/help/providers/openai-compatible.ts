import { ProviderError, type AnswerInput, type AnswerProvider, type Price, type ProviderEvent } from './types.js';

interface Chunk {
  choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: unknown;
}

/**
 * Any service with an OpenAI-style /chat/completions endpoint, a lab's own model server included. The address and
 * key come only from the server's environment, never from Admin, so nobody can point it somewhere else.
 */
export class OpenAiCompatibleProvider implements AnswerProvider {
  readonly name = 'openai-compatible' as const;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
    readonly model: string,
    readonly price: Price,
  ) {}

  async *answer({ system, messages, maxTokens, signal }: AnswerInput): AsyncGenerator<ProviderEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'system', content: system }, ...messages] }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw new ProviderError('stopped', false);
      throw new ProviderError(err instanceof Error ? 'could not be reached' : 'failed', true);
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new ProviderError(`answered ${res.status}`, res.status === 408 || res.status === 429 || res.status >= 500);
    }
    let finish: string | null = null;
    let refused = false;
    let usage = false;
    let written = 0;
    const inputChars = system.length + messages.reduce((n, m) => n + m.content.length, 0);
    // Not every service reports usage, and none does when cut off: an estimate, replaced by the real figure if it comes.
    const estimate = () => ({ type: 'usage' as const, inputTokens: Math.ceil(inputChars / 3), outputTokens: Math.ceil(written / 3), cacheReadTokens: 0, cacheWriteTokens: 0 });
    yield estimate();
    try {
      for await (const chunk of sse(res.body)) {
        if (chunk.error) throw new ProviderError('failed part-way', true);
        const choice = chunk.choices?.[0];
        if (choice?.delta?.refusal) refused = true;
        if (choice?.delta?.content) {
          written += choice.delta.content.length;
          yield { type: 'text', text: choice.delta.content };
          if (!usage) yield estimate();
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) {
          usage = true;
          yield { type: 'usage', inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(signal.aborted ? 'stopped' : 'was cut off', !signal.aborted);
    }
    if (!finish) throw new ProviderError('was cut off', true);
    yield { type: 'done', stop: refused || finish === 'content_filter' ? 'refusal' : finish === 'length' ? 'length' : 'end' };
  }
}

async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<Chunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const part of body) {
    buffer += decoder.decode(part, { stream: true });
    if (buffer.length > 1_000_000) throw new ProviderError('sent an unreadable answer', false);
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      yield JSON.parse(data) as Chunk;
    }
  }
}
