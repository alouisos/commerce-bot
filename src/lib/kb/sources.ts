import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, kbSources, sites, type KbSource } from "@/db/schema";
import { NotFoundError, PlanLimitError, ValidationError } from "@/lib/errors";
import { sniffImageType } from "@/lib/files";
import { enqueue, JOBS } from "@/lib/jobs";
import { planStatus } from "@/lib/plans";
import { getStorage, kbObjectKey } from "@/lib/storage";
import { clearPromptCache } from "@/lib/prompts/cache";

const MB = 1024 ** 2;
export const MAX_DOCUMENT_BYTES = 20 * MB;
export const MAX_IMAGE_BYTES = 5 * MB;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCUMENT_TYPES = new Set(["application/pdf", DOCX, "text/plain", "text/markdown"]);

export async function accountStorageUsed(accountId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${kbSources.bytes}), 0)::bigint` })
    .from(kbSources)
    .innerJoin(sites, eq(sites.id, kbSources.siteId))
    .where(eq(sites.accountId, accountId));
  return Number(row?.total ?? 0);
}

async function checkStorage(siteId: string, addBytes: number): Promise<void> {
  const [row] = await db
    .select({ account: accounts })
    .from(sites)
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(eq(sites.id, siteId));
  if (!row) throw new NotFoundError("Site not found");
  const { limits } = planStatus(row.account, new Date());
  const used = await accountStorageUsed(row.account.id);
  if (used + addBytes > limits.storageBytes) throw new PlanLimitError("Storage limit reached for your plan");
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
}

function documentType(file: File): string | null {
  const name = file.name.toLowerCase();
  if (DOCUMENT_TYPES.has(file.type)) return file.type;
  if (name.endsWith(".md") && (file.type === "" || file.type === "text/x-markdown")) return "text/markdown";
  return null;
}

/** Inserts a pending row, stores the object, then enqueues ingestion. */
async function createSource(
  siteId: string,
  values: { kind: "document" | "image" | "text"; title: string; mimeType: string; caption?: string | null },
  filename: string,
  body: Uint8Array,
): Promise<KbSource> {
  await checkStorage(siteId, body.byteLength);
  const [source] = await db
    .insert(kbSources)
    .values({ siteId, ...values, bytes: body.byteLength, status: "pending" })
    .returning();
  const key = kbObjectKey(siteId, source.id, filename);
  try {
    await getStorage().put(key, body, values.mimeType);
  } catch (err) {
    await db.delete(kbSources).where(eq(kbSources.id, source.id));
    throw err;
  }
  const [updated] = await db
    .update(kbSources)
    .set({ storageKey: key })
    .where(eq(kbSources.id, source.id))
    .returning();
  await enqueue(JOBS.ingestSource, { sourceId: source.id });
  return updated;
}

export async function addDocument(siteId: string, file: File): Promise<KbSource> {
  const mimeType = documentType(file);
  if (!mimeType) throw new ValidationError("Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.");
  if (file.size === 0) throw new ValidationError("The file is empty");
  if (file.size > MAX_DOCUMENT_BYTES) throw new ValidationError("Documents can be up to 20 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (mimeType === "application/pdf" && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    throw new ValidationError("This file is not a valid PDF");
  }
  if (mimeType === DOCX && !startsWith(bytes, [0x50, 0x4b])) {
    throw new ValidationError("This file is not a valid DOCX document");
  }
  return createSource(siteId, { kind: "document", title: file.name, mimeType }, file.name, bytes);
}

export async function addImage(siteId: string, file: File, caption?: string): Promise<KbSource> {
  if (file.size === 0) throw new ValidationError("The file is empty");
  if (file.size > MAX_IMAGE_BYTES) throw new ValidationError("Images can be up to 5 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw new ValidationError("Images must be PNG, JPEG, WEBP or GIF");
  if (file.type !== sniffed) throw new ValidationError("The file content does not match its type");
  const cleanCaption = caption?.trim().slice(0, 300) || null;
  return createSource(
    siteId,
    { kind: "image", title: file.name, mimeType: sniffed, caption: cleanCaption },
    file.name,
    bytes,
  );
}

export async function addText(siteId: string, input: { title: string; text: string }): Promise<KbSource> {
  const title = input.title.trim();
  const text = input.text.trim();
  if (title.length < 1 || title.length > 200) throw new ValidationError("Title must be 1 to 200 characters");
  if (text.length < 1 || text.length > 100_000) throw new ValidationError("Text must be 1 to 100,000 characters");
  const body = new TextEncoder().encode(text);
  return createSource(siteId, { kind: "text", title, mimeType: "text/plain" }, "text.txt", body);
}

async function ownedSource(siteId: string, sourceId: string): Promise<KbSource> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(sourceId)) throw new NotFoundError("Source not found");
  const [row] = await db
    .select()
    .from(kbSources)
    .where(and(eq(kbSources.id, sourceId), eq(kbSources.siteId, siteId)));
  if (!row) throw new NotFoundError("Source not found");
  return row;
}

export async function deleteSource(siteId: string, sourceId: string): Promise<void> {
  const source = await ownedSource(siteId, sourceId);
  await db.delete(kbSources).where(eq(kbSources.id, source.id));
  await clearPromptCache(siteId);
  if (source.storageKey) await getStorage().delete(source.storageKey);
}

export async function setExcluded(siteId: string, sourceId: string, excluded: boolean): Promise<void> {
  const source = await ownedSource(siteId, sourceId);
  await db.update(kbSources).set({ excluded }).where(eq(kbSources.id, source.id));
  await clearPromptCache(siteId);
}

export async function getSource(siteId: string, sourceId: string): Promise<KbSource> {
  return ownedSource(siteId, sourceId);
}
