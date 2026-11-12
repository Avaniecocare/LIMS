/**
 * Search over the published help pages. Pure (no I/O), so it can be tested directly.
 *
 * BM25 keyword scoring over title, heading and text (titles and headings count more), optionally blended with
 * vector similarity when the index carries embeddings. Results are filtered by who is asking: anonymous visitors
 * only ever get `public` chunks.
 */
export interface HelpChunk {
  id: string;
  title: string;
  url: string;
  heading: string | null;
  /** the page's one-line summary, from its front matter */
  description?: string | null;
  access: 'public' | 'staff';
  text: string;
  vector?: number[];
}
export interface HelpIndexFile {
  version: string;
  builtAt: string;
  embeddingModel: string | null;
  chunks: HelpChunk[];
}
export interface Hit {
  chunk: HelpChunk;
  score: number;
}

// Common English words, plus words every question about the product shares ("how do I…").
const STOP = new Set(
  'a an and are as at be by can could do does for from get go has have how i if in into is it its me my of on or our should so that the their them then there these this to use using want we what when where which who why will with would you your lims please tell show need'.split(
    ' ',
  ),
);

/** Lower-case word stems: "invoices", "invoicing" and "invoiced" all match "invoice". */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    let w = raw;
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

// TODO(product-decision): how sure retrieval must be before the model is called. Below this, the visitor gets
// "not in the documentation" and suggested pages, at no cost.
export const MIN_SCORE = 2.5;
export const MIN_COVERAGE = 0.6;

/** Whether the docs plausibly answer the question: the gate in front of the model. */
export function isRelevant(r: { hits: Hit[]; coverage: number }): boolean {
  return r.hits.length > 0 && r.hits[0].score >= MIN_SCORE && r.coverage >= MIN_COVERAGE;
}

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;
const HEADING_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;

export class HelpSearch {
  private readonly docs: { chunk: HelpChunk; tf: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(readonly index: HelpIndexFile) {
    this.docs = index.chunks.map((chunk) => {
      const tf = new Map<string, number>();
      const add = (text: string | null, weight: number) => {
        for (const t of terms(text ?? '')) tf.set(t, (tf.get(t) ?? 0) + weight);
      };
      add(chunk.title, TITLE_WEIGHT);
      add(chunk.heading, HEADING_WEIGHT);
      add(chunk.description ?? null, DESCRIPTION_WEIGHT);
      add(chunk.text, 1);
      let length = 0;
      for (const v of tf.values()) length += v;
      return { chunk, tf, length };
    });
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLength = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }

  get version() {
    return this.index.version;
  }

  get size() {
    return this.docs.length;
  }

  /**
   * The best chunks for a question. `coverage` is the share of the question's distinct terms found in the best
   * chunk: the cheap on-topic check that runs before any model is called.
   */
  search(question: string, opts: { staff: boolean; k?: number; queryVector?: number[] | null }): { hits: Hit[]; coverage: number; queryTerms: string[] } {
    const q = [...new Set(terms(question))];
    const n = this.docs.length;
    const scored: Hit[] = [];
    for (const d of this.docs) {
      if (d.chunk.access === 'staff' && !opts.staff) continue;
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / this.avgLength));
      }
      if (opts.queryVector && d.chunk.vector) s = s * 0.5 + cosine(opts.queryVector, d.chunk.vector) * 10 * 0.5;
      if (s > 0) scored.push({ chunk: d.chunk, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    // At most two chunks per page, so one long page cannot crowd out the others.
    const perPage = new Map<string, number>();
    const hits: Hit[] = [];
    for (const h of scored) {
      const page = h.chunk.url.split('#')[0];
      const seen = perPage.get(page) ?? 0;
      if (seen >= 2) continue;
      perPage.set(page, seen + 1);
      hits.push(h);
      if (hits.length >= (opts.k ?? 5)) break;
    }
    const best = hits[0];
    const covered = best ? q.filter((t) => this.docs.find((d) => d.chunk.id === best.chunk.id)!.tf.has(t)).length : 0;
    return { hits, coverage: q.length ? covered / q.length : 0, queryTerms: q };
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
