import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DataRequestKind, DataRequestStatus } from '../../generated/prisma/client.js';

export class DataRequestDto {
  id: string;
  @ApiProperty({ enum: DataRequestKind }) kind: DataRequestKind;
  @ApiProperty({ enum: DataRequestStatus }) status: DataRequestStatus;
  requesterName: string;
  requesterEmail: string;
  details: string;
  receivedOn: Date;
  dueOn: Date;
  overdue: boolean;
  resolution: string | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  version: number;
}

export class CreateDataRequestDto {
  @IsEnum(DataRequestKind) kind: DataRequestKind;
  @IsString() @MaxLength(200) requesterName: string;
  @IsEmail() requesterEmail: string;
  @IsString() @MaxLength(5000) details: string;
  @IsDateString() receivedOn: string;
}

export class ResolveDataRequestDto {
  @IsInt() @Min(1) version: number;
  @IsIn(['DONE', 'REJECTED']) status: 'DONE' | 'REJECTED';
  @IsString() @MaxLength(5000) resolution: string;
}

export class PersonalDataItemDto {
  /** where it is held, e.g. "Customer contact" */
  place: string;
  /** which record, e.g. the customer's name */
  record: string;
  /** the personal details held there */
  details: string;
  /** whether erasing can remove it (issued documents are kept as the law requires) */
  erasable: boolean;
}

export class PersonalDataDto {
  email: string;
  @ApiProperty({ type: () => [PersonalDataItemDto] }) items: PersonalDataItemDto[];
}

export class ErasedDto {
  /** customer contacts whose name, email and phone were removed */
  contacts: number;
}

export class BreachDto {
  id: string;
  detectedAt: Date;
  description: string;
  dataAffected: string;
  peopleAffected: number | null;
  containment: string | null;
  reportedToBoardAt: Date | null;
  notifiedPeopleAt: Date | null;
  closedAt: Date | null;
  createdByName: string | null;
  /** when the detailed report to the Data Protection Board is due (72 hours after detection) */
  boardReportDueAt: Date;
  version: number;
}

export class CreateBreachDto {
  @IsDateString() detectedAt: string;
  @IsString() @MaxLength(5000) description: string;
  @IsString() @MaxLength(2000) dataAffected: string;
  @IsOptional() @IsInt() @Min(0) peopleAffected?: number | null;
  @IsOptional() @IsString() @MaxLength(5000) containment?: string | null;
}

export class UpdateBreachDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsString() @MaxLength(5000) containment?: string | null;
  @IsOptional() @IsInt() @Min(0) peopleAffected?: number | null;
  @IsOptional() @IsDateString() reportedToBoardAt?: string | null;
  @IsOptional() @IsDateString() notifiedPeopleAt?: string | null;
  @IsOptional() @IsDateString() closedAt?: string | null;
}

export class EmailQuery {
  @IsEmail() email: string;
}
