/**
 * Customer-facing email wording, editable by the lab in Admin > Email templates.
 *
 * A template is plain text: blank lines separate paragraphs, **double asterisks** make bold, {{name}} inserts a value,
 * and {{#name}}...{{/name}} keeps a passage only when that value is present. Everything the admin types and every
 * value is HTML-escaped, so a template can never inject markup or scripts into an email; link values become links.
 */

export interface TemplateVariable {
  name: string;
  description: string;
  example: string;
  /** rendered as a clickable link */
  link?: boolean;
}

export interface EmailTemplateDef {
  label: string;
  description: string;
  subject: string;
  body: string;
  variables: TemplateVariable[];
}

const common: TemplateVariable[] = [
  { name: 'labName', description: "The laboratory's name", example: 'Sunrise Testing Laboratory' },
  { name: 'labPhone', description: "The laboratory's phone", example: '+91 20 0000 0000' },
  { name: 'labEmail', description: "The laboratory's email", example: 'lab@example.com' },
];

export const EMAIL_TEMPLATES = {
  acknowledgement: {
    label: 'Samples received',
    description: 'Sent with the acknowledgement letter when samples are booked.',
    subject: 'Samples received: {{jobNo}} — {{labName}}',
    body: 'Dear {{contactName}},\n\nWe have received your samples under job **{{jobNo}}**. The acknowledgement is attached{{#photoText}}, with {{photoText}} of the samples as we received them{{/photoText}}.\n\nRegards,\n{{senderName}}\n{{labName}}',
    variables: [
      ...common,
      { name: 'jobNo', description: 'Job number', example: 'SL/JOB/26-27/00012' },
      { name: 'contactName', description: 'The customer contact, or "Sir/Madam"', example: 'Rohan Mehta' },
      { name: 'customerName', description: 'The customer company', example: 'Example Industries Pvt Ltd' },
      { name: 'sampleCount', description: 'How many samples', example: '2' },
      { name: 'photoText', description: 'e.g. "2 photographs", only when photos are attached', example: '2 photographs' },
      { name: 'senderName', description: 'The person sending it', example: 'Rekha Reception' },
    ],
  },
  quotation: {
    label: 'Quotation',
    description: 'Sent with a quotation or proforma invoice.',
    subject: '{{documentTitle}} {{quotationNo}} from {{labName}}',
    body: 'Dear {{contactName}},\n\nPlease find attached our {{documentTitleLower}} **{{quotationNo}}**.\n\n{{#message}}{{message}}\n\n{{/message}}Regards,\n{{senderName}}\n{{labName}}',
    variables: [
      ...common,
      { name: 'quotationNo', description: 'Quotation number', example: 'SL/QT/26-27/00031' },
      { name: 'documentTitle', description: '"Quotation" or "Proforma Invoice"', example: 'Quotation' },
      { name: 'documentTitleLower', description: 'The same, in lower case for a sentence', example: 'quotation' },
      { name: 'contactName', description: 'The customer contact, or "Sir/Madam"', example: 'Sir/Madam' },
      { name: 'customerName', description: 'The customer company', example: 'Example Industries Pvt Ltd' },
      { name: 'message', description: 'The note typed when sending, if any', example: 'Rates are valid for 30 days.' },
      { name: 'senderName', description: 'The person sending it', example: 'Sameer Sales' },
    ],
  },
  report: {
    label: 'Test report',
    description: 'Sent with an issued test report.',
    subject: 'Test report {{reportNo}}{{#revisionNo}} revision {{revisionNo}}{{/revisionNo}} — {{labName}}',
    body: 'Dear {{contactName}},\n\nPlease find attached test report **{{reportNo}}** for sample {{sampleNo}}.\n\n{{#revisionReason}}This revision replaces the earlier version. Reason: {{revisionReason}}\n\n{{/revisionReason}}{{#verifyEmail}}To verify this report, scan its QR code or write to {{verifyEmail}}.{{/verifyEmail}}',
    variables: [
      ...common,
      { name: 'reportNo', description: 'Report number', example: 'SL/TR/26-27/000112' },
      { name: 'sampleNo', description: 'Sample number', example: 'SL/S/26-27/000345' },
      { name: 'revisionNo', description: 'Revision number, only for a revised report', example: '1' },
      { name: 'revisionReason', description: 'Why it was revised, only for a revised report', example: 'Customer name corrected' },
      { name: 'contactName', description: 'The customer contact, or "Sir/Madam"', example: 'Sir/Madam' },
      { name: 'customerName', description: 'The customer company', example: 'Example Industries Pvt Ltd' },
      { name: 'verifyEmail', description: 'The report verification email', example: 'verify@example.com' },
    ],
  },
  invoice: {
    label: 'Tax invoice',
    description: 'Sent with an issued tax invoice.',
    subject: 'Tax invoice {{invoiceNo}} — {{labName}}',
    body: 'Dear {{contactName}},\n\nPlease find attached tax invoice **{{invoiceNo}}** for ₹{{amount}}, due on {{dueDate}}.\n\nRegards,\n{{labName}}',
    variables: [
      ...common,
      { name: 'invoiceNo', description: 'Invoice number', example: 'SL/INV/26-27/00088' },
      { name: 'amount', description: 'Invoice total', example: '12,980.00' },
      { name: 'dueDate', description: 'Due date', example: '12-Dec-2026' },
      { name: 'contactName', description: 'The customer contact, or "Sir/Madam"', example: 'Sir/Madam' },
      { name: 'customerName', description: 'The customer company', example: 'Example Industries Pvt Ltd' },
    ],
  },
  reminder: {
    label: 'Payment reminder',
    description: 'Sent for an unpaid invoice, by hand or on the automatic schedule.',
    subject: 'Payment reminder: invoice {{invoiceNo}} — {{labName}}',
    body: 'Dear {{contactName}},\n\nOur records show a balance of **₹{{balance}}** on invoice **{{invoiceNo}}**, due on {{dueDate}}.\n\nPlease arrange payment, or let us know if it has already been made.\n\n{{#bankAccount}}Bank: {{bankName}}, A/c {{bankAccount}}, IFSC {{bankIfsc}}{{/bankAccount}}',
    variables: [
      ...common,
      { name: 'invoiceNo', description: 'Invoice number', example: 'SL/INV/26-27/00088' },
      { name: 'balance', description: 'Amount still due', example: '6,490.00' },
      { name: 'dueDate', description: 'Due date', example: '12-Dec-2026' },
      { name: 'contactName', description: 'The customer contact, or "Sir/Madam"', example: 'Sir/Madam' },
      { name: 'customerName', description: 'The customer company', example: 'Example Industries Pvt Ltd' },
      { name: 'bankName', description: 'Bank name', example: 'Example Bank' },
      { name: 'bankAccount', description: 'Account number', example: '000000000000' },
      { name: 'bankIfsc', description: 'IFSC', example: 'EXMP0000001' },
    ],
  },
  'password-reset': {
    label: 'Password reset',
    description: 'Sent to a staff member who asked to reset their password.',
    subject: 'Reset your {{appName}} password',
    body: 'A password reset was requested for your account.\n\n{{resetLink}}\n\nThis link works for one hour. If you did not ask for this, you can ignore this email.',
    variables: [
      ...common,
      { name: 'appName', description: "The app's name", example: 'Sunrise LIMS' },
      { name: 'userName', description: 'The staff member', example: 'Rekha Reception' },
      { name: 'resetLink', description: 'The one-time link (shown as "Set a new password")', example: 'https://app.example/reset-password?token=example', link: true },
    ],
  },
} satisfies Record<string, EmailTemplateDef>;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;
export const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const SECTION = /\{\{#([a-zA-Z]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
const VARIABLE = /\{\{([a-zA-Z]+)\}\}/g;
const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

/** Names used in a template that it may not use, and sections left open. Empty when the template is fine. */
export function templateProblems(key: EmailTemplateKey, text: string): string[] {
  const allowed = new Set<string>(EMAIL_TEMPLATES[key].variables.map((v) => v.name));
  const problems: string[] = [];
  const withoutSections = text.replace(SECTION, (_m, name: string, inner: string) => {
    if (!allowed.has(name)) problems.push(`{{#${name}}} is not available here`);
    return inner;
  });
  for (const m of withoutSections.matchAll(/\{\{([#/]?)([a-zA-Z]*)\}\}/g)) {
    if (m[1]) problems.push(`{{${m[1]}${m[2]}}} has no matching ${m[1] === '#' ? 'end' : 'start'}`);
    else if (!allowed.has(m[2])) problems.push(`{{${m[2]}}} is not available here`);
  }
  return [...new Set(problems)];
}

/** Values in, plain-text subject and safe HTML body out. Missing values render as nothing. */
export function renderTemplate(key: EmailTemplateKey, tpl: { subject: string; body: string }, values: Record<string, string | number | null | undefined>): { subject: string; bodyHtml: string } {
  const links = new Set<string>(EMAIL_TEMPLATES[key].variables.filter((v) => 'link' in v && v.link).map((v) => v.name));
  const sections = (text: string) => text.replace(SECTION, (_m, name: string, inner: string) => (filled(values[name]) ? inner : ''));
  const subject = sections(tpl.subject)
    .replace(VARIABLE, (_m, name: string) => String(values[name] ?? ''))
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const html = esc(sections(tpl.body).replace(/\r\n/g, '\n').trim())
    .replace(VARIABLE, (_m, name: string) => {
      const v = values[name];
      if (!filled(v)) return '';
      const s = String(v);
      return links.has(name) && /^https?:\/\//.test(s) ? `<a href="${esc(s)}">${name === 'resetLink' ? 'Set a new password' : esc(s)}</a>` : esc(s);
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  const bodyHtml = html
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { subject, bodyHtml };
}

/** The example values shown in the editor's preview. */
export function exampleValues(key: EmailTemplateKey): Record<string, string> {
  return Object.fromEntries(EMAIL_TEMPLATES[key].variables.map((v) => [v.name, v.example]));
}
