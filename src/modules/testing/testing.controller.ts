import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm } from '../auth/decorators.js';
import { AuditHistoryDto } from '../jobs/jobs.dto.js';
import { ApprovalPageDto, ApprovalQuery, BulkApproveDto, BulkApproveResultDto, SaveResultsDto, TestDetailDto, TestReasonDto, VersionDto, WorklistPageDto, WorklistQuery } from './testing.dto.js';
import { TestingService } from './testing.service.js';

@ApiTags('tests')
@Controller('tests')
export class TestingController {
  constructor(private readonly testing: TestingService) {}

  /** Assigned tests only */
  @Get('my')
  @Perm('tests.work')
  @ApiOkResponse({ type: WorklistPageDto })
  worklist(@Query() q: WorklistQuery) {
    return this.testing.worklist(q);
  }

  @Get('approvals')
  @Perm('tests.approve')
  @ApiOkResponse({ type: ApprovalPageDto })
  approvals(@Query() q: ApprovalQuery) {
    return this.testing.approvalQueue(q);
  }

  @Post('approvals/bulk')
  @HttpCode(200)
  @Perm('tests.approve')
  @ApiOkResponse({ type: BulkApproveResultDto })
  bulk(@Body() dto: BulkApproveDto) {
    return this.testing.bulkApprove(dto.items);
  }

  @Get(':id')
  @Perm('tests.work', 'tests.viewAll')
  @ApiOkResponse({ type: TestDetailDto })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.testing.detail(id);
  }

  @Get(':id/history')
  @Perm('tests.work', 'tests.viewAll')
  @ApiOkResponse({ type: [AuditHistoryDto] })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.testing.history(id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @Perm('tests.work')
  @ApiOkResponse({ type: TestDetailDto })
  start(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    return this.testing.start(id, dto.version);
  }

  @Post(':id/stages/:seq/complete')
  @HttpCode(200)
  @Perm('tests.work')
  @ApiOkResponse({ type: TestDetailDto })
  stage(@Param('id', ParseUUIDPipe) id: string, @Param('seq', ParseIntPipe) seq: number, @Body() dto: VersionDto) {
    return this.testing.completeStage(id, seq, dto.version);
  }

  /** Saves values, including autosaved drafts, and returns the server's calculations and pass/fail. */
  @Put(':id/results')
  @Perm('tests.work')
  @ApiOkResponse({ type: TestDetailDto })
  save(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveResultsDto) {
    return this.testing.saveResults(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Perm('tests.work')
  @ApiOkResponse({ type: TestDetailDto })
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    return this.testing.submit(id, dto.version);
  }

  @Post(':id/hold')
  @HttpCode(200)
  @Perm('tests.work', 'tests.hold')
  @ApiOkResponse({ type: TestDetailDto })
  hold(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TestReasonDto) {
    return this.testing.hold(id, dto.version, dto.reason);
  }

  @Post(':id/release')
  @HttpCode(200)
  @Perm('tests.work', 'tests.hold')
  @ApiOkResponse({ type: TestDetailDto })
  release(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    return this.testing.release(id, dto.version);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Perm('tests.approve')
  @ApiOkResponse({ type: TestDetailDto })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    return this.testing.approve(id, dto.version);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Perm('tests.approve')
  @ApiOkResponse({ type: TestDetailDto })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TestReasonDto) {
    return this.testing.reject(id, dto.version, dto.reason);
  }
}
