import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { OkDto } from '../auth/auth.dto.js';
import { Public, SignedIn, RequireModule } from '../auth/decorators.js';
import { readUpload } from '../files/files.controller.js';
import { ClaimedDto, ClaimPhoneUploadsDto, CreatePhoneUploadDto, PhoneUploadLinkDto, PhoneUploadPublicDto, PhoneUploadReceivedDto, PhoneUploadStatusDto } from './phone-uploads.dto.js';
import { PhoneUploadsService } from './phone-uploads.service.js';

@ApiTags('files')
@RequireModule('phoneUpload')
@Controller()
export class PhoneUploadsController {
  constructor(private readonly links: PhoneUploadsService) {}

  @Post('phone-uploads')
  @SignedIn('needs write access to the sample or report, checked in the service')
  @ApiOkResponse({ type: PhoneUploadLinkDto })
  create(@Body() dto: CreatePhoneUploadDto) {
    return this.links.create(dto);
  }

  @Post('phone-uploads/claim')
  @SignedIn('only the person who collected the photos, onto a sample they may attach to')
  @ApiOkResponse({ type: ClaimedDto })
  claim(@Body() dto: ClaimPhoneUploadsDto) {
    return this.links.claim(dto);
  }

  @Get('phone-uploads/:id')
  @SignedIn('the maker of the link only')
  @ApiOkResponse({ type: PhoneUploadStatusDto })
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.status(id);
  }

  @Delete('phone-uploads/:id')
  @SignedIn('the maker of the link only')
  @ApiOkResponse({ type: OkDto })
  end(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.end(id);
  }

  /** The phone's page: no sign-in, the token in the link is the permission. */
  @Public()
  @Get('public/phone-uploads/:token')
  @ApiOkResponse({ type: PhoneUploadPublicDto })
  describe(@Param('token') token: string) {
    return this.links.describe(token);
  }

  @Public()
  @Post('public/phone-uploads/:token/files')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOkResponse({ type: PhoneUploadReceivedDto })
  async receive(@Param('token') token: string, @Req() req: FastifyRequest) {
    // The link is checked before the photo is read, so an expired link can't be used to push data.
    await this.links.describe(token);
    return this.links.receive(token, await readUpload(req));
  }
}
