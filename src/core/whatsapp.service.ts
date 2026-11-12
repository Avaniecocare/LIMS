import { Inject, Injectable } from '@nestjs/common';
import { actorId } from '../common/context.js';
import { AppError, badRequest, conflict } from '../common/errors.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';
import { AuditService } from './audit.service.js';
import { Prisma, PrismaService } from './prisma.service.js';
import { QueueService } from './queue.service.js';
import { StorageService } from './storage.service.js';

/**
 * Customer messages on WhatsApp, through the WhatsApp Business Cloud API. Business-started messages must use a
 * template the lab has had approved in WhatsApp Manager. Each kind of message offers a set of values; the lab picks
 * which go into its template's {{1}}, {{2}}... and in what order, to match the wording it had approved.
 * Documents travel as the template's header.
 */
const COMMON = { contactName: 'Customer contact name', customerName: 'Customer (company) name', labName: 'Laboratory name', labPhone: 'Laboratory phone' } as const;
export const WHATSAPP_KINDS = {
  report: { label: 'Test report', document: true, values: { ...COMMON, reportNo: 'Report number', sampleNo: 'Sample number', issuedOn: 'Issue date' }, order: ['contactName', 'reportNo', 'labName'] },
  invoice: {
    label: 'Tax invoice',
    document: true,
    values: { ...COMMON, invoiceNo: 'Invoice number', amount: 'Amount, e.g. ₹15,576.00', invoiceDate: 'Invoice date', dueDate: 'Due date' },
    order: ['contactName', 'invoiceNo', 'amount', 'dueDate', 'labName'],
  },
  acknowledgement: {
    label: 'Samples received',
    document: true,
    values: { ...COMMON, jobNo: 'Job number', sampleCount: 'Number of samples', receivedOn: 'Date received' },
    order: ['contactName', 'jobNo', 'labName'],
  },
  reminder: {
    label: 'Payment reminder',
    document: false,
    values: { ...COMMON, invoiceNo: 'Invoice number', balance: 'Balance due, e.g. ₹15,576.00', dueDate: 'Due date', daysOverdue: 'Days overdue' },
    order: ['contactName', 'invoiceNo', 'balance', 'dueDate', 'labName'],
  },
} as const;
export type WhatsappKind = keyof typeof WHATSAPP_KINDS;
export const WHATSAPP_KIND_KEYS = Object.keys(WHATSAPP_KINDS) as WhatsappKind[];
export type WhatsappTemplate = { name: string; language: string; /** value keys for {{1}}, {{2}}..., in order */ values: string[] };

// TODO(product-decision): suggested template names, language and wording order; each lab creates its own in WhatsApp Manager.
const DEFAULT_TEMPLATES: Record<WhatsappKind, WhatsappTemplate> = {
  report: { name: 'lims_test_report', language: 'en', values: [...WHATSAPP_KINDS.report.order] },
  invoice: { name: 'lims_tax_invoice', language: 'en', values: [...WHATSAPP_KINDS.invoice.order] },
  acknowledgement: { name: 'lims_samples_received', language: 'en', values: [...WHATSAPP_KINDS.acknowledgement.order] },
  reminder: { name: 'lims_payment_reminder', language: 'en', values: [...WHATSAPP_KINDS.reminder.order] },
};
const KEY = 'whatsapp.templates';
/** A status from Meta never moves a message backwards: a late "delivered" after "read" is ignored. */
const RANK = { QUEUED: 0, FAILED: 0, SENT: 1, DELIVERED: 2, READ: 3 } as const;

/** What a caller hands over; a document job adds the rendered file before it is queued. */
export interface WhatsappInput {
  kind: WhatsappKind;
  to: string;
  /** every value this kind offers; the template decides which are sent and in what order */
  values: Record<string, string | number | null | undefined>;
  entity: string;
  entityId: string;
  consentConfirmedBy: string;
  createdById?: string | null;
  documentFileId?: string | null;
  documentName?: string | null;
}

/**
 * A WhatsApp number in international form (digits only, country code first). Indian mobiles may be written with
 * spaces, a leading 0, or without +91. Anything that cannot be a mobile number is refused.
 */
export function whatsappNumber(raw: string): string | null {
  const d = raw.replace(/[\s\-().]/g, '');
  // With a country code: any mobile number in the world, but +91 must still be an Indian mobile.
  const intl = d.startsWith('+') ? d.slice(1) : d.startsWith('00') ? d.slice(2) : null;
  if (intl !== null) {
    if (!/^[1-9]\d{7,14}$/.test(intl)) return null;
    return intl.startsWith('91') && !/^91[6-9]\d{9}$/.test(intl) ? null : intl;
  }
  // Without one: an Indian mobile, optionally written with a leading 0 or 91.
  const m = /^(?:0|91)?([6-9]\d{9})$/.exec(d);
  return m ? `91${m[1]}` : null;
}

