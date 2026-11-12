import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { HelpAdminController, HelpController } from './help.controller.js';
import { HelpIndexService } from './help-index.service.js';
import { HelpService } from './help.service.js';

@Module({
  imports: [AuthModule, NotificationsModule, SchedulerModule],
  controllers: [HelpController, HelpAdminController],
  providers: [HelpIndexService, HelpService],
  exports: [HelpService, HelpIndexService],
})
export class HelpModule {}
