import { type ObjectStorage } from '@integrations/s3/object-storage.port';

/** The bytes of a stored object (uploaded bank files, statements, settlement reports). */
export async function readObject(storage: ObjectStorage, key: string): Promise<Buffer> {
  const stream = await storage.getStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