@Injectable()
export class WhatsappService {
  /** json transport keeps what would have been sent, for development and tests */
  readonly sent: { to: string; template: string; language: string; params: string[]; document?: string }[] = [];

  constructor(
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  get configured() {
    return !!this.infra.whatsapp;
  }

  async templates() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const saved = (row?.value as Partial<Record<WhatsappKind, Partial<WhatsappTemplate>>> | undefined) ?? {};
    // Settings saved before the order could be chosen have no list of values: they keep the original order.
    return {
      version: row?.version ?? 0,
      templates: Object.fromEntries(WHATSAPP_KIND_KEYS.map((k) => [k, { ...DEFAULT_TEMPLATES[k], ...saved[k], values: saved[k]?.values ?? DEFAULT_TEMPLATES[k].values }])) as Record<
        WhatsappKind,
        WhatsappTemplate
      >,
    };
  }

  async saveTemplates(templates: Record<string, WhatsappTemplate>, expectedVersion: number) {
    for (const [k, t] of Object.entries(templates)) {
      if (!(WHATSAPP_KIND_KEYS as string[]).includes(k)) throw badRequest(`Unknown message ${k}`, [{ field: k, message: 'Unknown' }]);
      if (typeof t?.name !== 'string' || typeof t?.language !== 'string') throw badRequest('Each message needs a template name and language', [{ field: k, message: 'Name and language' }]);
      if (!/^[a-z0-9_]{1,512}$/.test(t.name)) throw badRequest('Template names are lower-case letters, digits and underscores', [{ field: `${k}.name`, message: 'As in WhatsApp Manager' }]);
      if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language)) throw badRequest('A language code like en or en_US', [{ field: `${k}.language`, message: 'e.g. en' }]);
      const offered = Object.keys(WHATSAPP_KINDS[k as WhatsappKind].values);
      if (!Array.isArray(t.values) || t.values.some((v) => !offered.includes(v))) throw badRequest('Choose the values from the list', [{ field: `${k}.values`, message: 'Unknown value' }]);
      if (new Set(t.values).size !== t.values.length) throw badRequest('Each value can be used once', [{ field: `${k}.values`, message: 'Used twice' }]);
      if (t.values.length > 10) throw badRequest('At most 10 values', [{ field: `${k}.values`, message: 'Too many' }]);
    }
    const current = await this.templates();
    if (current.version !== expectedVersion) throw conflict();
    const next = { ...current.templates, ...Object.fromEntries(Object.entries(templates).map(([k, t]) => [k, { name: t.name, language: t.language, values: t.values }])) };
    await this.prisma.$transaction(async (tx) => {
      if (current.version === 0) await tx.setting.create({ data: { key: KEY, value: next as Prisma.InputJsonValue } });
      else {
        const { count } = await tx.setting.updateMany({ where: { key: KEY, version: expectedVersion }, data: { value: next as Prisma.InputJsonValue, version: { increment: 1 } } });
        if (count !== 1) throw conflict();
      }
      await this.audit.record({ action: 'whatsapp.templates.update', entity: 'Setting', entityId: KEY, before: current.templates, after: next }, tx);
    });
  }

  /** Queues a message; the worker sends it and retries on failure. */
  async enqueue(input: WhatsappInput) {
    if (!this.configured) throw new AppError('WHATSAPP_OFF', 422, 'WhatsApp is not set up for this laboratory.');
    const to = whatsappNumber(input.to);
    if (!to) throw badRequest('Enter a WhatsApp mobile number, with the country code for numbers outside India', [{ field: 'to', message: 'Not a mobile number' }]);
    const { templates } = await this.templates();
    const t = templates[input.kind];
    // WhatsApp refuses an empty value, so a missing one is sent as a dash.
    const params = t.values.map((k) => (input.values[k] ?? '').toString().replace(/\s+/g, ' ').trim() || '-');
    const row = await this.prisma.whatsappMessage.create({
      data: {
        toNumber: to,
        kind: input.kind,
        template: t.name,
        language: t.language,
        params,
        documentFileId: input.documentFileId ?? null,
        documentName: input.documentName ?? null,
        entity: input.entity,
        entityId: input.entityId,
        consentConfirmedBy: input.consentConfirmedBy,
        createdById: input.createdById ?? actorId(),
      },
    });
    await this.queue.whatsapp.add('send', { messageId: row.id }, { jobId: `whatsapp-${row.id}` });
    return row;
  }

  private async call(path: string, init: RequestInit) {
    const w = this.infra.whatsapp!;
    const res = await fetch(`${w.apiUrl}/${w.phoneNumberId}/${path}`, { ...init, headers: { Authorization: `Bearer ${w.token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { id?: string; messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) throw new Error(`WhatsApp refused it: ${body.error?.message ?? res.statusText}${body.error?.code ? ` (code ${body.error.code})` : ''}`);
    return body;
  }

  /** Sends one template message now. Used by the worker and by the admin's test send. */
  private async send(m: { toNumber: string; template: string; language: string; params: string[]; documentFileId?: string | null; documentName?: string | null }): Promise<string> {
    if (this.infra.whatsapp?.transport === 'json') {
      this.sent.push({ to: m.toNumber, template: m.template, language: m.language, params: m.params, document: m.documentName ?? undefined });
      return `json-${Date.now()}-${this.sent.length}`;
    }
    const components: unknown[] = [];
    if (m.documentFileId) {
      const file = await this.storage.read(m.documentFileId);
      const form = new FormData();
      form.set('messaging_product', 'whatsapp');
      form.set('type', file.mimeType);
      form.set('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), m.documentName ?? file.originalName);
      const media = await this.call('media', { method: 'POST', body: form });
      components.push({ type: 'header', parameters: [{ type: 'document', document: { id: media.id, filename: m.documentName ?? file.originalName } }] });
    }
    if (m.params.length) components.push({ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) });
    const out = await this.call('messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: m.toNumber,
        type: 'template',
        template: { name: m.template, language: { code: m.language }, ...(components.length ? { components } : {}) },
      }),
    });
    return out.messages?.[0]?.id ?? 'unknown';
  }

  /** Worker side. Throws on failure so the queue retries. */
  async deliver(messageId: string) {
    const m = await this.prisma.whatsappMessage.findUnique({ where: { id: messageId } });
    if (!m || (m.status !== 'QUEUED' && m.status !== 'FAILED')) return;
    await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { attempts: { increment: 1 } } });
    try {
      const providerMessageId = await this.send({ ...m, params: m.params as string[] });
      await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId, lastError: null } });
    } catch (e) {
      await this.prisma.whatsappMessage.update({ where: { id: m.id }, data: { status: 'FAILED', lastError: e instanceof Error ? e.message.slice(0, 500) : 'send failed' } });
      throw e;
    }
  }

  /** The admin's check: Meta's own hello_world template, which every WhatsApp Business account has. */
  async testSend(raw: string) {
    if (!this.configured) throw new AppError('WHATSAPP_OFF', 422, 'WhatsApp is not set up: add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to the server settings.');
    const to = whatsappNumber(raw);
    if (!to) throw badRequest('Enter a WhatsApp mobile number', [{ field: 'to', message: 'Not a mobile number' }]);
    try {
      await this.send({ toNumber: to, template: 'hello_world', language: 'en_US', params: [] });
    } catch (e) {
      throw new AppError('WHATSAPP_FAILED', 502, e instanceof Error ? e.message : 'WhatsApp could not be reached');
    }
    await this.audit.record({ action: 'whatsapp.test', entity: 'Setting', entityId: KEY, after: { to } });
  }

  /**
   * Meta's status webhook: sent, delivered, read or failed, for messages it accepted. Unknown ids are ignored
   * (another system on the same number). Returns how many messages changed.
   */
  async receipts(body: unknown): Promise<number> {
    type Status = { id?: string; status?: string; timestamp?: string; errors?: { title?: string; message?: string; code?: number }[] };
    const statuses: Status[] = [];
    for (const entry of (body as { entry?: { changes?: { value?: { statuses?: Status[] } }[] }[] })?.entry ?? []) {
      for (const change of entry.changes ?? []) statuses.push(...(change.value?.statuses ?? []));
    }
    let changed = 0;
    for (const st of statuses) {
      if (!st.id || !st.status) continue;
      const m = await this.prisma.whatsappMessage.findFirst({ where: { providerMessageId: st.id } });
      if (!m) continue;
      const at = st.timestamp && /^\d+$/.test(st.timestamp) ? new Date(Number(st.timestamp) * 1000) : new Date();
      if (st.status === 'failed') {
        const e = st.errors?.[0];
        await this.prisma.whatsappMessage.update({
          where: { id: m.id },
          data: { status: 'FAILED', lastError: `WhatsApp could not deliver it: ${e?.message ?? e?.title ?? 'no reason given'}${e?.code ? ` (code ${e.code})` : ''}`.slice(0, 500) },
        });
        changed++;
        continue;
      }
      const next = ({ sent: 'SENT', delivered: 'DELIVERED', read: 'READ' } as Record<string, 'SENT' | 'DELIVERED' | 'READ'>)[st.status];
      if (!next) continue;
      const data: Prisma.WhatsappMessageUpdateInput = {};
      if (next === 'DELIVERED' || next === 'READ') data.deliveredAt = m.deliveredAt ?? at;
      if (next === 'READ') data.readAt = m.readAt ?? at;
      if (RANK[next] > RANK[m.status]) data.status = next;
      if (Object.keys(data).length) {
        await this.prisma.whatsappMessage.update({ where: { id: m.id }, data });
        changed++;
      }
    }
    return changed;
  }

  log(entity?: string, entityId?: string) {
    return this.prisma.whatsappMessage.findMany({ where: entity && entityId ? { entity, entityId } : {}, orderBy: { createdAt: 'desc' }, take: entity ? 20 : 100 });
  }
}
