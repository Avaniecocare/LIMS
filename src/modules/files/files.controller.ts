import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { badRequest } from '../../common/errors.js';
import { OkDto } from '../auth/auth.dto.js';
import { FileDto, SignedUrlDto } from './files.dto.js';
import { FilesService } from './files.service.js';

/** Reads a single-file multipart body into memory; the size limit is enforced by the plugin. */
export async function readUpload(req: FastifyRequest) {
  const part = await (req as unknown as { file: () => Promise<{ toBuffer(): Promise<Buffer>; filename: string; mimetype: string; fields: Record<string, { value?: string } | undefined> } | undefined> }).file();
  if (!part) throw badRequest('No file was sent', [{ field: 'file', message: 'Required' }]);
  const field = (name: string) => part.fields[name]?.value;
  return { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype, field };
}

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'entity', 'entityId', 'category'], properties: { file: { type: 'string', format: 'binary' }, entity: { type: 'string' }, entityId: { type: 'string' }, category: { type: 'string' }, caption: { type: 'string' }, printWidthMm: { type: 'integer' }, printHeightMm: { type: 'integer' } } } })
  @ApiOkResponse({ type: FileDto })
  async upload(@Req() req: FastifyRequest) {
    const f = await readUpload(req);
    const num = (name: string) => {
      const v = f.field(name);
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 400) throw badRequest(`${name} must be between 1 and 400`, [{ field: name, message: 'Between 1 and 400' }]);
      return n;
    };
    return this.files.upload({
      buffer: f.buffer,
      originalName: f.filename,
      mimeType: f.mimetype,
      category: (f.field('category') ?? 'attachment').replace(/[^\w-]/g, '').slice(0, 40) || 'attachment',
      entity: f.field('entity'),
      entityId: f.field('entityId'),
      caption: f.field('caption')?.slice(0, 200),
      printWidthMm: num('printWidthMm'),
      printHeightMm: num('printHeightMm'),
    });
  }

  @Get() @ApiOkResponse({ type: [FileDto] })
  list(@Query('entity') entity: string, @Query('entityId') entityId: string, @Query('category') category?: string) {
    return this.files.list(entity, entityId, category);
  }

  @Get(':id/url') @ApiOkResponse({ type: SignedUrlDto })
  url(@Param('id', ParseUUIDPipe) id: string) {
    return this.files.url(id);
  }

  @Delete(':id') @ApiOkResponse({ type: OkDto })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Query('reason') reason?: string) {
    await this.files.remove(id, reason);
    return { ok: true };
  }
}
