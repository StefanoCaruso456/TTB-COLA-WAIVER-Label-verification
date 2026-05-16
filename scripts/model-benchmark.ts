/**
 * Gemini model A/B benchmark.
 *
 * For each (model, image) pair: runs extraction, captures latency, captures
 * whether the response parses to the ExtractedLabel schema, captures errors
 * (with 503 distinguished). Prints a summary table and a cross-model matrix.
 *
 * Pattern adopted from
 * https://github.com/fsyeddev/ttb-label/blob/main/scripts/model-benchmark.ts
 * with attribution.
 *
 * Usage:
 *   npm run benchmark -- --images=./tmp-labels --models=gemini-2.5-flash,gemini-2.5-flash-lite
 *   npm run benchmark -- --images=./tmp-labels --models=gemini-2.5-flash --save
 *
 * Required env: GEMINI_API_KEY.
 */

import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, extname, basename } from "node:path";

import { GoogleGenAI } from "@google/genai";
import { preprocessImage } from "@/lib/services/image-preprocess";
import {
  GEMINI_503_RETRY_DELAYS_MS,
  is503Error,
} from "@/lib/services/gemini-label-extraction.service";
import { extractedLabelSchema } from "@/lib/schemas/extracted-label.schema";
import { buildOcrPrompt } from "@/lib/services/ocr-prompt-builder";
import type { ColaApplication } from "@/types/cola";

interface CliArgs {
  imagesDir: string;
  models: string[];
  save: boolean;
}

interface RunResult {
  modelId: string;
  imageFile: string;
  durationMs: number;
  ok: boolean;
  schemaMatch: boolean;
  errorMessage: string | null;
  is503: boolean;
  originalSizeKB: number;
  resizedSizeKB: number;
}

const DEFAULT_APPLICATION: ColaApplication = {
  applicationTypeStep: {
    productType: "wine",
    sourceOfProduct: "domestic",
    applicationType: "certificate_of_label_approval",
    isResubmission: false,
  },
  colaInformationStep: {
    brandName: "Benchmark Wine",
    netContents: ["750 mL"],
  },
  uploadLabelsStep: {
    labelImages: [
      {
        id: "img-1",
        fileName: "label.jpg",
        mimeType: "image/jpeg",
        size: 0,
        labelImageType: "brand",
      },
    ],
  },
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const find = (name: string) => {
    const flag = `--${name}`;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag && i + 1 < args.length) return args[i + 1];
      if (args[i].startsWith(`${flag}=`)) return args[i].split("=")[1];
    }
    return undefined;
  };

  const imagesDir = find("images");
  const modelsRaw = find("models");
  const save = args.includes("--save");

  if (!imagesDir) {
    console.error(
      "missing --images=<dir>. Provide a directory of .jpg/.png label images.",
    );
    process.exit(2);
  }
  if (!modelsRaw) {
    console.error(
      "missing --models=<a,b>. Example: --models=gemini-2.5-flash,gemini-2.5-flash-lite",
    );
    process.exit(2);
  }
  const models = modelsRaw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  return { imagesDir: resolve(imagesDir), models, save };
}

function listImages(dir: string): string[] {
  const supported = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  try {
    statSync(dir);
  } catch {
    console.error(`images dir not found: ${dir}`);
    process.exit(2);
  }
  return readdirSync(dir)
    .filter((f) => supported.has(extname(f).toLowerCase()))
    .map((f) => resolve(dir, f));
}

async function runOne(
  client: GoogleGenAI,
  modelId: string,
  imageBase64: string,
  mimeType: string,
): Promise<{ ok: boolean; durationMs: number; schemaMatch: boolean; errorMessage: string | null; is503: boolean }> {
  const prompt = buildOcrPrompt(DEFAULT_APPLICATION);
  const start = Date.now();
  try {
    const response = await client.models.generateContent({
      model: modelId,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: prompt.userInstruction },
          ],
        },
      ],
      config: {
        systemInstruction: prompt.systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });
    const durationMs = Date.now() - start;
    const text = response.text ?? "";
    if (!text.trim()) {
      return { ok: false, durationMs, schemaMatch: false, errorMessage: "empty response", is503: false };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: true, durationMs, schemaMatch: false, errorMessage: "non-JSON response", is503: false };
    }
    const result = extractedLabelSchema.safeParse(parsed);
    return {
      ok: true,
      durationMs,
      schemaMatch: result.success,
      errorMessage: result.success ? null : "schema mismatch",
      is503: false,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      schemaMatch: false,
      errorMessage: err instanceof Error ? err.message.slice(0, 120) : String(err),
      is503: is503Error(err),
    };
  }
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

