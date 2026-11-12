import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class CreateAccessRequestDto {
  /** the screen the person was trying to open, e.g. /invoices */
  @IsString() @Matches(/^\/[\w\-/]*$/) @MaxLength(200) page: string;
  @IsString() @Length(3, 1000) reason: string;
}

export class AccessRequestQuery extends PageQuery {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'DENIED']) status?: 'PENDING' | 'APPROVED' | 'DENIED';
}

export class ApproveAccessDto {
  @IsUUID() roleId: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class DenyAccessDto {
  @IsString() @Length(3, 1000) note: string;
}

export class AccessRequestDto {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  currentRoles: string[];
  page: string;
  reason: string;
  status: string;
  grantedRoleName: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}
export class AccessRequestPageDto {
  data: AccessRequestDto[];
  meta: PageMetaDto;
}

export class AccessReviewUserDto {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roles: string[];
  permissionCount: number;
  lastLoginAt: Date | null;
  /** holds user or role management */
  adminCapable: boolean;
  /** never signed in, or not for 90 days */
  dormant: boolean;
  locked: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
}
export class PermissionHoldersDto {
  code: string;
  module: string;
  description: string;
  holders: number;
}
export class AccessReviewDto {
  users: AccessReviewUserDto[];
  permissions: PermissionHoldersDto[];
  generatedAt: Date;
}
