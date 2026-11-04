export class FileDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  category: string;
  entity: string | null;
  entityId: string | null;
  printWidthMm: number | null;
  printHeightMm: number | null;
  caption: string | null;
  createdAt: Date;
}

export class SignedUrlDto {
  url: string;
  expiresInSeconds: number;
  originalName: string;
  mimeType: string;
}
