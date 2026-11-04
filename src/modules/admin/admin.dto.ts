import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageMeta, PageQuery } from '../../common/pagination.dto.js';
import { TermsKind } from '../../generated/prisma/client.js';

export class PageMetaDto implements PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class UserListQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100)
  role?: string;

  @IsOptional() @IsString() @MaxLength(5)
  active?: string;
}

export class CreateUserDto {
  @IsEmail() @MaxLength(254)
  email: string;

  @IsString() @MinLength(2) @MaxLength(120)
  name: string;

  @IsString() @MaxLength(200)
  password: string;

  @IsOptional() @IsString() @MaxLength(120)
  designation?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsUUID()
  departmentId?: string;

  @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true })
  roleIds: string[];
}

export class UpdateUserDto {
  @IsInt() @Min(1)
  version: number;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(120)
  designation?: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;

  @IsOptional() @IsUUID()
  departmentId?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true })
  roleIds?: string[];
}

export class AdminResetPasswordDto {
  @IsString() @MaxLength(200)
  newPassword: string;
}

export class UserDto {
  id: string;
  email: string;
  name: string;
  designation: string | null;
  phone: string | null;
  departmentId: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
  signatureFileId: string | null;
  version: number;
  roles: { id: string; name: string }[];
}

export class UserPageDto {
  data: UserDto[];
  meta: PageMetaDto;
}

export class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsInt() @Min(1)
  version: number;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions?: string[];
}

export class RoleDto {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  version: number;
  permissions: string[];
  userCount: number;
}

export class PermissionDto {
  code: string;
  module: string;
  description: string;
}

export class SettingDto {
  key: string;
  label: string;
  group: string;
  /** any JSON value */
  value: unknown;
  default: unknown;
  version: number;
}

export class UpdateSettingDto {
  @IsDefined()
  value: unknown;

  /** 0 when the setting has never been saved */
  @IsInt() @Min(0)
  version: number;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class TermsDto {
  id: string;
  kind: TermsKind;
  versionNo: number;
  body: string;
  createdAt: Date;
}

export class CreateTermsDto {
  @IsEnum(TermsKind)
  kind: TermsKind;

  @IsString() @MinLength(1) @MaxLength(50000)
  body: string;
}

export class HolidayDto {
  id: string;
  date: Date;
  name: string;
}

export class CreateHolidayDto {
  @IsDateString()
  date: string;

  @IsString() @MinLength(1) @MaxLength(120)
  name: string;
}

export class AuditQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(60)
  entity?: string;

  @IsOptional() @IsString() @MaxLength(60)
  entityId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  action?: string;

  @IsOptional() @IsUUID()
  userId?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;
}

export class AuditEntryDto {
  id: string;
  at: Date;
  userId: string | null;
  userName: string | null;
  ip: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
}

export class AuditPageDto {
  data: AuditEntryDto[];
  meta: PageMetaDto;
}

export class CompanyDetailsDto {
  productName: string;
  companyName: string;
  legalName: string;
  gstin: string;
  pan: string;
  cin: string | null;
  stateName: string;
  gstStateCode: string;
  sacCode: string;
  sacDescription: string;
  registeredAddress: string;
  labAddress: string;
  phone: string;
  email: string;
  website: string | null;
  reportVerificationEmail: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  bankBranch: string;
  bankIfsc: string;
  bankSwift: string | null;
  certificationText: string | null;
  nablMode: boolean;
  nablCertificateNo: string | null;
  ulrFormat: string | null;
  documentPrefix: string;
  note: string;
}

class WizardTermsDto {
  @IsOptional() @IsString() @MaxLength(50000)
  quotation?: string;

  @IsOptional() @IsString() @MaxLength(50000)
  invoice?: string;

  @IsOptional() @IsString() @MaxLength(50000)
  report?: string;
}

export class SetupDto {
  /** required when the deployment sets SETUP_TOKEN */
  @IsOptional() @IsString() @MaxLength(200)
  setupToken?: string;

  @IsEmail() @MaxLength(254)
  adminEmail: string;

  @IsString() @MinLength(2) @MaxLength(120)
  adminName: string;

  @IsString() @MaxLength(200)
  adminPassword: string;

  @IsOptional() @IsInt() @Min(0)
  gstRate?: number;

  @IsOptional() @IsInt() @Min(0)
  defaultCreditDays?: number;

  @IsOptional() @IsArray() @IsInt({ each: true })
  workingDays?: number[];

  @IsOptional() @IsInt() @Min(0)
  sampleRetentionDays?: number;

  @IsOptional() @IsInt() @Min(0)
  reportRetentionYears?: number;

  @IsOptional() @Type(() => WizardTermsDto)
  terms?: WizardTermsDto;
}

export class SetupStatusDto {
  setupRequired: boolean;
  tokenRequired: boolean;
}

export class BrandingDto {
  productName: string;
  companyName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
}

export class SavedFilterDto {
  id: string;
  screen: string;
  name: string;
  /** JSON filter state */
  filters: unknown;
}

export class CreateSavedFilterDto {
  @IsString() @MaxLength(60)
  screen: string;

  @IsString() @MinLength(1) @MaxLength(60)
  name: string;

  @IsDefined()
  filters: unknown;
}
