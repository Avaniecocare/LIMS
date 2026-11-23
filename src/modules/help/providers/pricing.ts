import type { Price } from './types.js';

/**
 * Anthropic's own prices, checked on 23 November 2026, for prompts of up to 100,000 tokens (the assistant's are far
 * smaller). Cache writes cost 1.25 times the input price. A model that is not here needs AI_PRICE_INPUT and
 * AI_PRICE_OUTPUT: guessing a price would make the budget meaningless.
 */
const ANTHROPIC: Record<string, Omit<Price, 'cacheWrite'>> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};

export function priceOf(provider: string, model: string, override: { input: number | null; output: number | null }): Price | null {
  // Prices given by hand charge cached tokens like any others, which can only overstate the cost.
  if (override.input !== null && override.output !== null) return { input: override.input, output: override.output, cacheRead: override.input, cacheWrite: override.input * 1.25 };
  const p = provider === 'anthropic' ? ANTHROPIC[model] : undefined;
  return p ? { ...p, cacheWrite: p.input * 1.25 } : null;
}
