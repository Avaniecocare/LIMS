import { Module } from '@nestjs/common';
import { PlanningModule } from '../planning/planning.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { TestingModule } from '../testing/testing.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({ imports: [PlanningModule, ReportsModule, TestingModule], controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
