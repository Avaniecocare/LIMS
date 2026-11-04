import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { QuotationStatus } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class QuotationLineInput {
  @IsString() @Length(1, 500) sampleDescription: string;
  @IsOptional() @IsString() @MaxLength(120) requiredQuantity?: string | null;
  @IsUUID() testId: string;
  @IsInt() @Min(1) @Max(10000) quantity: number;
  /** Leave empty to use the looked-up rate. A different rate needs permission and a reason. */
  @IsOptional() @IsNumberString() rate?: string | null;
  @IsOptional() @IsString() @MaxLength(500) overrideReason?: string | null;
  @IsOptional() @IsNumberString() discountPct?: string | null;
}

export class SaveQuotationDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsUUID() orderId?: string | null;
  @IsOptional() @IsIn(['Quotation', 'Proforma Invoice']) documentTitle?: string;
  @IsOptional() @IsDateString() validUntil?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3650) estimatedDays?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) paymentTerms?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) deliveryAddress?: string | null;
  @IsOptional() @IsString() @MaxLength(200) contactPerson?: string | null;
  @IsOptional() @IsNumberString() discountPct?: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => QuotationLineInput) lines: QuotationLineInput[];
}

export class UpdateQuotationDto extends SaveQuotationDto {
  @IsInt() @Min(1) version: number;
}

export class QuotationQuery extends PageQuery {
  @IsOptional() @IsEnum(QuotationStatus) status?: QuotationStatus;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class SendQuotationDto {
  @IsInt() @Min(1) version: number;
  @IsEmail() to: string;
  @IsOptional() @IsEmail() cc?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) message?: string | null;
}

export class VersionedActionDto {
  @IsInt() @Min(1) version: number;
}

export class ReasonDto {
  @IsInt() @Min(1) version: number;
  @IsString() @Length(1, 1000) reason: string;
}

export class QuotationLineDto {
  id: string; seq: number; sampleDescription: string; requiredQuantity: string | null; testId: string; testCode: string; testName: string; methodName: string | null; quantity: number;
  rate: string; rateSource: string; overrideReason: string | null; discountPct: string; amount: string;
}
export class QuotationVersionDto {
  id: string; versionNo: number; documentTitle: string; validUntil: Date; estimatedDays: number | null; paymentTerms: string | null; deliveryAddress: string | null; contactPerson: string | null;
  revisionNote: string | null; discountPct: string; subtotal: string; discountAmount: string; taxableAmount: string; gstRate: string; cgst: string; sgst: string; igst: string; roundOff: string; grandTotal: string;
  amountInWords: string; createdAt: Date; lines: QuotationLineDto[];
}
export class QuotationSummaryDto {
  id: string; quotationNo: string; customerId: string; customerName: string; crn: string; orderId: string | null; status: QuotationStatus; currentVersionNo: number; validUntil: Date; grandTotal: string;
  rejectReason: string | null; sentAt: Date | null; acceptedAt: Date | null; createdAt: Date; version: number; jobId: string | null;
}
export class QuotationDto extends QuotationSummaryDto {
  versions: QuotationVersionDto[];
}
export class QuotationPageDto { data: QuotationSummaryDto[]; meta: PageMetaDto; }

export class EmailLogDto {
  id: string; toAddress: string; ccAddress: string | null; subject: string; template: string; status: string; attempts: number; lastError: string | null; sentAt: Date | null; createdAt: Date;
}
export class StatusEventDto {
  id: string; entity: string; entityId: string; fromStatus: string | null; toStatus: string; reason: string | null; byName: string | null; at: Date;
}
export class ConvertedDto {
  jobId: string;
  jobNo: string;
}

/** What Reception sees to book from a quotation: no rates or totals. */
export class ConvertibleQuotationDto {
  id: string; quotationNo: string; customerId: string; customerName: string; acceptedAt: Date | null; samples: string[]; testCount: number;
}
