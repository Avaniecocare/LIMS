import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { MisController } from './mis.controller.js';
import { MisService } from './mis.service.js';

@Module({ imports: [DocumentsModule], controllers: [MisController], providers: [MisService], exports: [MisService] })
export class MisModule {}
