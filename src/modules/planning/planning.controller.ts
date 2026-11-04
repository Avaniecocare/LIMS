import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OkDto } from '../auth/auth.dto.js';
import { Perm } from '../auth/decorators.js';
import { AssignDto, InstrumentOptionDto, PlanningPageDto, PlanningQuery, PlanResultDto, PlanSamplesDto, SuggestedTestDto, SuggestQuery, TechnicianDto, WorkloadDto } from './planning.dto.js';
import { PlanningService } from './planning.service.js';

@ApiTags('planning')
@Controller('planning')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get('tests') @Perm('planning.view') @ApiOkResponse({ type: PlanningPageDto })
  list(@Query() q: PlanningQuery) {
    return this.planning.list(q);
  }

  @Get('suggest') @Perm('planning.view') @ApiOkResponse({ type: [SuggestedTestDto] })
  suggest(@Query() q: SuggestQuery) {
    return this.planning.suggest(q);
  }

  @Post('plans') @Perm('planning.edit') @ApiOkResponse({ type: PlanResultDto })
  plan(@Body() dto: PlanSamplesDto) {
    return this.planning.plan(dto);
  }

  @Post('assign') @HttpCode(200) @Perm('planning.edit') @ApiOkResponse({ type: OkDto })
  assign(@Body() dto: AssignDto) {
    return this.planning.assign(dto);
  }

  @Get('workload') @Perm('planning.view') @ApiOkResponse({ type: WorkloadDto })
  workload() {
    return this.planning.workload();
  }

  @Get('technicians') @Perm('planning.view') @ApiOkResponse({ type: [TechnicianDto] })
  technicians() {
    return this.planning.technicians();
  }

  @Get('instruments') @Perm('planning.view') @ApiOkResponse({ type: [InstrumentOptionDto] })
  instruments() {
    return this.planning.instruments();
  }
}
