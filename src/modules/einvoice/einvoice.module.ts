import { Module } from '@nestjs/common';
import { EInvoiceAdminController } from './einvoice.controller.js';
import { EInvoiceService } from './einvoice.service.js';

@Module({ controllers: [EInvoiceAdminController], providers: [EInvoiceService], exports: [EInvoiceService] })
export class EInvoiceModule {}
