import { IsIn, IsOptional } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { EmailStatus } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class CheckDto {
  key: string;
  label: string;
  /** OFF: not set up, and not a fault */
  state: 'OK' | 'WARNING' | 'PROBLEM' | 'OFF';
  detail: string;
  /** how long it took to answer */
  ms: number;
}

export class SystemStatusDto {
  checkedAt: Date;
  version: string | null;
  checks: CheckDto[];
}

export class EmailQuery extends PageQuery {
  @IsOptional()
  @IsIn(Object.values(EmailStatus))
  status?: EmailStatus;
}

export class EmailDto {
  id: string;
  toAddress: string;
  ccAddress: string | null;
  subject: string;
  template: string;
  attachments: number;
  entity: string | null;
  entityId: string | null;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  sentBy: string | null;
  createdAt: Date;
  /** failed, and will be tried again by itself */
  retrying: boolean;
  canResend: boolean;
}

export class EmailPageDto {
  data: EmailDto[];
  meta: PageMetaDto;
}

export class DataExportPartDto {
  name: string;
  sizeBytes: number;
  sha256: string;
}

export class DataExportDto {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  parts: DataExportPartDto[];
  tables: number;
  rows: number;
  files: number;
  missingFiles: number;
  error: string | null;
  requestedByName: string;
  createdAt: Date;
  finishedAt: Date | null;
  expiresAt: Date | null;
  removedAt: Date | null;
}

export class DownloadDto {
  url: string;
  expiresInSeconds: number;
}
