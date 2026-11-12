import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { ModulesService } from '../../core/modules.service.js';
import { WHATSAPP_KIND_KEYS, WHATSAPP_KINDS, WhatsappService } from '../../core/whatsapp.service.js';
import { OkDto } from '../auth/auth.dto.js';
import { Perm } from '../auth/decorators.js';
import { WhatsappSendService } from './whatsapp-send.service.js';
import { SaveWhatsappTemplatesDto, WhatsappPanelDto, WhatsappSendDto, WhatsappSettingsDto, WhatsappTestDto } from './whatsapp.dto.js';

/** Sending reports, invoices, letters and reminders on WhatsApp. Each kind is checked against its own permission. */
@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly sender: WhatsappSendService) {}

  @Post('send')
  @HttpCode(200)
  @Perm('reports.issue', 'invoices.edit', 'reminders.send', 'jobs.create', 'jobs.edit')
  @ApiOkResponse({ type: OkDto })
  send(@Body() dto: WhatsappSendDto) {
    return this.sender.send(dto);
  }

  @Get(':entity/:id')
  @Perm('reports.view', 'invoices.view', 'jobs.view')
  @ApiOkResponse({ type: WhatsappPanelDto })
  panel(@Param('entity') entity: string, @Param('id', ParseUUIDPipe) id: string): Promise<WhatsappPanelDto> {
    return this.sender.panel(entity, id) as Promise<WhatsappPanelDto>;
  }
}

/** The administrator's WhatsApp page: whether it is connected, which templates to use, a test, and what was sent. */
@ApiTags('admin')
@Controller('admin/lab/whatsapp')
export class WhatsappAdminController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly modules: ModulesService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  @Get()
  @Perm('admin.company.view')
  @ApiOkResponse({ type: WhatsappSettingsDto })
  async settings(): Promise<WhatsappSettingsDto> {
    const { version, templates } = await this.whatsapp.templates();
    const w = this.infra.whatsapp;
    return {
      configured: !!w,
      enabled: await this.modules.isOn('whatsapp'),
      transport: w?.transport ?? null,
      phoneNumberIdHint: w?.phoneNumberId ? w.phoneNumberId.slice(-4) : null,
      version,
      templates: WHATSAPP_KIND_KEYS.map((key) => ({
        key,
        label: WHATSAPP_KINDS[key].label,
        document: WHATSAPP_KINDS[key].document,
        available: Object.entries(WHATSAPP_KINDS[key].values).map(([k, label]) => ({ key: k, label })),
        name: templates[key].name,
        language: templates[key].language,
        values: templates[key].values,
      })),
      receipts: !!w?.appSecret && !!w?.verifyToken,
      webhookUrl: `${this.infra.publicApiUrl.replace(/\/+$/, '')}/api/v1/webhooks/whatsapp`,
      recent: (await this.whatsapp.log()) as WhatsappSettingsDto['recent'],
    };
  }

  @Put('templates')
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: WhatsappSettingsDto })
  async saveTemplates(@Body() dto: SaveWhatsappTemplatesDto): Promise<WhatsappSettingsDto> {
    await this.whatsapp.saveTemplates(dto.templates, dto.version);
    return this.settings();
  }

  /** Sends Meta's hello_world template, which every WhatsApp Business account has, to check the connection. */
  @Post('test')
  @HttpCode(200)
  @Perm('admin.company.edit')
  @ApiOkResponse({ type: OkDto })
  async test(@Body() dto: WhatsappTestDto) {
    await this.whatsapp.testSend(dto.to);
    return { ok: true };
  }
}
