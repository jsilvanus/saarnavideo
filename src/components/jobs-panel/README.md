# Jobs panel (shared component, copied between apps)

A top-bar badge and drop-down that lists queued, running and recently finished jobs, with a one-line fleet strip
(`fleet 3w · slots 5/8 · queue 2 · hetzner 1/5 · app 1 run / 4 queued · stt 1 queued`) and an optional cancel button.

**This component exists in more than one place and is copied, not shared.** There is no single source of truth and no
shared package on purpose. Known copies:

| App | Folder |
|---|---|
| SaarnaVideo | `src/components/jobs-panel/` (TypeScript) |
| LCYT | `packages/lcyt-web/src/components/jobs-panel/` (JSX) |

When you change one copy, look at the others and port what fits. Keep the file names and the props below the same so a
change can be carried over by diff.

## Files

- `JobsPanel.tsx`: the badge, the drop-down and the polling. Everything app-specific comes in through props.
- `job-panel.ts`: pure helpers (`PanelJob`, `isActiveJob`, `jobPercent`, `jobDetail`, `formatJobAge`, `pollInterval`, `Translate`).
- `fleet-strip.ts`: `FleetStripData`, `fleetStripParts`, `summariseFleet` (the strip from an fffleet orchestrator's answers).
- `JobsPanel.module.css`: styles (CSS variables with fallbacks, no app theme needed).
- `*.test.ts`: tests of the pure parts.

## Props (`JobsPanelProps`)

| Prop | Meaning |
|---|---|
| `t(key, params?)` | Translate function. Keys below. Plurals: `jobs.badge_one` / `jobs.badge_other` with `{count}`; an app without plural support can define `jobs.badge` and map it. |
| `loadJobs()` | Resolves `{ jobs: PanelJob[], counts: { running, queued } }`; throw to show "could not load". |
| `loadStrip?()` | Resolves `{ enabled: true, ...FleetStripData }`, `{ enabled: false }` or null; leave out for no strip. |
| `cancelJob?(job)` | Cancels a job; leave out for no cancel button; throw on failure. |
| `typeLabel?(type)` | Display name of a job type; default is the raw type. |

`PanelJob` = `{ id, projectId, projectTitle, type, status, phase, progress, message, error, workerId, cancelRequested, createdAt, startedAt, completedAt }`
(ISO strings; `projectTitle` is whatever names the owner of the job in that app).

## Message keys

`jobs.title`, `jobs.open`, `jobs.close`, `jobs.empty`, `jobs.badge`, `jobs.cancel`, `jobs.cancelling`, `jobs.cancelFailed`,
`jobs.loadFailed`, `jobs.cancelRequested`, `jobs.section.active`, `jobs.section.recent`, `jobs.ago.s|m|h|d` (`{n}`),
`jobStatus.QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED` (more statuses are fine: unknown ones should fall back to the raw
status in the app's `t`), and `fleetStrip.offline|workers|slots|queue|draining|local|localWorkers|lanes|app|stt|sttBusy`.
English texts are in SaarnaVideo's `src/i18n/messages/en.ts`.

## SaarnaVideo wiring

`src/components/JobsIndicator.tsx` (mounted in `TopNav`): `GET /api/jobs`, `GET /api/fleet/status`, project cancel route.
Server side: `src/app/api/jobs/route.ts`, `src/app/api/fleet/status/route.ts`, `src/lib/fleet-status.ts`.
