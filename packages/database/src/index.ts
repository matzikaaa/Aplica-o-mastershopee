import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __mastershopeePrisma: PrismaClient | undefined;
}

// Reuse a single client across hot-reloads in dev and across serverless
// invocations that share a warm container.
export const prisma =
  globalThis.__mastershopeePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__mastershopeePrisma = prisma;
}

export * from "@prisma/client";
