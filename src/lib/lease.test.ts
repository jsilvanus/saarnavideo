import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { acquireLease, releaseLease, withLease, type LeaseDb } from "./lease";

const db = prisma as unknown as LeaseDb;
const names: string[] = [];
const lease = () => { const name = `test-lease-${randomUUID()}`; names.push(name); return name; };
afterEach(async () => { await prisma.lease.deleteMany({ where: { name: { in: names.splice(0) } } }); });

describe("lease", () => {
  it("is taken by the first asker and refused to the second", async () => {
    const name = lease();
    expect(await acquireLease(db, name, "a", 60_000)).toBe(true);
    expect(await acquireLease(db, name, "b", 60_000)).toBe(false);
  });

  it("is renewed by its owner", async () => {
    const name = lease();
    const now = new Date();
    expect(await acquireLease(db, name, "a", 1_000, now)).toBe(true);
    expect(await acquireLease(db, name, "a", 60_000, new Date(now.getTime() + 500))).toBe(true);
    expect(await acquireLease(db, name, "b", 60_000, new Date(now.getTime() + 5_000))).toBe(false);
  });

  it("passes to another owner once it has expired", async () => {
    const name = lease();
    const now = new Date();
    await acquireLease(db, name, "a", 1_000, now);
    expect(await acquireLease(db, name, "b", 1_000, new Date(now.getTime() + 2_000))).toBe(true);
    expect(await acquireLease(db, name, "a", 1_000, new Date(now.getTime() + 2_500))).toBe(false);
  });

  it("goes to exactly one of many racing owners", async () => {
    const name = lease();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => acquireLease(db, name, `owner-${index}`, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("is only released by its owner", async () => {
    const name = lease();
    await acquireLease(db, name, "a", 60_000);
    await releaseLease(db, name, "b");
    expect(await acquireLease(db, name, "c", 60_000)).toBe(false);
    await releaseLease(db, name, "a");
    expect(await acquireLease(db, name, "c", 60_000)).toBe(true);
  });

  it("withLease runs the work once, releases afterwards and skips while someone else holds it", async () => {
    const name = lease();
    let runs = 0;
    expect(await withLease(db, name, "a", 60_000, async () => { runs++; })).toBe(true);
    expect(await withLease(db, name, "b", 60_000, async () => { runs++; })).toBe(true); // released by a, so b gets it
    await acquireLease(db, name, "c", 60_000);
    expect(await withLease(db, name, "d", 60_000, async () => { runs++; })).toBe(false);
    expect(runs).toBe(2);
  });

  it("withLease releases the lease when the work throws", async () => {
    const name = lease();
    await expect(withLease(db, name, "a", 60_000, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await acquireLease(db, name, "b", 60_000)).toBe(true);
  });
});
