/**
 * The ONLY module allowed to read COMPANY_* environment variables.
 * A deployment describes exactly one company. Invalid or missing values stop startup,
 * naming the variable but never echoing its value.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isValidGstin, PAN_RE } from '../common/india.js';

export interface CompanyConfig {
  productName: string;
  companyName: string;
  legalName: string;
  gstin: string;
  pan: string;
  cin: string | null;
  stateName: string;
  gstStateCode: string;
  sacCode: string;
  sacDescription: string;
  registeredAddress: string;
  labAddress: string;
  phone: string;
  email: string;
  website: string | null;
  reportVerificationEmail: string;
  bank: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    branch: string;
    ifsc: string;
    swift: string | null;
  };
  branding: { logoPath: string; faviconPath: string; primaryColor: string; accentColor: string };
  accreditation: {
    certificationText: string | null;
    nablMode: boolean;
    nablCertificateNo: string | null;
    ulrFormat: string | null;
  };
  documentPrefix: string;
}

/** Frozen onto issued documents. Excludes file paths: PDFs embed the logo captured at issue. */
export type CompanySnapshot = Omit<CompanyConfig, 'branding'> & {
  branding: { primaryColor: string; accentColor: string; logoDataUri: string | null };
};

export class CompanyConfigError extends Error {
  constructor(public readonly problems: { variable: string; problem: string }[]) {
    super(
      `Invalid company configuration:\n${problems.map((p) => `  - ${p.variable}: ${p.problem}`).join('\n')}`,
    );
    this.name = 'CompanyConfigError';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export function loadCompanyConfig(env: NodeJS.ProcessEnv = process.env): CompanyConfig {
  const problems: { variable: string; problem: string }[] = [];
  const req = (name: string): string => {
    const v = env[name]?.trim();
    if (!v) {
      problems.push({ variable: name, problem: 'is required but missing' });
      return '';
    }
    return v;
  };
  const opt = (name: string): string | null => env[name]?.trim() || null;
  const check = (name: string, value: string | null, ok: (v: string) => boolean, problem: string) => {
    if (value && !ok(value)) problems.push({ variable: name, problem });
  };

  const gstin = req('COMPANY_GSTIN');
  const pan = req('COMPANY_PAN');
  const gstStateCode = req('COMPANY_GST_STATE_CODE');
  const email = req('COMPANY_EMAIL');
  const verification = req('COMPANY_REPORT_VERIFICATION_EMAIL');
  const ifsc = req('COMPANY_BANK_IFSC');
  const swift = opt('COMPANY_BANK_SWIFT');
  const cin = opt('COMPANY_CIN');
  const primary = req('COMPANY_PRIMARY_COLOR');
  const accent = req('COMPANY_ACCENT_COLOR');
  const logo = req('COMPANY_LOGO_PATH');
  const favicon = req('COMPANY_FAVICON_PATH');

  check('COMPANY_GSTIN', gstin, isValidGstin, 'is not a valid GSTIN');
  check('COMPANY_GST_STATE_CODE', gstStateCode, (v) => /^[0-9]{2}$/.test(v), 'must be a two-digit state code');
  if (gstin && gstStateCode && gstin.slice(0, 2) !== gstStateCode) {
    problems.push({ variable: 'COMPANY_GST_STATE_CODE', problem: 'does not match the state code in COMPANY_GSTIN' });
  }
  check('COMPANY_PAN', pan, (v) => PAN_RE.test(v), 'is not a valid PAN');
  if (gstin && pan && gstin.slice(2, 12) !== pan) {
    problems.push({ variable: 'COMPANY_PAN', problem: 'does not match the PAN in COMPANY_GSTIN' });
  }
  check('COMPANY_CIN', cin, (v) => CIN_RE.test(v), 'is not a valid CIN');
  check('COMPANY_EMAIL', email, (v) => EMAIL_RE.test(v), 'is not a valid email address');
  check('COMPANY_REPORT_VERIFICATION_EMAIL', verification, (v) => EMAIL_RE.test(v), 'is not a valid email address');
  check('COMPANY_BANK_IFSC', ifsc, (v) => IFSC_RE.test(v), 'is not a valid IFSC');
  check('COMPANY_BANK_SWIFT', swift, (v) => SWIFT_RE.test(v), 'is not a valid SWIFT code');
  check('COMPANY_PRIMARY_COLOR', primary, (v) => COLOR_RE.test(v), 'must be a colour like #1a2b3c');
  check('COMPANY_ACCENT_COLOR', accent, (v) => COLOR_RE.test(v), 'must be a colour like #1a2b3c');

  const brandingRoot = env.COMPANY_BRANDING_DIR?.trim() || process.cwd();
  const resolvePath = (p: string) => (isAbsolute(p) ? p : resolve(brandingRoot, p));
  check('COMPANY_LOGO_PATH', logo, (v) => existsSync(resolvePath(v)), 'file does not exist');
  check('COMPANY_FAVICON_PATH', favicon, (v) => existsSync(resolvePath(v)), 'file does not exist');

  const nablRaw = (env.COMPANY_NABL_MODE ?? '').trim().toLowerCase();
  if (!['on', 'off'].includes(nablRaw)) {
    problems.push({ variable: 'COMPANY_NABL_MODE', problem: 'must be "on" or "off"' });
  }
  const nablMode = nablRaw === 'on';
  const nablCertificateNo = opt('COMPANY_NABL_CERTIFICATE_NO');
  const ulrFormat = opt('COMPANY_ULR_FORMAT');
  if (nablMode && !nablCertificateNo) {
    problems.push({ variable: 'COMPANY_NABL_CERTIFICATE_NO', problem: 'is required when COMPANY_NABL_MODE is on' });
  }
  if (nablMode && !ulrFormat) {
    problems.push({ variable: 'COMPANY_ULR_FORMAT', problem: 'is required when COMPANY_NABL_MODE is on' });
  }
  check('COMPANY_ULR_FORMAT', ulrFormat, (v) => v.includes('{SEQ'), 'must contain a {SEQ:n} token');

  const documentPrefix = req('COMPANY_DOCUMENT_PREFIX');
  check('COMPANY_DOCUMENT_PREFIX', documentPrefix, (v) => /^[A-Za-z0-9-]{1,10}$/.test(v), 'must be 1-10 letters, digits or hyphens');

  const config: CompanyConfig = {
    productName: req('COMPANY_PRODUCT_NAME'),
    companyName: req('COMPANY_NAME'),
    legalName: req('COMPANY_LEGAL_NAME'),
    gstin,
    pan,
    cin,
    stateName: req('COMPANY_STATE'),
    gstStateCode,
    sacCode: req('COMPANY_SAC_CODE'),
    sacDescription: req('COMPANY_SAC_DESCRIPTION'),
    registeredAddress: req('COMPANY_REGISTERED_ADDRESS'),
    labAddress: req('COMPANY_LAB_ADDRESS'),
    phone: req('COMPANY_PHONE'),
    email,
    website: opt('COMPANY_WEBSITE'),
    reportVerificationEmail: verification,
    bank: {
      accountName: req('COMPANY_BANK_ACCOUNT_NAME'),
      accountNumber: req('COMPANY_BANK_ACCOUNT_NUMBER'),
      bankName: req('COMPANY_BANK_NAME'),
      branch: req('COMPANY_BANK_BRANCH'),
      ifsc,
      swift,
    },
    branding: {
      logoPath: logo ? resolvePath(logo) : '',
      faviconPath: favicon ? resolvePath(favicon) : '',
      primaryColor: primary,
      accentColor: accent,
    },
    accreditation: {
      certificationText: opt('COMPANY_CERTIFICATION_TEXT'),
      nablMode,
      nablCertificateNo,
      ulrFormat,
    },
    documentPrefix,
  };

  if (problems.length) throw new CompanyConfigError(problems);
  return Object.freeze(config);
}

/** Nest injection token for the validated config. */
export const COMPANY_CONFIG = Symbol('COMPANY_CONFIG');
