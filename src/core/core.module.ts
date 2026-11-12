import { Global, Module } from '@nestjs/common';
import { INFRA_CONFIG, loadInfraConfig } from '../config/infra.config.js';
import { AuditService } from './audit.service.js';
import { CompanyService } from './company.service.js';
import { EmailTemplateService } from './email-template.service.js';
import { MailService } from './mail.service.js';
import { ModulesService } from './modules.service.js';
import { NumberingService } from './numbering.service.js';
import { PrismaService, ReadPrismaService } from './prisma.service.js';
import { QueueService } from './queue.service.js';
import { RedisService } from './redis.service.js';
import { SettingsService } from './settings.service.js';
import { StorageService } from './storage.service.js';
import { WhatsappService } from './whatsapp.service.js';

const services = [
  PrismaService,
  ReadPrismaService,
  RedisService,
  AuditService,
  SettingsService,
  NumberingService,
  CompanyService,
  StorageService,
  QueueService,
  MailService,
  EmailTemplateService,
  ModulesService,
  WhatsappService,
];

@Global()
@Module({
  providers: [
    { provide: INFRA_CONFIG, useFactory: () => loadInfraConfig() },
    ...services,
  ],
  exports: [INFRA_CONFIG, ...services],
})
export class CoreModule {}
