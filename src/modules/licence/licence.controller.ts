import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Background, Perm, SignedIn, WhenReadOnly } from '../auth/decorators.js';
import { ActivateLicenceDto, LicenceDto, LicenceNoticeDto } from './licence.dto.js';
import { LicenceService } from './licence.service.js';

@ApiTags('licence')
@Controller()
export class LicenceController {
  constructor(private readonly licence: LicenceService) {}

  /** For the banner: polled, so it does not count as the person being active. */
  @Get('licence')
  @Background()
  @SignedIn('everyone needs to know when nothing can be saved, and why')
  @ApiOkResponse({ type: LicenceNoticeDto })
  async notice(): Promise<LicenceNoticeDto> {
    const s = await this.licence.status();
    return { state: s.state, readOnly: s.readOnly, kind: s.licence?.kind ?? null, readOnlyFrom: s.readOnlyFrom, daysLeft: s.daysLeft };
  }

  @Get('admin/licence')
  @Perm('admin.settings')
  @ApiOkResponse({ type: LicenceDto })
  async details(): Promise<LicenceDto> {
    const { licence, ...s } = await this.licence.status();
    return { ...s, kind: licence?.kind ?? null, customer: licence?.customer ?? null, licenceId: licence?.id ?? null };
  }

  @Post('admin/licence')
  @HttpCode(200)
  @WhenReadOnly('a new licence is how read-only ends')
  @Perm('admin.settings')
  @ApiOkResponse({ type: LicenceDto })
  async activate(@Body() dto: ActivateLicenceDto): Promise<LicenceDto> {
    await this.licence.activate(dto.licence);
    return this.details();
  }
}