function p50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. Run with `tsx --env-file=.env scripts/model-benchmark.ts`.");
    process.exit(2);
  }

  const args = parseArgs(process.argv);
  const images = listImages(args.imagesDir);
  if (images.length === 0) {
    console.error(`no .jpg/.png/.webp images found in ${args.imagesDir}`);
    process.exit(2);
  }

  console.log(
    `\nGemini model benchmark — ${args.models.length} models × ${images.length} images = ${args.models.length * images.length} calls (retries on 503: ${GEMINI_503_RETRY_DELAYS_MS.join(", ")}ms)\n`,
  );

  const client = new GoogleGenAI({ apiKey });
  const results: RunResult[] = [];

  // Preprocess each image once; reuse across all models.
  console.log("Preprocessing images...");
  const prepped: Array<{
    file: string;
    base64: string;
    mimeType: string;
    originalSizeKB: number;
    resizedSizeKB: number;
  }> = [];
  for (const path of images) {
    const raw = readFileSync(path);
    const result = await preprocessImage(raw);
    prepped.push({
      file: basename(path),
      base64: result.buffer.toString("base64"),
      mimeType: result.mimeType,
      originalSizeKB: result.originalSizeKB,
      resizedSizeKB: result.resizedSizeKB,
    });
    process.stdout.write(
      `  ${basename(path).padEnd(40)} ${result.originalSizeKB} KB → ${result.resizedSizeKB} KB\n`,
    );
  }
  console.log("");

  for (const modelId of args.models) {
    console.log(`\n${"─".repeat(70)}\nRunning ${modelId}\n${"─".repeat(70)}`);
    for (let i = 0; i < prepped.length; i++) {
      const p = prepped[i];
      process.stdout.write(`  [${String(i + 1).padStart(2)}/${prepped.length}] ${p.file.padEnd(36)} `);
      const r = await runOne(client, modelId, p.base64, p.mimeType);
      results.push({
        modelId,
        imageFile: p.file,
        durationMs: r.durationMs,
        ok: r.ok,
        schemaMatch: r.schemaMatch,
        errorMessage: r.errorMessage,
        is503: r.is503,
        originalSizeKB: p.originalSizeKB,
        resizedSizeKB: p.resizedSizeKB,
      });
      if (r.ok && r.schemaMatch) {
        process.stdout.write(`✓ ${String(r.durationMs).padStart(5)}ms\n`);
      } else if (r.is503) {
        process.stdout.write(`503 ${String(r.durationMs).padStart(5)}ms\n`);
      } else {
        process.stdout.write(`✗ ${String(r.durationMs).padStart(5)}ms  ${r.errorMessage ?? ""}\n`);
      }
    }
  }

  console.log(`\n${"═".repeat(70)}\nSUMMARY\n${"═".repeat(70)}`);
  console.log(pad("Model", 28) + pad("OK", 8) + pad("Schema✓", 10) + pad("avg ms", 10) + pad("p50 ms", 10) + pad("503s", 6));
  console.log("─".repeat(70));
  for (const modelId of args.models) {
    const rs = results.filter((r) => r.modelId === modelId);
    const ok = rs.filter((r) => r.ok).length;
    const schemaOk = rs.filter((r) => r.schemaMatch).length;
    const errs503 = rs.filter((r) => r.is503).length;
    const okDurations = rs.filter((r) => r.ok).map((r) => r.durationMs);
    const avg = okDurations.length
      ? Math.round(okDurations.reduce((a, b) => a + b, 0) / okDurations.length)
      : 0;
    console.log(
      pad(modelId, 28) +
        pad(`${ok}/${rs.length}`, 8) +
        pad(`${schemaOk}/${rs.length}`, 10) +
        pad(`${avg}`, 10) +
        pad(`${p50(okDurations)}`, 10) +
        pad(`${errs503}`, 6),
    );
  }

  if (args.save) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = resolve(process.cwd(), `benchmark-${stamp}.json`);
    writeFileSync(out, JSON.stringify({ args, results }, null, 2));
    console.log(`\nSaved to ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
