import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const MAX_PAGE_SIZE = 200;

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE)
  pageSize?: number = 25;

  @IsOptional() @IsString() @MaxLength(120)
  sort?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional() @IsString() @MaxLength(200)
  q?: string;
}

/** Keep generic Page<T> shape identical across endpoints. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export const skipTake = (q: PageQuery) => {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 25;
  return { skip: (page - 1) * pageSize, take: pageSize };
};

export function toPage<T>(data: T[], total: number, q: PageQuery): Page<T> {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 25;
  return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

/**
 * Sort only on allow-listed columns: `sort` comes from the client and must never
 * reach Prisma unchecked.
 */
export function orderBy<K extends string>(q: PageQuery, allowed: readonly K[], fallback: K, dir: 'asc' | 'desc' = 'desc') {
  const key = allowed.includes(q.sort as K) ? (q.sort as K) : fallback;
  const order = q.order ?? (key === fallback ? dir : 'asc');
  return { [key]: order } as Record<K, 'asc' | 'desc'>;
}
