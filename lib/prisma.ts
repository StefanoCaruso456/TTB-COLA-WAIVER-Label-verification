import { PrismaClient } from "@prisma/client";

import { createInMemoryPrisma, shouldUseMockPrisma } from "./prisma-mock";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  (shouldUseMockPrisma()
    ? createInMemoryPrisma()
    : new PrismaClient({
        log:
          process.env.NODE_ENV === "development"
            ? ["query", "error", "warn"]
            : ["error"],
      }));

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
