import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AppError, badRequest, requireRecentAuth } from '../../common/errors.js';
import { EmailTemplateService } from '../../core/email-template.service.js';
import { MailService } from '../../core/mail.service.js';
import { ModulesService } from '../../core/modules.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { OkDto } from '../auth/auth.dto.js';
import { CompanyService, type BrandImageKind } from '../../core/company.service.js';
import { StorageService } from '../../core/storage.service.js';
import { Perm } from '../auth/decorators.js';
import { readUpload } from '../files/files.controller.js';
import {
  ModuleListDto,
  SaveModulesDto,
  EmailPreviewDto,
  EmailTemplateInputDto,
  EmailTemplateListDto,
  SaveEmailTemplateDto,
  ApplyTemplatesDto,
  ApplyTemplatesResultDto,
  LabDetailsDto,
  SaveBrandingDto,
  SaveLabProfileDto,
  SetupStatusDetailDto,
  TemplateSummaryDto,
  TestEmailDto,
} from './lab.dto.js';
import { TemplatesService } from './templates.service.js';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const KINDS = ['logo', 'favicon', 'login'] as const;
// TODO(product-decision): 2 MB for a logo or sign-in picture; ample for a sharp PNG, small enough for every PDF.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** The lab profile and branding, edited by the lab's administrator. Saved changes apply everywhere at once. */
@ApiTags('admin')
@Controller('admin/lab')
export class LabController {
  constructor(
    private readonly company: CompanyService,
    private readonly storage: StorageService,
    private readonly templatesService: TemplatesService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly emailTemplatesService: EmailTemplateService,
    private readonly modules: ModulesService,
  ) {}

  @Get()
  @Perm('admin.company.view')
  @ApiOkResponse({ type: LabDetailsDto })
  details(): Promise<LabDetailsDto> {
    return this.company.details();
  }

