import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateLicenceDto {
  @IsString() @MinLength(20) @MaxLength(8000) licence: string;
}

export class LicenceDto {
  @ApiProperty({ enum: ['not-required', 'missing', 'active', 'ending', 'grace', 'expired'] }) state: string;
  readOnly: boolean;
  @ApiProperty({ type: String, nullable: true }) kind: string | null;
  @ApiProperty({ type: String, nullable: true }) customer: string | null;
  @ApiProperty({ type: String, nullable: true }) licenceId: string | null;
  /** quote this when asking for a licence */
  @ApiProperty({ type: String, nullable: true }) installation: string | null;
  @ApiProperty({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) endsAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) readOnlyFrom: Date | null;
  @ApiProperty({ type: Number, nullable: true }) daysLeft: number | null;
  /** whom to ask for a licence */
  vendorName: string;
  @ApiProperty({ type: String, nullable: true }) vendorUrl: string | null;
}

/** What everyone signed in may know: enough for the banner. */
export class LicenceNoticeDto {
  @ApiProperty({ enum: ['not-required', 'missing', 'active', 'ending', 'grace', 'expired'] }) state: string;
  readOnly: boolean;
  @ApiProperty({ type: String, nullable: true }) kind: string | null;
  @ApiProperty({ type: Date, nullable: true }) readOnlyFrom: Date | null;
  @ApiProperty({ type: Number, nullable: true }) daysLeft: number | null;
}
