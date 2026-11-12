import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { LookupKind, ParameterKind, TestCategory, TestGroupKind } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class MasterQuery extends PageQuery {
  @IsOptional() @IsIn(['true', 'false', 'all'])
  active?: 'true' | 'false' | 'all';

  /** Filters for specific masters */
  @IsOptional() @IsUUID()
  testId?: string;

  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsUUID()
  departmentId?: string;

  @IsOptional() @IsEnum(LookupKind)
  kind?: LookupKind;
}

class Versioned {
  /** Required on update for optimistic concurrency */
  @IsOptional() @IsInt() @Min(1)
  version?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// -------------------------------------------------------------------- simple masters
export class DepartmentInput extends Versioned {
  @IsString() @Length(1, 30) code: string;
  @IsString() @Length(1, 120) name: string;
}
export class DepartmentDto {
  id: string; code: string; name: string; isActive: boolean; version: number;
}
export class DepartmentPageDto { data: DepartmentDto[]; meta: PageMetaDto; }

export class UnitInput extends Versioned {
  @IsString() @Length(1, 30) code: string;
  @IsString() @Length(1, 80) name: string;
  @IsString() @Length(1, 30) symbol: string;
}
export class UnitDto {
  id: string; code: string; name: string; symbol: string; isActive: boolean; version: number;
}
export class UnitPageDto { data: UnitDto[]; meta: PageMetaDto; }

export class UnitConversionInput extends Versioned {
  @IsUUID() fromUnitId: string;
  @IsUUID() toUnitId: string;
  @IsNumberString() factor: string;
}
export class UnitConversionDto {
  id: string; fromUnitId: string; toUnitId: string; fromUnitCode: string; toUnitCode: string; factor: string; isActive: boolean; version: number;
}
export class UnitConversionPageDto { data: UnitConversionDto[]; meta: PageMetaDto; }

export class ConvertInput {
  @IsUUID() conversionId: string;
  @IsNumberString() value: string;
  @IsOptional() @IsInt() @Min(0) @Max(12) decimals?: number;
}
export class ConvertResultDto { value: string; }

export class TestMethodInput extends Versioned {
  @IsString() @Length(1, 60) code: string;
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsString() @MaxLength(200) standardRef?: string;
  @IsOptional() @IsBoolean() accredited?: boolean;
  @IsOptional() @IsDateString() accreditedUntil?: string | null;
}
export class TestMethodDto {
  id: string; code: string; name: string; standardRef: string | null; accredited: boolean; accreditedUntil: Date | null; isActive: boolean; version: number;
}
export class TestMethodPageDto { data: TestMethodDto[]; meta: PageMetaDto; }

export class TestMasterInput extends Versioned {
  @IsString() @Length(1, 60) code: string;
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsEnum(TestCategory) category?: TestCategory;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsUUID() methodId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(365) defaultTatDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) urgentTatDays?: number;
  @IsOptional() @IsBoolean() accredited?: boolean;
  @IsOptional() @IsDateString() accreditedUntil?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MinLength(1, { each: true }) stages?: string[];
}
export class TestMasterDto {
  id: string; code: string; name: string; category: TestCategory; departmentId: string | null; departmentName: string | null;
  methodId: string | null; methodName: string | null; defaultTatDays: number; urgentTatDays: number; accredited: boolean;
  accreditedUntil: Date | null; stages: string[]; parameterCount: number; isActive: boolean; version: number;
}
export class TestMasterPageDto { data: TestMasterDto[]; meta: PageMetaDto; }

