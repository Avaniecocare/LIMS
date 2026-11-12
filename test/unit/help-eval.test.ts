import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HelpSearch, isRelevant, type HelpIndexFile } from '../../src/modules/help/retrieval.js';
import evalSet from '../fixtures/help-eval.json' with { type: 'json' };

/**
 * Retrieval quality against the real help site's index (built by `npm run build` in LIMS-UI/docs-site).
 * For each answerable question, one of its expected pages must be among the top three sources; questions the
 * docs do not cover must be stopped by the relevance gate (no model call). Skipped when the index is not built.
 */
const indexFile = new URL('../../../LIMS-UI/docs-site/dist/help-index.json', import.meta.url).pathname;
const built = existsSync(indexFile);

describe.skipIf(!built)('help assistant retrieval on the real docs', () => {
  const search = built ? new HelpSearch(JSON.parse(readFileSync(indexFile, 'utf8')) as HelpIndexFile) : null!;
  const page = (url: string) => url.split('#')[0];

  it('finds the right page for real questions, and stops on questions the docs do not answer', () => {
    const rows = evalSet.answerable.map(({ q, pages }) => {
      const r = search.search(q, { staff: false, k: 5 });
      const top = r.hits.map((h) => page(h.chunk.url));
      const rank = top.findIndex((u) => pages.includes(u));
      return { q, rank, relevant: isRelevant(r), got: top.slice(0, 3) };
    });
    const top1 = rows.filter((r) => r.rank === 0).length;
    const top3 = rows.filter((r) => r.rank >= 0 && r.rank < 3 && r.relevant).length;
    const gated = rows.filter((r) => !r.relevant);
    const wrong = rows.filter((r) => r.relevant && (r.rank < 0 || r.rank >= 3));
    const notFound = evalSet.notInDocs.map((q) => ({ q, relevant: isRelevant(search.search(q, { staff: false, k: 5 })) }));
    const correctlyNotFound = notFound.filter((r) => !r.relevant).length;
    const report = [
      `answerable: ${rows.length}, right page first: ${top1}, right page in top 3: ${top3}, stopped as not found: ${gated.length}, wrong sources: ${wrong.length}`,
      `not in docs: ${notFound.length}, correctly not found: ${correctlyNotFound}`,
      ...gated.map((r) => `  stopped: ${r.q}`),
      ...wrong.map((r) => `  wrong: ${r.q} -> ${r.got.join(', ')}`),
      ...notFound.filter((r) => r.relevant).map((r) => `  answered but not in docs: ${r.q}`),
    ].join('\n');
    console.log(report);
    // Questions written after the gate was tuned, run as they are: a check that the tuning did not overfit.
    const held = evalSet.heldOut.answerable.map(({ q, pages }) => {
      const r = search.search(q, { staff: false, k: 5 });
      const rank = r.hits.map((h) => page(h.chunk.url)).findIndex((u) => pages.includes(u));
      return { q, ok: isRelevant(r) && rank >= 0 && rank < 3, got: r.hits.slice(0, 3).map((h) => page(h.chunk.url)) };
    });
    const heldNotFound = evalSet.heldOut.notInDocs.filter((q) => !isRelevant(search.search(q, { staff: false, k: 5 }))).length;
    console.log(
      [
        `held out: ${held.filter((h) => h.ok).length}/${held.length} right page in top 3; not in docs stopped ${heldNotFound}/${evalSet.heldOut.notInDocs.length}`,
        ...held.filter((h) => !h.ok).map((h) => `  held-out miss: ${h.q} -> ${h.got.join(', ')}`),
      ].join('\n'),
    );
    expect(held.filter((h) => h.ok).length / held.length).toBeGreaterThanOrEqual(0.75);
    expect(top3 / rows.length, report).toBeGreaterThanOrEqual(0.9);
    expect(correctlyNotFound / notFound.length, report).toBeGreaterThanOrEqual(0.8);
  });
});
