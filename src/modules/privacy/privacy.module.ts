import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

@Module({ imports: [NotificationsModule], controllers: [PrivacyController], providers: [PrivacyService] })
export class PrivacyModule {}
