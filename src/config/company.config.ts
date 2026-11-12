/**
 * The laboratory's identity and branding.
 *
 * These live in the database and are edited by the lab's administrator (Admin > Lab profile and Branding), so a
 * deployment needs only BRAND_NAME in its environment. CompanyService loads them, caches them in memory and reloads
 * every process when they change.
 *
 * COMPANY_* environment variables are still read, once, to import an installation that was configured the old way:
 * on the first start with an empty profile they are validated and copied into the database. After that the database
 * wins and the variables are ignored. Values are never echoed in error messages.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isValidGstin, PAN_RE } from '../common/india.js';

export interface CompanyProfile {
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
  accreditation: {
    certificationText: string | null;
    nablMode: boolean;
    nablCertificateNo: string | null;
    ulrFormat: string | null;
  };
  documentPrefix: string;
  /** shown in the footer of screens and emails */
  supportEmail: string | null;
  supportPhone: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  /** the person who answers privacy requests and grievances (DPDP Act), shown in emails and on the sign-in page */
  privacyContactName: string | null;
  privacyContactEmail: string | null;
}

export interface BrandingSettings {
  /** the app's display name; empty means BRAND_NAME */
  appName: string | null;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  navColor: string;
  /** stored files (category "branding"); null means the built-in default */
  logoFileId: string | null;
  faviconFileId: string | null;
  loginImageFileId: string | null;
  /** a line on the sign-in page and in emails; text and on/off */
  loginTagline: string | null;
  poweredBy: boolean;
}

/** What the rest of the system reads: profile, branding, and the resolved product name. */
export interface CompanyConfig extends CompanyProfile {
  productName: string;
  branding: BrandingSettings;
}

/** Frozen onto issued documents. PDFs embed the logo captured at issue. */
export type CompanySnapshot = Omit<CompanyConfig, 'branding'> & {
  branding: { primaryColor: string; accentColor: string; logoDataUri: string | null };
};

export class CompanyConfigError extends Error {
  constructor(public readonly problems: { variable: string; problem: string }[]) {
    super(`Invalid company configuration:\n${problems.map((p) => `  - ${p.variable}: ${p.problem}`).join('\n')}`);
    this.name = 'CompanyConfigError';
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const URL_RE = /^https?:\/\/\S+$/;

// TODO(product-decision): the neutral default palette for a fresh install (slate), before the lab picks colours.
export const DEFAULT_COLORS = { primaryColor: '#334155', accentColor: '#475569', surfaceColor: '#f5f6f8', navColor: '#f5f6f8' };

export const brandName = (env: NodeJS.ProcessEnv = process.env) => env.BRAND_NAME?.trim() || 'LIMS';

/** Letters and digits from the brand, for document numbers until the lab sets its own prefix. */
function prefixFrom(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '')
    .join('')
    .toUpperCase();
  return (initials.length >= 2 ? initials : name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).slice(0, 6) || 'LAB';
}

/** A fresh installation: the brand name and neutral defaults, to be completed in the setup wizard. */
export function defaultCompany(env: NodeJS.ProcessEnv = process.env): { profile: CompanyProfile; branding: BrandingSettings } {
  const name = brandName(env);
  return {
    profile: {
      companyName: name,
      legalName: name,
      gstin: '',
      pan: '',
      cin: null,
      stateName: '',
      gstStateCode: '',
      sacCode: '998346',
      sacDescription: 'Technical testing and analysis services',
      registeredAddress: '',
      labAddress: '',
      phone: '',
      email: '',
      website: null,
      reportVerificationEmail: '',
      bank: { accountName: '', accountNumber: '', bankName: '', branch: '', ifsc: '', swift: null },
      accreditation: { certificationText: null, nablMode: false, nablCertificateNo: null, ulrFormat: null },
      documentPrefix: prefixFrom(name),
      supportEmail: null,
      supportPhone: null,
      termsUrl: null,
      privacyUrl: null,
      privacyContactName: null,
      privacyContactEmail: null,
    },
    branding: { appName: null, ...DEFAULT_COLORS, logoFileId: null, faviconFileId: null, loginImageFileId: null, loginTagline: null, poweredBy: true },
  };
}

/**
 * Checks a profile as the admin saves it. Fields left empty are allowed (a lab can finish later), but anything
 * filled must be valid and consistent: GSTIN with PAN and state code, NABL mode with its certificate and ULR format.
 */
export function validateProfile(p: CompanyProfile): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  const bad = (field: string, message: string) => problems.push({ field, message });
  const filled = (v: string | null | undefined): v is string => !!v && v.trim().length > 0;
  if (!filled(p.companyName)) bad('companyName', 'Enter the laboratory name');
  if (!filled(p.legalName)) bad('legalName', 'Enter the legal name');
  if (filled(p.gstin) && !isValidGstin(p.gstin)) bad('gstin', 'Not a valid GSTIN');
  if (filled(p.gstStateCode) && !/^[0-9]{2}$/.test(p.gstStateCode)) bad('gstStateCode', 'Two digits');
  if (filled(p.gstin) && filled(p.gstStateCode) && p.gstin.slice(0, 2) !== p.gstStateCode) bad('gstStateCode', 'Does not match the GSTIN');
  if (filled(p.pan) && !PAN_RE.test(p.pan)) bad('pan', 'Not a valid PAN');
  if (filled(p.gstin) && filled(p.pan) && p.gstin.slice(2, 12) !== p.pan) bad('pan', 'Does not match the GSTIN');
  if (filled(p.cin) && !CIN_RE.test(p.cin)) bad('cin', 'Not a valid CIN');
  for (const f of ['email', 'reportVerificationEmail', 'supportEmail', 'privacyContactEmail'] as const) if (filled(p[f]) && !EMAIL_RE.test(p[f])) bad(f, 'Not a valid email address');
  for (const f of ['website', 'termsUrl', 'privacyUrl'] as const) if (filled(p[f]) && !URL_RE.test(p[f])) bad(f, 'Start with https://');
  if (filled(p.bank.ifsc) && !IFSC_RE.test(p.bank.ifsc)) bad('bank.ifsc', 'Not a valid IFSC');
  if (filled(p.bank.swift) && !SWIFT_RE.test(p.bank.swift)) bad('bank.swift', 'Not a valid SWIFT code');
  if (!/^[A-Za-z0-9-]{1,10}$/.test(p.documentPrefix ?? '')) bad('documentPrefix', '1-10 letters, digits or hyphens');
  if (p.accreditation.nablMode && !filled(p.accreditation.nablCertificateNo)) bad('accreditation.nablCertificateNo', 'Required when NABL mode is on');
  if (p.accreditation.nablMode && !filled(p.accreditation.ulrFormat)) bad('accreditation.ulrFormat', 'Required when NABL mode is on');
  if (filled(p.accreditation.ulrFormat) && !p.accreditation.ulrFormat.includes('{SEQ')) bad('accreditation.ulrFormat', 'Must contain a {SEQ:n} token');
  return problems;
}

