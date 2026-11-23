import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class HelpAskDto {
  /** the visitor's question; the server's own limit (MAX_QUESTION_LENGTH) applies as well */
  @IsString() @MaxLength(4000) question: string;
  /** earlier turns of this conversation; only the last few are used */
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } }, required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** Cloudflare Turnstile token, for visitors who are not signed in when the check is on */
  @ApiProperty({ type: String, nullable: true, required: false }) @IsOptional() @IsString() @MaxLength(4096) turnstileToken?: string | null;
}

export class HelpFeedbackDto {
  @IsUUID() id: string;
  @IsBoolean() helpful: boolean;
}

export class HelpPageFeedbackDto {
  @IsString() @MaxLength(300) path: string;
  @IsBoolean() helpful: boolean;
}

export class HelpStatusDto {
  enabled: boolean;
  signedIn: boolean;
  requireLogin: boolean;
  maxQuestionLength: number;
  @ApiProperty({ type: String, nullable: true }) turnstileSiteKey: string | null;
  @ApiProperty({ type: String, nullable: true }) supportEmail: string | null;
}

export class HelpAnalyticsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

export class HelpDayDto {
  day: string;
  questions: number;
  /** US dollars */
  cost: number;
}
export class HelpQuestionCountDto {
  question: string;
  count: number;
}
export class HelpUnansweredDto {
  question: string;
  at: Date;
}
export class HelpSourceRefDto {
  url: string;
}
export class HelpNotHelpfulDto {
  @ApiProperty({ type: String, nullable: true }) question: string | null;
  @ApiProperty({ type: () => [HelpSourceRefDto] }) sources: HelpSourceRefDto[];
  at: Date;
}
export class HelpPageScoreDto {
  path: string;
  helpful: number;
  notHelpful: number;
}
export class HelpAnalyticsDto {
  days: number;
  enabled: boolean;
  model: string;
  @ApiProperty({ type: String, nullable: true }) fallbackModel: string | null;
  /** US dollars spent or held for answers being written, as the limits count it */
  spentToday: number;
  spentThisMonth: number;
  dailyBudget: number;
  monthlyBudget: number;
  /** count per outcome: ANSWERED, CACHED, NOT_FOUND, OFF_TOPIC, BLOCKED, RATE_LIMITED, CAPTCHA_FAILED, BUDGET_REACHED, ERROR, CANCELLED (the visitor left), TRUNCATED, REFUSED */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) outcomes: Record<string, number>;
  @ApiProperty({ type: () => [HelpDayDto] }) daily: HelpDayDto[];
  @ApiProperty({ type: () => [HelpQuestionCountDto] }) topQuestions: HelpQuestionCountDto[];
  @ApiProperty({ type: () => [HelpUnansweredDto] }) unanswered: HelpUnansweredDto[];
  @ApiProperty({ type: () => [HelpNotHelpfulDto] }) notHelpful: HelpNotHelpfulDto[];
  @ApiProperty({ type: () => [HelpPageScoreDto] }) pages: HelpPageScoreDto[];
}
