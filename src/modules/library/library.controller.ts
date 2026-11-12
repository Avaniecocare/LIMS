import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { OkDto } from '../auth/auth.dto.js';
import { Perm, RequireModule } from '../auth/decorators.js';
import { readUpload } from '../files/files.controller.js';
import { FileDto, SignedUrlDto } from '../files/files.dto.js';
import { FolderDto, FolderInput, FolderUpdateInput, LibraryFilePageDto, LibraryFileUpdate, LibraryQuery } from './library.dto.js';
import { LibraryService } from './library.service.js';

@ApiTags('library')
@RequireModule('files')
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('folders') @Perm('files.view') @ApiOkResponse({ type: [FolderDto] })
  folders() {
    return this.library.folders();
  }

  @Post('folders') @Perm('files.manage') @ApiOkResponse({ type: FolderDto })
  createFolder(@Body() dto: FolderInput) {
    return this.library.createFolder(dto);
  }

  @Patch('folders/:id') @Perm('files.manage') @ApiOkResponse({ type: FolderDto })
  updateFolder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FolderUpdateInput) {
    return this.library.updateFolder(id, dto);
  }

  @Delete('folders/:id') @Perm('files.manage') @ApiOkResponse({ type: OkDto })
  async removeFolder(@Param('id', ParseUUIDPipe) id: string) {
    await this.library.removeFolder(id);
    return { ok: true };
  }

  @Get('files') @Perm('files.view') @ApiOkResponse({ type: LibraryFilePageDto })
  list(@Query() q: LibraryQuery) {
    return this.library.list(q);
  }

  @Post('files') @Perm('files.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, folderId: { type: 'string' }, description: { type: 'string' }, entity: { type: 'string', enum: ['Customer', 'Job'] }, entityId: { type: 'string' } } } })
  @ApiOkResponse({ type: FileDto })
  async upload(@Req() req: FastifyRequest) {
    const f = await readUpload(req);
    return this.library.upload({ buffer: f.buffer, originalName: f.filename, folderId: f.field('folderId') || null, description: f.field('description')?.slice(0, 1000) ?? null, entity: f.field('entity') || null, entityId: f.field('entityId') || null });
  }

  @Patch('files/:id') @Perm('files.manage') @ApiOkResponse({ type: FileDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LibraryFileUpdate) {
    return this.library.update(id, dto);
  }

  @Delete('files/:id') @Perm('files.manage') @ApiOkResponse({ type: OkDto })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Query('reason') reason?: string) {
    await this.library.remove(id, reason?.slice(0, 500));
    return { ok: true };
  }

  @Get('files/:id/url') @Perm('files.view') @ApiOkResponse({ type: SignedUrlDto })
  url(@Param('id', ParseUUIDPipe) id: string) {
    return this.library.url(id);
  }
}

