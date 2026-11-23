import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreateDocumentDto, DocumentJobDto } from './documents.dto.js';
import { SignedIn, WhenReadOnly } from '../auth/decorators.js';
import { DocumentsService } from './documents.service.js';

@ApiTags('documents')
@WhenReadOnly('PDFs and exports of what is already here')
@SignedIn('each document kind checks its own permission when queued, and a job is readable only by the person who asked for it')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Queue a PDF or Excel export; poll until status is DONE. */
  @Post()
  @ApiOkResponse({ type: DocumentJobDto })
  create(@Body() dto: CreateDocumentDto) {
    return this.documents.enqueueFromClient(dto.kind, dto.params ?? {});
  }

  @Get(':id')
  @ApiOkResponse({ type: DocumentJobDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.describe(id);
  }
}
