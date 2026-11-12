import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import type { CompanySnapshot } from '../../config/company.config.js';
import { esc } from './templates/base.js';

export interface RenderOptions {
  company: Pick<CompanySnapshot, 'legalName' | 'labAddress' | 'phone' | 'email' | 'reportVerificationEmail' | 'accreditation'>;
  /** A4 by default. Labels use their own size and no footer. */
  width?: string;
  height?: string;
  footer?: boolean;
  /** the verification address belongs on test reports only */
  reportVerification?: boolean;
  margin?: { top: string; bottom: string; left: string; right: string };
}

/**
 * HTML to PDF with headless Chromium. Runs only in the worker. Pages have no JavaScript and no
 * network, so nothing in user-entered text can execute or fetch anything.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private browser: Promise<Browser> | null = null;

  private launch(): Promise<Browser> {
    this.browser ??= chromium
      // Playwright's own signal handlers would close the browser but keep the process alive,
      // leaving a worker that takes jobs and fails them. The worker handles shutdown itself.
      .launch({ headless: true, handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false })
      .then((browser) => {
        // A crashed browser must not stay cached: the next job starts a new one.
        browser.on('disconnected', () => {
          this.browser = null;
        });
        return browser;
      });
    return this.browser;
  }

  async render(html: string, options: RenderOptions): Promise<Buffer> {
    const browser = await this.launch();
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    try {
      await context.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const useFooter = options.footer !== false;
      const pdf = await page.pdf({
        ...(options.width ? { width: options.width, height: options.height } : { format: 'A4' }),
        printBackground: true,
        margin: options.margin ?? { top: '12mm', bottom: useFooter ? '24mm' : '12mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: useFooter,
        headerTemplate: '<span></span>',
        footerTemplate: useFooter ? footer(options.company, options.reportVerification === true) : '<span></span>',
        preferCSSPageSize: false,
      });
      return Buffer.from(pdf);
    } finally {
      await context.close();
    }
  }

  async mergeImagesToPdf(images: { bytes: Buffer; mimeType: string }[]): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (const img of images) {
      // A copy, not the Buffer itself: pdf-lib reads the underlying ArrayBuffer and ignores the offset of pooled Buffers.
      const bytes = Uint8Array.from(img.bytes);
      const embedded = img.mimeType === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const page = doc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }
    return Buffer.from(await doc.save());
  }

  async onModuleDestroy() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}

function footer(c: RenderOptions['company'], verification: boolean): string {
  const certification = c.accreditation.certificationText ? ` · ${esc(c.accreditation.certificationText)}` : '';
  return `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#374151;padding:0 12mm;box-sizing:border-box">
    <div style="border-top:1px solid #9ca3af;padding-top:3px;display:flex;justify-content:space-between;gap:12px">
      <div><strong>${esc(c.legalName)}</strong>${verification ? ` · Report verification: ${esc(c.reportVerificationEmail)}` : ''}${certification}</div>
      <div style="white-space:nowrap">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
    </div></div>`;
}
