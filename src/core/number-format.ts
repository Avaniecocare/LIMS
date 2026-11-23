const TOKENS = /\{[^{}]*\}/g;
const KNOWN_TOKEN = /^\{(PREFIX|FY|YY|SEQ(:\d{1,2})?)\}$/;

/** What is wrong with a number format, or null. An unknown token would otherwise print as it is typed. */
export function numberFormatProblem(format: unknown): string | null {
  if (typeof format !== 'string') return 'Must be text';
  const unknown = (format.match(TOKENS) ?? []).find((t) => !KNOWN_TOKEN.test(t));
  if (unknown) return `${unknown} is not a known token. Use {PREFIX}, {FY}, {YY} and {SEQ:n}.`;
  if (/[{}]/.test(format.replace(TOKENS, ''))) return 'Has an unmatched brace';
  if (!/\{SEQ(:\d{1,2})?\}/.test(format)) return 'Must contain a {SEQ:n} token';
  return null;
}
