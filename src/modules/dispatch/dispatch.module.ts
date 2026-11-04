import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchService } from './dispatch.service.js';

@Module({ imports: [DocumentsModule], controllers: [DispatchController], providers: [DispatchService], exports: [DispatchService] })
export class DispatchModule {}
