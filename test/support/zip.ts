import { inflateRawSync } from 'node:zlib';

/** Reads a ZIP from its central directory, as an unzip program would. */
export function readZip(b: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let end = b.length - 22;
  while (b.readUInt32LE(end) !== 0x06054b50) end--;
  let at = b.readUInt32LE(end + 16);
  for (let n = b.readUInt16LE(end + 10); n > 0; n--) {
    const [method, size, nameLen, extraLen, commentLen, local] = [
      b.readUInt16LE(at + 10),
      b.readUInt32LE(at + 20),
      b.readUInt16LE(at + 28),
      b.readUInt16LE(at + 30),
      b.readUInt16LE(at + 32),
      b.readUInt32LE(at + 42),
    ];
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + size);
    out[b.subarray(at + 46, at + 46 + nameLen).toString()] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
