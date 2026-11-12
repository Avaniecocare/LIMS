import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

export class EInvoiceSellerDto {
  @IsString() @MaxLength(100) line1: string;
  @IsString() @MaxLength(100) line2: string;
  @IsString() @MaxLength(50) city: string;
  /** 6 digits, or empty while not set */
  @Matches(/^([1-9][0-9]{5})?$/, { message: 'A PIN code has 6 digits' }) pincode: string;
}

export class EInvoiceProblemDto {
  field: string;
  message: string;
}

export class EInvoiceSettingsDto {
  /** EINVOICE_PROVIDER is set on the server */
  configured: boolean;
  /** configured and the module is on */
  enabled: boolean;
  provider: string | null;
  environment: string | null;
  gstin: string | null;
  autoOnIssue: boolean;
  seller: EInvoiceSellerDto;
  /** what would stop every registration; empty means ready */
  problems: EInvoiceProblemDto[];
  sellerVersion: number;
  autoOnIssueVersion: number;
}

export class SaveEInvoiceSettingsDto {
  @ValidateNested() @Type(() => EInvoiceSellerDto) seller: EInvoiceSellerDto;
  @IsBoolean() autoOnIssue: boolean;
  @IsInt() @Min(0) sellerVersion: number;
  @IsInt() @Min(0) autoOnIssueVersion: number;
}
