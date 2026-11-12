import { Module } from '@nestjs/common';
import { MastersModule } from '../masters/masters.module.js';
import { LabController } from './lab.controller.js';
import { TemplatesService } from './templates.service.js';

@Module({ imports: [MastersModule], controllers: [LabController], providers: [TemplatesService] })
export class LabModule {}
