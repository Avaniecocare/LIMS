import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreateDocumentDto, DocumentJobDto } from './documents.dto.js';
import { DocumentsService } from './documents.service.js';

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Queue a PDF or Excel export; poll until status is DONE. */
  @Post() @ApiOkResponse({ type: DocumentJobDto })
  create(@Body() dto: CreateDocumentDto) {
    return this.documents.enqueue(dto.kind, dto.params ?? {});
  }

  @Get(':id') @ApiOkResponse({ type: DocumentJobDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.describe(id);
  }
}
