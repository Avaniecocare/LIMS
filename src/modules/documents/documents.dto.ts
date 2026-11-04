import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDocumentDto {
  @IsString() @MaxLength(60)
  kind: string;

  @IsOptional() @IsObject()
  params?: Record<string, unknown>;
}

export class DocumentJobDto {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  /** short-lived signed link, present when done */
  url: string | null;
  filename: string | null;
}
