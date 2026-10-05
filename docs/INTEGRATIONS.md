# Integration guide

How SaarnaVideo is wired to the other pieces: an [fffleet](https://github.com/jsilvanus/fffleet) render fleet, S3 media storage, API connectors ([varfetch](https://github.com/jsilvanus/varfetch)), speech-to-text ([liturgos-auditor](https://github.com/jsilvanus/liturgos-auditor)), YouTube and Facebook.

Everything here is optional. With none of it configured, the worker renders and downloads on its own machine and media lives in a folder.

> **Verification status.** The fleet, S3, Graph and Google paths are tested against fakes (an in-process fleet, a fake S3 server, fake Graph and Google servers). None has been run against a real remote fleet, a real bucket or the real services yet. Treat a first real run as a test and keep the local fallback in mind.

Contents: [fffleet](#fffleet-render-and-download-on-workers) · [Media in S3](#media-in-s3) · [API connectors](#api-connectors-and-church-year-data-varfetch) · [Speech-to-text](#speech-to-text-liturgos-auditor) · [YouTube](#youtube) · [Facebook](#facebook)

## fffleet: render and download on workers

### What goes where

| Work | Where it runs | Setting |
|---|---|---|
| Render, preview, thumbnail, podcast (ffmpeg) | A fleet worker, as a batch job | `RENDER_EXECUTOR=fffleet` |
| YouTube download (yt-dlp) | A fleet worker with the `download` executor, as a batch job | `DOWNLOAD_EXECUTOR=fffleet` |
| Transcription audio strip (`AUDITOR_STT_FETCH=s3-source`) | A fleet worker, started by the auditor service, not by this app | see [Speech-to-text](#speech-to-text-liturgos-auditor) |
| Queue, job state, outputs, publishing, audio ffprobe, transcription polling | The app's own worker (`npm run worker`) | always local |

SaarnaVideo keeps its own job queue in the database. The fleet only does the heavy command. The app's worker stays the one that claims jobs, writes progress and creates `Output` rows, so downloads, thumbnails and publishing do not change, and a worker restart recovers jobs the same way with or without a fleet.

### How a render goes through the fleet

1. The worker builds the ffmpeg command exactly as for a local render, with local paths.
2. `src/worker/remote-ffmpeg.ts` rewrites every file the command reads into fffleet placeholders (`{{input:in0}}`, `{{inputdir:font}}`, `{{output:out}}`) and works out what the worker needs (`requires`: `filter:ass`, `filter:drawtext`, `encoder:libmp3lame`, ...).
3. The files are uploaded to S3 under `FFFLEET_S3_PREFIX/in/` (once per file; keyed by path, size and modification time). Generated caption files go under `tmp/<jobId>/` and are deleted after the job.
4. One batch job is submitted. Fleet progress is mapped onto the job's progress bar.
5. The result is downloaded from S3 to the local output path, and the temporary objects are removed. Sources and assets stay in the bucket; add a lifecycle rule if you want them to expire.
6. Cancelling a running job in the UI cancels it on the fleet and ends the SaarnaVideo job as `CANCELLED`.

### Set it up

You need an S3-compatible bucket, one orchestrator, one or more workers and the app's worker pointed at them. The fleet's own settings (slots, autoscaling, metrics, restarts) are described in the fffleet repository: [docs/operations.md](https://github.com/jsilvanus/fffleet/blob/main/docs/operations.md) and the READMEs of `fffleet-orchestrator` and `fffleet-worker`.

**1. Bucket.** Create one for staging (for example `saarnavideo-render`) and an access key that can read, write and delete in it. Workers and the app's worker both need the key. For S3-compatible stores (Hetzner Object Storage, MinIO) you also need the endpoint.

**2. Orchestrator** (once, somewhere the app's worker and the fleet workers can reach; put TLS in front if it crosses networks you do not control):

```bash
docker run -d --name fffleet-orchestrator -p 5000:5000 -v fffleet-data:/data \
  -e FFFLEET_WORKER_TOKEN=<worker-secret> \
  -e FFFLEET_SIGNING_KEY_FILE=/data/signing.pem \
  -e FFFLEET_CLIENTS_FILE=/data/clients.json \
  -e FFFLEET_STATE_FILE=/data/state.db \
  ghcr.io/jsilvanus/fffleet-orchestrator
```

Give SaarnaVideo its own login (the secret is printed once):

```bash
docker exec fffleet-orchestrator fffleet-orchestrator add-client saarnavideo --scope jobs
```

**3. Workers.** For renders the published image is enough (Debian ffmpeg with x264, x265, libass, drawtext, lame, opus and DejaVu fonts):

```bash
docker run -d --name fffleet-worker -p 5100:5100 \
  -e FFFLEET_ORCHESTRATOR_URL=http://<orchestrator>:5000 \
  -e FFFLEET_WORKER_TOKEN=<worker-secret> \
  -e FFFLEET_WORKER_ID=render-1 \
  -e FFFLEET_ADVERTISE_URL=http://<this-host>:5100 \
  -e FFFLEET_SLOTS=auto \
  -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... \
  -e FFFLEET_S3_ENDPOINT=https://<endpoint> \
  -e FFFLEET_CACHE_DIR=/cache -v fffleet-cache:/cache \
  ghcr.io/jsilvanus/fffleet-worker
```

`FFFLEET_CACHE_DIR` makes a worker download a large source once, not once per render. Workers sit on a private network: the orchestrator calls them with the worker token.

**4. The app's worker.** Add to the environment of `npm run worker` (or the `worker` service in compose):

```bash
RENDER_EXECUTOR=fffleet
FFFLEET_URL=http://<orchestrator>:5000
FFFLEET_CLIENT_ID=saarnavideo
FFFLEET_CLIENT_SECRET=<secret printed by add-client>
FFFLEET_S3_BUCKET=saarnavideo-render
FFFLEET_S3_PREFIX=saarnavideo
FFFLEET_S3_ENDPOINT=https://<endpoint>     # S3-compatible stores only
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
MAX_CONCURRENT_JOBS=4                       # default is already 4 with the fleet
```

(`FFFLEET_TOKEN` replaces the client id/secret pair if you prefer a static token.) The worker refuses to start rendering with `RENDER_EXECUTOR=fffleet` unless the bucket and the S3 credentials are set.

**5. Check.** Queue a preview. The job log shows the phase going through SUBMITTING and ENCODING; `GET /v1/workers` on the orchestrator lists your worker, and `GET /metrics` shows the queue. If no reachable fleet answers, the same job runs on the worker's own machine through an in-process fffleet runner with the same S3 staging (so the staging bucket and a local ffmpeg are still needed). Unset `FFFLEET_URL` on purpose to use that.

### Downloads on a fleet worker (optional)

yt-dlp needs python and the SaarnaVideo executor, so use the image built from `Dockerfile.fleet-worker` for the workers that should take downloads:

```bash
docker build -f Dockerfile.fleet-worker -t saarnavideo-fleet-worker .
```

It is the published worker plus python3, yt-dlp and `fleet/download-executor.mjs`, loaded through `FFFLEET_EXECUTORS`; it still renders like the stock image. The image is not built or pushed by CI yet; build and push it yourself, or run a plain worker with the same `FFFLEET_EXECUTORS` added to its environment. Then set on the app's worker:

```bash
DOWNLOAD_EXECUTOR=fffleet      # plus the same FFFLEET_* and AWS_* settings as above
```

The job type is `download`; the worker advertises `type:download`, so downloads only go to workers that have the executor. YouTube cookies saved in **Settings** are decrypted into a private temporary file for each run, staged for the fleet job, and removed afterwards; the executor never prints cookie contents. If yt-dlp rewrote the cookie file, the new copy is saved back, encrypted. Needs `YOUTUBE_TOKEN_ENCRYPTION_KEY`.

### How the pieces use the fffleet package

SaarnaVideo depends on the `fffleet` npm package (client and in-process runner, currently `^2.2.0`) and imports only `createFleet`, `createS3Client`, `s3ConfigFromEnv` and the types. Where:

| File | Role |
|---|---|
| `src/worker/remote-ffmpeg.ts` | `readRemoteConfig`, `translateFfmpegArgs`, `deriveRequires`, `createRemoteExecutor` for renders |
| `src/worker/remote-download.ts` | `createRemoteDownloader` for yt-dlp |
| `fleet/download-executor.mjs` | the worker-side `download` executor (plain ESM, no dependencies; stays in this repo because the generic fffleet repo does not know this app) |
| `src/worker/transcription-staging.ts`, `s3-presign.ts` | staging audio or the original in the same bucket for the auditor service |

Keep fffleet orchestrator, workers and the app on the same major version: the job contract (`v1`) does not change within a major, and the fffleet [upgrading guide](https://github.com/jsilvanus/fffleet/blob/main/docs/upgrading.md) lists what changed between versions.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Job stays `QUEUED` in SaarnaVideo | The app's worker is not running (it claims jobs, not the fleet) |
| Job `RUNNING`, phase `SUBMITTING`, no progress | No fleet worker has a free slot or the capabilities the command needs (`GET /v1/workers`, `GET /v1/capabilities` on the orchestrator). An `s3://` job needs a worker with S3 credentials |
| `WORKER_LOST`, `FFMPEG_EXIT`, `INPUT_FAILED`, `UPLOAD_FAILED`, `OUTPUT_MISSING` in the job error | See the table in fffleet's `docs/operations.md`; the ffmpeg stderr tail is in the job log |
| `RENDER_EXECUTOR=fffleet needs FFFLEET_S3_BUCKET and S3 credentials` | The staging bucket or keys are missing on the app's worker |
| 401 from the orchestrator | The client was removed, the secret is wrong, or the orchestrator has no stable `FFFLEET_SIGNING_KEY_FILE` and restarted |
| Render "works" but runs on the app host | `FFFLEET_URL` is unset or unreachable and the in-process fallback took over (check the worker log) |
| Podcast loudness pass fails | The fleet worker hides ffmpeg's loudnorm output; SaarnaVideo asks for `-loglevel info`; check the worker is on a current fffleet version that returns the stderr tail |
| Burned captions fail with a missing filter | The worker's ffmpeg has no libass (`filter:ass`); use the published image |

## Media in S3

Separate from render staging: `MEDIA_STORAGE=s3` puts sources, outputs and the asset library themselves in a bucket, so several app instances and workers need no shared volume.

```bash
MEDIA_STORAGE=s3
MEDIA_S3_BUCKET=saarnavideo-media
MEDIA_S3_PREFIX=media
MEDIA_S3_ENDPOINT=https://<endpoint>   # S3-compatible stores only
AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...
MEDIA_CACHE_MAX_BYTES=21474836480      # worker's cache of downloaded files
```

Set it on the app and on every worker. Startup fails if the bucket or keys are missing; there is no silent fallback to disk. A stored reference (`storagePath`) is either a local absolute path or `s3://bucket/key`, so existing rows keep working after the switch; move them with `npm run media:migrate -- --to s3` (or `--to local`). The app serves S3 files through itself (with Range support), uploads are streamed, and the worker downloads what it needs into a size-capped cache and uploads outputs when a job finishes. With several workers, each job heartbeats; a stale job is failed and an interrupted transcription is taken over by another worker.

You can use the same bucket for render staging (`FFFLEET_S3_BUCKET`) or a different one; staged objects live under their own prefix and are deleted after use, media is kept.

## API connectors and church-year data (varfetch)

**Settings** (top right) manages connectors: a base address, authentication (bearer, API-key header, basic; the secret is stored but never shown again) and requests with `{{name}}` placeholders and JSONPath mappings to project variable names. Requests run through the [varfetch](https://github.com/jsilvanus/varfetch) package (`^0.2.0`; only `fireRequest` on the server, types in the browser).

Nothing about a particular service is built in. For church-year data point a connector at an [anno-api](https://github.com/jsilvanus/anno-api) instance and press **Lisää kirkkovuosipohja** to add the day request (`/api/v1/date/{{paiva}}`) with the variable names `pyhapaiva`, `teema`, `evankeliumi`, `evankeliumiteksti`, `vari`, `jakso`, `aika`. In a project's **Lähde** step press **Hae muuttujat**, check old against new values and save the ones you accept; graphics that contain `{{evankeliumi}}` and so on fill themselves in at render time.

Connector calls to private or loopback addresses are blocked. To call a service on your own network, list its host in `CONNECTOR_ALLOW` on the app (comma separated; `CONNECTOR_DENY` wins). The check resolves the name before the request; it does not yet pin the address for the request itself (a DNS rebinding gap, listed in varfetch's open items), so only add connectors you trust.

## Speech-to-text (liturgos-auditor)

Transcriptions (and therefore captions and the plain-text transcript) come from a [liturgos-auditor](https://github.com/jsilvanus/liturgos-auditor) speech-to-text service. Compose runs its image as `auditor-stt` on port 8090; otherwise point the worker at one:

```bash
AUDITOR_STT_URL=http://stt.internal:8090
AUDITOR_STT_API_KEY=...        # only if the service has one
```

How the audio reaches the service (`AUDITOR_STT_FETCH`):

- `upload` (default): the worker cuts the range, extracts audio with ffmpeg and uploads it.
- `s3`: the worker stages 16 kHz mono audio in the staging bucket, sends a presigned URL (one hour), and deletes the object as soon as the service has downloaded it. The service must list the bucket host in its `AUDITOR_STT_SOURCE_URL_HOSTS`.
- `s3-source`: the worker stages the *original* file and the service strips the audio on an fffleet worker (`AUDITOR_STT_STRIP=fleet` there), so no ffmpeg runs in SaarnaVideo's worker. The staged object is kept until the job ends. Partial ranges still use `s3`.

The service keeps its own durable queue; the worker polls it and resumes after a restart. End-to-end transcription tests (`npm run test:e2e:transcription`) skip themselves unless `AUDITOR_STT_URL` points at a running service.

## YouTube

Needs OAuth credentials with the YouTube Data API enabled: step by step in [YOUTUBE_OAUTH_SETUP.md](YOUTUBE_OAUTH_SETUP.md). Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` (must equal `<address>/api/integrations/youtube/callback` in Google Cloud) and `YOUTUBE_TOKEN_ENCRYPTION_KEY` on the app and the worker. **Connect YouTube** in the UI; tokens are stored encrypted. The scope list includes `youtube.force-ssl` for caption upload; connections made before that scope was added must be reconnected for captions (video upload is unaffected). With `ACCESS_SECRET` set, sign in first: the OAuth callback is not exempt from the login. Publishing uploads the video, then the thumbnail and the SRT captions; a rejected thumbnail or caption never fails a video that is already on YouTube.

## Facebook

One Page, configured by environment only: `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_ACCESS_TOKEN` on the app and the worker. Page token creation and permissions are in [FACEBOOK_SETUP.md](FACEBOOK_SETUP.md). The token is never stored in the database or logged. `PUBLIC` publishes, `PRIVATE` uploads unpublished, `UNLISTED` is not available on Facebook. The Facebook path has not been tried against the real Graph API.
