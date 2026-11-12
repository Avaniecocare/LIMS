import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { OkDto } from '../auth/auth.dto.js';
import { Perm } from '../auth/decorators.js';
import { SaveEInvoiceSettingsDto, EInvoiceSettingsDto } from './einvoice.dto.js';
import { EInvoiceService } from './einvoice.service.js';

/** Admin, E-invoicing: what the server is set up for, the seller address, and a connection check. No secrets. */
@ApiTags('admin')
@Controller('admin/lab/einvoice')
export class EInvoiceAdminController {
  constructor(
    private readonly einvoice: EInvoiceService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Perm('admin.company.view')
  @ApiOkResponse({ type: EInvoiceSettingsDto })
  async get(): Promise<EInvoiceSettingsDto> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: ['einvoice.seller', 'einvoice.autoOnIssue'] } } });
    const version = (key: string) => rows.find((r) => r.key === key)?.version ?? 0;
    return { ...(await this.einvoice.status()), sellerVersion: version('einvoice.seller'), autoOnIssueVersion: version('einvoice.autoOnIssue') };
  }

  @Put()
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: EInvoiceSettingsDto })
  async save(@Body() dto: SaveEInvoiceSettingsDto): Promise<EInvoiceSettingsDto> {
    const seller = { line1: dto.seller.line1.trim(), line2: dto.seller.line2.trim(), city: dto.seller.city.trim(), pincode: dto.seller.pincode.trim() };
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set('einvoice.seller', seller, dto.sellerVersion, null, tx);
      await this.settings.set('einvoice.autoOnIssue', dto.autoOnIssue, dto.autoOnIssueVersion, null, tx);
    });
    return this.get();
  }

  /** Signs in to the IRP with the server's credentials, to prove they work. */
  @Post('check')
  @HttpCode(200)
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: OkDto })
  check() {
    return this.einvoice.check();
  }
}
