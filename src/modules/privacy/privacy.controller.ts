import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm } from '../auth/decorators.js';
import { EmailQuery, BreachDto, CreateBreachDto, CreateDataRequestDto, DataRequestDto, ErasedDto, PersonalDataDto, ResolveDataRequestDto, UpdateBreachDto } from './privacy.dto.js';
import { PrivacyService } from './privacy.service.js';

@ApiTags('privacy')
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('requests') @Perm('privacy.manage') @ApiOkResponse({ type: [DataRequestDto] })
  requests() {
    return this.privacy.requests();
  }

  @Post('requests') @Perm('privacy.manage') @ApiOkResponse({ type: DataRequestDto })
  create(@Body() dto: CreateDataRequestDto) {
    return this.privacy.createRequest(dto);
  }

  @Post('requests/:id/resolve') @HttpCode(200) @Perm('privacy.manage') @ApiOkResponse({ type: DataRequestDto })
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDataRequestDto) {
    return this.privacy.resolveRequest(id, dto);
  }

  /** Erases the person's details from customer contacts (password confirmed first). */
  @Post('requests/:id/erase') @HttpCode(200) @Perm('privacy.manage') @ApiOkResponse({ type: ErasedDto })
  erase(@Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.erase(id);
  }

  @Get('personal-data') @Perm('privacy.manage') @ApiOkResponse({ type: PersonalDataDto })
  personalData(@Query() q: EmailQuery) {
    return this.privacy.personalData(q.email);
  }

  @Get('breaches') @Perm('privacy.manage') @ApiOkResponse({ type: [BreachDto] })
  breaches() {
    return this.privacy.breaches();
  }

  @Post('breaches') @Perm('privacy.manage') @ApiOkResponse({ type: BreachDto })
  createBreach(@Body() dto: CreateBreachDto) {
    return this.privacy.createBreach(dto);
  }

  @Patch('breaches/:id') @Perm('privacy.manage') @ApiOkResponse({ type: BreachDto })
  updateBreach(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBreachDto) {
    return this.privacy.updateBreach(id, dto);
  }
}
