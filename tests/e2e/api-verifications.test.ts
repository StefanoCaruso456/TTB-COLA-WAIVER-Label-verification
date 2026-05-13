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

async function loadVerifyPost() {
  const mod = await import("@/app/api/verify/route");
  return mod.POST;
}

async function loadList() {
  const mod = await import("@/app/api/verifications/route");
  return mod.GET;
}

async function loadDetail() {
  const mod = await import("@/app/api/verifications/[id]/route");
  return { GET: mod.GET, PATCH: mod.PATCH };
}

async function loadSamples() {
  const mod = await import("@/data/samples");
  return mod.getSampleScenarios();
}

async function seedRecord(itemKey = "wine-valid"): Promise<string> {
  const POST = await loadVerifyPost();
  const samples = await loadSamples();
  const sample = samples.find((s) => s.id === itemKey)!;
  const res = await POST(
    jsonRequest("http://test/api/verify", {
      clientName: sample.clientName,
      application: sample.application,
      images: sample.images,
      mockScenario: sample.mockScenario,
    }),
  );
  const body = await res.json();
  return body.recordId;
}

describe("GET /api/verifications", () => {
  it("returns an empty list when no records exist", async () => {
    const GET = await loadList();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toEqual([]);
  });

  it("returns persisted records in reverse-chronological order", async () => {
    const idA = await seedRecord("wine-valid");
    const idB = await seedRecord("spirits-valid");
    const GET = await loadList();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records.map((r: { id: string }) => r.id)).toEqual([idB, idA]);
  });
});

describe("GET /api/verifications/[id]", () => {
  it("returns 404 for an unknown id", async () => {
    const { GET } = await loadDetail();
    const res = await GET(new Request("http://test/api/verifications/nope"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns full record detail for a real id", async () => {
    const id = await seedRecord("wine-valid");
    const { GET } = await loadDetail();
    const res = await GET(new Request(`http://test/api/verifications/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.id).toBe(id);
    expect(body.record.applicationJson).toBeDefined();
    expect(body.record.extractedJson).toBeDefined();
    expect(body.record.reportJson).toBeDefined();
  });
});

describe("PATCH /api/verifications/[id]", () => {
  it("updates reviewer notes on an existing record", async () => {
    const id = await seedRecord("wine-valid");
    const { PATCH } = await loadDetail();
    const res = await PATCH(
      jsonRequest(
        `http://test/api/verifications/${id}`,
        { reviewerNotes: "Looks good after manual check." },
        "PATCH",
      ),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.id).toBe(id);
  });

  it("returns 400 on invalid PATCH JSON", async () => {
    const id = await seedRecord("wine-valid");
    const { PATCH } = await loadDetail();
    const res = await PATCH(
      rawRequest(`http://test/api/verifications/${id}`, "not json", "PATCH"),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when reviewerNotes is missing or too long", async () => {
    const id = await seedRecord("wine-valid");
    const { PATCH } = await loadDetail();
    const res = await PATCH(
      jsonRequest(
        `http://test/api/verifications/${id}`,
        { reviewerNotes: "x".repeat(5001) },
        "PATCH",
      ),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });
});
