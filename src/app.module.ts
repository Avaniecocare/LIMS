import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { MisModule } from './modules/mis/mis.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { CancellationsModule } from './modules/cancellations/cancellations.module.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { AdminController, SavedFiltersController } from './modules/admin/admin.controller.js';
import { AdminService } from './modules/admin/admin.service.js';
import { AccessRequestsController, AccessReviewController } from './modules/security/security.controller.js';
import { SecurityService } from './modules/security/security.service.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { LibraryModule } from './modules/library/library.module.js';
import { LabModule } from './modules/lab/lab.module.js';
import { LookupModule } from './modules/lookup/lookup.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { QualityModule } from './modules/quality/quality.module.js';
import { PhoneUploadsModule } from './modules/phone-uploads/phone-uploads.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { MastersModule } from './modules/masters/masters.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PdfModule } from './modules/pdf/pdf.module.js';
import { PublicController } from './modules/public/public.controller.js';
import { PlanningModule } from './modules/planning/planning.module.js';
import { QuotationsModule } from './modules/quotations/quotations.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RbacBootstrap } from './modules/rbac/rbac.bootstrap.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { TestingModule } from './modules/testing/testing.module.js';

/** Business modules. The worker imports these too, so document handlers register in both processes. */
import { WhatsappModule } from './modules/whatsapp/whatsapp.module.js';

export const DOMAIN_MODULES = [PdfModule, SchedulerModule, DocumentsModule, FilesModule, LabModule, LibraryModule, LookupModule, PrivacyModule, QualityModule, PhoneUploadsModule, MastersModule, CustomersModule, OrdersModule, QuotationsModule, JobsModule, PlanningModule, SearchModule, TestingModule, ReportsModule, InvoicesModule, DispatchModule, CancellationsModule, MisModule, DashboardModule, NotificationsModule, WhatsappModule];

@Module({
  imports: [CoreModule, AuthModule, ...DOMAIN_MODULES],
  controllers: [AdminController, SavedFiltersController, AccessRequestsController, AccessReviewController, PublicController, HealthController],
  // Admin and security share this module: SecurityService needs AdminService and NotificationsService.
  providers: [AdminService, SecurityService, RbacBootstrap, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
