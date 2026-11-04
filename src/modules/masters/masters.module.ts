import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { MASTER_CONTROLLERS, MasterToolsController } from './masters.controller.js';
import { MastersService } from './masters.service.js';

@Module({
  imports: [DocumentsModule],
  // Tools first, so static paths are registered before the /:id routes.
  controllers: [MasterToolsController, ...MASTER_CONTROLLERS],
  providers: [MastersService],
  exports: [MastersService],
})
export class MastersModule {}
