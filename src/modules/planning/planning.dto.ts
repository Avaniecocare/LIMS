import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { AnalysisMode } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class PlanTestInput {
  @IsUUID() testId: string;
  @IsOptional() @IsEnum(AnalysisMode) analysisMode?: AnalysisMode | null;
  @IsOptional() @IsString() @MaxLength(2000) officeInstructions?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) technicalData?: string | null;
  @IsOptional() @IsUUID() assignedToId?: string | null;
  @IsOptional() @IsUUID() instrumentId?: string | null;
}

export class PlanSamplesDto {
  /** one sample, or several planned as a group */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) sampleIds: string[];
  @IsOptional() @IsUUID() specificationId?: string | null;
  /** second grade for dual grade reporting */
  @IsOptional() @IsUUID() dualSpecificationId?: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PlanTestInput) tests: PlanTestInput[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class AssignDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID(undefined, { each: true }) sampleTestIds: string[];
  @IsUUID() assignedToId: string;
  @IsOptional() @IsUUID() instrumentId?: string | null;
}

export class SuggestQuery {
  @IsOptional() @IsUUID() specificationId?: string;
  @IsOptional() @IsUUID() dualSpecificationId?: string;
  @IsOptional() @IsUUID() groupId?: string;
}

export class PlanningQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(20) view?: 'unplanned' | 'unassigned' | 'assigned';
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsUUID() assignedToId?: string;
}

export class SuggestedParameterDto { id: string; code: string; name: string; }
export class SuggestedTestDto {
  testId: string; testCode: string; testName: string; methodName: string | null; category: string; defaultTatDays: number; parameters: SuggestedParameterDto[];
}
export class PlanResultDto { planId: string; planNo: string; sampleTestIds: string[]; }

export class PlanningRowDto {
  id: string; sampleId: string; sampleNo: string; sampleDescription: string; jobId: string; jobNo: string; testId: string; testCode: string; testName: string; methodName: string | null; status: string; urgent: boolean;
  planned: boolean; dueDate: Date | null; assignedToId: string | null; assignedToName: string | null; instrumentId: string | null; instrumentName: string | null; version: number;
}
export class PlanningPageDto { data: PlanningRowDto[]; meta: PageMetaDto; }

export class WorkloadRowDto {
  id: string; name: string; openTests: number; inProgress: number; overdue: number; urgent: number;
}
export class WorkloadDto { technicians: WorkloadRowDto[]; instruments: WorkloadRowDto[]; }
export class TechnicianDto { id: string; name: string; departmentId: string | null; }
export class InstrumentOptionDto {
  id: string; code: string; name: string; departmentId: string | null; calibrationDueAt: Date | null; calibrationOverdue: boolean;
}
export class CancelTestDto {
  @IsString() @MaxLength(1000) reason: string;
}
