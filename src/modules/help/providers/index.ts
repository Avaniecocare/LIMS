import type { HelpConfig, HelpProviderConfig } from '../../../config/infra.config.js';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';
import type { AnswerProvider } from './types.js';

function create(c: HelpProviderConfig): AnswerProvider {
  if (c.provider === 'mock') return new MockProvider();
  if (c.provider === 'anthropic') return new AnthropicProvider(c.apiKey!, c.model, c.price!, c.baseUrl ?? undefined);
  return new OpenAiCompatibleProvider(c.baseUrl!, c.apiKey, c.model, c.price!);
}

/** The provider to ask first, then the one to fall back to, if set. Empty when the assistant is off. */
export const createProviders = (cfg: HelpConfig): AnswerProvider[] => (cfg.enabled ? cfg.providers.map(create) : []);
