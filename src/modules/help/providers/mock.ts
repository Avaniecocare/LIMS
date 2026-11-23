import type { AnswerInput, AnswerProvider, ProviderEvent } from './types.js';

/**
 * Offline answers for development and tests (AI_PROVIDER=mock): the opening of the best excerpt and a link to it.
 * No network, no cost.
 */
export class MockProvider implements AnswerProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';
  readonly price = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  async *answer({ hits }: AnswerInput): AsyncGenerator<ProviderEvent> {
    const top = hits[0];
    const sentences = top.chunk.text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]/g) ?? [top.chunk.text];
    const text = `From the documentation: ${sentences.slice(0, 2).join(' ').trim()}\n\nSee: [${top.chunk.heading ?? top.chunk.title}](${top.chunk.url})`;
    for (const word of text.split(/(?<= )/)) yield { type: 'text', text: word };
    yield { type: 'done', stop: 'end' };
  }
}
