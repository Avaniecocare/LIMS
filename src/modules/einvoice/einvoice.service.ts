import { Inject, Injectable, Logger } from '@nestjs/common';
import QRCode from 'qrcode';
import { actorId } from '../../common/context.js';
import { AppError, notFound, rule } from '../../common/errors.js';
import { financialYear } from '../../common/india.js';
import type { CompanySnapshot } from '../../config/company.config.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { ModulesService } from '../../core/modules.service.js';
import { renderNumber } from '../../core/numbering.service.js';
import { Prisma, PrismaService, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { NicIrp } from './nic.js';
import { buildPayload, checkDocument, DOC_NO_RE, type Document, type Party, type Problem } from './payload.js';
import { CANCEL_REASONS, IrpRejection, MockIrp, type CancelReason, type IrpProvider, type Registered } from './provider.js';

/** The IRP allows cancelling an IRN only within this long of registration; after that, a credit note. */
export const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A registration attempt still running (another tab, a double click) is left alone for this long. */
const IN_FLIGHT_MS = 2 * 60 * 1000;

type Row = Prisma.EInvoiceGetPayload<object>;

/** A refusal of the document itself. Codes starting with 1 are sign-in and session errors, which say nothing about it. */
const isDecision = (e: unknown) => e instanceof IrpRejection && !e.existingIrn && e.codes.length > 0 && e.codes.every((c) => !c.startsWith('1'));

export interface EInvoiceView {
  status: Row['status'];
  provider: string;
  environment: string;
  test: boolean;
  irn: string | null;
  ackNo: string | null;
  ackDate: Date | null;
  lastError: string | null;
  attempts: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** until when the IRN can still be cancelled at the IRP; null once it cannot */
  cancellableUntil: Date | null;
}

/**
 * GST e-invoicing: registers B2B tax invoices and credit notes at the Invoice Registration Portal and keeps the
 * IRN, acknowledgement and signed QR code that the printed document must carry.
 *
 * Only documents to a customer with a GSTIN are registered (B2C invoices are outside e-invoicing). A failure never
 * undoes the invoice: it is shown on the invoice with the IRP's reason and can be retried.
 */
@Injectable()
export class EInvoiceService {
  private readonly log = new Logger('EInvoice');
  readonly provider: IrpProvider | null;

  constructor(
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly settings: SettingsService,
    private readonly modules: ModulesService,
  ) {
    const c = infra.einvoice;
    this.provider = !c ? null : c.provider === 'mock' ? new MockIrp() : new NicIrp(c);
  }

  /** On, set up, and therefore expected for B2B documents. */
  async active(): Promise<boolean> {
    return !!this.provider && (await this.modules.isOn('einvoice'));
  }

  // ---------------------------------------------------------------- set-up

  /** What would stop registration for every document, for the admin page. Empty means ready. */
  async readiness(): Promise<Problem[]> {
    const problems: Problem[] = [];
    const c = this.infra.einvoice;
    if (!c) return [{ field: 'server', message: 'E-invoicing is not set up on the server (EINVOICE_PROVIDER and the API credentials).' }];
    const profile = this.company.config;
    if (c.provider === 'nic' && c.gstin !== profile.gstin)
      problems.push({ field: 'gstin', message: `The server is registered for GSTIN ${c.gstin}, but the lab profile has ${profile.gstin}. They must be the same.` });
    const seller = await this.settings.get('einvoice.seller');
    if (!seller.line1.trim()) problems.push({ field: 'seller.line1', message: "Enter the lab's address line for e-invoices." });
    if (seller.city.trim().length < 3) problems.push({ field: 'seller.city', message: "Enter the lab's city or town for e-invoices." });
    if (!/^[1-9][0-9]{5}$/.test(seller.pincode)) problems.push({ field: 'seller.pincode', message: "Enter the lab's 6-digit PIN code for e-invoices." });
    const formats = await this.settings.get('numbering.formats');
    for (const [code, label] of [
      ['INVOICE', 'Invoice'],
      ['CREDIT_NOTE', 'Credit note'],
    ] as const) {
      // The longest number the format gives within its own width (99999 for {SEQ:5}, 9999 for {SEQ:4}).
      const format = formats[code] ?? `{PREFIX}/${code}/{FY}/{SEQ:5}`;
      const width = Number(/\{SEQ(?::(\d+))?\}/.exec(format)?.[1] ?? 5);
      const sample = renderNumber(format, { prefix: profile.documentPrefix, fy: financialYear(), seq: 10 ** Math.max(1, width) - 1 });
      if (!DOC_NO_RE.test(sample))
        problems.push({
          field: `numbering.${code}`,
          message: `${label} numbers look like ${sample} (${sample.length} characters). The GST portal accepts at most 16 letters, digits, "/" or "-". Shorten the format in Admin, Settings, Numbering, for example {PREFIX}/{FY}/{SEQ:5}.`,
        });
    }
    return problems;
  }

  async status() {
    const c = this.infra.einvoice;
    return {
      configured: !!c,
      enabled: await this.active(),
      provider: c?.provider ?? null,
      environment: c?.environment ?? null,
      gstin: c?.gstin || null,
      autoOnIssue: await this.settings.get('einvoice.autoOnIssue'),
      seller: await this.settings.get('einvoice.seller'),
      problems: await this.readiness(),
    };
  }

  /** Signs in to the IRP with the server's credentials. */
  async check() {
    if (!this.provider) throw rule('EINVOICE_NOT_SET_UP', 'E-invoicing is not set up on the server.');
    try {
      await this.provider.check();
      return { ok: true as const };
    } catch (e) {
      throw rule('IRP_UNREACHABLE', `Could not sign in to the GST portal: ${this.describe(e)}`);
    }
  }

  // ---------------------------------------------------------------- views

  view(row: Row | null | undefined): EInvoiceView | null {
    if (!row) return null;
    const until = row.status === 'GENERATED' && row.ackDate ? new Date(row.ackDate.getTime() + CANCEL_WINDOW_MS) : null;
    return {
      status: row.status,
      provider: row.provider,
      environment: row.environment,
      test: row.provider === 'mock' || row.environment !== 'production',
      irn: row.irn,
      ackNo: row.ackNo,
      ackDate: row.ackDate,
      lastError: row.lastError,
      attempts: row.attempts,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReasonCode ? `${CANCEL_REASONS[row.cancelReasonCode as CancelReason] ?? row.cancelReasonCode}${row.cancelRemark ? `: ${row.cancelRemark}` : ''}` : null,
      cancellableUntil: until && until.getTime() > Date.now() ? until : null,
    };
  }

  /** The signed QR code as an image, for the screen and the PDF. */
  qrDataUri(row: Pick<Row, 'signedQrCode'> | null | undefined): Promise<string | null> {
    if (!row?.signedQrCode) return Promise.resolve(null);
    return QRCode.toDataURL(row.signedQrCode, { errorCorrectionLevel: 'L', margin: 1, scale: 4 });
  }

  // ---------------------------------------------------------------- documents

  private async seller(snapshot: CompanySnapshot | null): Promise<Party> {
    const p = snapshot ?? (this.company.snapshot() as unknown as CompanySnapshot);
    const a = await this.settings.get('einvoice.seller');
    return {
      gstin: p.gstin,
      legalName: p.legalName,
      tradeName: p.companyName !== p.legalName ? p.companyName : null,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      pincode: a.pincode,
      stateCode: p.gstStateCode,
      phone: p.phone,
      email: p.email,
    };
  }

  /** The customer as a party: GSTIN and legal name from the frozen snapshot, the address from the billing address. */
  private async buyer(customerId: string, snapshot: { name?: string; gstin?: string | null; contactEmail?: string | null; contactPhone?: string | null } | null): Promise<Party | null> {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId }, include: { addresses: { where: { deletedAt: null } } } });
    const gstin = (snapshot ? snapshot.gstin : c.gstin)?.trim().toUpperCase();
    if (!gstin) return null;
    const a = c.addresses.find((x) => x.kind === 'BILLING') ?? c.addresses[0];
    return {
      gstin,
      legalName: snapshot?.name ?? c.name,
      line1: a?.line1 ?? '',
      line2: a?.line2 ?? null,
      city: a?.city ?? '',
      pincode: a?.pincode ?? '',
      stateCode: gstin.slice(0, 2),
      phone: snapshot?.contactPhone ?? null,
      email: snapshot?.contactEmail ?? null,
    };
  }

  private async invoiceDocument(invoiceId: string): Promise<{ doc: Document; docNo: string; docDate: Date } | 'B2C'> {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, deletedAt: null }, include: { lines: { orderBy: { seq: 'asc' } } } });
    if (!inv) throw notFound('Invoice');
    if (!inv.invoiceNo || !inv.invoiceDate || inv.status === 'DRAFT') throw rule('NOT_ISSUED', 'Only an issued invoice can be registered at the GST portal');
    if (inv.status === 'CANCELLED') throw rule('CANCELLED', 'This invoice is cancelled');
    const buyer = await this.buyer(inv.customerId, inv.customerSnapshot as never);
    if (!buyer) return 'B2C';
    const doc: Document = {
      type: 'INV',
      no: inv.invoiceNo,
      date: inv.invoiceDate,
      seller: await this.seller(inv.companySnapshot as unknown as CompanySnapshot | null),
      buyer,
      placeOfSupplyCode: inv.placeOfSupplyCode,
      lines: inv.lines.map((l) => ({ description: l.description, sac: l.sacCode, quantity: l.quantity, unitPrice: String(l.rate), amount: String(l.amount) })),
      gstRate: String(inv.gstRate),
      totals: {
        discount: String(inv.discountAmount),
        taxable: String(inv.taxableAmount),
        cgst: String(inv.cgst),
        sgst: String(inv.sgst),
        igst: String(inv.igst),
        roundOff: String(inv.roundOff),
        total: String(inv.grandTotal),
      },
    };
    return { doc, docNo: inv.invoiceNo, docDate: inv.invoiceDate };
  }

  private async creditNoteDocument(creditNoteId: string): Promise<{ doc: Document; docNo: string; docDate: Date } | 'B2C'> {
    const cn = await this.prisma.creditNote.findUnique({ where: { id: creditNoteId }, include: { invoice: { include: { lines: { orderBy: { seq: 'asc' }, take: 1 } } } } });
    if (!cn) throw notFound('Credit note');
    const buyer = await this.buyer(cn.invoice.customerId, cn.customerSnapshot as never);
    if (!buyer) return 'B2C';
    const sac = cn.invoice.lines[0]?.sacCode ?? this.company.config.sacCode;
    const doc: Document = {
      type: 'CRN',
      no: cn.creditNoteNo,
      date: cn.issuedOn,
      seller: await this.seller(cn.companySnapshot as unknown as CompanySnapshot | null),
      buyer,
      placeOfSupplyCode: cn.invoice.placeOfSupplyCode,
      lines: [{ description: `Credit against ${cn.invoice.invoiceNo}: ${cn.reason}`, sac, quantity: 1, unitPrice: String(cn.taxableAmount), amount: String(cn.taxableAmount) }],
      gstRate: String(cn.gstRate),
      totals: { discount: '0', taxable: String(cn.taxableAmount), cgst: String(cn.cgst), sgst: String(cn.sgst), igst: String(cn.igst), roundOff: String(cn.roundOff), total: String(cn.total) },
      precedingInvoice: cn.invoice.invoiceNo && cn.invoice.invoiceDate ? { no: cn.invoice.invoiceNo, date: cn.invoice.invoiceDate } : null,
    };
    return { doc, docNo: cn.creditNoteNo, docDate: cn.issuedOn };
  }

  /** Whether an invoice to this customer must carry an IRN: e-invoicing is on and the customer has a GSTIN. */
  async requiredFor(customerSnapshot: { gstin?: string | null } | null, customerId: string): Promise<boolean> {
    if (!(await this.active())) return false;
    // An issued invoice keeps the GSTIN it was issued with, or its absence: a customer registering later changes nothing.
    if (customerSnapshot) return !!customerSnapshot.gstin;
    return !!(await this.prisma.customer.findUnique({ where: { id: customerId }, select: { gstin: true } }))?.gstin;
  }

  registerInvoice(invoiceId: string) {
    return this.register({ invoiceId }, () => this.invoiceDocument(invoiceId), `invoice`);
  }

  registerCreditNote(creditNoteId: string) {
    return this.register({ creditNoteId }, () => this.creditNoteDocument(creditNoteId), `credit note`);
  }

  /**
   * One attempt at registering a document. The row is claimed first (PENDING), so two attempts at once cannot both
   * reach the IRP; the outcome, good or bad, is stored on it. Returns the stored state; throws only for set-up faults.
   */
  private async register(key: { invoiceId: string } | { creditNoteId: string }, load: () => Promise<{ doc: Document; docNo: string; docDate: Date } | 'B2C'>, what: string) {
    if (!this.provider || !(await this.active())) throw rule('EINVOICE_OFF', 'GST e-invoicing is not turned on for this laboratory.');
    const built = await load();
    if (built === 'B2C') throw rule('EINVOICE_B2C', `This ${what} is to a customer without a GSTIN, so it is not registered at the GST portal (B2C).`);
    const where = 'invoiceId' in key ? { invoiceId: key.invoiceId } : { creditNoteId: key.creditNoteId };
    const c = this.infra.einvoice!;
    const existing = await this.prisma.eInvoice.findFirst({ where });
    if (existing?.status === 'GENERATED') return existing;
    if (existing?.status === 'CANCELLED') throw rule('IRN_CANCELLED', `The IRN for this ${what} was cancelled; the same number cannot be registered again.`);
    if (existing?.status === 'PENDING' && Date.now() - existing.updatedAt.getTime() < IN_FLIGHT_MS)
      throw rule('IRN_IN_PROGRESS', `This ${what} is being registered right now. Wait a moment and refresh.`);

    const problems = [...(await this.readiness()), ...checkDocument(built.doc)];
    const payload = problems.length ? null : buildPayload(built.doc);
    // Locking the invoice decides between this and a cancellation at the same moment: whichever comes second sees the first.
    const claim = async (tx: Tx) => {
      if ('invoiceId' in key) {
        await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${key.invoiceId} FOR UPDATE`;
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: key.invoiceId }, select: { status: true } });
        if (inv.status === 'CANCELLED') throw rule('CANCELLED', 'This invoice is cancelled');
      }
      if (existing)
        return tx.eInvoice.updateMany({
          where: { id: existing.id, updatedAt: existing.updatedAt },
          data: {
            status: 'PENDING',
            attempts: { increment: 1 },
            payload: payload ?? Prisma.DbNull,
            lastError: null,
            provider: c.provider,
            environment: c.environment,
            ...(payload ? { uncertain: true } : {}),
          },
        });
      await tx.eInvoice.create({
        data: {
          ...where,
          docType: built.doc.type,
          docNo: built.docNo,
          docDate: built.docDate,
          status: 'PENDING',
          attempts: 1,
          provider: c.provider,
          environment: c.environment,
          payload: payload ?? Prisma.DbNull,
          uncertain: !!payload,
          createdById: actorId(),
        },
      });
      return { count: 1 };
    };
    const claimed = await this.prisma.$transaction(claim).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { count: 0 };
      throw e;
    });
    if (claimed.count !== 1) throw rule('IRN_IN_PROGRESS', `This ${what} is being registered right now. Wait a moment and refresh.`);
    const row = (await this.prisma.eInvoice.findFirst({ where }))!;

    if (problems.length) return this.fail(row, problems.map((p) => p.message).join(' '));
    let reg: Registered;
    try {
      reg = await this.provider.generate(payload!);
    } catch (e) {
      // Already registered (a lost answer last time, or registered elsewhere): take the IRN the IRP has.
      if (e instanceof IrpRejection && e.existingIrn) {
        try {
          reg = await this.provider.fetch(e.existingIrn);
        } catch (e2) {
          return this.fail(row, `The GST portal already has this ${what} (IRN ${e.existingIrn}), but its details could not be fetched: ${this.describe(e2)}`);
        }
        // The portal never takes the number of a cancelled document again, and a cancelled IRN must not look like a live one.
        if (reg.cancelled) return this.fail(row, `The GST portal has this ${what} as cancelled (IRN ${reg.irn}), and does not accept its number again. Cancel it here and raise a new one.`, true);
      } else {
        return this.fail(row, this.describe(e), isDecision(e));
      }
    }
    const saved = await this.prisma.eInvoice.update({
      where: { id: row.id },
      data: { status: 'GENERATED', irn: reg.irn, ackNo: reg.ackNo, ackDate: reg.ackDate, signedInvoice: reg.signedInvoice, signedQrCode: reg.signedQrCode, lastError: null, uncertain: false },
    });
    await this.audit.record({
      action: 'EInvoice.generated',
      entity: 'invoiceId' in key ? 'Invoice' : 'CreditNote',
      entityId: 'invoiceId' in key ? key.invoiceId : key.creditNoteId,
      after: { irn: reg.irn, ackNo: reg.ackNo, provider: c.provider, environment: c.environment },
    });
    return saved;
  }

  /** `decided`: the IRP answered that it did not register the document, so nothing can be live there. */
  private async fail(row: Row, message: string, decided = false) {
    this.log.warn(`IRN for ${row.docType} ${row.docNo} failed: ${message}`);
    const saved = await this.prisma.eInvoice.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: message.slice(0, 2000), ...(decided ? { uncertain: false } : {}) } });
    await this.audit.record({ action: 'EInvoice.failed', entity: row.invoiceId ? 'Invoice' : 'CreditNote', entityId: (row.invoiceId ?? row.creditNoteId)!, after: { error: message.slice(0, 500) } });
    return saved;
  }

  private describe(e: unknown): string {
    if (e instanceof IrpRejection) return `${e.message}${e.codes.length ? ` (GST portal error ${e.codes.join(', ')})` : ''}`;
    if (e instanceof AppError) return e.message;
    this.log.error(e);
    return 'The GST portal could not be reached or did not answer. Try again in a few minutes.';
  }

  /** In the transaction that cancels an invoice, after locking it: nothing may be on its way to the IRP, or live there. */
  async assertNothingLive(tx: Tx, invoiceId: string) {
    const row = await tx.eInvoice.findUnique({ where: { invoiceId }, select: { status: true, uncertain: true, updatedAt: true } });
    if (!row) return;
    const inFlight = row.status === 'PENDING' && Date.now() - row.updatedAt.getTime() < IN_FLIGHT_MS;
    if (inFlight || row.status === 'GENERATED' || (row.uncertain && row.status !== 'CANCELLED'))
      throw rule('IRN_IN_PROGRESS', 'This invoice was being registered at the GST portal at the same moment, so it was not cancelled. Refresh, and cancel it again.');
  }

  /**
   * Before an invoice is cancelled: an IRN must be cancelled at the IRP too, which it allows only within 24 hours.
   * After that the law's answer is a credit note, so the invoice cannot be cancelled here either.
   */
  async cancelInvoiceIrn(invoiceId: string, reason: CancelReason | undefined, remark: string) {
    const row = await this.prisma.eInvoice.findUnique({ where: { invoiceId } });
    // A lost answer may have left a live IRN behind. Registering again finds it, so it can be cancelled properly.
    if (row?.uncertain && row.status !== 'GENERATED')
      throw rule('IRN_UNCERTAIN', 'The GST portal’s answer to the last registration was not received, so this invoice may have an IRN there. Register it again first; then it can be cancelled.');
    if (!row || row.status !== 'GENERATED' || !row.irn) return null;
    if (!row.ackDate || Date.now() - row.ackDate.getTime() > CANCEL_WINDOW_MS)
      throw rule('IRN_NOT_CANCELLABLE', 'This invoice was registered at the GST portal more than 24 hours ago, so its IRN can no longer be cancelled. Raise a credit note instead.');
    if (!reason) throw rule('IRN_CANCEL_REASON', 'Choose why the IRN is being cancelled (duplicate, data entry mistake, order cancelled, or other).');
    if (!this.provider) throw rule('EINVOICE_NOT_SET_UP', 'E-invoicing is not set up on the server, so the IRN cannot be cancelled.');
    try {
      const provider = this.provider;
      const irn = row.irn;
      const { cancelledAt } = await provider.cancel(irn, reason, remark.slice(0, 100)).catch(async (e: unknown) => {
        // The portal may have cancelled it and the answer been lost, now or on an earlier try. Ask before saying it failed.
        const there = await provider.fetch(irn).catch(() => null);
        if (!there?.cancelled) throw e;
        return { cancelledAt: new Date() };
      });
      const saved = await this.prisma.eInvoice.update({ where: { id: row.id }, data: { status: 'CANCELLED', cancelledAt, cancelReasonCode: reason, cancelRemark: remark.slice(0, 100) } });
      await this.audit.record({ action: 'EInvoice.cancelled', entity: 'Invoice', entityId: invoiceId, after: { irn: row.irn, reason: CANCEL_REASONS[reason] }, reason: remark });
      return saved;
    } catch (e) {
      throw rule('IRN_CANCEL_FAILED', `The GST portal did not cancel the IRN, so the invoice is still issued: ${this.describe(e)}`);
    }
  }
}
