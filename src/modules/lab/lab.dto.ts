import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class BankDetailsDto {
  @IsString() @MaxLength(200) accountName: string;
  @IsString() @MaxLength(40) accountNumber: string;
  @IsString() @MaxLength(120) bankName: string;
  @IsString() @MaxLength(120) branch: string;
  @IsString() @MaxLength(11) ifsc: string;
  @IsOptional() @IsString() @MaxLength(11) swift: string | null;
}

export class AccreditationDto {
  /** e.g. "ISO/IEC 17025:2017 accredited laboratory"; printed on reports */
  @IsOptional() @IsString() @MaxLength(300) certificationText: string | null;
  /** NABL mode: the NABL symbol and ULR number on reports of accredited tests */
  @IsBoolean() nablMode: boolean;
  @IsOptional() @IsString() @MaxLength(60) nablCertificateNo: string | null;
  @IsOptional() @IsString() @MaxLength(80) ulrFormat: string | null;
}

/** The laboratory as it appears on reports, quotations, invoices and emails. */
export class LabProfileDto {
  @IsString() @MaxLength(200) companyName: string;
  @IsString() @MaxLength(250) legalName: string;
  @IsString() @MaxLength(15) gstin: string;
  @IsString() @MaxLength(10) pan: string;
  @IsOptional() @IsString() @MaxLength(21) cin: string | null;
  @IsString() @MaxLength(80) stateName: string;
  @IsString() @MaxLength(2) gstStateCode: string;
  /** SAC code on invoices; 998346 is technical testing and analysis */
  @IsString() @MaxLength(10) sacCode: string;
  @IsString() @MaxLength(200) sacDescription: string;
  @IsString() @MaxLength(500) registeredAddress: string;
  @IsString() @MaxLength(500) labAddress: string;
  @IsString() @MaxLength(40) phone: string;
  @IsString() @MaxLength(254) email: string;
  @IsOptional() @IsString() @MaxLength(200) website: string | null;
  /** printed beside the verification QR code */
  @IsString() @MaxLength(254) reportVerificationEmail: string;
  @ValidateNested() @Type(() => BankDetailsDto) bank: BankDetailsDto;
  @ValidateNested() @Type(() => AccreditationDto) accreditation: AccreditationDto;
  /** starts document numbers, e.g. SL in SL/TR/26-27/000001 */
  @IsString() @MaxLength(10) documentPrefix: string;
  @IsOptional() @IsString() @MaxLength(254) supportEmail: string | null;
  @IsOptional() @IsString() @MaxLength(40) supportPhone: string | null;
  @IsOptional() @IsString() @MaxLength(300) termsUrl: string | null;
  @IsOptional() @IsString() @MaxLength(300) privacyUrl: string | null;
  /** who answers privacy requests and grievances under the DPDP Act */
  @IsOptional() @IsString() @MaxLength(200) privacyContactName: string | null;
  @IsOptional() @IsString() @MaxLength(254) privacyContactEmail: string | null;
}

export class BrandingSettingsDto {
  /** the app's name in the browser tab, menus and emails; empty means BRAND_NAME */
  @IsOptional() @IsString() @MaxLength(60) appName: string | null;
  @IsString() primaryColor: string;
  @IsString() accentColor: string;
  @IsString() surfaceColor: string;
  @IsString() navColor: string;
  @IsOptional() @IsString() @MaxLength(160) loginTagline: string | null;
  @IsBoolean() poweredBy: boolean;
}

export class BrandingStateDto extends BrandingSettingsDto {
  logoFileId: string | null;
  faviconFileId: string | null;
  loginImageFileId: string | null;
}

export class SaveLabProfileDto {
  @IsInt() @Min(0) version: number;
  @ValidateNested() @Type(() => LabProfileDto) profile: LabProfileDto;
}

export class SaveBrandingDto {
  @IsInt() @Min(0) version: number;
  @ValidateNested() @Type(() => BrandingSettingsDto) branding: BrandingSettingsDto;
}

export class LabDetailsDto {
  @ApiProperty({ type: () => LabProfileDto }) profile: LabProfileDto;
  @ApiProperty({ type: () => BrandingStateDto }) branding: BrandingStateDto;
  /** the name in use: the branding's app name, or BRAND_NAME */
  productName: string;
  profileVersion: number;
  brandingVersion: number;
}

export class TemplateSummaryDto {
  id: string;
  name: string;
  description: string;
  tests: number;
  packages: number;
  /** regulatory limits that come with it, e.g. IS 10500 */
  specifications: string[];
  /** a few of its tests, to show what it holds */
  sample: string[];
}

export class ApplyTemplatesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) templates: string[];
}

export class ApplyTemplatesResultDto {
  /** how many of each kind of record were added */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) created: Record<string, number>;
  /** already there, so left as the lab has them */
  skipped: number;
}

export class SetupStepsDto {
  profile: boolean;
  branding: boolean;
  catalogue: boolean;
  team: boolean;
  email: boolean;
}

export class SetupStatusDetailDto {
  completed: boolean;
  @ApiProperty({ type: () => SetupStepsDto }) steps: SetupStepsDto;
}

export class TestEmailDto {
  @IsEmail() to: string;
}

export class TemplateVariableDto {
  name: string;
  description: string;
  example: string;
}

export class EmailTemplateDto {
  key: string;
  label: string;
  description: string;
  @ApiProperty({ type: () => [TemplateVariableDto] }) variables: TemplateVariableDto[];
  subject: string;
  body: string;
  defaultSubject: string;
  defaultBody: string;
  /** the lab has its own wording */
  customized: boolean;
}

export class EmailTemplateListDto {
  version: number;
  @ApiProperty({ type: () => [EmailTemplateDto] }) templates: EmailTemplateDto[];
}

export class EmailTemplateInputDto {
  @IsString() @MaxLength(200) subject: string;
  @IsString() @MaxLength(5000) body: string;
}

export class SaveEmailTemplateDto extends EmailTemplateInputDto {
  @IsInt() @Min(0) version: number;
}

export class EmailPreviewDto {
  subject: string;
  /** the whole email, in the lab's branded layout */
  html: string;
}

export class ModuleStateDto {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** what the server still needs before this module can be turned on; null when ready */
  @ApiProperty({ type: String, nullable: true }) setupNeeded: string | null;
}

export class ModuleListDto {
  version: number;
  @ApiProperty({ type: () => [ModuleStateDto] }) modules: ModuleStateDto[];
}

export class SaveModulesDto {
  @IsInt() @Min(0) version: number;
  /** module key -> on/off; modules not listed keep their state */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } }) @IsObject() enabled: Record<string, boolean>;
}
