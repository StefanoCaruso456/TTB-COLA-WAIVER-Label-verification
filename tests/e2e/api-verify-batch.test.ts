import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  mockPrisma,
  mockPrismaCount,
  resetMockPrisma,
} from "./_helpers/mock-prisma";
import { jsonRequest, rawRequest } from "./_helpers/make-request";

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

beforeAll(() => {
  process.env.USE_MOCK_EXTRACTION = "true";
});

afterEach(() => {
  resetMockPrisma();
});

async function loadPost() {
  const mod = await import("@/app/api/verify/batch/route");
  return mod.POST;
}

async function loadSamples() {
  const mod = await import("@/data/samples");
  return mod.getSampleScenarios();
}

describe("POST /api/verify/batch", () => {
  it("runs all six sample scenarios end-to-end and persists every result", async () => {
    const POST = await loadPost();
    const samples = await loadSamples();

    const res = await POST(
      jsonRequest("http://test/api/verify/batch", {
        items: samples.map((s) => ({
          itemKey: s.id,
          clientName: s.clientName,
          applicantName: s.applicantName,
          productName: s.productName,
          application: s.application,
          images: s.images,
          mockScenario: s.mockScenario,
        })),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.total).toBe(samples.length);
    expect(body.counts.success).toBe(samples.length);
    expect(body.counts.failed).toBe(0);
    expect(body.results).toHaveLength(samples.length);
    expect(mockPrismaCount()).toBe(samples.length);

    const sample = samples.find((s) => s.id === "spirits-missing-warning")!;
    const result = body.results.find(
      (r: { itemKey?: string }) => r.itemKey === sample.id,
    );
    expect(result.success).toBe(true);
    expect(result.status).toBe("fail");
  });

  it("isolates a single bad item — others still succeed and persist", async () => {
    const POST = await loadPost();
    const samples = await loadSamples();
    const valid = samples.find((s) => s.id === "wine-valid")!;

    const res = await POST(
      jsonRequest("http://test/api/verify/batch", {
        items: [
          {
            itemKey: "good",
            application: valid.application,
            images: valid.images,
            mockScenario: valid.mockScenario,
          },
          {
            itemKey: "bad",
            application: { applicationTypeStep: { productType: "wine" } },
            images: valid.images,
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ total: 2, success: 1, failed: 1 });
    expect(mockPrismaCount()).toBe(1);

    const good = body.results.find(
      (r: { itemKey: string }) => r.itemKey === "good",
    );
    const bad = body.results.find(
      (r: { itemKey: string }) => r.itemKey === "bad",
    );
    expect(good.success).toBe(true);
    expect(good.recordId).toMatch(/^rec_/);
    expect(bad.success).toBe(false);
    expect(bad.error.code).toBe("schema_validation");
  });

  it("returns 400 on invalid JSON body", async () => {
    const POST = await loadPost();
    const res = await POST(
      rawRequest("http://test/api/verify/batch", "not json"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on an empty items array", async () => {
    const POST = await loadPost();
    const res = await POST(
      jsonRequest("http://test/api/verify/batch", { items: [] }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on out-of-range concurrency", async () => {
    const POST = await loadPost();
    const samples = await loadSamples();
    const valid = samples.find((s) => s.id === "wine-valid")!;
    const res = await POST(
      jsonRequest("http://test/api/verify/batch", {
        items: [
          {
            application: valid.application,
            images: valid.images,
            mockScenario: valid.mockScenario,
          },
        ],
        concurrency: 99,
      }),
    );
    expect(res.status).toBe(400);
  });
});
