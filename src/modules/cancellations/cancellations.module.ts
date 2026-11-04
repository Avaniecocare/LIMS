import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { CancellationsController } from './cancellations.controller.js';
import { CancellationsService } from './cancellations.service.js';

@Module({ imports: [InvoicesModule, JobsModule], controllers: [CancellationsController], providers: [CancellationsService] })
export class CancellationsModule {}
