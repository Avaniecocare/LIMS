import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module.js';
import { AdminController, SavedFiltersController } from './modules/admin/admin.controller.js';
import { AdminService } from './modules/admin/admin.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { MastersModule } from './modules/masters/masters.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PdfModule } from './modules/pdf/pdf.module.js';
import { PublicController } from './modules/public/public.controller.js';
import { PlanningModule } from './modules/planning/planning.module.js';
import { QuotationsModule } from './modules/quotations/quotations.module.js';
import { RbacBootstrap } from './modules/rbac/rbac.bootstrap.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { SearchModule } from './modules/search/search.module.js';

/** Business modules. The worker imports these too, so document handlers register in both processes. */
export const DOMAIN_MODULES = [PdfModule, SchedulerModule, DocumentsModule, FilesModule, MastersModule, CustomersModule, OrdersModule, QuotationsModule, JobsModule, PlanningModule, SearchModule];

@Module({
  imports: [CoreModule, ...DOMAIN_MODULES],
  controllers: [AuthController, AdminController, SavedFiltersController, PublicController, HealthController],
  providers: [AuthService, SessionService, AdminService, RbacBootstrap, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
