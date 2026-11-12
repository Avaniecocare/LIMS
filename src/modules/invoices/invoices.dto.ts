import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { InvoiceStatus, PaymentMode } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class InvoiceQuery extends PageQuery {
  @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class DueQuery extends PageQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['Not Due', '0-30', '31-60', '61-90', '90+']) bucket?: string;
  @IsOptional() @IsIn(['true', 'false']) overdue?: string;
}

export class CreateInvoiceDto {
  @IsUUID() customerId: string;
  /** one job, or several for one customer */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) jobIds: string[];
  @IsOptional() @IsNumberString() discountPct?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class LineRateInput {
  @IsUUID() lineId: string;
  @IsNumberString() rate: string;
  @IsString() @Length(1, 500) reason: string;
}

export class UpdateDraftInvoiceDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsNumberString() discountPct?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  /** Changing a fetched rate needs a reason */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LineRateInput) lineRates?: LineRateInput[];
}

export class IssueInvoiceDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsOptional() @IsEmail() emailTo?: string | null;
  @IsOptional() @IsEmail() emailCc?: string | null;
}

export class CancelInvoiceDto {
  @IsInt() @Min(1) version: number;
  @IsString() @Length(1, 1000) reason: string;
  /** When the invoice has an IRN: the IRP's reason code (1 duplicate, 2 data entry mistake, 3 order cancelled, 4 other). */
  @IsOptional() @IsIn(['1', '2', '3', '4']) irnCancelReason?: '1' | '2' | '3' | '4';
}

export class EmailInvoiceDto {
  @IsEmail() to: string;
  @IsOptional() @IsEmail() cc?: string | null;
}

export class RemindDto {
  /** defaults to the customer's contact email */
  @IsOptional() @IsEmail() to?: string | null;
}

export class CreateCreditNoteDto {
  @IsNumberString() taxableAmount: string;
  @IsString() @Length(1, 1000) reason: string;
  @IsOptional() @IsDateString() issuedOn?: string;
}

export class AllocationInput {
  @IsUUID() invoiceId: string;
  @IsNumberString() amount: string;
}

export class CreatePaymentDto {
  @IsUUID() customerId: string;
  @IsDateString() paidOn: string;
  @IsEnum(PaymentMode) mode: PaymentMode;
  @IsOptional() @IsString() @MaxLength(200) reference?: string | null;
  @IsNumberString() amount: string;
  /** Anything not allocated stays on account as an advance */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AllocationInput) allocations?: AllocationInput[];
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class ApplyAdvanceDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AllocationInput) allocations: AllocationInput[];
}

export class ReversePaymentDto {
  @IsString() @Length(1, 1000) reason: string;
}

export class PaymentQuery extends PageQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(['true']) unapplied?: string;
}

export class InvoiceLineDto {
  id: string;
  seq: number;
  jobId: string | null;
  sampleTestId: string | null;
  description: string;
  sacCode: string;
  quantity: number;
  rate: string;
  rateSource: string | null;
  amount: string;
}
export class InvoiceSummaryDto {
  id: string;
  invoiceNo: string | null;
  customerId: string;
  customerName: string;
  crn: string;
  status: InvoiceStatus;
  invoiceDate: Date | null;
  dueDate: Date | null;
  grandTotal: string;
  paidAmount: string;
  creditedAmount: string;
  balance: string;
  overdue: boolean;
  daysOverdue: number;
  ageingBucket: string | null;
  isInterState: boolean;
  version: number;
}
export class AllocationDto {
  id: string;
  paymentId: string;
  paymentNo: string;
  paidOn: Date;
  mode: PaymentMode;
  reference: string | null;
  amount: string;
}
/** The document's registration at the GST Invoice Registration Portal. */
export class EInvoiceDto {
  @ApiProperty({ enum: ['PENDING', 'GENERATED', 'FAILED', 'CANCELLED'] }) status: 'PENDING' | 'GENERATED' | 'FAILED' | 'CANCELLED';
  provider: string;
  environment: string;
  /** a test IRN (mock provider or sandbox): not valid for GST */
  test: boolean;
  irn: string | null;
  ackNo: string | null;
  ackDate: Date | null;
  lastError: string | null;
  attempts: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** until when the IRN can still be cancelled at the IRP; null once it cannot */
  cancellableUntil: Date | null;
  /** the signed QR code as a PNG data URI */
  qrDataUri: string | null;
}
export class CreditNoteDto {
  id: string;
  creditNoteNo: string;
  issuedOn: Date;
  reason: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  total: string;
  amountInWords: string;
  einvoice: EInvoiceDto | null;
}
export class ReminderDto {
  id: string;
  kind: string;
  at: Date;
  emailLogId: string | null;
}
export class InvoiceDto extends InvoiceSummaryDto {
  placeOfSupply: string;
  placeOfSupplyCode: string;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  amountInWords: string;
  cancelReason: string | null;
  notes: string | null;
  issuedAt: Date | null;
  lines: InvoiceLineDto[];
  allocations: AllocationDto[];
  creditNotes: CreditNoteDto[];
  reminders: ReminderDto[];
  /** e-invoicing is on and the customer has a GSTIN, so the invoice must carry an IRN */
  einvoiceRequired: boolean;
  einvoice: EInvoiceDto | null;
}
export class InvoicePageDto {
  data: InvoiceSummaryDto[];
  meta: PageMetaDto;
}

export class ReadyJobDto {
  jobId: string;
  jobNo: string;
  customerId: string;
  customerName: string;
  crn: string;
  reportNos: string[];
  testCount: number;
  amount: string;
  missingRates: number;
  receivedAt: Date;
}
export class ReadyPageDto {
  data: ReadyJobDto[];
  meta: PageMetaDto;
}
export class AgeingTotalsDto {
  bucket: string;
  amount: string;
  count: number;
}
export class CustomerOutstandingDto {
  customerId: string;
  customerName: string;
  crn: string;
  outstanding: string;
  overdue: string;
  invoiceCount: number;
}
export class DueSummaryDto {
  ageing: AgeingTotalsDto[];
  customers: CustomerOutstandingDto[];
  total: string;
}

export class PaymentDto {
  id: string;
  paymentNo: string;
  customerId: string;
  customerName: string;
  paidOn: Date;
  mode: PaymentMode;
  reference: string | null;
  amount: string;
  unapplied: string;
  isAdvance: boolean;
  notes: string | null;
  reversed: boolean;
  allocations: { invoiceId: string; invoiceNo: string | null; amount: string }[];
}
export class PaymentPageDto {
  data: PaymentDto[];
  meta: PageMetaDto;
}