export function validateBranding(b: BrandingSettings): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  for (const f of ['primaryColor', 'accentColor', 'surfaceColor', 'navColor'] as const) if (!COLOR_RE.test(b[f] ?? '')) problems.push({ field: f, message: 'A colour like #1a2b3c' });
  if (b.appName && b.appName.length > 60) problems.push({ field: 'appName', message: 'At most 60 characters' });
  if (b.loginTagline && b.loginTagline.length > 160) problems.push({ field: 'loginTagline', message: 'At most 160 characters' });
  return problems;
}

/** Profile, colours and image paths from COMPANY_* variables: for importing an install configured the old way. */
export interface LegacyCompany {
  profile: CompanyProfile;
  branding: BrandingSettings;
  appName: string;
  logoPath: string | null;
  faviconPath: string | null;
}

/**
 * Reads COMPANY_* variables when an install still has them, with the same strict checks as before (an invalid value
 * stops startup, naming the variable but never echoing it). Returns null when they are not set.
 */
export function legacyCompanyFromEnv(env: NodeJS.ProcessEnv = process.env): LegacyCompany | null {
  if (!env.COMPANY_NAME?.trim() && !env.COMPANY_LEGAL_NAME?.trim()) return null;
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
  const surface = opt('COMPANY_SURFACE_COLOR') ?? DEFAULT_COLORS.surfaceColor;
  const nav = opt('COMPANY_NAV_COLOR') ?? surface;
  const logo = opt('COMPANY_LOGO_PATH');
  const favicon = opt('COMPANY_FAVICON_PATH');

  check('COMPANY_GSTIN', gstin, isValidGstin, 'is not a valid GSTIN');
  check('COMPANY_GST_STATE_CODE', gstStateCode, (v) => /^[0-9]{2}$/.test(v), 'must be a two-digit state code');
  if (gstin && gstStateCode && gstin.slice(0, 2) !== gstStateCode) problems.push({ variable: 'COMPANY_GST_STATE_CODE', problem: 'does not match the state code in COMPANY_GSTIN' });
  check('COMPANY_PAN', pan, (v) => PAN_RE.test(v), 'is not a valid PAN');
  if (gstin && pan && gstin.slice(2, 12) !== pan) problems.push({ variable: 'COMPANY_PAN', problem: 'does not match the PAN in COMPANY_GSTIN' });
  check('COMPANY_CIN', cin, (v) => CIN_RE.test(v), 'is not a valid CIN');
  check('COMPANY_EMAIL', email, (v) => EMAIL_RE.test(v), 'is not a valid email address');
  check('COMPANY_REPORT_VERIFICATION_EMAIL', verification, (v) => EMAIL_RE.test(v), 'is not a valid email address');
  check('COMPANY_BANK_IFSC', ifsc, (v) => IFSC_RE.test(v), 'is not a valid IFSC');
  check('COMPANY_BANK_SWIFT', swift, (v) => SWIFT_RE.test(v), 'is not a valid SWIFT code');
  check('COMPANY_PRIMARY_COLOR', primary, (v) => COLOR_RE.test(v), 'must be a colour like #1a2b3c');
  check('COMPANY_ACCENT_COLOR', accent, (v) => COLOR_RE.test(v), 'must be a colour like #1a2b3c');
  check('COMPANY_SURFACE_COLOR', surface, (v) => COLOR_RE.test(v), 'must be a colour like #1a2b3c');
  check('COMPANY_NAV_COLOR', nav, (v) => COLOR_RE.test(v), 'must be a colour like #1a2b3c');

  const brandingRoot = env.COMPANY_BRANDING_DIR?.trim() || process.cwd();
  const resolvePath = (p: string) => (isAbsolute(p) ? p : resolve(brandingRoot, p));
  check('COMPANY_LOGO_PATH', logo, (v) => existsSync(resolvePath(v)), 'file does not exist');
  check('COMPANY_FAVICON_PATH', favicon, (v) => existsSync(resolvePath(v)), 'file does not exist');

  const nablRaw = (env.COMPANY_NABL_MODE ?? 'off').trim().toLowerCase();
  if (!['on', 'off'].includes(nablRaw)) problems.push({ variable: 'COMPANY_NABL_MODE', problem: 'must be "on" or "off"' });
  const nablMode = nablRaw === 'on';
  const nablCertificateNo = opt('COMPANY_NABL_CERTIFICATE_NO');
  const ulrFormat = opt('COMPANY_ULR_FORMAT');
  if (nablMode && !nablCertificateNo) problems.push({ variable: 'COMPANY_NABL_CERTIFICATE_NO', problem: 'is required when COMPANY_NABL_MODE is on' });
  if (nablMode && !ulrFormat) problems.push({ variable: 'COMPANY_ULR_FORMAT', problem: 'is required when COMPANY_NABL_MODE is on' });
  check('COMPANY_ULR_FORMAT', ulrFormat, (v) => v.includes('{SEQ'), 'must contain a {SEQ:n} token');

  const documentPrefix = req('COMPANY_DOCUMENT_PREFIX');
  check('COMPANY_DOCUMENT_PREFIX', documentPrefix, (v) => /^[A-Za-z0-9-]{1,10}$/.test(v), 'must be 1-10 letters, digits or hyphens');

  const profile: CompanyProfile = {
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
    bank: { accountName: req('COMPANY_BANK_ACCOUNT_NAME'), accountNumber: req('COMPANY_BANK_ACCOUNT_NUMBER'), bankName: req('COMPANY_BANK_NAME'), branch: req('COMPANY_BANK_BRANCH'), ifsc, swift },
    accreditation: { certificationText: opt('COMPANY_CERTIFICATION_TEXT'), nablMode, nablCertificateNo, ulrFormat },
    documentPrefix,
    supportEmail: null,
    supportPhone: null,
    termsUrl: null,
    privacyUrl: null,
    privacyContactName: null,
    privacyContactEmail: null,
  };
  const appName = opt('COMPANY_PRODUCT_NAME') ?? brandName(env);
  if (problems.length) throw new CompanyConfigError(problems);
  return {
    profile,
    branding: {
      appName,
      primaryColor: primary,
      accentColor: accent,
      surfaceColor: surface,
      navColor: nav,
      logoFileId: null,
      faviconFileId: null,
      loginImageFileId: null,
      loginTagline: null,
      poweredBy: true,
    },
    appName,
    logoPath: logo ? resolvePath(logo) : null,
    faviconPath: favicon ? resolvePath(favicon) : null,
  };
}

/** The config the rest of the system reads, from a profile and its branding. */
export function toCompanyConfig(profile: CompanyProfile, branding: BrandingSettings, env: NodeJS.ProcessEnv = process.env): CompanyConfig {
  return Object.freeze({ ...profile, productName: branding.appName?.trim() || brandName(env), branding });
}

/** Kept for tests and tools: the full config straight from COMPANY_* variables. */
export function loadCompanyConfig(env: NodeJS.ProcessEnv = process.env): CompanyConfig {
  const legacy = legacyCompanyFromEnv(env);
  if (!legacy) throw new CompanyConfigError([{ variable: 'COMPANY_NAME', problem: 'is required but missing' }]);
  return toCompanyConfig(legacy.profile, legacy.branding, env);
}
