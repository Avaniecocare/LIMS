import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { AuditExport } from './audit-export.js';
import { DataExportService } from './data-export.service.js';
import { OperationsController } from './operations.controller.js';
import { OutboxService } from './outbox.service.js';
import { StatusService } from './status.service.js';

/** Looking after a running installation: how it is, what was emailed, and getting the data out. */
@Module({
  imports: [DocumentsModule, NotificationsModule, SchedulerModule],
  controllers: [OperationsController],
  providers: [StatusService, OutboxService, DataExportService, AuditExport],
  exports: [OutboxService, DataExportService],
})
export class OperationsModule {}
