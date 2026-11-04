import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OkDto } from '../auth/auth.dto.js';
import { Perm } from '../auth/decorators.js';
import { DocumentJobDto } from '../documents/documents.dto.js';
import { EmailLogDto } from '../quotations/quotations.dto.js';
import { AddDeviationDto, AuditHistoryDto, CombineLetterDto, CreateJobDto, JobDto, JobPageDto, JobQuery, ReasonOnlyDto, SamplePageDto, SampleQuery, SendAckDto, TimelineEventDto, UpdateJobDto, UpdateSampleDto, VersionOnlyDto } from './jobs.dto.js';
import { JobsService } from './jobs.service.js';

@ApiTags('jobs')
@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs') @Perm('jobs.view') @ApiOkResponse({ type: JobPageDto })
  list(@Query() q: JobQuery) {
    return this.jobs.list(q);
  }

  @Get('samples') @Perm('jobs.view') @ApiOkResponse({ type: SamplePageDto })
  samples(@Query() q: SampleQuery) {
    return this.jobs.listSamples(q);
  }

  @Get('jobs/:id') @Perm('jobs.view') @ApiOkResponse({ type: JobDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.get(id);
  }

  @Post('jobs') @Perm('jobs.create') @ApiOkResponse({ type: JobDto })
  create(@Body() dto: CreateJobDto) {
    return this.jobs.create(dto);
  }

  @Patch('jobs/:id') @Perm('jobs.edit') @ApiOkResponse({ type: JobDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJobDto) {
    return this.jobs.update(id, dto);
  }

  @Patch('samples/:id') @Perm('jobs.edit') @ApiOkResponse({ type: JobDto })
  updateSample(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSampleDto) {
    return this.jobs.updateSample(id, dto);
  }

  @Post('jobs/:id/deviations') @HttpCode(200) @Perm('jobs.edit', 'jobs.create') @ApiOkResponse({ type: JobDto })
  addDeviation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddDeviationDto) {
    return this.jobs.addDeviation(id, dto);
  }

  @Post('jobs/:id/hold') @HttpCode(200) @Perm('jobs.hold') @ApiOkResponse({ type: JobDto })
  hold(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonOnlyDto) {
    return this.jobs.hold(id, dto.version, dto.reason);
  }

  @Post('jobs/:id/release') @HttpCode(200) @Perm('jobs.hold') @ApiOkResponse({ type: JobDto })
  release(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionOnlyDto) {
    return this.jobs.release(id, dto.version);
  }

  @Get('jobs/:id/timeline') @Perm('jobs.view') @ApiOkResponse({ type: [TimelineEventDto] })
  timeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.timeline(id);
  }

  @Get('jobs/:id/history') @Perm('jobs.view') @ApiOkResponse({ type: [AuditHistoryDto] })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.auditHistory('Job', id);
  }

  @Get('samples/:id/history') @Perm('jobs.view') @ApiOkResponse({ type: [AuditHistoryDto] })
  sampleHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.auditHistory('Sample', id);
  }

  @Post('jobs/:id/acknowledgement') @HttpCode(200) @Perm('jobs.create', 'jobs.edit') @ApiOkResponse({ type: OkDto })
  acknowledge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendAckDto) {
    return this.jobs.sendAcknowledgement(id, dto);
  }

  @Get('jobs/:id/emails') @Perm('jobs.view') @ApiOkResponse({ type: [EmailLogDto] })
  emails(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.emails(id);
  }

  @Post('jobs/:id/letter-pdf') @HttpCode(200) @Perm('jobs.create', 'jobs.edit') @ApiOkResponse({ type: DocumentJobDto })
  combine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CombineLetterDto) {
    return this.jobs.combineLetter(id, dto.fileIds);
  }
}
