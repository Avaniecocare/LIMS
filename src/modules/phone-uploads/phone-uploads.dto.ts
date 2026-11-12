import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export const PHONE_PURPOSES = ['sample-image', 'report-photo', 'result-image', 'letter-page', 'booking'] as const;
export type PhonePurpose = (typeof PHONE_PURPOSES)[number];

export class CreatePhoneUploadDto {
  /**
   * What the photos are for: sample-image (a sample), report-photo (a draft report), result-image (a test in
   * progress), letter-page (pages of the customer's letter on a job), or booking (a booking not saved yet: the photos
   * are held for the person booking and moved onto the sample with /phone-uploads/claim).
   */
  @ApiProperty({ enum: PHONE_PURPOSES }) @IsIn(PHONE_PURPOSES) purpose: PhonePurpose;
  /** the sample, report, test or job; not used for a booking */
  @ValidateIf((o: CreatePhoneUploadDto) => o.purpose !== 'booking') @IsUUID() entityId?: string;
  /** booking only: which sample on the form, shown on the phone, e.g. "sample 2" */
  @IsOptional() @IsString() @MaxLength(40) note?: string;
}

/** Moves photos sent from a phone during booking onto the sample that was just booked. */
export class ClaimPhoneUploadsDto {
  @IsUUID() sampleId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @IsUUID('all', { each: true }) fileIds: string[];
}

export class ClaimedDto {
  claimed: number;
}

/** Returned once, to the person who made the link: the token is never stored or shown again. */
export class PhoneUploadLinkDto {
  id: string;
  url: string;
  /** the link as a QR code image (data URI) */
  qrDataUri: string;
  label: string;
  expiresAt: Date;
  maxUploads: number;
}

export class PhoneUploadStatusDto {
  id: string;
  label: string;
  expiresAt: Date;
  active: boolean;
  /** files received so far, oldest first */
  fileIds: string[];
  maxUploads: number;
}

/** What the phone sees. Only the sample or report number and the lab's name, never the customer. */
export class PhoneUploadPublicDto {
  laboratoryName: string;
  label: string;
  expiresAt: Date;
  remaining: number;
}

export class PhoneUploadReceivedDto {
  received: number;
  remaining: number;
}
