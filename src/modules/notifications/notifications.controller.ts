import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { OkDto } from '../auth/auth.dto.js';
import { NotificationPageDto, NotificationQuery, PreferenceDto, UpdatePreferencesDto } from './notifications.dto.js';
import { SignedIn } from '../auth/decorators.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@SignedIn('every query is scoped to the caller’s own notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOkResponse({ type: NotificationPageDto })
  list(@Query() q: NotificationQuery) {
    return this.notifications.list(q);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  async readAll() {
    await this.notifications.markAllRead();
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  async read(@Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(id);
    return { ok: true };
  }

  @Get('preferences')
  @ApiOkResponse({ type: [PreferenceDto] })
  preferences() {
    return this.notifications.preferences();
  }

  @Put('preferences')
  @ApiOkResponse({ type: [PreferenceDto] })
  update(@Body() dto: UpdatePreferencesDto) {
    return this.notifications.updatePreferences(dto.preferences);
  }
}