export class TestParameterInput extends Versioned {
  @IsUUID() testId: string;
  @IsString() @Length(1, 40) code: string;
  @IsString() @Length(1, 200) name: string;
  @IsOptional() @IsEnum(ParameterKind) kind?: ParameterKind;
  @IsOptional() @IsUUID() unitId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(8) decimals?: number;
  @IsOptional() @IsUUID() resultSetId?: string | null;
  @IsOptional() @IsUUID() formulaId?: string | null;
  /** formula variable -> parameter code on the same test */
  @IsOptional() @IsObject() formulaBindings?: Record<string, string> | null;
  @IsOptional() @IsBoolean() accredited?: boolean;
  @IsOptional() @IsDateString() accreditedUntil?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  /** false for working values the report should not print, such as dimensions, loads or individual readings */
  @IsOptional() @IsBoolean() showOnReport?: boolean;
}
export class TestParameterDto {
  id: string; testId: string; testCode: string; code: string; name: string; kind: ParameterKind; unitId: string | null; unitSymbol: string | null;
  decimals: number; resultSetId: string | null; formulaId: string | null; formulaBindings: Record<string, string> | null;
  accredited: boolean; accreditedUntil: Date | null; sortOrder: number; showOnReport: boolean; isActive: boolean; version: number;
}
export class TestParameterPageDto { data: TestParameterDto[]; meta: PageMetaDto; }

export class SpecLimitInput {
  @IsUUID() parameterId: string;
  @IsOptional() @IsNumberString() minValue?: string | null;
  @IsOptional() @IsNumberString() maxValue?: string | null;
  @IsOptional() @IsString() @MaxLength(200) textLimit?: string | null;
}
export class SpecificationInput extends Versioned {
  @IsString() @Length(1, 60) code: string;
  @IsString() @Length(1, 200) name: string;
  /** leave empty for a general specification */
  @IsOptional() @IsUUID() customerId?: string | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SpecLimitInput) limits?: SpecLimitInput[];
}
export class SpecLimitDto {
  parameterId: string; parameterCode: string; parameterName: string; testId: string; testCode: string; minValue: string | null; maxValue: string | null; textLimit: string | null;
}
export class SpecificationDto {
  id: string; code: string; name: string; customerId: string | null; limits: SpecLimitDto[]; isActive: boolean; version: number;
}
export class SpecificationPageDto { data: SpecificationDto[]; meta: PageMetaDto; }

export class TestGroupItemInput {
  @IsUUID() testId: string;
  @IsOptional() @IsUUID() parameterId?: string | null;
}
export class TestGroupInput extends Versioned {
  @IsString() @Length(1, 40) code: string;
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsEnum(TestGroupKind) kind?: TestGroupKind;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TestGroupItemInput) items?: TestGroupItemInput[];
}
export class TestGroupItemDto {
  testId: string; testCode: string; testName: string; parameterId: string | null; parameterName: string | null;
}
export class TestGroupDto {
  id: string; code: string; name: string; kind: TestGroupKind; items: TestGroupItemDto[]; isActive: boolean; version: number;
}
export class TestGroupPageDto { data: TestGroupDto[]; meta: PageMetaDto; }

export class ResultOptionInput {
  @IsString() @Length(1, 120) value: string;
  /** whether this outcome counts as a pass; empty when pass/fail does not apply */
  @IsOptional() @IsBoolean() isPass?: boolean | null;
}
export class ResultSetInput extends Versioned {
  @IsString() @Length(1, 40) code: string;
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ResultOptionInput) options?: ResultOptionInput[];
}
export class ResultOptionDto { value: string; isPass: boolean | null; }
export class ResultSetDto {
  id: string; code: string; name: string; options: ResultOptionDto[]; isActive: boolean; version: number;
}
export class ResultSetPageDto { data: ResultSetDto[]; meta: PageMetaDto; }

