import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Perm, SignedIn } from '../auth/decorators.js';
import { AccessRequestDto, AccessRequestPageDto, AccessRequestQuery, AccessReviewDto, ApproveAccessDto, CreateAccessRequestDto, DenyAccessDto } from './security.dto.js';
import { SecurityService } from './security.service.js';

@ApiTags('security')
@Controller('access-requests')
export class AccessRequestsController {
  constructor(private readonly security: SecurityService) {}

  @Post() @SignedIn('anyone can ask for access; admins decide') @ApiOkResponse({ type: AccessRequestDto })
  request(@Body() dto: CreateAccessRequestDto) {
    return this.security.request(dto);
  }

  @Get('mine') @SignedIn('the caller’s own requests') @ApiOkResponse({ type: [AccessRequestDto] })
  mine() {
    return this.security.mine();
  }

  @Get() @Perm('admin.users') @ApiOkResponse({ type: AccessRequestPageDto })
  list(@Query() q: AccessRequestQuery) {
    return this.security.list(q);
  }

  @Post(':id/approve') @Perm('admin.users') @ApiOkResponse({ type: AccessRequestDto })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveAccessDto) {
    return this.security.approve(id, dto);
  }

  @Post(':id/deny') @Perm('admin.users') @ApiOkResponse({ type: AccessRequestDto })
  deny(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DenyAccessDto) {
    return this.security.deny(id, dto.note);
  }
}

@ApiTags('security')
@Controller('admin/access-review')
export class AccessReviewController {
  constructor(private readonly security: SecurityService) {}

  @Get() @Perm('admin.users') @ApiOkResponse({ type: AccessReviewDto })
  review() {
    return this.security.review();
  }
}
