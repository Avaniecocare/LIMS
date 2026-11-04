import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MastersModule } from '../masters/masters.module.js';
import { PlanningController } from './planning.controller.js';
import { PlanningService } from './planning.service.js';

@Module({ imports: [DocumentsModule, JobsModule, MastersModule], controllers: [PlanningController], providers: [PlanningService], exports: [PlanningService] })
export class PlanningModule {}
