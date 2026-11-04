import { createReadStream } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, Inject, Post, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import argon2 from 'argon2';
import type { FastifyReply } from 'fastify';
import { AppError, badRequest } from '../../common/errors.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService, mimeForPath } from '../../core/company.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { BrandingDto, SetupDto, SetupStatusDto } from '../admin/admin.dto.js';
import { AdminService } from '../admin/admin.service.js';
import { OkDto } from '../auth/auth.dto.js';
import { assertPasswordPolicy } from '../auth/auth.service.js';
import { Public } from '../auth/decorators.js';

@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly company: CompanyService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly admin: AdminService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  /** Allow-list by construction: only these six fields may ever leave without a login. */
  @Get('branding') @ApiOkResponse({ type: BrandingDto })
  branding(): BrandingDto {
    const c = this.company.config;
    return {
      productName: c.productName,
      companyName: c.companyName,
      logoUrl: `${this.infra.publicApiUrl}/api/v1/public/branding/logo`,
      faviconUrl: `${this.infra.publicApiUrl}/api/v1/public/branding/favicon`,
      primaryColor: c.branding.primaryColor,
      accentColor: c.branding.accentColor,
    };
  }

  @Get('branding/logo')
  logo(@Res() reply: FastifyReply) {
    return this.sendFile(reply, this.company.config.branding.logoPath);
  }

  @Get('branding/favicon')
  favicon(@Res() reply: FastifyReply) {
    return this.sendFile(reply, this.company.config.branding.faviconPath);
  }

  private sendFile(reply: FastifyReply, path: string) {
    return reply
      .header('Content-Type', mimeForPath(path))
      .header('Cache-Control', 'public, max-age=3600')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(createReadStream(path));
  }

  @Get('setup-status') @ApiOkResponse({ type: SetupStatusDto })
  async setupStatus(): Promise<SetupStatusDto> {
    return { setupRequired: await this.setupRequired(), tokenRequired: !!this.infra.setupToken };
  }

  private async setupRequired() {
    const completed = await this.settings.get('setup.completed');
    if (completed) return false;
    return (await this.prisma.user.count({ where: { deletedAt: null } })) === 0;
  }

  /** First-run wizard. Refuses permanently once any user exists. */
  @Post('setup') @ApiOkResponse({ type: OkDto })
  async setup(@Body() dto: SetupDto): Promise<OkDto> {
    if (this.infra.setupToken) {
      const a = Buffer.from(dto.setupToken ?? '');
      const b = Buffer.from(this.infra.setupToken);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('FORBIDDEN', 403, 'Incorrect setup token');
    }
    assertPasswordPolicy(dto.adminPassword, 'adminPassword');
    if (dto.workingDays && (dto.workingDays.length === 0 || dto.workingDays.some((d) => d < 0 || d > 6))) {
      throw badRequest('Working days must be between 0 and 6', [{ field: 'workingDays', message: 'Invalid day' }]);
    }
    const passwordHash = await argon2.hash(dto.adminPassword);
    await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent first-run attempts; the second sees the first admin and is refused.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
      if ((await tx.user.count({ where: { deletedAt: null } })) > 0) throw new AppError('SETUP_DONE', 409, 'Setup has already been completed');
      const adminRole = await tx.role.findUniqueOrThrow({ where: { name: 'Admin' } });
      const user = await tx.user.create({
        data: { email: dto.adminEmail.trim().toLowerCase(), name: dto.adminName, passwordHash, passwordChangedAt: new Date(), roles: { create: [{ roleId: adminRole.id }] } },
      });
      const set = (key: Parameters<SettingsService['set']>[0], value: unknown) => this.settings.set(key, value, 0, 'First-run setup', tx);
      if (dto.gstRate !== undefined) await set('tax.gstRate', dto.gstRate);
      if (dto.defaultCreditDays !== undefined) await set('credit.defaultDays', dto.defaultCreditDays);
      if (dto.workingDays) await set('calendar.workingDays', dto.workingDays);
      if (dto.sampleRetentionDays !== undefined) await set('retention.sampleDays', dto.sampleRetentionDays);
      if (dto.reportRetentionYears !== undefined) await set('retention.reportYears', dto.reportRetentionYears);
      if (dto.terms?.quotation) await this.admin.addTerms('QUOTATION', dto.terms.quotation, tx);
      if (dto.terms?.invoice) await this.admin.addTerms('INVOICE', dto.terms.invoice, tx);
      if (dto.terms?.report) await this.admin.addTerms('REPORT', dto.terms.report, tx);
      await set('setup.completed', true);
      await this.audit.record({ action: 'setup.completed', entity: 'User', entityId: user.id }, tx);
    });
    return { ok: true };
  }
}
