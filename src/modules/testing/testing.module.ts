import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { TestingController } from './testing.controller.js';
import { TestingService } from './testing.service.js';

@Module({ imports: [DocumentsModule, JobsModule], controllers: [TestingController], providers: [TestingService], exports: [TestingService] })
export class TestingModule {}
