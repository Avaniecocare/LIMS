import { Injectable } from '@nestjs/common';
import { badRequest, conflict } from '../common/errors.js';
import { AuditService } from './audit.service.js';
import { CompanyService } from './company.service.js';
import { EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATES, exampleValues, renderTemplate, templateProblems, type EmailTemplateKey } from './email-templates.js';
import { MailService } from './mail.service.js';
import { Prisma, PrismaService } from './prisma.service.js';

const KEY = 'templates.email';
type Overrides = Partial<Record<EmailTemplateKey, { subject: string; body: string }>>;

/** The lab's own wording for customer emails, with the product's wording wherever it has not changed it. */
@Injectable()
export class EmailTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    private readonly mail: MailService,
  ) {}

  private async overrides(): Promise<{ map: Overrides; version: number }> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    return { map: (row?.value as Overrides | undefined) ?? {}, version: row?.version ?? 0 };
  }

  isKey(key: string): key is EmailTemplateKey {
    return (EMAIL_TEMPLATE_KEYS as string[]).includes(key);
  }

  /** The values every template can use, from the lab's profile (or the snapshot stored on a document). */
  commonValues(company: { companyName: string; phone: string; email: string } = this.company.config) {
    return { labName: company.companyName, labPhone: company.phone, labEmail: company.email };
  }

  /** Subject and body for an email about to be queued. */
  async render(key: EmailTemplateKey, values: Record<string, string | number | null | undefined>) {
    const { map } = await this.overrides();
    const def = EMAIL_TEMPLATES[key];
    return renderTemplate(key, map[key] ?? { subject: def.subject, body: def.body }, values);
  }

  async list() {
    const { map, version } = await this.overrides();
    return {
      version,
      templates: EMAIL_TEMPLATE_KEYS.map((key) => {
        const def = EMAIL_TEMPLATES[key];
        const own = map[key];
        return {
          key,
          label: def.label,
          description: def.description,
          variables: def.variables.map((v) => ({ name: v.name, description: v.description, example: v.example })),
          subject: own?.subject ?? def.subject,
          body: own?.body ?? def.body,
          defaultSubject: def.subject,
          defaultBody: def.body,
          customized: !!own,
        };
      }),
    };
  }

  private check(key: EmailTemplateKey, subject: string, body: string) {
    const problems = [...templateProblems(key, subject).map((message) => ({ field: 'subject', message })), ...templateProblems(key, body).map((message) => ({ field: 'body', message }))];
    if (!subject.trim()) problems.push({ field: 'subject', message: 'Enter a subject' });
    if (!body.trim()) problems.push({ field: 'body', message: 'Enter the message' });
    if (problems.length) throw badRequest('The template needs correcting', problems);
  }

  private async write(map: Overrides, expectedVersion: number, action: string, key: EmailTemplateKey, before: unknown, after: unknown) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({ where: { key: KEY } });
      if ((existing?.version ?? 0) !== expectedVersion) throw conflict();
      if (existing) {
        const { count } = await tx.setting.updateMany({ where: { key: KEY, version: expectedVersion }, data: { value: map as Prisma.InputJsonValue, version: { increment: 1 } } });
        if (count !== 1) throw conflict();
      } else await tx.setting.create({ data: { key: KEY, value: map as Prisma.InputJsonValue } });
      await this.audit.record({ action, entity: 'Setting', entityId: `${KEY}.${key}`, before, after }, tx);
    });
  }

  async save(key: EmailTemplateKey, subject: string, body: string, expectedVersion: number) {
    this.check(key, subject, body);
    const { map } = await this.overrides();
    await this.write({ ...map, [key]: { subject: subject.trim(), body: body.replace(/\r\n/g, '\n').trim() } }, expectedVersion, 'email-template.update', key, map[key] ?? null, { subject, body });
  }

  async reset(key: EmailTemplateKey, expectedVersion: number) {
    const { map } = await this.overrides();
    const { [key]: removed, ...rest } = map;
    await this.write(rest, expectedVersion, 'email-template.reset', key, removed ?? null, null);
  }

  /** What the email will look like, in the lab's branded layout, with example values. */
  preview(key: EmailTemplateKey, subject: string, body: string) {
    this.check(key, subject, body);
    const values = { ...exampleValues(key), ...this.commonValues(), appName: this.company.config.productName };
    const out = renderTemplate(key, { subject, body }, values);
    return { subject: out.subject, html: this.mail.wrap(out.bodyHtml) };
  }
}
