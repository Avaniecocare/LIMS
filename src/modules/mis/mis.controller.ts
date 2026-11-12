import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm, RequireModule } from '../auth/decorators.js';
import { MisCatalogItemDto, MisQuery, MisResultDto } from './mis.dto.js';
import { MisService } from './mis.service.js';

@ApiTags('reports-module')
@RequireModule('analytics')
@Controller('mis')
export class MisController {
  constructor(private readonly mis: MisService) {}

  @Get() @Perm('mis.view', 'mis.commercial') @ApiOkResponse({ type: [MisCatalogItemDto] })
  catalog() {
    return this.mis.catalog();
  }

  @Get(':key') @Perm('mis.view', 'mis.commercial') @ApiOkResponse({ type: MisResultDto })
  run(@Param('key') key: string, @Query() q: MisQuery) {
    return this.mis.run(key, q);
  }
}
