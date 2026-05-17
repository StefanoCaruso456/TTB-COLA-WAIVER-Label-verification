// Image preprocessing for Gemini vision calls.
//
// Sizing values (1024px max edge by default, JPEG q=85) — base pattern
// adopted from
// https://github.com/fsyeddev/ttb-label/blob/main/lib/image-preprocess.ts with
// attribution. Rationale: Gemini's effective vision resolution is roughly
// 1024–1568px on the longest edge. We default to the bottom of that range
// (1024) because vision tokens dominate end-to-end latency and the 256-px
// reduction from 1280 saves ~30% on the Gemini call without measurable OCR
// accuracy loss on the wine/spirits/malt fixtures.
//
// Operators can raise this back up to 1280–1568 via IMAGE_MAX_EDGE_PX if a
// specific corpus has small print that benefits.

import sharp from "sharp";

export const DEFAULT_MAX_EDGE_PX = 1024;
const MIN_MAX_EDGE_PX = 256;
const MAX_MAX_EDGE_PX = 4096;
const JPEG_QUALITY = 85;

export function resolveMaxEdgePx(
  raw: string | undefined = process.env.IMAGE_MAX_EDGE_PX,
): number {
  if (!raw) return DEFAULT_MAX_EDGE_PX;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_EDGE_PX;
  return Math.max(MIN_MAX_EDGE_PX, Math.min(MAX_MAX_EDGE_PX, Math.floor(n)));
}

export interface PreprocessResult {
  buffer: Buffer;
  mimeType: "image/jpeg";
  originalWidth: number;
  originalHeight: number;
  resizedWidth: number;
  resizedHeight: number;
  originalSizeKB: number;
  resizedSizeKB: number;
}

export class ImagePreprocessError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ImagePreprocessError";
  }
}

export async function preprocessImage(input: Buffer): Promise<PreprocessResult> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch (err) {
    throw new ImagePreprocessError(
      "Could not read image metadata. The buffer is not a valid image.",
      err,
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) {
    throw new ImagePreprocessError(
      "Image has zero width or height; cannot preprocess.",
    );
  }

  const maxEdgePx = resolveMaxEdgePx();
  const longestEdge = Math.max(width, height);
  const scale = longestEdge > maxEdgePx ? maxEdgePx / longestEdge : 1;
  const resizedWidth = Math.round(width * scale);
  const resizedHeight = Math.round(height * scale);

  const outputBuffer = await sharp(input)
    .resize(resizedWidth, resizedHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return {
    buffer: outputBuffer,
    mimeType: "image/jpeg",
    originalWidth: width,
    originalHeight: height,
    resizedWidth,
    resizedHeight,
    originalSizeKB: Math.round(input.byteLength / 1024),
    resizedSizeKB: Math.round(outputBuffer.byteLength / 1024),
  };
}
