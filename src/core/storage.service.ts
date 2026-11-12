import { createHash, randomUUID } from 'node:crypto';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { actorId } from '../common/context.js';
import { badRequest, notFound } from '../common/errors.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';
import { PrismaService, type Tx } from './prisma.service.js';

export const SIGNED_URL_SECONDS = 300;

/** Upload allow-list, checked against file content rather than the client's claimed type. */
const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString() === '%PDF-' },
];

export function sniffMime(buffer: Buffer): string | null {
  return SIGNATURES.find((s) => s.test(buffer))?.mime ?? null;
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The file library also takes Word, Excel and CSV documents (SOPs, certificates, price lists). Checked by
 * content: an Office file is a ZIP holding its own part names; a CSV must be plain UTF-8 text with commas.
 */
export function sniffLibraryMime(buffer: Buffer, filename: string): string | null {
  const basic = sniffMime(buffer);
  if (basic) return basic;
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (isZip && buffer.includes('[Content_Types].xml')) {
    if (buffer.includes('word/document.xml') || buffer.includes('word/')) return DOCX_MIME;
    if (buffer.includes('xl/workbook.xml') || buffer.includes('xl/')) return XLSX_TYPE;
    return null;
  }
  if (/\.csv$/i.test(filename) && !buffer.includes(0)) {
    const text = buffer.subarray(0, 4096).toString('utf8');
    if (!text.includes('\uFFFD') && text.includes(',')) return 'text/csv';
  }
  return null;
}

export interface StoreInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  category: string;
  entity?: string | null;
  entityId?: string | null;
  printWidthMm?: number | null;
  printHeightMm?: number | null;
  caption?: string | null;
}

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  /** Signs URLs with the address browsers can reach, which may differ from the internal one. */
  private readonly signer: S3Client;
  private bucketChecked = false;

  constructor(
    @Inject(INFRA_CONFIG) private readonly cfg: InfraConfig,
    private readonly prisma: PrismaService,
  ) {
    const client = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: cfg.s3.region,
        forcePathStyle: cfg.s3.forcePathStyle,
        credentials: { accessKeyId: cfg.s3.accessKey, secretAccessKey: cfg.s3.secretKey },
      });
    this.s3 = client(cfg.s3.endpoint);
    this.signer = client(cfg.s3.publicEndpoint ?? cfg.s3.endpoint);
  }

  async ensureBucket(): Promise<void> {
    if (this.bucketChecked) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.cfg.s3.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.cfg.s3.bucket }));
    }
    this.bucketChecked = true;
  }

  /** User uploads: validates size and real content type before storing. */
  async storeUpload(input: StoreInput, tx?: Tx) {
    if (input.buffer.length === 0) throw badRequest('The file is empty', [{ field: 'file', message: 'The file is empty' }]);
    if (input.buffer.length > this.cfg.maxUploadBytes) throw badRequest('The file is too large', [{ field: 'file', message: 'The file is too large' }]);
    const sniffed = sniffMime(input.buffer);
    if (!sniffed) throw badRequest('Only PNG, JPEG, WebP and PDF files are accepted', [{ field: 'file', message: 'Unsupported file type' }]);
    return this.store({ ...input, mimeType: sniffed }, tx);
  }

  /** File library uploads: also Word, Excel and CSV, still checked by content and size. */
  async storeLibraryUpload(input: StoreInput, tx?: Tx) {
    if (input.buffer.length === 0) throw badRequest('The file is empty', [{ field: 'file', message: 'The file is empty' }]);
    if (input.buffer.length > this.cfg.maxUploadBytes) throw badRequest('The file is too large', [{ field: 'file', message: 'The file is too large' }]);
    const sniffed = sniffLibraryMime(input.buffer, input.originalName);
    if (!sniffed) throw badRequest('Only PDF, images (PNG, JPEG, WebP), Word, Excel and CSV files are accepted', [{ field: 'file', message: 'Unsupported file type' }]);
    return this.store({ ...input, mimeType: sniffed }, tx);
  }

  /** System-generated files (PDF, Excel). */
  async store(input: StoreInput, tx?: Tx) {
    await this.ensureBucket();
    const storageKey = `${input.category}/${new Date().getFullYear()}/${randomUUID()}`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.cfg.s3.bucket, Key: storageKey, Body: input.buffer, ContentType: input.mimeType }));
    return (tx ?? this.prisma).fileObject.create({
      data: {
        storageKey,
        originalName: input.originalName.replace(/[^\w.\- ()]/g, '_').slice(0, 200),
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        sha256: createHash('sha256').update(input.buffer).digest('hex'),
        category: input.category,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        printWidthMm: input.printWidthMm ?? null,
        printHeightMm: input.printHeightMm ?? null,
        caption: input.caption ?? null,
        createdById: actorId(),
      },
    });
  }

  async read(fileId: string): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) throw notFound('File');
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.s3.bucket, Key: file.storageKey }));
    const bytes = await res.Body!.transformToByteArray();
    return { buffer: Buffer.from(bytes), mimeType: file.mimeType, originalName: file.originalName };
  }

  /** Files stay private; access is only through short-lived signed URLs. */
  async signedUrl(fileId: string): Promise<{ url: string; expiresInSeconds: number; originalName: string; mimeType: string }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw notFound('File');
    const url = await getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.cfg.s3.bucket,
        Key: file.storageKey,
        // PDFs and images open in the browser; anything else (Word, Excel, CSV) downloads.
        ResponseContentDisposition: `${/^(application\/pdf|image\/)/.test(file.mimeType) ? 'inline' : 'attachment'}; filename="${file.originalName}"`,
      }),
      { expiresIn: SIGNED_URL_SECONDS },
    );
    return { url, expiresInSeconds: SIGNED_URL_SECONDS, originalName: file.originalName, mimeType: file.mimeType };
  }
}
