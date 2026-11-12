/**
 * Checks on a question before anything costly happens. Pure, so each rule is unit-tested.
 * The model's own instructions are the second line of defence; these stop the obvious cases for free.
 */

export type GuardResult = { ok: true; question: string } | { ok: false; reason: 'empty' | 'too_long' | 'garbage' };

/** Plain text only: tags, control characters and runs of whitespace go. */
export function cleanQuestion(raw: unknown, maxLength: number): GuardResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > maxLength) return { ok: false, reason: 'too_long' };
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 3 || !/\p{L}{2,}/u.test(text)) return { ok: false, reason: 'garbage' };
  // "aaaaaaaa…" or a key held down.
  const counts = new Map<string, number>();
  for (const ch of text.replace(/\s/g, '')) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const top = Math.max(...counts.values());
  if (text.length >= 12 && top / text.replace(/\s/g, '').length > 0.6) return { ok: false, reason: 'garbage' };
  return { ok: true, question: text };
}

// Attempts to change the assistant's rules or read what it was told. Asking how to set an API key for an
// integration is a fair question, so "API key" on its own is not here.
const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|your|the|these|those|system)\b.{0,40}\b(instructions?|rules?|prompts?|directions?|guidelines?)\b/i,
  /\b(system|initial|hidden|original)\s+(prompt|instructions?|message)\b/i,
  /\b(reveal|print|show|repeat|output|display|leak|dump)\b.{0,40}\b(your|the)\b.{0,20}\b(prompt|instructions?|rules|configuration|config)\b/i,
  /\byour\s+(api|secret|access)\s+keys?\b/i,
  /\b(what|which)\s+is\s+(the|your)\s+(api|secret)\s+key\b/i,
  /\b(jailbreak|dan mode|developer mode|do anything now)\b/i,
  /\b(you are now|act as|pretend (to be|you are)|roleplay as)\b/i,
  /<\/?(system|instructions?|documentation|document)>/i,
];

export function looksLikeInjection(question: string): boolean {
  return INJECTION.some((r) => r.test(question));
}

// Requests that are plainly not about using the product. The retrieval check catches the rest.
const OFF_TOPIC = [
  /\b(write|compose|generate|create)\b.{0,30}\b(poem|story|essay|song|lyrics|joke|haiku|limerick|novel|tweet|cover letter|resume)\b/i,
  /\btell me a joke\b/i,
  /\b(weather|stock price|cricket score|horoscope|recipe)\b/i,
  /\btranslate\b.{0,40}\b(into|to)\b\s+\w+/i,
  /\b(write|debug|fix|refactor)\b.{0,30}\b(python|javascript|java|sql query|regex|c\+\+|function|script)\b/i,
  /\b(who (won|is the president|is the prime minister)|capital of)\b/i,
];

export function looksOffTopic(question: string): boolean {
  return OFF_TOPIC.some((r) => r.test(question));
}

/**
 * Personal data is not sent to the AI provider or kept in logs: email addresses, phone numbers, long numbers
 * (accounts, IDs) and GSTINs become placeholders. Product numbers like "AE/JOB/26-27/00012" stay readable.
 */
export function scrubPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/gi, '[gstin]')
    .replace(/(?<![\w/])(\+?\d[\d\s-]{8,}\d)(?![\w/])/g, '[number]');
}

/** Same question, ignoring case, spacing and punctuation: the answer cache's key. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
