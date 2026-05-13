import type { Prisma } from "@prisma/client";

interface MockRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  clientName: string | null;
  applicantName: string | null;
  productName: string | null;
  brandName: string | null;
  productType: string;
  sourceOfProduct: string;
  status: string;
  applicationJson: Prisma.JsonValue;
  extractedJson: Prisma.JsonValue;
  reportJson: Prisma.JsonValue;
  imageJson: Prisma.JsonValue | null;
  reviewerNotes: string | null;
}

const records = new Map<string, MockRow>();
let counter = 0;

function nullable<T>(value: T | undefined | null): T | null {
  return value == null ? null : value;
}

export const mockPrisma = {
  verificationRecord: {
    async create({ data }: { data: Prisma.VerificationRecordCreateInput }) {
      const id = `rec_${++counter}`;
      const now = new Date(Date.now() + counter);
      const row: MockRow = {
        id,
        createdAt: now,
        updatedAt: now,
        clientName: nullable(data.clientName as string | undefined),
        applicantName: nullable(data.applicantName as string | undefined),
        productName: nullable(data.productName as string | undefined),
        brandName: nullable(data.brandName as string | undefined),
        productType: data.productType as string,
        sourceOfProduct: data.sourceOfProduct as string,
        status: data.status as string,
        applicationJson: data.applicationJson as Prisma.JsonValue,
        extractedJson: data.extractedJson as Prisma.JsonValue,
        reportJson: data.reportJson as Prisma.JsonValue,
        imageJson:
          (data.imageJson as Prisma.JsonValue | undefined) ?? null,
        reviewerNotes: null,
      };
      records.set(id, row);
      return row;
    },
    async findMany({
      orderBy,
      take,
    }: {
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) {
      let list = Array.from(records.values());
      if (orderBy?.createdAt === "desc") {
        list = list.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      } else if (orderBy?.createdAt === "asc") {
        list = list.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      }
      if (typeof take === "number") list = list.slice(0, take);
      return list;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return records.get(where.id) ?? null;
    },
    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: { reviewerNotes?: string };
    }) {
      const existing = records.get(where.id);
      if (!existing) {
        const err = new Error(
          `Record to update not found: ${where.id}`,
        ) as Error & { code?: string };
        err.code = "P2025";
        throw err;
      }
      const updated: MockRow = {
        ...existing,
        ...(data.reviewerNotes !== undefined
          ? { reviewerNotes: data.reviewerNotes }
          : {}),
        updatedAt: new Date(Date.now() + counter++),
      };
      records.set(where.id, updated);
      return updated;
    },
  },
};

export function resetMockPrisma() {
  records.clear();
  counter = 0;
}

export function mockPrismaCount() {
  return records.size;
}