  /** Bank account, GSTIN and accreditation print on every invoice and report, so the password is confirmed first. */
  @Put('profile')
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: LabDetailsDto })
  async saveProfile(@Body() dto: SaveLabProfileDto): Promise<LabDetailsDto> {
    requireRecentAuth();
    await this.company.saveProfile(dto.profile, dto.version);
    return this.company.details();
  }

  @Put('branding')
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: LabDetailsDto })
  async saveBranding(@Body() dto: SaveBrandingDto): Promise<LabDetailsDto> {
    await this.company.saveBranding(dto.branding, dto.version);
    return this.company.details();
  }

  @Post('branding/:kind')
  @Perm('admin.company.edit')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'version'], properties: { file: { type: 'string', format: 'binary' }, version: { type: 'integer' } } } })
  @ApiOkResponse({ type: LabDetailsDto })
  async uploadImage(@Param('kind') kind: string, @Req() req: FastifyRequest): Promise<LabDetailsDto> {
    const k = this.kind(kind);
    const f = await readUpload(req);
    const version = Number(f.field('version'));
    if (!Number.isInteger(version) || version < 0) throw badRequest('Send the branding version', [{ field: 'version', message: 'Required' }]);
    if (f.buffer.length > MAX_IMAGE_BYTES) throw badRequest('The picture is larger than 2 MB', [{ field: 'file', message: 'At most 2 MB' }]);
    const stored = await this.storage.storeUpload({ buffer: f.buffer, originalName: f.filename || `${k}.png`, mimeType: f.mimetype, category: 'branding', entity: 'Branding', entityId: null });
    if (!stored.mimeType.startsWith('image/')) throw badRequest('Use a PNG, JPEG or WebP picture', [{ field: 'file', message: 'Not a picture' }]);
    await this.company.setImage(k, stored.id, version);
    return this.company.details();
  }

  @Delete('branding/:kind')
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: LabDetailsDto })
  async removeImage(@Param('kind') kind: string, @Query('version', ParseIntPipe) version: number): Promise<LabDetailsDto> {
    await this.company.setImage(this.kind(kind), null, version);
    return this.company.details();
  }

  // ---------------------------------------------------------------- setup wizard

  @Get('templates')
  @Perm('admin.company.view')
  @ApiOkResponse({ type: [TemplateSummaryDto] })
  templates(): TemplateSummaryDto[] {
    return this.templatesService.list();
  }

  /** Adds a starting test catalogue. Only adds: anything already there by code is left as it is. */
  @Post('templates/apply')
  @HttpCode(200)
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: ApplyTemplatesResultDto })
  applyTemplates(@Body() dto: ApplyTemplatesDto): Promise<ApplyTemplatesResultDto> {
    return this.templatesService.apply(dto.templates);
  }

  @Get('setup')
  @Perm('admin.company.view')
  @ApiOkResponse({ type: SetupStatusDetailDto })
  async setup(): Promise<SetupStatusDetailDto> {
    const { profile, brandingVersion } = await this.company.details();
    const [tests, users, emailTested, completed] = await Promise.all([
      this.prisma.testMaster.count({ where: { deletedAt: null, isDemo: false } }),
      this.prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      this.settings.get('setup.emailTested'),
      this.settings.get('setup.labCompleted'),
    ]);
    return {
      completed,
      steps: {
        profile: !!(profile.labAddress && profile.email && profile.stateName),
        branding: brandingVersion > 1,
        catalogue: tests > 0,
        team: users > 1,
        email: emailTested,
      },
    };
  }

  /** Sends a branded test email at once and reports what the mail server said. */
  @Post('setup/test-email')
  @HttpCode(200)
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: OkDto })
  async testEmail(@Body() dto: TestEmailDto): Promise<OkDto> {
    const c = this.company.config;
    try {
      await this.mail.sendNow(
        dto.to,
        `Test email from ${c.productName}`,
        `<p>This is a test email from ${escapeHtml(c.productName)}.</p><p>If you can read it, emails to customers (acknowledgements, reports, invoices, reminders) will be delivered from this address with your lab's name.</p>`,
      );
    } catch (e) {
      throw new AppError('EMAIL_FAILED', 502, `The mail server refused or could not be reached: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown error'}`);
    }
    const version = (await this.prisma.setting.findUnique({ where: { key: 'setup.emailTested' } }))?.version ?? 0;
    await this.settings.set('setup.emailTested', true, version, 'Test email sent from setup');
    return { ok: true };
  }

  @Post('setup/complete')
  @HttpCode(200)
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: OkDto })
  async complete(): Promise<OkDto> {
    const version = (await this.prisma.setting.findUnique({ where: { key: 'setup.labCompleted' } }))?.version ?? 0;
    if (version === 0 || !(await this.settings.get('setup.labCompleted'))) await this.settings.set('setup.labCompleted', true, version, 'Setup wizard finished');
    return { ok: true };
  }

  // ---------------------------------------------------------------- modules

  @Get('modules')
  @Perm('admin.company.view')
  @ApiOkResponse({ type: ModuleListDto })
  moduleList(): Promise<ModuleListDto> {
    return this.modules.list();
  }

  @Put('modules')
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: ModuleListDto })
  async saveModules(@Body() dto: SaveModulesDto): Promise<ModuleListDto> {
    if (Object.values(dto.enabled).some((v) => typeof v !== 'boolean')) throw badRequest('Each module is on or off', [{ field: 'enabled', message: 'true or false' }]);
    await this.modules.save(dto.enabled, dto.version);
    return this.modules.list();
  }

  // ---------------------------------------------------------------- email templates

  @Get('email-templates')
  @Perm('admin.company.view')
  @ApiOkResponse({ type: EmailTemplateListDto })
  emailTemplates(): Promise<EmailTemplateListDto> {
    return this.emailTemplatesService.list();
  }

  @Put('email-templates/:key')
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: EmailTemplateListDto })
  async saveEmailTemplate(@Param('key') key: string, @Body() dto: SaveEmailTemplateDto): Promise<EmailTemplateListDto> {
    await this.emailTemplatesService.save(this.templateKey(key), dto.subject, dto.body, dto.version);
    return this.emailTemplatesService.list();
  }

  /** Back to the product's wording. */
  @Delete('email-templates/:key')
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: EmailTemplateListDto })
  async resetEmailTemplate(@Param('key') key: string, @Query('version', ParseIntPipe) version: number): Promise<EmailTemplateListDto> {
    await this.emailTemplatesService.reset(this.templateKey(key), version);
    return this.emailTemplatesService.list();
  }

  @Post('email-templates/:key/preview')
  @HttpCode(200)
  @Perm('admin.company.view')
  @ApiOkResponse({ type: EmailPreviewDto })
  previewEmailTemplate(@Param('key') key: string, @Body() dto: EmailTemplateInputDto): EmailPreviewDto {
    return this.emailTemplatesService.preview(this.templateKey(key), dto.subject, dto.body);
  }

  private templateKey(key: string) {
    if (!this.emailTemplatesService.isKey(key)) throw badRequest('Unknown email template', [{ field: 'key', message: 'Unknown template' }]);
    return key;
  }

  private kind(kind: string): BrandImageKind {
    if (!(KINDS as readonly string[]).includes(kind)) throw badRequest('Unknown picture', [{ field: 'kind', message: 'logo, favicon or login' }]);
    return kind as BrandImageKind;
  }
}
