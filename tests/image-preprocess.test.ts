import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  DEFAULT_MAX_EDGE_PX,
  ImagePreprocessError,
  preprocessImage,
  resolveMaxEdgePx,
} from "@/lib/services/image-preprocess";

async function makeImage(
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
): Promise<Buffer> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    [format]({ quality: format === "jpeg" ? 95 : undefined })
    .toBuffer();
  return buf;
}

describe("preprocessImage", () => {
  afterEach(() => {
    delete process.env.IMAGE_MAX_EDGE_PX;
  });

  it("resizes_4000px_down_to_default_max_edge_1024", async () => {
    const input = await makeImage(4000, 3000);
    const result = await preprocessImage(input);
    expect(Math.max(result.resizedWidth, result.resizedHeight)).toBe(
      DEFAULT_MAX_EDGE_PX,
    );
    // Aspect ratio preserved within 1px tolerance.
    const inputAR = 4000 / 3000;
    const outputAR = result.resizedWidth / result.resizedHeight;
    expect(Math.abs(inputAR - outputAR)).toBeLessThan(0.01);
  });

  it("preserves_dimensions_under_default_max_edge", async () => {
    const input = await makeImage(800, 600);
    const result = await preprocessImage(input);
    expect(result.resizedWidth).toBe(800);
    expect(result.resizedHeight).toBe(600);
  });

  it("honors_IMAGE_MAX_EDGE_PX_env_override", async () => {
    process.env.IMAGE_MAX_EDGE_PX = "1280";
    const input = await makeImage(4000, 3000);
    const result = await preprocessImage(input);
    expect(Math.max(result.resizedWidth, result.resizedHeight)).toBe(1280);
  });

  it("output_is_jpeg_regardless_of_input_format", async () => {
    const png = await makeImage(500, 500, "png");
    const result = await preprocessImage(png);
    expect(result.mimeType).toBe("image/jpeg");
    // First bytes of a JPEG are 0xFF 0xD8 0xFF.
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);
  });

  it("output_smaller_than_input_for_large_jpeg", async () => {
    const input = await makeImage(3000, 2000);
    const result = await preprocessImage(input);
    expect(result.buffer.byteLength).toBeLessThan(input.byteLength);
  });

  it("throws_on_invalid_buffer", async () => {
    const garbage = Buffer.from("not-an-image-at-all-just-random-bytes");
    await expect(preprocessImage(garbage)).rejects.toBeInstanceOf(
      ImagePreprocessError,
    );
  });

  it("populates_size_metadata", async () => {
    const input = await makeImage(2000, 2000);
    const result = await preprocessImage(input);
    expect(result.originalSizeKB).toBeGreaterThan(0);
    expect(result.resizedSizeKB).toBeGreaterThan(0);
    expect(result.originalWidth).toBe(2000);
    expect(result.originalHeight).toBe(2000);
  });
});

describe("resolveMaxEdgePx", () => {
  it("falls_back_to_default_when_env_unset", () => {
    expect(resolveMaxEdgePx(undefined)).toBe(DEFAULT_MAX_EDGE_PX);
  });

  it("respects_a_valid_numeric_override", () => {
    expect(resolveMaxEdgePx("800")).toBe(800);
    expect(resolveMaxEdgePx("1568")).toBe(1568);
  });

  it("clamps_below_minimum", () => {
    expect(resolveMaxEdgePx("100")).toBe(256);
  });

  it("clamps_above_maximum", () => {
    expect(resolveMaxEdgePx("10000")).toBe(4096);
  });

  it("falls_back_to_default_for_non_numeric", () => {
    expect(resolveMaxEdgePx("nope")).toBe(DEFAULT_MAX_EDGE_PX);
  });
});
