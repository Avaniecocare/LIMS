import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { COMPANY_CONFIG, type CompanyConfig, type CompanySnapshot } from '../config/company.config.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

export const mimeForPath = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

@Injectable()
export class CompanyService {
  constructor(@Inject(COMPANY_CONFIG) readonly config: CompanyConfig) {}

  logoDataUri(): string | null {
    try {
      const { logoPath } = this.config.branding;
      return `data:${mimeForPath(logoPath)};base64,${readFileSync(logoPath).toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** Stored on documents when issued; PDFs regenerate from this, never from live env values. */
  snapshot(): CompanySnapshot {
    const { branding, ...rest } = this.config;
    return {
      ...rest,
      branding: { primaryColor: branding.primaryColor, accentColor: branding.accentColor, logoDataUri: this.logoDataUri() },
    };
  }
}
