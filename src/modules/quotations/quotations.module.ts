import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { MastersModule } from '../masters/masters.module.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsService } from './quotations.service.js';

@Module({ imports: [DocumentsModule, MastersModule], controllers: [QuotationsController], providers: [QuotationsService], exports: [QuotationsService] })
export class QuotationsModule {}
