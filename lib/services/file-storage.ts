// File storage interface for batch label uploads.
//
// Phase 2 ships a `LocalDiskFileStorage` implementation. An `S3FileStorage`
// (Cloudflare R2, AWS S3, Railway Tigris) can slot in behind the same
// interface in a future phase without touching callers.
//
// See docs/specs/phase-2-data-model-and-storage.md.

export interface StoredFileMetadata {
  /** Opaque key callers pass back to getBuffer / delete / exists. */
  storageKey: string;
  /** Original byte length. */
  size: number;
  /** MIME type recorded at put time. */
  mimeType: string;
  /** sha256 hex of the raw bytes. */
  hash: string;
}

export interface PutFileInput {
  buffer: Buffer;
  mimeType: string;
  /** Free-form metadata. Currently unused by the disk impl; future backends may persist. */
  metadata?: Record<string, string>;
}

export interface FileStorage {
  /** Writes the buffer; returns metadata including the opaque storageKey. */
  put(input: PutFileInput): Promise<StoredFileMetadata>;

  /** Reads the full buffer for a storageKey. Throws FileNotFoundError if absent. */
  getBuffer(storageKey: string): Promise<Buffer>;

  /** Idempotent: deleting a non-existent key resolves without throwing. */
  delete(storageKey: string): Promise<void>;

  /** Cheap existence check; never throws for unknown keys. */
  exists(storageKey: string): Promise<boolean>;
}

export class FileNotFoundError extends Error {
  constructor(public readonly storageKey: string) {
    super(`File not found in storage: ${storageKey}`);
    this.name = "FileNotFoundError";
  }
}

export class FileStorageWriteError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "FileStorageWriteError";
  }
}
