// Image preprocessing for Gemini vision calls.
//
// Sizing values (1280px max edge, JPEG q=85) adopted from
// https://github.com/fsyeddev/ttb-label/blob/main/lib/image-preprocess.ts with
// attribution. Rationale: Gemini's effective vision resolution is roughly
// 1024–1568px on the longest edge; 1280px keeps detail while cutting typical
// phone-photo payloads ~85%.

import sharp from "sharp";

const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 85;

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

  const longestEdge = Math.max(width, height);
  const scale = longestEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longestEdge : 1;
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
