import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { MastersModule } from '../masters/masters.module.js';
import { QuotationsModule } from '../quotations/quotations.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({ imports: [DocumentsModule, MastersModule, QuotationsModule], controllers: [JobsController], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
