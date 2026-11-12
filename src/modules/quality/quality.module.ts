import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { QualityController } from './quality.controller.js';
import { QualityService } from './quality.service.js';

@Module({ imports: [NotificationsModule], controllers: [QualityController], providers: [QualityService], exports: [QualityService] })
export class QualityModule {}
