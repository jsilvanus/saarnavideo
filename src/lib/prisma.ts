import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const basePrisma = globalForPrisma.prisma ?? new PrismaClient();

/**
 * Project media is persistent by design. The old worker used expiresAt for a
 * seven-day retention policy; that policy was removed from the product model.
 * Keep the nullable database fields for compatibility with existing data, but
 * prevent new/updated sources and outputs from acquiring an expiry and ignore
 * expiry filters from legacy cleanup code.
 */
export const prisma = basePrisma.$extends({
  query: {
    source: {
      async create({ args, query }) {
        (args.data as { expiresAt?: Date | null }).expiresAt = null;
        return query(args);
      },
      async update({ args, query }) {
        (args.data as { expiresAt?: Date | null }).expiresAt = null;
        return query(args);
      },
      async updateMany({ args, query }) {
        (args.data as { expiresAt?: Date | null }).expiresAt = null;
        return query(args);
      },
      async findMany({ args, query }) {
        const where = args.where as Record<string, unknown> | undefined;
        if (where && "expiresAt" in where) {
          const { expiresAt: _expiresAt, ...withoutExpiry } = where;
          args.where = withoutExpiry;
        }
        return query(args);
      },
    },
    output: {
      async create({ args, query }) {
        (args.data as { expiresAt?: Date | null }).expiresAt = null;
        return query(args);
      },
      async update({ args, query }) {
        (args.data as { expiresAt?: Date | null }).expiresAt = null;
        return query(args);
      },
      async updateMany({ args, query }) {
        (args.data as { expiresAt?: Date | null }).expiresAt = null;
        return query(args);
      },
      async findMany({ args, query }) {
        const where = args.where as Record<string, unknown> | undefined;
        if (where && "expiresAt" in where) {
          const { expiresAt: _expiresAt, ...withoutExpiry } = where;
          args.where = withoutExpiry;
        }
        return query(args);
      },
    },
  },
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma as unknown as PrismaClient;
