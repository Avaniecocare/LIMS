import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { TestingModule } from '../testing/testing.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({ imports: [AuthModule, DocumentsModule, JobsModule, TestingModule], controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
