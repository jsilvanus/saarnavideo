import { NextResponse } from "next/server";
import { jsonError } from "@/app/api/_lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ACTIVE = ["QUEUED", "RUNNING"] as const;
const RECENT_MINUTES = 60;
const RECENT_LIMIT = 15;

/**
 * Jobs of all projects for the job panel: every QUEUED and RUNNING job plus the latest finished ones.
 * `?active=1` leaves the finished ones out; `?recentMinutes=` (default 60) and `?recentLimit=` (default 15) shape them.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get("active") === "1";
    const minutes = Math.min(24 * 60, Math.max(1, Number(url.searchParams.get("recentMinutes")) || RECENT_MINUTES));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("recentLimit")) || RECENT_LIMIT));
    const select = {
      id: true, projectId: true, sourceId: true, type: true, status: true, phase: true, progress: true, message: true, error: true,
      etaSeconds: true, workerId: true, cancelRequested: true, createdAt: true, startedAt: true, completedAt: true,
      project: { select: { title: true } },
    } as const;
    const [active, recent] = await Promise.all([
      prisma.mediaJob.findMany({ where: { status: { in: [...ACTIVE] } }, select, orderBy: [{ createdAt: "asc" }], take: 200 }),
      activeOnly ? Promise.resolve([]) : prisma.mediaJob.findMany({
        where: { status: { notIn: [...ACTIVE] }, updatedAt: { gt: new Date(Date.now() - minutes * 60_000) } },
        select, orderBy: [{ updatedAt: "desc" }], take: limit,
      }),
    ]);
    const jobs = [...active, ...recent].map(({ project, ...job }) => ({ ...job, projectTitle: project.title }));
    return NextResponse.json({
      jobs,
      counts: { running: active.filter(job => job.status === "RUNNING").length, queued: active.filter(job => job.status === "QUEUED").length },
    });
  } catch (error) {
    console.error("Job list error:", error);
    return jsonError("Failed to list jobs", 500);
  }
}
