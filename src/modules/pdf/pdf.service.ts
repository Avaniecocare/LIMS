import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
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
  /** the document's real page count, when pages are added after rendering (report annexures) */
  totalPages?: number;
}

/** One instrument report to append to a test report as annexure pages. */
export interface AnnexInput {
  letter: string;
  testName: string;
  title: string;
  bytes: Buffer;
}

const MM = 72 / 25.4;
const A4: [number, number] = [210 * MM, 297 * MM];

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
        footerTemplate: useFooter ? footer(options.company, options.reportVerification === true, options.totalPages) : '<span></span>',
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

  /** Pages in a PDF, for working out the full length of a report before its final render. */
  async pageCount(pdf: Buffer): Promise<number> {
    return (await PDFDocument.load(Uint8Array.from(pdf), { updateMetadata: false })).getPageCount();
  }

  /**
   * Appends instrument reports as annexure pages. Each source page is scaled onto an A4 page (landscape for
   * landscape sources) under a header naming the annexure, test and report, above the same footer and page count
   * as the report body; the last page ends the report.
   */
  async appendAnnexes(body: Buffer, annexes: AnnexInput[], label: { reportNo: string; legalName: string }): Promise<Buffer> {
    const doc = await PDFDocument.load(Uint8Array.from(body));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const bodyPages = doc.getPageCount();
    const sources = await Promise.all(annexes.map(async (a) => ({ a, src: await PDFDocument.load(Uint8Array.from(a.bytes), { updateMetadata: false }) })));
    const total = bodyPages + sources.reduce((s, x) => s + x.src.getPageCount(), 0);
    const grey = rgb(0.22, 0.25, 0.32);
    let n = bodyPages;
    for (const { a, src } of sources) {
      const embedded = await doc.embedPdf(src, src.getPageIndices());
      for (const [i, page] of embedded.entries()) {
        n++;
        const landscape = page.width > page.height;
        const [w, h] = landscape ? [A4[1], A4[0]] : A4;
        const out = doc.addPage([w, h]);
        const side = 12 * MM;
        const top = 20 * MM;
        const bottom = 24 * MM;
        // The instrument page, whole and unaltered, scaled to fit inside the margins.
        const scale = Math.min((w - 2 * side) / page.width, (h - top - bottom) / page.height);
        const dw = page.width * scale;
        const dh = page.height * scale;
        out.drawPage(page, { x: (w - dw) / 2, y: bottom + (h - top - bottom - dh) / 2, width: dw, height: dh });
        out.drawRectangle({ x: (w - dw) / 2, y: bottom + (h - top - bottom - dh) / 2, width: dw, height: dh, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
        const heading = `Annexure ${a.letter} · ${a.testName} · ${a.title}${embedded.length > 1 ? ` (page ${i + 1} of ${embedded.length})` : ''}`;
        drawFitted(out, winAnsi(heading, bold), side, h - 12 * MM, w - 2 * side - 60 * MM, 9, bold, grey);
        const right = winAnsi(`Report ${label.reportNo}`, font);
        out.drawText(right, { x: w - side - font.widthOfTextAtSize(right, 8), y: h - 12 * MM, size: 8, font, color: grey });
        out.drawLine({ start: { x: side, y: h - 14 * MM }, end: { x: w - side, y: h - 14 * MM }, thickness: 0.5, color: rgb(0.61, 0.64, 0.69) });
        // Footer, as on the body pages.
        out.drawLine({ start: { x: side, y: 14 * MM }, end: { x: w - side, y: 14 * MM }, thickness: 0.5, color: rgb(0.61, 0.64, 0.69) });
        drawFitted(out, winAnsi(label.legalName, bold), side, 10.5 * MM, w - 2 * side - 40 * MM, 5.6, bold, grey);
        const pageText = `Page ${n} of ${total}`;
        out.drawText(pageText, { x: w - side - font.widthOfTextAtSize(pageText, 5.6), y: 10.5 * MM, size: 5.6, font, color: grey });
        if (n === total) {
          const end = 'End of Report';
          out.drawText(end, { x: (w - bold.widthOfTextAtSize(end, 9)) / 2, y: 18 * MM, size: 9, font: bold, color: rgb(0, 0, 0) });
        }
      }
    }
    return Buffer.from(await doc.save());
  }

  async onModuleDestroy() {
    // Shutting down: a browser that has already exited is fine.
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}

/** The standard PDF fonts cover Western characters only: anything else is replaced rather than failing the report. */
function winAnsi(text: string, font: PDFFont): string {
  return [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return '?';
      }
    })
    .join('');
}

/** Text on one line, shrunk to fit the width rather than running into the next item. */
function drawFitted(page: ReturnType<PDFDocument['addPage']>, text: string, x: number, y: number, maxWidth: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  let s = size;
  while (s > 5 && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  let t = text;
  while (t.length > 4 && font.widthOfTextAtSize(t, s) > maxWidth) t = `${t.slice(0, -2)}…`.replace(/……$/, '…');
  page.drawText(winAnsi(t, font), { x, y, size: s, font, color });
}

function footer(c: RenderOptions['company'], verification: boolean, totalPages?: number): string {
  const certification = c.accreditation.certificationText ? ` · ${esc(c.accreditation.certificationText)}` : '';
  return `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#374151;padding:0 12mm;box-sizing:border-box">
    <div style="border-top:1px solid #9ca3af;padding-top:3px;display:flex;justify-content:space-between;gap:12px">
      <div><strong>${esc(c.legalName)}</strong>${verification ? ` · Report verification: ${esc(c.reportVerificationEmail)}` : ''}${certification}</div>
      <div style="white-space:nowrap">Page <span class="pageNumber"></span> of ${totalPages ? String(totalPages) : '<span class="totalPages"></span>'}</div>
    </div></div>`;
}
