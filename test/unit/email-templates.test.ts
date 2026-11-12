import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATES, exampleValues, renderTemplate, templateProblems } from '../../src/core/email-templates.js';

describe('email templates', () => {
  it('every built-in template uses only its own variables', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = EMAIL_TEMPLATES[key];
      expect([...templateProblems(key, def.subject), ...templateProblems(key, def.body)], key).toEqual([]);
    }
  });

  it('turns plain text into paragraphs and line breaks, with **bold**', () => {
    const out = renderTemplate('invoice', { subject: 'Invoice {{invoiceNo}}', body: 'Dear {{contactName}},\n\nInvoice **{{invoiceNo}}**\nis attached.' }, { invoiceNo: 'INV/1', contactName: 'Asha' });
    expect(out.subject).toBe('Invoice INV/1');
    expect(out.bodyHtml).toBe('<p>Dear Asha,</p><p>Invoice <strong>INV/1</strong><br>is attached.</p>');
  });

  it('keeps a section only when its value is present', () => {
    const tpl = { subject: 'Report {{reportNo}}{{#revisionNo}} revision {{revisionNo}}{{/revisionNo}}', body: 'Hi{{#revisionReason}}\n\nReason: {{revisionReason}}{{/revisionReason}}' };
    expect(renderTemplate('report', tpl, { reportNo: 'R1' })).toEqual({ subject: 'Report R1', bodyHtml: '<p>Hi</p>' });
    expect(renderTemplate('report', tpl, { reportNo: 'R1', revisionNo: 2, revisionReason: 'Typo' })).toEqual({ subject: 'Report R1 revision 2', bodyHtml: '<p>Hi</p><p>Reason: Typo</p>' });
  });

  it('escapes everything, so neither the wording nor a value can inject markup', () => {
    const out = renderTemplate('quotation', { subject: 'Q', body: '<script>alert(1)</script> {{message}}' }, { message: '<img src=x onerror=alert(1)>' });
    expect(out.bodyHtml).not.toMatch(/<script|<img/);
    expect(out.bodyHtml).toContain('&lt;script&gt;');
  });

  it('a subject cannot carry a line break into the email headers', () => {
    expect(renderTemplate('quotation', { subject: '{{message}}', body: 'x' }, { message: 'Hi\r\nBcc: someone@evil.example' }).subject).toBe('Hi Bcc: someone@evil.example');
  });

  it('shows the reset link as a link, and only http(s) links', () => {
    const def = EMAIL_TEMPLATES['password-reset'];
    expect(renderTemplate('password-reset', def, { resetLink: 'https://app.example/reset?token=a' }).bodyHtml).toContain('<a href="https://app.example/reset?token=a">Set a new password</a>');
    expect(renderTemplate('password-reset', def, { resetLink: 'javascript:alert(1)' }).bodyHtml).not.toContain('<a ');
  });

  it('names unknown variables and unclosed sections', () => {
    expect(templateProblems('invoice', 'Hello {{reportNo}} {{#amount}}x')).toEqual(['{{reportNo}} is not available here', '{{#amount}} has no matching end']);
    expect(templateProblems('invoice', '{{#gstin}}x{{/gstin}}')).toEqual(['{{#gstin}} is not available here']);
  });

  it('has example values for the preview', () => {
    expect(exampleValues('acknowledgement').jobNo).toBeTruthy();
  });
});
