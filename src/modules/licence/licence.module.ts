import { Global, Module } from '@nestjs/common';
import { LicenceController } from './licence.controller.js';
import { LicenceService } from './licence.service.js';

/** Global: the guard checks it on every request that would save something. */
@Global()
@Module({ controllers: [LicenceController], providers: [LicenceService], exports: [LicenceService] })
export class LicenceModule {}
