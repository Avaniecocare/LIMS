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
import { MastersModule } from './modules/masters/masters.module.js';
import { PublicController } from './modules/public/public.controller.js';
import { RbacBootstrap } from './modules/rbac/rbac.bootstrap.js';

/** Business modules. The worker imports these too, so document handlers register in both processes. */
export const DOMAIN_MODULES = [DocumentsModule, FilesModule, MastersModule, CustomersModule];

@Module({
  imports: [CoreModule, ...DOMAIN_MODULES],
  controllers: [AuthController, AdminController, SavedFiltersController, PublicController, HealthController],
  providers: [AuthService, SessionService, AdminService, RbacBootstrap, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
