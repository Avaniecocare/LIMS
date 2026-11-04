import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { JobStatus, SampleStatus } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class AttributeInput {
  @IsString() @Length(1, 120) label: string;
  @IsString() @Length(1, 500) value: string;
}

export class SampleInput {
  @IsString() @Length(1, 500) description: string;
  @IsOptional() @IsString() @MaxLength(200) condition?: string | null;
  @IsOptional() @IsString() @MaxLength(120) quantity?: string | null;
  @IsOptional() @IsString() @MaxLength(120) size?: string | null;
  @IsOptional() @IsBoolean() returnable?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AttributeInput) attributes?: AttributeInput[];
  /** Tests requested by the customer; planned later */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) testIds?: string[];
}

export class DeviationInput {
  @IsUUID() typeId: string;
  /** index into samples; empty means it applies to the whole job */
  @IsOptional() @IsInt() @Min(0) sampleIndex?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) remark?: string | null;
}

class JobHeader {
  @IsOptional() @IsString() @MaxLength(200) letterRef?: string | null;
  @IsOptional() @IsDateString() letterDate?: string | null;
  @IsOptional() @IsString() @MaxLength(500) materialSpec?: string | null;
  @IsOptional() @IsString() @MaxLength(120) poNumber?: string | null;
  @IsOptional() @IsDateString() poDate?: string | null;
  @IsOptional() @IsUUID() receiptModeId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) reportIssueDetails?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) reportIssueAddress?: string | null;
  @IsOptional() @IsString() @MaxLength(200) kindAttention?: string | null;
  @IsOptional() @IsEmail() contactEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string | null;
  @IsOptional() @IsBoolean() urgent?: boolean;
  /** when true the report omits the "sample not drawn by our laboratory" statement */
  @IsOptional() @IsBoolean() sampleDrawnByLab?: boolean;
}

export class CreateJobDto extends JobHeader {
  @IsUUID() customerId: string;
  /** Required when there is no quotation; needs extra permission */
  @IsOptional() @IsString() @MaxLength(500) noQuotationReason?: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SampleInput) samples: SampleInput[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DeviationInput) deviations?: DeviationInput[];
}

export class UpdateJobDto extends JobHeader {
  @IsInt() @Min(1) version: number;
}

export class UpdateSampleDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsString() @Length(1, 500) description?: string;
  @IsOptional() @IsString() @MaxLength(200) condition?: string | null;
  @IsOptional() @IsString() @MaxLength(120) quantity?: string | null;
  @IsOptional() @IsString() @MaxLength(120) size?: string | null;
  @IsOptional() @IsBoolean() returnable?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AttributeInput) attributes?: AttributeInput[];
}

export class AddDeviationDto {
  @IsUUID() typeId: string;
  @IsOptional() @IsUUID() sampleId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) remark?: string | null;
}

export class JobQuery extends PageQuery {
  @IsOptional() @IsEnum(JobStatus) status?: JobStatus;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() @MaxLength(5) urgent?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class SampleQuery extends PageQuery {
  @IsOptional() @IsEnum(SampleStatus) status?: SampleStatus;
  @IsOptional() @IsString() @MaxLength(5) returnable?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ReasonOnlyDto {
  @IsInt() @Min(1) version: number;
  @IsString() @Length(1, 1000) reason: string;
}

export class VersionOnlyDto {
  @IsInt() @Min(1) version: number;
}

export class CombineLetterDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @IsUUID(undefined, { each: true }) fileIds: string[];
}

export class SendAckDto {
  @IsEmail() to: string;
  @IsOptional() @IsEmail() cc?: string | null;
}

export class DeviationDto {
  id: string; sampleId: string | null; typeId: string; typeLabel: string; remark: string | null; createdAt: Date;
}
export class SampleTestBriefDto {
  id: string; testId: string; testCode: string; testName: string; status: string; dueDate: Date | null; assignedToName: string | null;
}
export class SampleDto {
  id: string; sampleNo: string; jobId: string; description: string; condition: string | null; quantity: string | null; size: string | null; returnable: boolean; status: SampleStatus; cancelReason: string | null;
  retentionUntil: Date | null; returnStatus: string | null; returnedAt: Date | null; disposedAt: Date | null; specificationId: string | null; dualSpecificationId: string | null; version: number;
  attributes: { id: string; label: string; value: string }[]; tests: SampleTestBriefDto[];
}
export class JobSummaryDto {
  id: string; jobNo: string; customerId: string | null; customerName: string | null; crn: string | null; status: JobStatus; urgent: boolean; receivedAt: Date; sampleCount: number; quotationId: string | null; holdReason: string | null; cancelReason: string | null; version: number;
}
export class JobDto extends JobSummaryDto {
  noQuotationReason: string | null; letterRef: string | null; letterDate: Date | null; materialSpec: string | null; poNumber: string | null; poDate: Date | null; receiptModeId: string | null; reportIssueDetails: string | null; reportIssueAddress: string | null;
  kindAttention: string | null; contactEmail: string | null; contactPhone: string | null; sampleDrawnByLab: boolean; statusBeforeHold: JobStatus | null; samples: SampleDto[]; deviations: DeviationDto[];
}
export class JobPageDto { data: JobSummaryDto[]; meta: PageMetaDto; }
export class SampleListItemDto {
  id: string; sampleNo: string; jobId: string; jobNo: string; description: string; status: SampleStatus; returnable: boolean; urgent: boolean; receivedAt: Date; customerName: string | null;
}
export class SamplePageDto { data: SampleListItemDto[]; meta: PageMetaDto; }
export class TimelineEventDto {
  id: string; entity: string; entityId: string; label: string | null; fromStatus: string | null; toStatus: string; reason: string | null; byName: string | null; at: Date;
}
export class AuditHistoryDto {
  id: string; at: Date; userName: string | null; action: string; before: unknown; after: unknown; reason: string | null;
}
export class SearchResultDto {
  type: string; id: string; title: string; subtitle: string | null; link: string;
}
export class ScanResultDto {
  /** where the app should go after a barcode or QR scan; null if nothing matched */
  link: string | null;
}
