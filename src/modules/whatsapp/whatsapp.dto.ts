import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class WhatsappSendDto {
  @ApiProperty({ enum: ['report', 'invoice', 'acknowledgement', 'reminder'] })
  @IsIn(['report', 'invoice', 'acknowledgement', 'reminder'])
  kind: 'report' | 'invoice' | 'acknowledgement' | 'reminder';
  /** the report, invoice or job */
  @IsUUID() entityId: string;
  /** a mobile number; Indian numbers may be written without +91 */
  @IsString() @Length(8, 24) to: string;
  /** the person the message greets; "Sir/Madam" when left out */
  @IsOptional() @IsString() @Length(1, 80) contactName?: string | null;
  /** the person sending confirms the customer agreed to get messages from the lab on WhatsApp */
  @ApiProperty({ enum: [true] }) @IsBoolean() @Equals(true, { message: 'Confirm the customer agreed to WhatsApp messages' }) consent: boolean;
  /** acknowledgement only: photos of the samples to print on the letter */
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsUUID('all', { each: true }) photoIds?: string[];
}

export class WhatsappMessageDto {
  id: string;
  toNumber: string;
  kind: string;
  template: string;
  @ApiProperty({ enum: ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'] }) status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  attempts: number;
  @ApiProperty({ type: String, nullable: true }) lastError: string | null;
  @ApiProperty({ type: String, nullable: true }) documentName: string | null;
  @ApiProperty({ type: String, nullable: true }) entity: string | null;
  @ApiProperty({ type: String, nullable: true }) entityId: string | null;
  createdAt: Date;
  @ApiProperty({ type: Date, nullable: true }) sentAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) deliveredAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) readAt: Date | null;
}

export class WhatsappContactDto {
  name: string;
  phone: string;
}

export class WhatsappPanelDto {
  /** WhatsApp is set up and turned on */
  available: boolean;
  /** the customer's contacts that have a phone number, primary first */
  @ApiProperty({ type: () => [WhatsappContactDto] }) contacts: WhatsappContactDto[];
  @ApiProperty({ type: () => [WhatsappMessageDto] }) messages: WhatsappMessageDto[];
}

export class WhatsappValueDto {
  key: string;
  label: string;
}

export class WhatsappTemplateDto {
  key: string;
  label: string;
  /** the template's header is a document (the PDF) */
  document: boolean;
  /** the values this message can carry */
  @ApiProperty({ type: () => [WhatsappValueDto] }) available: WhatsappValueDto[];
  name: string;
  language: string;
  /** keys of the values {{1}}, {{2}}... receive, in order */
  values: string[];
}

export class WhatsappSettingsDto {
  configured: boolean;
  enabled: boolean;
  /** "cloud" sends through Meta; "json" only records messages (development) */
  @ApiProperty({ type: String, nullable: true }) transport: string | null;
  /** last four digits of the WhatsApp phone number id, to tell accounts apart */
  @ApiProperty({ type: String, nullable: true }) phoneNumberIdHint: string | null;
  /** delivered and read receipts are coming in (Meta's webhook is set up) */
  receipts: boolean;
  /** the callback URL to enter in Meta's app settings */
  webhookUrl: string;
  version: number;
  @ApiProperty({ type: () => [WhatsappTemplateDto] }) templates: WhatsappTemplateDto[];
  @ApiProperty({ type: () => [WhatsappMessageDto] }) recent: WhatsappMessageDto[];
}

export class WhatsappTemplateInputDto {
  @IsString() @Length(1, 512) name: string;
  @IsString() @Length(2, 8) language: string;
  values: string[];
}

export class SaveWhatsappTemplatesDto {
  @IsInt() @Min(0) version: number;
  /** message key -> template name and language */
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: { name: { type: 'string' }, language: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } },
      required: ['name', 'language', 'values'],
    },
  })
  @IsObject()
  templates: Record<string, WhatsappTemplateInputDto>;
}

export class WhatsappTestDto {
  @IsString() @Length(8, 24) to: string;
}
