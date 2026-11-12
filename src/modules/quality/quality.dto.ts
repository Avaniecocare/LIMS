import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { EquipmentEventKind, EquipmentOutcome, NcSeverity, NcStatus } from '../../generated/prisma/client.js';

export class EquipmentRowDto {
  id: string;
  code: string;
  name: string;
  departmentName: string | null;
  lastCalibratedAt: Date | null;
  calibrationDueAt: Date | null;
  calibrationIntervalMonths: number | null;
  lastMaintainedAt: Date | null;
  maintenanceDueAt: Date | null;
  maintenanceIntervalMonths: number | null;
  /** the most urgent of calibration and maintenance */
  @ApiProperty({ enum: ['OVERDUE', 'DUE_SOON', 'OK', 'NOT_SCHEDULED'] }) status: 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NOT_SCHEDULED';
  version: number;
}

export class EquipmentEventDto {
  id: string;
  @ApiProperty({ enum: EquipmentEventKind }) kind: EquipmentEventKind;
  performedOn: Date;
  performedBy: string;
  @ApiProperty({ enum: EquipmentOutcome }) outcome: EquipmentOutcome;
  certificateNo: string | null;
  certificateFileId: string | null;
  nextDueOn: Date | null;
  notes: string | null;
  createdAt: Date;
}

export class RecordEquipmentEventDto {
  @IsEnum(EquipmentEventKind) kind: EquipmentEventKind;
  @IsDateString() performedOn: string;
  @IsString() @MaxLength(200) performedBy: string;
  @IsEnum(EquipmentOutcome) outcome: EquipmentOutcome;
  @IsOptional() @IsString() @MaxLength(100) certificateNo?: string | null;
  @IsOptional() @IsUUID() certificateFileId?: string | null;
  /** when the next one is due; empty uses the instrument's interval */
  @IsOptional() @IsDateString() nextDueOn?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class EquipmentScheduleDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsInt() @Min(1) @Max(120) calibrationIntervalMonths?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(120) maintenanceIntervalMonths?: number | null;
  @IsOptional() @IsDateString() maintenanceDueAt?: string | null;
}

export class AuthorisationDto {
  id: string;
  userId: string;
  userName: string;
  testId: string;
  testCode: string;
  testName: string;
  authorisedOn: Date;
  validUntil: Date | null;
  authorisedByName: string | null;
  evidence: string | null;
  evidenceFileId: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'WITHDRAWN'] }) state: 'ACTIVE' | 'EXPIRED' | 'WITHDRAWN';
  withdrawnReason: string | null;
}

export class CreateAuthorisationDto {
  @IsUUID() userId: string;
  @IsUUID() testId: string;
  @IsDateString() authorisedOn: string;
  @IsOptional() @IsDateString() validUntil?: string | null;
  /** e.g. "Supervised trials 1-5 within limits; PT round 2026-1 satisfactory" */
  @IsOptional() @IsString() @MaxLength(2000) evidence?: string | null;
  @IsOptional() @IsUUID() evidenceFileId?: string | null;
}

export class WithdrawDto {
  @IsString() @MaxLength(1000) reason: string;
}

export class AuthorisationQuery {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() testId?: string;
}

export class AuthorisationCheckQuery {
  @IsUUID() userId: string;
  /** comma-separated test ids */
  @IsString() @MaxLength(4000) testIds: string;
}

export class AuthorisationCheckDto {
  /** test ids this person is not currently authorised for */
  missing: string[];
  /** whether the lab refuses such assignments (Settings > Controls) */
  enforced: boolean;
}

export class TrainingDto {
  id: string;
  userId: string;
  userName: string;
  title: string;
  trainedOn: Date;
  trainer: string | null;
  hours: string | null;
  notes: string | null;
  evidenceFileId: string | null;
}

export class CreateTrainingDto {
  @IsUUID() userId: string;
  @IsString() @MaxLength(300) title: string;
  @IsDateString() trainedOn: string;
  @IsOptional() @IsString() @MaxLength(200) trainer?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) hours?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsUUID() evidenceFileId?: string | null;
}

export const NC_SOURCES = ['Complaint', 'Internal audit', 'External audit', 'Proficiency testing', 'Customer feedback', 'Routine work', 'Other'] as const;

export class NcDto {
  id: string;
  ncNo: string;
  source: string;
  title: string;
  description: string;
  @ApiProperty({ enum: NcSeverity }) severity: NcSeverity;
  @ApiProperty({ enum: NcStatus }) status: NcStatus;
  reference: string | null;
  correction: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dueOn: Date | null;
  overdue: boolean;
  verification: string | null;
  verifiedByName: string | null;
  closedAt: Date | null;
  createdByName: string | null;
  createdAt: Date;
  version: number;
}

export class CreateNcDto {
  @IsIn(NC_SOURCES) source: string;
  @IsString() @MaxLength(200) title: string;
  @IsString() @MaxLength(5000) description: string;
  @IsEnum(NcSeverity) severity: NcSeverity;
  @IsOptional() @IsString() @MaxLength(100) reference?: string | null;
  @IsOptional() @IsUUID() ownerId?: string | null;
  @IsOptional() @IsDateString() dueOn?: string | null;
}

export class UpdateNcDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsEnum(NcStatus) status?: NcStatus;
  @IsOptional() @IsEnum(NcSeverity) severity?: NcSeverity;
  @IsOptional() @IsString() @MaxLength(5000) correction?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) rootCause?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) correctiveAction?: string | null;
  @IsOptional() @IsUUID() ownerId?: string | null;
  @IsOptional() @IsDateString() dueOn?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) verification?: string | null;
}

export class NcQuery {
  @IsOptional() @IsEnum(NcStatus) status?: NcStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class PersonDto {
  id: string;
  name: string;
  designation: string | null;
  /** can be assigned tests */
  analyst: boolean;
}

export class QualitySummaryDto {
  equipmentOverdue: number;
  equipmentDueSoon: number;
  authorisationsExpiringSoon: number;
  ncOpen: number;
  ncOverdue: number;
}
