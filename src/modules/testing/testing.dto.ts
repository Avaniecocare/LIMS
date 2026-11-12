import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class ResultValueInput {
  @IsUUID() parameterId: string;
  @IsOptional() @IsString() @MaxLength(4000) value?: string | null;
}

export class SaveResultsDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ResultValueInput) values?: ResultValueInput[];
  @IsOptional() @IsUUID() instrumentId?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) remarks?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) observations?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

export class VersionDto {
  @IsInt() @Min(1) version: number;
}

export class TestReasonDto {
  @IsInt() @Min(1) version: number;
  @IsString() @Length(1, 1000) reason: string;
}

export class BulkApproveItem {
  @IsUUID() id: string;
  @IsInt() @Min(1) version: number;
}

export class BulkApproveDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => BulkApproveItem) items: BulkApproveItem[];
}

export class WorklistQuery extends PageQuery {
  /** open (default) or done */
  @IsOptional() @IsString() @MaxLength(10) view?: string;
}

export class ApprovalQuery extends PageQuery {
  @IsOptional() @IsUUID() departmentId?: string;
}

export class WorklistItemDto {
  id: string; testCode: string; testName: string; methodName: string | null; status: string; urgent: boolean; dueDate: Date | null; overdue: boolean; sampleNo: string; jobNo: string; sampleDescription: string;
  /** null while impartiality is on */
  customerName: string | null; currentStage: string | null; rejectionReason: string | null; holdReason: string | null; version: number; analysisMode: string | null;
}
export class WorklistPageDto { data: WorklistItemDto[]; meta: PageMetaDto; }

export class LimitDto { spec: string; role: string; min: string | null; max: string | null; text: string | null; }
export class CalculationDto { inputs: Record<string, string>; working: string; result: string; formulaVersion: number | null; }
export class ResultOptionViewDto { value: string; isPass: boolean | null; }
export class ParameterResultDto {
  parameterId: string; code: string; name: string; kind: string; unit: string | null; decimals: number; accredited: boolean; value: string | null; numericValue: string | null; qualifier: string | null; textValue: string | null;
  limits: LimitDto[]; passPrimary: boolean | null; passDual: boolean | null; options: ResultOptionViewDto[]; error: string | null;
  @ApiProperty({ type: () => CalculationDto, nullable: true }) calculation: CalculationDto | null;
}
export class StageDto { seq: number; name: string; completedAt: Date | null; completedByName: string | null; }
export class ConversionOptionDto { id: string; fromCode: string; fromSymbol: string; toCode: string; toSymbol: string; }
export class InstrumentChoiceDto { id: string; code: string; name: string; calibrationDueAt: Date | null; calibrationOverdue: boolean; }
export class RemarkOptionDto { id: string; code: string; text: string; outcome: string; suggested: boolean; }
export class TestDetailDto extends WorklistItemDto {
  sampleId: string; officeInstructions: string | null; technicalData: string | null; instrumentId: string | null; remarks: string | null; observations: string | null; notes: string | null; conductedByName: string | null; canEdit: boolean; assignedToMe: boolean;
  blockOverdueInstruments: boolean; instrumentWarning: string | null; stages: StageDto[]; results: ParameterResultDto[]; instruments: InstrumentChoiceDto[]; conversions: ConversionOptionDto[]; remarkOptions: RemarkOptionDto[];
  assignedToName: string | null; submittedAt: Date | null; approvedAt: Date | null; approvedByName: string | null; outcome: string;
}
export class ApprovalItemDto {
  id: string; testCode: string; testName: string; methodName: string | null; sampleNo: string; jobNo: string; urgent: boolean; dueDate: Date | null; submittedAt: Date | null; conductedByName: string | null; outcome: string; version: number; ownResult: boolean; results: ParameterResultDto[];
}
export class ApprovalPageDto { data: ApprovalItemDto[]; meta: PageMetaDto; }
export class BulkApproveResultDto {
  approved: string[];
  failed: { id: string; message: string }[];
}
