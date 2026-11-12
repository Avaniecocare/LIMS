import { describe, expect, it } from 'vitest';
import { loadCompanyConfig, type CompanySnapshot } from '../../src/config/company.config.js';
import { acknowledgementHtml, type JobDocument } from '../../src/modules/pdf/templates/job-documents.js';
import { bluepeak } from '../support/company-env.js';

const { branding, ...rest } = loadCompanyConfig(bluepeak);
const company: CompanySnapshot = { ...rest, branding: { primaryColor: branding.primaryColor, accentColor: branding.accentColor, logoDataUri: null } };
const job: JobDocument = {
  jobNo: 'JOB-1', receivedAt: new Date('2026-11-12T05:00:00Z'), urgent: false, letterRef: null, letterDate: null, materialSpec: null, poNumber: null, poDate: null, receiptMode: null,
  reportIssueDetails: null, reportIssueAddress: null, kindAttention: 'Rohan Mehta', contactEmail: null, contactPhone: null, customerName: 'Green Valley', crn: 'CRN-1', receivedBy: null,
  samples: [{ sampleNo: 'S-1', description: 'MS plate', condition: 'Good', quantity: '1', size: null, returnable: false, attributes: [], tests: ['Tensile'] }],
  deviations: [],
};

describe('acknowledgement letter', () => {
  it('has no photo section when none were chosen', () => {
    expect(acknowledgementHtml(job, company)).not.toContain('Photographs of samples as received');
  });
  it('prints chosen photos in order, numbered, with the sample number and caption', () => {
    const html = acknowledgementHtml(job, company, [
      { dataUri: 'data:image/png;base64,AAAA', caption: 'S-1: front face' },
      { dataUri: 'data:image/png;base64,BBBB', caption: 'S-1' },
    ]);
    expect(html).toContain('Photographs of samples as received');
    expect(html.indexOf('Photo 1: S-1: front face')).toBeLessThan(html.indexOf('Photo 2: S-1'));
    expect(html).toContain('data:image/png;base64,BBBB');
  });
  it('escapes captions', () => {
    expect(acknowledgementHtml(job, company, [{ dataUri: 'data:image/png;base64,AA', caption: '<script>x</script>' }])).not.toContain('<script>x');
  });
});
