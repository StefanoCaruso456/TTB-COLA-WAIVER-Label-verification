import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { mockPrisma, resetMockPrisma } from "./_helpers/mock-prisma";
import { jsonRequest, rawRequest } from "./_helpers/make-request";

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

beforeAll(() => {
  process.env.USE_MOCK_EXTRACTION = "true";
});

afterEach(() => {
  resetMockPrisma();
});

async function loadPost() {
  const mod = await import("@/app/api/verify/route");
  return mod.POST;
}

async function loadSamples() {
  const mod = await import("@/data/samples");
  return mod.getSampleScenarios();
}

describe("POST /api/verify", () => {
  it("runs the wine-valid sample end-to-end and persists a record", async () => {
    const POST = await loadPost();
    const samples = await loadSamples();
    const sample = samples.find((s) => s.id === "wine-valid");
    expect(sample, "wine-valid sample present").toBeDefined();

    const res = await POST(
      jsonRequest("http://test/api/verify", {
        clientName: sample!.clientName,
        applicantName: sample!.applicantName,
        productName: sample!.productName,
        application: sample!.application,
        images: sample!.images,
        mockScenario: sample!.mockScenario,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recordId).toMatch(/^rec_/);
    expect(body.report.overallStatus).toBeDefined();
    expect(Array.isArray(body.report.checks)).toBe(true);
    expect(body.report.checks.length).toBeGreaterThan(0);
    expect(body.extractedLabel).toBeDefined();
  });

  it("flags the spirits-missing-warning sample as a fail", async () => {
    const POST = await loadPost();
    const samples = await loadSamples();
    const sample = samples.find((s) => s.id === "spirits-missing-warning")!;

    const res = await POST(
      jsonRequest("http://test/api/verify", {
        clientName: sample.clientName,
        application: sample.application,
        images: sample.images,
        mockScenario: sample.mockScenario,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.overallStatus).toBe("fail");
    const warning = body.report.checks.find(
      (c: { fieldKey: string }) => c.fieldKey === "governmentWarning",
    );
    expect(warning?.status).toBe("missing");
  });

  it("returns 400 on invalid JSON body", async () => {
    const POST = await loadPost();
    const res = await POST(rawRequest("http://test/api/verify", "not json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 on missing images", async () => {
    const POST = await loadPost();
    const samples = await loadSamples();
    const sample = samples[0];
    const res = await POST(
      jsonRequest("http://test/api/verify", {
        application: sample.application,
        images: [],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 422 on schema-invalid application", async () => {
    const POST = await loadPost();
    const samples = await loadSamples();
    const sample = samples[0];
    const res = await POST(
      jsonRequest("http://test/api/verify", {
        application: { applicationTypeStep: { productType: "wine" } },
        images: sample.images,
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(Array.isArray(body.issues)).toBe(true);
  });
});
