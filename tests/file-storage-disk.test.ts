import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";

import {
  FileNotFoundError,
  FileStorageWriteError,
} from "@/lib/services/file-storage";
import { LocalDiskFileStorage } from "@/lib/services/file-storage-disk";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("LocalDiskFileStorage", () => {
  let root: string;
  let storage: LocalDiskFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ttb-file-storage-"));
    storage = new LocalDiskFileStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("puts_and_gets_round_trip", async () => {
    const buffer = Buffer.alloc(1024 * 1024, 7); // 1 MB
    const meta = await storage.put({ buffer, mimeType: "image/jpeg" });
    expect(meta.size).toBe(buffer.byteLength);
    expect(meta.mimeType).toBe("image/jpeg");
    expect(meta.hash).toBe(sha256(buffer));
    expect(meta.storageKey).toBe(meta.hash);

    const got = await storage.getBuffer(meta.storageKey);
    expect(got.equals(buffer)).toBe(true);
  });

  it("path_uses_sharded_layout", async () => {
    const buffer = Buffer.from("hello world");
    const meta = await storage.put({ buffer, mimeType: "text/plain" });
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const shard = meta.hash.slice(0, 2);
    const expected = join(root, yyyy, mm, dd, shard, meta.hash);
    // stat throws if path doesn't exist
    const s = await stat(expected);
    expect(s.isFile()).toBe(true);
    expect(expected.split(sep).slice(-5)).toEqual([yyyy, mm, dd, shard, meta.hash]);
  });

  it("exists_returns_false_for_unknown_key", async () => {
    const unknown = sha256(Buffer.from("not stored"));
    expect(await storage.exists(unknown)).toBe(false);
  });

  it("exists_returns_true_after_put", async () => {
    const meta = await storage.put({
      buffer: Buffer.from("abc"),
      mimeType: "text/plain",
    });
    expect(await storage.exists(meta.storageKey)).toBe(true);
  });

  it("delete_is_idempotent", async () => {
    const unknown = sha256(Buffer.from("never stored"));
    await expect(storage.delete(unknown)).resolves.toBeUndefined();
  });

  it("delete_actually_removes_the_file", async () => {
    const meta = await storage.put({
      buffer: Buffer.from("delete me"),
      mimeType: "text/plain",
    });
    expect(await storage.exists(meta.storageKey)).toBe(true);
    await storage.delete(meta.storageKey);
    expect(await storage.exists(meta.storageKey)).toBe(false);
  });

  it("getBuffer_throws_FileNotFoundError_on_missing_key", async () => {
    const unknown = sha256(Buffer.from("missing"));
    await expect(storage.getBuffer(unknown)).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });

  it("put_returns_correct_hash", async () => {
    const buffer = randomBytes(4096);
    const meta = await storage.put({ buffer, mimeType: "application/octet-stream" });
    expect(meta.hash).toBe(sha256(buffer));
  });

  it("put_records_correct_size", async () => {
    const buffer = Buffer.alloc(7777, 1);
    const meta = await storage.put({ buffer, mimeType: "application/octet-stream" });
    expect(meta.size).toBe(7777);
  });

  it("concurrent_puts_of_same_bytes_dedup_by_hash", async () => {
    const buffer = Buffer.from("identical bytes");
    const [a, b] = await Promise.all([
      storage.put({ buffer, mimeType: "text/plain" }),
      storage.put({ buffer, mimeType: "text/plain" }),
    ]);
    expect(a.storageKey).toBe(b.storageKey);
    expect(await storage.exists(a.storageKey)).toBe(true);
  });

  it("rejects_invalid_storage_key_shape", async () => {
    await expect(storage.getBuffer("not-a-hex-hash")).rejects.toBeInstanceOf(
      FileStorageWriteError,
    );
  });

  it("constructor_rejects_empty_root", () => {
    expect(() => new LocalDiskFileStorage("")).toThrow(FileStorageWriteError);
  });
});
