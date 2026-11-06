import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function greetingImageKey(siteId: string, ext: string): string {
  return `sites/${siteId}/greeting/${randomUUID()}.${ext}`;
}

export function kbObjectKey(siteId: string, sourceId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "file";
  return `sites/${siteId}/kb/${sourceId}/${safe}`;
}

class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const root = resolve(this.root);
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    await writeFile(`${p}.meta`, contentType);
  }

  async get(key: string) {
    const p = this.path(key);
    try {
      const [body, contentType] = await Promise.all([
        readFile(p),
        readFile(`${p}.meta`, "utf8").catch(() => "application/octet-stream"),
      ]);
      return { body: new Uint8Array(body), contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const p = this.path(key);
    await rm(p, { force: true });
    await rm(`${p}.meta`, { force: true });
  }
}

class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    });
    this.bucket = env.S3_BUCKET!;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return {
        body: await res.Body.transformToByteArray(),
        contentType: res.ContentType ?? "application/octet-stream",
      };
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const g = globalThis as unknown as { __storage?: Storage };

export function getStorage(): Storage {
  g.__storage ??= env.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage(env.STORAGE_LOCAL_DIR);
  return g.__storage;
}
