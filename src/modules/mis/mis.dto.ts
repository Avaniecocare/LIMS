import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class MisQuery extends PageQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() technicianId?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
}

export class MisColumnDto { key: string; label: string; type: string; }
export class MisCatalogItemDto { key: string; no: number; title: string; group: string; filters: string[]; columns: MisColumnDto[]; }
export class MisResultDto {
  key: string; title: string; columns: MisColumnDto[];
  /** each row is keyed by column key */
  data: Record<string, unknown>[];
  meta: PageMetaDto;
}
