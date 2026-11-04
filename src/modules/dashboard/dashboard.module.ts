import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { MisModule } from '../mis/mis.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({ imports: [InvoicesModule, MisModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
