import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class NotificationQuery extends PageQuery {
  @IsOptional() @IsBoolean() unreadOnly?: boolean;
}
export class NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}
export class NotificationPageDto {
  data: NotificationDto[];
  meta: PageMetaDto;
  unread: number;
}
export class PreferenceDto {
  type: string;
  label: string;
  email: boolean;
}
export class UpdatePreferencesDto {
  /** notification type -> send email */
  @IsObject() preferences: Record<string, boolean>;
}
