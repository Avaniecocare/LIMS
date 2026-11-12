import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { notFound } from '../../common/errors.js';
import { Public } from '../auth/decorators.js';
import { ReportVerificationDto } from './reports.dto.js';
import { ReportsService } from './reports.service.js';

const CODE = /^[A-Za-z0-9_-]{16,64}$/;

/** Opened from the QR code on a report, on any device, without signing in. */
@ApiTags('public')
@Public()
@Controller('public/reports')
export class ReportVerificationController {
  constructor(private readonly reports: ReportsService) {}

  @Get('verify/:code') @ApiOkResponse({ type: ReportVerificationDto })
  verify(@Param('code') code: string): Promise<ReportVerificationDto> {
    if (!CODE.test(code)) throw notFound('Report');
    return this.reports.verify(code);
  }
}
