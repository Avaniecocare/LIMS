import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { badRequest } from '../../common/errors.js';
import { SettingsService } from '../../core/settings.service.js';
import { OkDto } from '../auth/auth.dto.js';
import { Perm } from '../auth/decorators.js';
import {
  AdminResetPasswordDto,
  AuditEntryDto,
  AuditPageDto,
  AuditQuery,
  CompanyDetailsDto,
  CreateHolidayDto,
  CreateRoleDto,
  CreateSavedFilterDto,
  CreateTermsDto,
  CreateUserDto,
  HolidayDto,
  PermissionDto,
  RoleDto,
  SetSignatureDto,
  SavedFilterDto,
  SettingDto,
  TermsDto,
  UpdateRoleDto,
  UpdateSettingDto,
  UpdateUserDto,
  UserDto,
  UserListQuery,
  UserPageDto,
} from './admin.dto.js';
import { AdminService } from './admin.service.js';

void AuditEntryDto;

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly settings: SettingsService,
  ) {}

  @Get('users') @Perm('admin.users') @ApiOkResponse({ type: UserPageDto })
  listUsers(@Query() q: UserListQuery) {
    return this.admin.listUsers(q);
  }

  @Get('users/:id') @Perm('admin.users') @ApiOkResponse({ type: UserDto })
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getUser(id);
  }

  @Post('users') @Perm('admin.users') @ApiOkResponse({ type: UserDto })
  createUser(@Body() dto: CreateUserDto) {
    return this.admin.createUser(dto);
  }

  @Patch('users/:id') @Perm('admin.users') @ApiOkResponse({ type: UserDto })
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.admin.updateUser(id, dto);
  }

  @Post('users/:id/reset-password') @HttpCode(200) @Perm('admin.users') @ApiOkResponse({ type: OkDto })
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminResetPasswordDto) {
    await this.admin.adminResetPassword(id, dto.newPassword);
    return { ok: true };
  }

  /** The image printed on reports this person signs. */
  @Post('users/:id/signature') @HttpCode(200) @Perm('admin.users') @ApiOkResponse({ type: UserDto })
  signature(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSignatureDto) {
    return this.admin.setUserSignature(id, dto.fileId, dto.version);
  }

  @Get('permissions') @Perm('admin.roles') @ApiOkResponse({ type: [PermissionDto] })
  permissions() {
    return this.admin.listPermissions();
  }

  @Get('roles') @Perm('admin.roles', 'admin.users') @ApiOkResponse({ type: [RoleDto] })
  roles() {
    return this.admin.listRoles();
  }

  @Post('roles') @Perm('admin.roles') @ApiOkResponse({ type: RoleDto })
  createRole(@Body() dto: CreateRoleDto) {
    return this.admin.createRole(dto);
  }

  @Patch('roles/:id') @Perm('admin.roles') @ApiOkResponse({ type: RoleDto })
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.admin.updateRole(id, dto);
  }

  @Get('settings') @Perm('admin.settings') @ApiOkResponse({ type: [SettingDto] })
  listSettings() {
    return this.settings.all();
  }

  @Put('settings/:key') @Perm('admin.settings') @ApiOkResponse({ type: [SettingDto] })
  async updateSetting(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    await this.settings.set(key, dto.value, dto.version, dto.reason);
    return this.settings.all();
  }

  @Get('terms') @Perm('admin.settings') @ApiOkResponse({ type: [TermsDto] })
  terms(@Query('kind') kind?: string) {
    if (!kind) return this.admin.latestTerms();
    if (kind !== 'QUOTATION' && kind !== 'INVOICE' && kind !== 'REPORT') throw badRequest('Unknown terms kind');
    return this.admin.termsHistory(kind);
  }

  @Post('terms') @Perm('admin.settings') @ApiOkResponse({ type: TermsDto })
  addTerms(@Body() dto: CreateTermsDto) {
    return this.admin.addTerms(dto.kind, dto.body);
  }

  @Get('holidays') @Perm('admin.settings') @ApiOkResponse({ type: [HolidayDto] })
  holidays() {
    return this.admin.listHolidays();
  }

  @Post('holidays') @Perm('admin.settings') @ApiOkResponse({ type: HolidayDto })
  addHoliday(@Body() dto: CreateHolidayDto) {
    return this.admin.addHoliday(dto.date, dto.name);
  }

  @Delete('holidays/:id') @Perm('admin.settings') @ApiOkResponse({ type: OkDto })
  async removeHoliday(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.removeHoliday(id);
    return { ok: true };
  }

  @Get('audit') @Perm('admin.audit') @ApiOkResponse({ type: AuditPageDto })
  audit(@Query() q: AuditQuery) {
    return this.admin.listAudit(q);
  }

  @Get('company') @Perm('admin.company.view') @ApiOkResponse({ type: CompanyDetailsDto })
  company() {
    return this.admin.companyDetails();
  }
}

/** Saved filters belong to the signed-in user; no special permission needed. */
@ApiTags('me')
@Controller('me/saved-filters')
export class SavedFiltersController {
  constructor(private readonly admin: AdminService) {}

  @Get() @ApiOkResponse({ type: [SavedFilterDto] })
  list(@Query('screen') screen: string) {
    return this.admin.listSavedFilters(screen ?? '');
  }

  @Post() @ApiOkResponse({ type: SavedFilterDto })
  create(@Body() dto: CreateSavedFilterDto) {
    return this.admin.createSavedFilter(dto);
  }

  @Delete(':id') @ApiOkResponse({ type: OkDto })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.deleteSavedFilter(id);
    return { ok: true };
  }
}
