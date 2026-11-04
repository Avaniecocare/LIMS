import { Global, Module } from '@nestjs/common';
import { COMPANY_CONFIG, loadCompanyConfig } from '../config/company.config.js';
import { INFRA_CONFIG, loadInfraConfig } from '../config/infra.config.js';
import { AuditService } from './audit.service.js';
import { CompanyService } from './company.service.js';
import { MailService } from './mail.service.js';
import { NumberingService } from './numbering.service.js';
import { PrismaService, ReadPrismaService } from './prisma.service.js';
import { QueueService } from './queue.service.js';
import { RedisService } from './redis.service.js';
import { SettingsService } from './settings.service.js';
import { StorageService } from './storage.service.js';

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
];

@Global()
@Module({
  providers: [
    { provide: COMPANY_CONFIG, useFactory: () => loadCompanyConfig() },
    { provide: INFRA_CONFIG, useFactory: () => loadInfraConfig() },
    ...services,
  ],
  exports: [COMPANY_CONFIG, INFRA_CONFIG, ...services],
})
export class CoreModule {}
