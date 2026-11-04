import { IsDateString, IsOptional } from 'class-validator';

export class DashboardQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

/** One figure; `link` leads to the records behind it. */
export class MetricDto { key: string; label: string; value: number; display: string | null; link: string | null; }
export class ChartPointDto { label: string; value: number; link: string | null; }
export class ChartSeriesPointDto { label: string; billed: number; collected: number; }
export class ReasonCountDto { reason: string; count: number; }

export class OperationsDto {
  metrics: MetricDto[];
  samplesByStatus: ChartPointDto[];
  testsByStage: ChartPointDto[];
}
export class QualityDto { metrics: MetricDto[]; rejectionReasons: ReasonCountDto[]; }
export class PeopleDto { byTechnician: ChartPointDto[]; byInstrument: ChartPointDto[]; calibrationsDue: { id: string; name: string; dueDate: Date; overdue: boolean }[]; }
export class CommercialDto {
  metrics: MetricDto[];
  billedVsCollected: ChartSeriesPointDto[];
  ageing: ChartPointDto[];
  topCustomers: ChartPointDto[];
  topTests: ChartPointDto[];
}
export class WorkItemDto { key: string; label: string; count: number; link: string; }
export class DashboardDto {
  from: string; to: string;
  operations: OperationsDto | null;
  quality: QualityDto | null;
  people: PeopleDto | null;
  commercial: CommercialDto | null;
  myWork: WorkItemDto[];
}
