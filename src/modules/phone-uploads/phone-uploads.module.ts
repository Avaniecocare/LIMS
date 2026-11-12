import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { PhoneUploadsController } from './phone-uploads.controller.js';
import { PhoneUploadsService } from './phone-uploads.service.js';

@Module({ imports: [FilesModule], controllers: [PhoneUploadsController], providers: [PhoneUploadsService] })
export class PhoneUploadsModule {}
