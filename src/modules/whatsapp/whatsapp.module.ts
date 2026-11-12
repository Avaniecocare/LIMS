import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { EInvoiceModule } from '../einvoice/einvoice.module.js';
import { WhatsappAdminController, WhatsappController } from './whatsapp.controller.js';
import { WhatsappSendService } from './whatsapp-send.service.js';
import { WhatsappWebhookController } from './whatsapp-webhook.controller.js';

@Module({ imports: [DocumentsModule, EInvoiceModule], controllers: [WhatsappController, WhatsappAdminController, WhatsappWebhookController], providers: [WhatsappSendService] })
export class WhatsappModule {}
