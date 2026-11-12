import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { EInvoiceModule } from '../einvoice/einvoice.module.js';
import { MastersModule } from '../masters/masters.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

@Module({ imports: [DocumentsModule, MastersModule, EInvoiceModule], controllers: [InvoicesController], providers: [InvoicesService], exports: [InvoicesService] })
export class InvoicesModule {}
