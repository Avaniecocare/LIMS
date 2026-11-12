import { describe, expect, it } from 'vitest';
import { CompanyConfigError, loadCompanyConfig } from '../../src/config/company.config.js';
import { bluepeak, greenfield } from '../support/company-env.js';

const problems = (env: Record<string, string>) => {
  try {
    loadCompanyConfig(env);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(CompanyConfigError);
    return (e as CompanyConfigError).problems.map((p) => p.variable);
  }
};

describe('company configuration', () => {
  it('accepts valid fictional companies', () => {
    expect(loadCompanyConfig(bluepeak).companyName).toBe('BluePeak Testing Labs');
    expect(loadCompanyConfig(greenfield).accreditation.nablMode).toBe(true);
  });

  // Optional when importing: the product name falls back to BRAND_NAME, images to the built-in mark, NABL mode to off.
  const OPTIONAL = ['COMPANY_CIN', 'COMPANY_WEBSITE', 'COMPANY_BANK_SWIFT', 'COMPANY_CERTIFICATION_TEXT', 'COMPANY_NABL_CERTIFICATE_NO', 'COMPANY_ULR_FORMAT', 'COMPANY_BRANDING_DIR', 'COMPANY_PRODUCT_NAME', 'COMPANY_LOGO_PATH', 'COMPANY_FAVICON_PATH', 'COMPANY_NABL_MODE'];
  it.each(Object.keys(bluepeak).filter((k) => !OPTIONAL.includes(k)))(
    'refuses to load without %s, naming it',
    (name) => {
      const env = { ...bluepeak };
      delete env[name];
      expect(problems(env)).toContain(name);
    },
  );

  it('rejects a GST state code that does not match the GSTIN', () => {
    expect(problems({ ...bluepeak, COMPANY_GST_STATE_CODE: '29' })).toContain('COMPANY_GST_STATE_CODE');
  });

  it('rejects malformed values without echoing them', () => {
    const secret = 'NOT-A-REAL-GSTIN-VALUE';
    try {
      loadCompanyConfig({ ...bluepeak, COMPANY_GSTIN: secret });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('COMPANY_GSTIN');
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('requires certificate and ULR format only when NABL mode is on', () => {
    expect(problems({ ...bluepeak, COMPANY_NABL_MODE: 'on' })).toEqual(expect.arrayContaining(['COMPANY_NABL_CERTIFICATE_NO', 'COMPANY_ULR_FORMAT']));
    expect(problems({ ...bluepeak, COMPANY_NABL_MODE: 'maybe' })).toContain('COMPANY_NABL_MODE');
  });

  it('rejects branding files that do not exist', () => {
    expect(problems({ ...bluepeak, COMPANY_LOGO_PATH: 'missing.png' })).toContain('COMPANY_LOGO_PATH');
  });
});