export class FormulaInput extends Versioned {
  @IsString() @Length(1, 40) code: string;
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsString() @Length(1, 500) expression: string;
  @IsOptional() @IsInt() @Min(0) @Max(8) decimals?: number;
}
export class FormulaVersionDto {
  id: string; versionNo: number; expression: string; variables: string[]; decimals: number; createdAt: Date;
}
export class FormulaDto {
  id: string; code: string; name: string; description: string | null; currentVersion: number; expression: string; variables: string[]; decimals: number; versions: FormulaVersionDto[]; isActive: boolean; version: number;
}
export class FormulaPageDto { data: FormulaDto[]; meta: PageMetaDto; }
export class FormulaTestInput {
  @IsString() @Length(1, 500) expression: string;
  @IsObject() inputs: Record<string, string>;
  @IsOptional() @IsInt() @Min(0) @Max(8) decimals?: number;
}
export class FormulaTestResultDto {
  valid: boolean; variables: string[]; value: string | null; working: string | null; error: string | null;
}

export class InstrumentInput extends Versioned {
  @IsString() @Length(1, 40) code: string;
  @IsString() @Length(1, 160) name: string;
  @IsOptional() @IsString() @MaxLength(80) serialNo?: string;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsDateString() lastCalibratedAt?: string | null;
  @IsOptional() @IsDateString() calibrationDueAt?: string | null;
  @IsOptional() @IsUUID() certificateFileId?: string | null;
}
export class InstrumentDto {
  id: string; code: string; name: string; serialNo: string | null; departmentId: string | null; departmentName: string | null;
  lastCalibratedAt: Date | null; calibrationDueAt: Date | null; certificateFileId: string | null; calibrationOverdue: boolean; isActive: boolean; version: number;
}
export class InstrumentPageDto { data: InstrumentDto[]; meta: PageMetaDto; }

export class StandardRateInput extends Versioned {
  @IsUUID() testId: string;
  @IsNumberString() rate: string;
  @IsDateString() effectiveFrom: string;
  @IsOptional() @IsDateString() effectiveTo?: string | null;
}
export class StandardRateDto {
  id: string; testId: string; testCode: string; testName: string; rate: string; effectiveFrom: Date; effectiveTo: Date | null; isActive: boolean; version: number;
}
export class StandardRatePageDto { data: StandardRateDto[]; meta: PageMetaDto; }

export class CustomerRateInput extends Versioned {
  @IsUUID() customerId: string;
  @IsUUID() testId: string;
  @IsNumberString() rate: string;
  @IsDateString() effectiveFrom: string;
  @IsOptional() @IsDateString() effectiveTo?: string | null;
}
export class CustomerRateDto {
  id: string; customerId: string; customerName: string; crn: string; testId: string; testCode: string; testName: string; rate: string; effectiveFrom: Date; effectiveTo: Date | null; isActive: boolean; version: number;
}
export class CustomerRatePageDto { data: CustomerRateDto[]; meta: PageMetaDto; }

export class RemarkTemplateInput extends Versioned {
  @IsString() @Length(1, 40) code: string;
  @IsString() @Length(1, 2000) text: string;
  @IsOptional() @IsUUID() testId?: string | null;
  @IsOptional() @IsIn(['ANY', 'PASS', 'FAIL']) outcome?: string;
}
export class RemarkTemplateDto {
  id: string; code: string; text: string; testId: string | null; outcome: string; isActive: boolean; version: number;
}
export class RemarkTemplatePageDto { data: RemarkTemplateDto[]; meta: PageMetaDto; }

export class LookupInput extends Versioned {
  @IsEnum(LookupKind) kind: LookupKind;
  @IsString() @Length(1, 40) code: string;
  @IsString() @Length(1, 120) label: string;
}
export class LookupDto {
  id: string; kind: LookupKind; code: string; label: string; isActive: boolean; version: number;
}
export class LookupPageDto { data: LookupDto[]; meta: PageMetaDto; }

export class ImportResultDto {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export class HistoryEntryDto {
  id: string; at: Date; userName: string | null; action: string; before: unknown; after: unknown; reason: string | null;
}

export class RateLookupDto {
  /** decimal string; null when no rate is set */
  rate: string | null;
  source: string | null;
}
export class RateLookupQuery {
  @IsUUID() testId: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsDateString() on?: string;
}

