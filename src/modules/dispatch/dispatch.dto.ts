import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class CreateDispatchDto {
  @IsUUID() jobId: string;
  @IsDateString() dispatchDate: string;
  @IsUUID() modeId: string;
  @IsOptional() @IsString() @MaxLength(120) courierName?: string | null;
  @IsOptional() @IsString() @MaxLength(120) carrierName?: string | null;
  @IsOptional() @IsString() @MaxLength(120) docketNo?: string | null;
  @IsOptional() @IsString() @MaxLength(60) carrierContact?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) remarks?: string | null;
  /** issued reports going out */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) reportIds?: string[];
  /** returnable samples going back */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) sampleIds?: string[];
}

export class DispatchQuery extends PageQuery {
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ReturnableQuery extends PageQuery {
  /** pending | returned | disposed | due-for-disposal */
  @IsOptional() @IsIn(['pending', 'returned', 'disposed', 'due-for-disposal']) view?: string;
}

export class SampleReturnDto {
  @IsInt() @Min(1) version: number;
  @IsDateString() returnedAt: string;
  @IsString() @Length(1, 120) returnStatus: string;
}

export class SampleDisposeDto {
  @IsInt() @Min(1) version: number;
  @IsDateString() disposedAt: string;
}

export class DispatchItemDto {
  kind: string;
  id: string;
  reference: string;
  description: string;
}
export class DispatchDto {
  id: string;
  dispatchNo: string;
  jobId: string;
  jobNo: string;
  customerName: string | null;
  dispatchDate: Date;
  modeId: string;
  modeLabel: string;
  courierName: string | null;
  carrierName: string | null;
  docketNo: string | null;
  carrierContact: string | null;
  remarks: string | null;
  items: DispatchItemDto[];
  createdAt: Date;
}
export class DispatchPageDto {
  data: DispatchDto[];
  meta: PageMetaDto;
}
export class DispatchableJobDto {
  jobId: string;
  jobNo: string;
  customerName: string | null;
  reports: { reportId: string; reportNo: string; revisionNo: number; withheld: boolean }[];
  returnableSamples: { sampleId: string; sampleNo: string; description: string }[];
}
export class DispatchablePageDto {
  data: DispatchableJobDto[];
  meta: PageMetaDto;
}
export class ReturnableRowDto {
  id: string;
  sampleNo: string;
  description: string;
  jobId: string;
  jobNo: string;
  customerName: string | null;
  returnable: boolean;
  returnStatus: string | null;
  returnedAt: Date | null;
  retentionUntil: Date | null;
  disposedAt: Date | null;
  status: string;
  version: number;
  dueForDisposal: boolean;
}
export class ReturnablePageDto {
  data: ReturnableRowDto[];
  meta: PageMetaDto;
}
