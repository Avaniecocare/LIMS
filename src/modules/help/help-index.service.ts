import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { logger } from '../../common/logger.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { HelpSearch, type HelpIndexFile } from './retrieval.js';

const REFRESH_MS = 10 * 60_000;

/**
 * The search index of the published help pages, built by the docs site (help-index.json). Read from
 * HELP_INDEX_PATH when set, otherwise from HELP_INDEX_URL (by default the help site on the app's own address).
 * A failed refresh keeps the last good copy.
 */
@Injectable()
export class HelpIndexService implements OnModuleInit, OnModuleDestroy {
  private current: HelpSearch | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(INFRA_CONFIG) private readonly infra: InfraConfig) {}

  async onModuleInit() {
    if (!this.infra.help.enabled) return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  get search(): HelpSearch | null {
    return this.current;
  }

  /** Tests and the docs build hand an index over directly. */
  use(index: HelpIndexFile) {
    this.current = new HelpSearch(validate(index));
  }

  async refresh() {
    const { indexPath, indexUrl } = this.infra.help;
    try {
      const raw = indexPath
        ? await readFile(indexPath, 'utf8')
        : await fetch(indexUrl, { signal: AbortSignal.timeout(15_000) }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          });
      const index = validate(JSON.parse(raw));
      if (index.version !== this.current?.version) {
        this.current = new HelpSearch(index);
        logger.info({ version: index.version, chunks: index.chunks.length }, 'help index loaded');
      }
    } catch (err) {
      logger.warn({ err, source: indexPath ?? indexUrl }, 'help index could not be loaded; the assistant keeps the last copy');
    }
  }
}

/** Only well-formed chunks whose links point into the help site are used. */
function validate(index: HelpIndexFile): HelpIndexFile {
  if (!index || typeof index.version !== 'string' || !Array.isArray(index.chunks)) throw new Error('not a help index');
  const chunks = index.chunks.filter(
    (c) =>
      c &&
      typeof c.id === 'string' &&
      typeof c.title === 'string' &&
      typeof c.text === 'string' &&
      typeof c.url === 'string' &&
      c.url.startsWith('/help/') &&
      (c.access === 'public' || c.access === 'staff'),
  );
  return { version: index.version, builtAt: String(index.builtAt ?? ''), embeddingModel: index.embeddingModel ?? null, chunks };
}
