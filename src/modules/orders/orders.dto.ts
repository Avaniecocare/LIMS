import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../common/pagination.dto.js';
import { OrderSource, OrderStage } from '../../generated/prisma/client.js';
import { PageMetaDto } from '../admin/admin.dto.js';

export class CreateOrderDto {
  @IsUUID() customerId: string;
  @IsEnum(OrderSource) source: OrderSource;
  @IsOptional() @IsString() @MaxLength(200) reference?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsDateString() receivedOn: string;
  @IsOptional() @IsUUID() ownerId?: string | null;
}

export class UpdateOrderDto extends CreateOrderDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsEnum(OrderStage) stage?: OrderStage;
}

export class OrderQuery extends PageQuery {
  @IsOptional() @IsEnum(OrderStage) stage?: OrderStage;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class OrderDto {
  id: string; orderNo: string; customerId: string; customerName: string; source: OrderSource; reference: string | null; description: string | null;
  receivedOn: Date; stage: OrderStage; ownerId: string | null; ownerName: string | null; version: number; createdAt: Date; quotationCount: number;
}
export class OrderPageDto { data: OrderDto[]; meta: PageMetaDto; }
export class PipelineStageDto { stage: OrderStage; count: number; }
export class OwnerDto { id: string; name: string; }
