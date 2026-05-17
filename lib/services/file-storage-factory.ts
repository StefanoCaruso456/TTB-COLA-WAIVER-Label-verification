// Resolves the active FileStorage implementation from env. Single source of
// truth — every batch endpoint imports `getFileStorage()` rather than
// constructing its own LocalDiskFileStorage instance.
//
// See docs/specs/phase-3-synchronous-batch.md.

import type { FileStorage } from "./file-storage";
import { LocalDiskFileStorage } from "./file-storage-disk";

let cached: FileStorage | undefined;

export function getFileStorage(): FileStorage {
  if (cached) return cached;
  const root = process.env.BATCH_FILE_STORAGE_PATH ?? "./.local/batch-files";
  cached = new LocalDiskFileStorage(root);
  return cached;
}

// Test hook: reset the cached instance so tests can swap roots between cases.
export function _resetFileStorageForTesting(): void {
  cached = undefined;
}
