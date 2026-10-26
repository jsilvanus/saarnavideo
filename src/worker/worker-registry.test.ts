import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { liveWorkerHosts, localStorageHostWarning, pruneWorkers, registerWorker, type RegistryDb } from "./worker-registry";

const db = prisma as unknown as RegistryDb;
const tag = randomUUID().slice(0, 8);
afterEach(async () => { await prisma.lease.deleteMany({ where: { name: { contains: tag } } }); });

describe("worker registry", () => {
  it("lists the distinct hosts of live workers and drops expired ones", async () => {
    const now = new Date();
    await registerWorker(db, `a-${tag}`, now, `host-a-${tag}`);
    await registerWorker(db, `b-${tag}`, now, `host-a-${tag}`);
    await registerWorker(db, `c-${tag}`, now, `host-b-${tag}`);
    await registerWorker(db, `d-${tag}`, new Date(now.getTime() - 10 * 60_000), `host-old-${tag}`); // expired
    const hosts = (await liveWorkerHosts(db, now)).filter(host => host.endsWith(tag));
    expect(hosts).toEqual([`host-a-${tag}`, `host-b-${tag}`]);
  });

  it("prunes workers that have been gone for over an hour", async () => {
    const now = new Date();
    await registerWorker(db, `old-${tag}`, new Date(now.getTime() - 3 * 60 * 60_000), `host-old-${tag}`);
    await registerWorker(db, `new-${tag}`, now, `host-new-${tag}`);
    await pruneWorkers(db, now);
    const left = await prisma.lease.findMany({ where: { name: { contains: tag } } });
    expect(left.map(row => row.name)).toEqual([`worker:host-new-${tag}:new-${tag}`]);
  });
});

describe("localStorageHostWarning", () => {
  it("warns only for local storage with several hosts", () => {
    expect(localStorageHostWarning(["a", "b"], "local")).toMatch(/MEDIA_STORAGE=local.*2 hosts/);
    expect(localStorageHostWarning(["a", "b"], undefined)).not.toBeNull();
    expect(localStorageHostWarning(["a", "b"], "s3")).toBeNull();
    expect(localStorageHostWarning(["a"], "local")).toBeNull();
  });
});
