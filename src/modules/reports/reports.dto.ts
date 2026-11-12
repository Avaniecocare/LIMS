import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { ReportStatus } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class ReportQuery extends PageQuery {
  @IsOptional() @IsEnum(ReportStatus) status?: ReportStatus;
  @IsOptional() @IsUUID() jobId?: string;
  /** needs permission to see customers */
  @IsOptional() @IsUUID() customerId?: string;
}

export class ReportActionDto {
  @IsInt() @Min(1) version: number;
}

export class ReportRejectDto {
  @IsInt() @Min(1) version: number;
  @IsString() @Length(1, 1000) reason: string;
  @IsIn(['CORRECT', 'RETEST']) action: 'CORRECT' | 'RETEST';
  /** required when action is RETEST */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) sampleTestIds?: string[];
}

/** One sample photograph chosen for the report, with how it prints. */
export class ReportPhotoDto {
  @IsUUID() fileId: string;
  @IsOptional() @IsString() @MaxLength(200) caption?: string | null;
  /** printed size; the page leaves about 180 x 250 mm */
  @IsInt() @Min(30) @Max(180) widthMm: number;
  @IsInt() @Min(30) @Max(240) heightMm: number;
}

export class ReportCorrectDto {
  @IsInt() @Min(1) version: number;
  /** the photographs to print, in order; an empty list removes them all */
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ReportPhotoDto) samplePhotos?: ReportPhotoDto[];
  @IsOptional() @IsString() @MaxLength(4000) reportRemarks?: string | null;
  @IsOptional() @IsString() @MaxLength(500) sampleDescription?: string;
  @IsOptional() @IsString() @MaxLength(500) customerReference?: string | null;
  @IsOptional() @IsString() @MaxLength(200) kindAttention?: string | null;
}

export class ReportApproveDto {
  @IsInt() @Min(1) version: number;
  /** the signatory re-enters their password */
  @IsString() @MaxLength(200) password: string;
}

export class ReportIssueDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsEmail() emailTo?: string | null;
  @IsOptional() @IsEmail() emailCc?: string | null;
}

export class ReportEmailDto {
  @IsEmail() to: string;
  @IsOptional() @IsEmail() cc?: string | null;
}

export class ReportReviseDto {
  @IsString() @Length(1, 1000) reason: string;
}

export class ReportRowDto {
  id: string; reportNo: string; revisionId: string; revisionNo: number; status: ReportStatus; sampleId: string; sampleNo: string; jobId: string; jobNo: string; customerName: string | null; ulrNumber: string | null; createdAt: Date; issuedAt: Date | null; version: number;
}
export class ReportPageDto { data: ReportRowDto[]; meta: PageMetaDto; }
export class ReportRejectionDto { id: string; stage: string; action: string; reason: string; byName: string | null; at: Date;
  @ApiProperty({ type: [String], nullable: true }) sampleTestIds: string[] | null;
}
export class SignatureDto { name: string; designation: string | null; signedAt: Date; contentSha256: string; }
export class RevisionDto {
  id: string; revisionNo: number; status: ReportStatus; revisionReason: string | null; ulrNumber: string | null; reviewedByName: string | null; reviewedAt: Date | null; approvedByName: string | null; approvedAt: Date | null; issuedAt: Date | null; supersededAt: Date | null;
  pdfReady: boolean; pdfSha256: string | null; version: number; rejections: ReportRejectionDto[];
  @ApiProperty({ type: () => SignatureDto, nullable: true }) signature: SignatureDto | null;
}
export class ReportTestDto { sampleTestId: string; testName: string; status: string; }
export class ReportDetailDto {
  id: string; reportNo: string; sampleId: string; sampleNo: string; jobId: string; jobNo: string; customerName: string | null; customerEmail: string | null; currentRevisionNo: number; revisions: RevisionDto[]; tests: ReportTestDto[]; canReview: boolean; canApprove: boolean; withheld: boolean; reportRemarks: string | null; sampleDescription: string; customerReference: string | null; kindAttention: string | null;
  @ApiProperty({ type: () => [ReportPhotoDto] }) samplePhotos: ReportPhotoDto[];
}
export class ReportPreviewDto { html: string; }
export class SignedPdfDto { url: string; filename: string; }

export class VerifiedParameterDto { name: string; value: string | null; unit: string | null; }
export class VerifiedTestDto {
  testName: string; methodName: string | null;
  @ApiProperty({ type: () => [VerifiedParameterDto] }) parameters: VerifiedParameterDto[];
}
/** Public report verification. Only these fields leave without a sign-in. */
export class ReportVerificationDto {
  @ApiProperty({ enum: ['VALID', 'SUPERSEDED'] }) status: 'VALID' | 'SUPERSEDED';
  laboratoryName: string; reportNo: string; revisionNo: number; ulrNumber: string | null; issuedAt: Date | null; approvedAt: Date; approvedByName: string;
  customerName: string; sampleNo: string; sampleDescription: string; contentSha256: string | null; pdfSha256: string | null; supersededAt: Date | null; replacedByRevisionNo: number | null;
  @ApiProperty({ type: () => [VerifiedTestDto] }) tests: VerifiedTestDto[];
}
