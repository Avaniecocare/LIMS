import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardDto, DashboardQuery } from './dashboard.dto.js';
import { SignedIn } from '../auth/decorators.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard')
@SignedIn('each widget appears only with its permission')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Sections follow the caller's permissions; every user at least gets "My work". */
  @Get() @ApiOkResponse({ type: DashboardDto })
  get(@Query() q: DashboardQuery) {
    return this.dashboard.build(q);
  }
}
