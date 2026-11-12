import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
export class FileDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  category: string;
  entity: string | null;
  entityId: string | null;
  printWidthMm: number | null;
  printHeightMm: number | null;
  caption: string | null;
  /** result images and instrument reports: printed on the test report */
  printOnReport: boolean;
  /** PDFs: number of pages */
  @ApiProperty({ type: Number, nullable: true }) pageCount: number | null;
  createdAt: Date;
}

export class UpdateFileDto {
  @ApiProperty({ type: String, nullable: true, required: false }) @IsOptional() @IsString() @MaxLength(200) caption?: string | null;
  @IsOptional() @IsBoolean() printOnReport?: boolean;
}

export class SignedUrlDto {
  url: string;
  expiresInSeconds: number;
  originalName: string;
  mimeType: string;
}
