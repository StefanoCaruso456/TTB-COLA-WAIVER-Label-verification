// Disk-backed FileStorage implementation. Works against any mountable directory:
// local temp dirs in tests, project-local `.local/batch-files` in dev, and a
// Railway Volume mount in production. The code doesn't care which.
//
// Path layout (sharded by hash and date to keep directory cardinality sane):
//   <root>/<yyyy>/<mm>/<dd>/<hash[0..2]>/<hash>
//
// See docs/specs/phase-2-data-model-and-storage.md.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  type FileStorage,
  type PutFileInput,
  type StoredFileMetadata,
  FileNotFoundError,
  FileStorageWriteError,
} from "./file-storage";

export class LocalDiskFileStorage implements FileStorage {
  private readonly root: string;
  /** Cache of "yyyy/mm/dd/xx" → resolved path for the hash. Lookup avoids redundant date math. */
  private readonly pathCache = new Map<string, string>();

  constructor(root: string) {
    if (!root || typeof root !== "string") {
      throw new FileStorageWriteError(
        "LocalDiskFileStorage requires a non-empty root directory.",
      );
    }
    this.root = resolve(root);
  }

  async put(input: PutFileInput): Promise<StoredFileMetadata> {
    const hash = sha256(input.buffer);
    const storageKey = hash;
    const filePath = this.resolvePath(storageKey);

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, input.buffer);
    } catch (err) {
      throw new FileStorageWriteError(
        `Failed to write file at ${filePath}.`,
        err,
      );
    }

    return {
      storageKey,
      size: input.buffer.byteLength,
      mimeType: input.mimeType,
      hash,
    };
  }

  async getBuffer(storageKey: string): Promise<Buffer> {
    const filePath = this.resolvePath(storageKey);
    try {
      return await readFile(filePath);
    } catch (err) {
      if (isENOENT(err)) {
        throw new FileNotFoundError(storageKey);
      }
      throw new FileStorageWriteError(
        `Failed to read file at ${filePath}.`,
        err,
      );
    }
  }

  async delete(storageKey: string): Promise<void> {
    const filePath = this.resolvePath(storageKey);
    try {
      await unlink(filePath);
    } catch (err) {
      if (isENOENT(err)) return; // idempotent
      throw new FileStorageWriteError(
        `Failed to delete file at ${filePath}.`,
        err,
      );
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const filePath = this.resolvePath(storageKey);
    try {
      await stat(filePath);
      return true;
    } catch (err) {
      if (isENOENT(err)) return false;
      // Other errors (EACCES etc.) — be conservative and report not present;
      // a subsequent operation will surface the real error.
      return false;
    }
  }

  /**
   * Resolves the on-disk path for a hash. Pure (uses today's UTC date), but
   * cached so repeated lookups within a request don't recompute date strings.
   */
  private resolvePath(hash: string): string {
    const cached = this.pathCache.get(hash);
    if (cached) return cached;

    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      throw new FileStorageWriteError(
        `Invalid storage key (expected 64-char sha256 hex): ${hash}`,
      );
    }

    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const shard = hash.slice(0, 2);
    const path = join(this.root, yyyy, mm, dd, shard, hash);
    this.pathCache.set(hash, path);
    return path;
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isENOENT(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
