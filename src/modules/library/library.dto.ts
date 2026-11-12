import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class LibraryQuery extends PageQuery {
  /** library: the lab's own documents (default); system: files the system made or attached; all: both */
  @IsOptional() @IsIn(['library', 'system', 'all']) scope?: 'library' | 'system' | 'all';
  /** a folder id, or "none" for files not in any folder */
  @IsOptional() @Matches(/^(none|[0-9a-f-]{36})$/) folderId?: string;
  @IsOptional() @IsString() @MaxLength(40) entity?: string;
  @IsOptional() @IsUUID() entityId?: string;
}

export class FolderInput {
  @IsString() @Length(1, 120) name: string;
  @IsOptional() @IsUUID() parentId?: string | null;
}

export class FolderUpdateInput extends FolderInput {
  @IsInt() @Min(1) version: number;
}

export class LibraryFileUpdate {
  @IsOptional() @IsString() @Length(1, 200) originalName?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsUUID() folderId?: string | null;
  @IsOptional() @IsIn(['Customer', 'Job']) entity?: string | null;
  @IsOptional() @IsUUID() entityId?: string | null;
}

export class FolderDto { id: string; name: string; parentId: string | null; fileCount: number; version: number; }

export class LibraryFileDto {
  id: string; originalName: string; mimeType: string; sizeBytes: number; category: string; entity: string | null; entityId: string | null;
  /** e.g. "Job LAB/JOB/26-27/00001" or "Example Industries (CRN-00001)" */
  entityLabel: string | null; folderId: string | null; folderName: string | null; description: string | null; createdAt: Date; createdByName: string | null;
  /** library files the caller may rename, move or remove */
  canEdit: boolean;
}

export class LibraryFilePageDto { data: LibraryFileDto[]; meta: PageMetaDto; }
