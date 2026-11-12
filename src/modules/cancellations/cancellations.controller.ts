import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OkDto } from '../auth/auth.dto.js';
import { CancelDto, CancelImpactDto, CancelPreviewDto } from './cancellations.dto.js';
import { Perm } from '../auth/decorators.js';
import { CancellationsService } from './cancellations.service.js';

@ApiTags('cancellations')
@Perm('jobs.cancel', 'planning.edit')
@Controller('cancellations')
export class CancellationsController {
  constructor(private readonly cancellations: CancellationsService) {}

  /** The downstream effect, shown before confirming. */
  @Post('preview') @HttpCode(200) @ApiOkResponse({ type: CancelImpactDto })
  preview(@Body() dto: CancelPreviewDto) {
    return this.cancellations.preview(dto);
  }

  @Post() @HttpCode(200) @ApiOkResponse({ type: OkDto })
  cancel(@Body() dto: CancelDto) {
    return this.cancellations.cancel(dto);
  }
}
