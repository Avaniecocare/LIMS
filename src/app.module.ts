import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module.js';
import { AdminController, SavedFiltersController } from './modules/admin/admin.controller.js';
import { AdminService } from './modules/admin/admin.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { PublicController } from './modules/public/public.controller.js';
import { RbacBootstrap } from './modules/rbac/rbac.bootstrap.js';

@Module({
  imports: [CoreModule],
  controllers: [AuthController, AdminController, SavedFiltersController, PublicController, HealthController],
  providers: [AuthService, SessionService, AdminService, RbacBootstrap, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
