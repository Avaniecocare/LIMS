import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { AddressKind } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class ContactInput {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(120) designation?: string | null;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class AddressInput {
  @IsOptional() @IsUUID() id?: string;
  @IsEnum(AddressKind) kind: AddressKind;
  @IsString() @Length(1, 200) line1: string;
  @IsOptional() @IsString() @MaxLength(200) line2?: string | null;
  @IsString() @Length(1, 80) city: string;
  @IsString() @Length(1, 80) stateName: string;
  @Matches(/^[0-9]{2}$/, { message: 'State code must be two digits' }) stateCode: string;
  @IsOptional() @Matches(/^[0-9]{6}$/, { message: 'PIN code must be six digits' }) pincode?: string | null;
}

export class CreateCustomerDto {
  @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(15) gstin?: string | null;
  @IsOptional() @IsString() @MaxLength(10) pan?: string | null;
  @IsString() @Length(1, 80) stateName: string;
  @Matches(/^[0-9]{2}$/, { message: 'State code must be two digits' }) stateCode: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) creditDays?: number;
  @IsOptional() @IsBoolean() withholdReportUntilPaid?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ContactInput) contacts?: ContactInput[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AddressInput) addresses?: AddressInput[];
}

export class UpdateCustomerDto extends CreateCustomerDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CustomerQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(5) active?: string;
  @IsOptional() @IsString() @MaxLength(2) stateCode?: string;
}

export class ContactDto {
  id: string; name: string; email: string | null; phone: string | null; designation: string | null; isPrimary: boolean;
}
export class AddressDto {
  id: string; kind: AddressKind; line1: string; line2: string | null; city: string; stateName: string; stateCode: string; pincode: string | null;
}
export class CustomerDto {
  id: string; crn: string; name: string; gstin: string | null; pan: string | null; stateName: string; stateCode: string; creditDays: number;
  withholdReportUntilPaid: boolean; notes: string | null; isActive: boolean; version: number; contacts: ContactDto[]; addresses: AddressDto[];
}
export class CustomerPageDto { data: CustomerDto[]; meta: PageMetaDto; }
