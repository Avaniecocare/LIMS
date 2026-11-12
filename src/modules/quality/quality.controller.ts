import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SettingsService } from '../../core/settings.service.js';
import { OkDto } from '../auth/auth.dto.js';
import { Perm, RequireModule } from '../auth/decorators.js';
import {
  AuthorisationCheckDto,
  AuthorisationCheckQuery,
  AuthorisationDto,
  AuthorisationQuery,
  CreateAuthorisationDto,
  CreateNcDto,
  CreateTrainingDto,
  EquipmentEventDto,
  EquipmentRowDto,
  EquipmentScheduleDto,
  NcDto,
  NcQuery,
  PersonDto,
  QualitySummaryDto,
  RecordEquipmentEventDto,
  TrainingDto,
  UpdateNcDto,
  WithdrawDto,
} from './quality.dto.js';
import { QualityService } from './quality.service.js';

@ApiTags('quality')
@RequireModule('quality')
@Controller('quality')
export class QualityController {
  constructor(
    private readonly quality: QualityService,
    private readonly settings: SettingsService,
  ) {}

  @Get('summary') @Perm('quality.view') @ApiOkResponse({ type: QualitySummaryDto })
  summary() {
    return this.quality.summary();
  }

  @Get('people') @Perm('quality.view') @ApiOkResponse({ type: [PersonDto] })
  people() {
    return this.quality.people();
  }

  @Get('equipment') @Perm('quality.view') @ApiOkResponse({ type: [EquipmentRowDto] })
  equipment() {
    return this.quality.equipment();
  }

  @Get('equipment/:id/events') @Perm('quality.view') @ApiOkResponse({ type: [EquipmentEventDto] })
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.quality.events(id);
  }

  @Post('equipment/:id/events') @Perm('quality.manage') @ApiOkResponse({ type: EquipmentEventDto })
  record(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordEquipmentEventDto) {
    return this.quality.recordEvent(id, dto);
  }

  @Patch('equipment/:id/schedule') @Perm('quality.manage') @ApiOkResponse({ type: OkDto })
  async schedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EquipmentScheduleDto) {
    await this.quality.schedule(id, dto);
    return { ok: true };
  }

  @Get('authorisations') @Perm('quality.view') @ApiOkResponse({ type: [AuthorisationDto] })
  authorisations(@Query() q: AuthorisationQuery) {
    return this.quality.authorisations(q);
  }

  /** For the planner's assignment dialog: which tests this person is not authorised for. */
  @Get('authorisations/check') @Perm('quality.view', 'planning.edit') @ApiOkResponse({ type: AuthorisationCheckDto })
  async check(@Query() q: AuthorisationCheckQuery): Promise<AuthorisationCheckDto> {
    const ids = q.testIds.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    return { missing: await this.quality.missingAuthorisations(q.userId, ids), enforced: await this.settings.get('controls.requireAuthorisation') };
  }

  @Post('authorisations') @Perm('quality.manage') @ApiOkResponse({ type: OkDto })
  async authorise(@Body() dto: CreateAuthorisationDto) {
    await this.quality.authorise(dto);
    return { ok: true };
  }

  @Post('authorisations/:id/withdraw') @HttpCode(200) @Perm('quality.manage') @ApiOkResponse({ type: OkDto })
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WithdrawDto) {
    await this.quality.withdraw(id, dto.reason);
    return { ok: true };
  }

  @Get('training') @Perm('quality.view') @ApiOkResponse({ type: [TrainingDto] })
  training(@Query('userId') userId?: string) {
    return this.quality.training(userId && /^[0-9a-f-]{36}$/.test(userId) ? userId : undefined);
  }

  @Post('training') @Perm('quality.manage') @ApiOkResponse({ type: OkDto })
  async addTraining(@Body() dto: CreateTrainingDto) {
    await this.quality.addTraining(dto);
    return { ok: true };
  }

  @Get('nc') @Perm('quality.view') @ApiOkResponse({ type: [NcDto] })
  ncList(@Query() q: NcQuery) {
    return this.quality.ncList(q);
  }

  /** What I reported, for anyone who can raise one. */
  @Get('nc/mine') @Perm('quality.view', 'tests.work', 'jobs.view') @ApiOkResponse({ type: [NcDto] })
  ncMine() {
    return this.quality.ncMine();
  }

  @Get('nc/:id') @Perm('quality.view') @ApiOkResponse({ type: NcDto })
  ncGet(@Param('id', ParseUUIDPipe) id: string) {
    return this.quality.ncGet(id);
  }

  /** Anyone who works in the lab can raise one; working it through needs quality.manage or being its owner. */
  @Post('nc') @Perm('quality.view', 'tests.work', 'jobs.view') @ApiOkResponse({ type: NcDto })
  ncCreate(@Body() dto: CreateNcDto) {
    return this.quality.ncCreate(dto);
  }

  @Patch('nc/:id') @Perm('quality.manage') @ApiOkResponse({ type: NcDto })
  ncUpdate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNcDto) {
    return this.quality.ncUpdate(id, dto);
  }
}
