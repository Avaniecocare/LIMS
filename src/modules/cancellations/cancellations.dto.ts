import { IsIn, IsInt, IsString, IsUUID, Length, Min } from 'class-validator';

export class CancelPreviewDto {
  @IsIn(['job', 'sample', 'test']) type: 'job' | 'sample' | 'test';
  @IsUUID() id: string;
}

export class CancelDto extends CancelPreviewDto {
  @IsInt() @Min(1) version: number;
  @IsString() @Length(1, 1000) reason: string;
}

export class CancelImpactDto {
  canCancel: boolean;
  /** why not, when canCancel is false */
  blockers: string[];
  samples: { id: string; sampleNo: string }[];
  tests: { id: string; sampleNo: string; testName: string; status: string }[];
  reports: { id: string; reportNo: string; status: string }[];
  /** lines on draft invoices are removed */
  draftInvoiceLines: { invoiceId: string; description: string }[];
  /** lines on issued invoices stay until corrected by a credit note */
  issuedInvoiceLines: { invoiceId: string; invoiceNo: string | null; description: string }[];
}
