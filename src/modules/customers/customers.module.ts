import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({ imports: [DocumentsModule], controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
