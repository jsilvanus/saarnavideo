# Facebook Page publishing setup

SaarnaVideo can publish a generated video to **one** Facebook Page, next to YouTube. The Page is configured through
environment variables; there is no OAuth flow in the app and no Facebook data in the database.

> **Read this first.** Meta changes permission names, app-review rules and the Graph API version often. The steps below
> are written from the documented Graph API behaviour as of the last time this was checked, and the integration has been
> tested only against a fake Graph server (`e2e/fake-graph-server.ts`), never against the real API. Items marked
> **(unsure)** are the ones most likely to be different in the Meta dashboard today. When the dashboard disagrees with
> this page, trust the dashboard and the Graph API changelog.

## What the app does

`POST /api/projects/[id]/publish` with `{ "platform": "FACEBOOK", "privacy": "PUBLIC" | "PRIVATE" }` queues a
`Publication` (`provider = FACEBOOK`). The worker then:

1. Uploads the latest non-preview `VIDEO` output with the resumable upload API on `/{page-id}/videos`
   (`upload_phase=start`, repeated `transfer` with the byte range Facebook asks for, `finish` with title, description and
   `published`).
2. Polls `GET /{video-id}?fields=status` until `video_status` is `ready` (error status or 30 minutes without a result
   fails the publication).
3. Sets the thumbnail (`POST /{video-id}/thumbnails`) if the project has a `THUMBNAIL` output.
4. Uploads the SRT sidecar of the render job (if it was rendered with soft or both captions) with
   `POST /{video-id}/captions`, named `video.<locale>.srt` (for example `video.fi_FI.srt`) as Facebook requires.

Steps 3 and 4 fail soft: a warning is written to the job log and the publication is still `COMPLETED`.
Any error from steps 1 and 2 ends the publication as `FAILED` with a readable message in `Publication.error`
(expired token, missing permission, rate limit, ...).

Visibility: `PUBLIC` publishes on the Page immediately (`published=true`). `PRIVATE` uploads an unpublished video that only
Page admins can see (`published=false`); you can publish it from Meta Business Suite later. `UNLISTED` does not exist on
Facebook and is rejected with 400.

## 1. Create a Meta app

1. Sign in at <https://developers.facebook.com/> with a personal account that is an **admin of the Page** (and of its
   Business portfolio, if the Page belongs to one).
2. **My Apps > Create App.** Pick the use case for managing Page content / "Other" and app type **Business** (the wording of
   this step changes between dashboard versions **(unsure)**).
3. Add the **Facebook Login for Business** or **Facebook Login** product only if you need it to issue the token in step 2;
   the app itself never uses it.
4. Note the **App ID** and **App Secret** (Settings > Basic). You need them for the token exchange; they are *not* stored
   by SaarnaVideo.

## 2. Get a Page access token

Permissions the upload needs **(unsure: Meta renames and merges these; app review may be required)**:

| Permission | Why |
| --- | --- |
| `pages_show_list` | Lets the token holder list Pages, used to obtain the Page token. |
| `pages_read_engagement` | Read the Page (`GET /{page-id}?fields=name`, video status). |
| `pages_manage_posts` | Create and publish posts and videos as the Page. |
| `publish_video` | Older permission for publishing videos. Some app configurations still ask for it; in newer ones it may be folded into `pages_manage_posts` **(unsure)**. |
| `pages_manage_metadata` | Sometimes required for thumbnails/captions edits **(unsure, request only if the caption or thumbnail step reports a permission error)**. |

**Development mode vs. live mode.** While the app is in *development mode*, these permissions work without review for
people who have a role on the app (admin/developer/tester). For a single Page run by your own church admins this is
usually enough: add the admin as a developer or tester on the app and keep the app in development mode. Making the app
public for other users requires **App Review** and **Business Verification**, which SaarnaVideo does not need for its own
Page **(unsure: Meta may require review for some permissions even for your own Page; the Graph API Explorer will tell
you)**.

Steps, using the Graph API Explorer (<https://developers.facebook.com/tools/explorer/>):

1. Select your app, choose **User Token**, add the permissions above, and click *Generate Access Token*. Approve for the
   right Page.
2. **Exchange for a long-lived user token** (about 60 days). Run this on your own machine, not in SaarnaVideo:

   ```bash
   curl -G "https://graph.facebook.com/v24.0/oauth/access_token" \
     --data-urlencode "grant_type=fb_exchange_token" \
     --data-urlencode "client_id=$APP_ID" \
     --data-urlencode "client_secret=$APP_SECRET" \
     --data-urlencode "fb_exchange_token=$SHORT_LIVED_USER_TOKEN"
   ```

3. **Get the Page token from the long-lived user token:**

   ```bash
   curl -G "https://graph.facebook.com/v24.0/me/accounts" \
     --data-urlencode "access_token=$LONG_LIVED_USER_TOKEN"
   ```

   The response lists your Pages with `id`, `name` and `access_token`. A Page token obtained from a long-lived user token
   does **not expire** in the usual case **(unsure: it can still be invalidated by a password change, by removing the app,
   or by Meta's data-use checks)**.
4. Optional check that the token is a never-expiring Page token: open <https://developers.facebook.com/tools/debug/accesstoken/>
   and paste it; *Expires* should say *Never*, and *Scopes* should list the permissions above.

## 3. Configure SaarnaVideo

Set these on the **web app and the worker** (in `docker-compose.yml` they are defined once and shared):

| Variable | Required | Meaning |
| --- | --- | --- |
| `FACEBOOK_PAGE_ID` | yes | Numeric Page ID (the `id` from `/me/accounts`). |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | yes | The Page access token. Keep it out of git; put it in `.env` or your secret store. |
| `FACEBOOK_GRAPH_VERSION` | no | Default `v24.0`. Meta retires versions after roughly two years; if requests start failing with a version error, set a newer one **(unsure whether `v24.0` is still current when you read this)**. |
| `FACEBOOK_GRAPH_BASE_URL` | no | Replaces `https://graph.facebook.com` and `https://graph-video.facebook.com` (tests, proxies). |
| `FACEBOOK_GRAPH_VIDEO_BASE_URL` | no | Replaces only the video-upload host. |
| `FACEBOOK_STATUS_POLL_MS` | no | Worker: milliseconds between processing checks (default 5000). |
| `FACEBOOK_PROCESSING_TIMEOUT_MS` | no | Worker: how long to wait for processing (default 30 minutes). |

Restart the app and the worker. `GET /api/integrations/facebook/status` should now report
`{"configured":true,"pageName":"<your Page>"}`; if the token is bad it reports `configured: true`, `pageName: null` and an
`error` text. The token itself is never returned, stored in the database, or written to logs or error messages. The
Download tab enables the Facebook option when the status endpoint says it is configured.

## Troubleshooting

| Publication error contains | Meaning |
| --- | --- |
| `access token has expired (code 190)` / `invalid or was revoked` | Create a new Page token (step 2) and update `FACEBOOK_PAGE_ACCESS_TOKEN` on the app and the worker. |
| `permission is missing (code 10 / 200-299)` | The token lacks `pages_manage_posts` (or a related permission) for this Page, or the app is not allowed to use it yet (review, roles). |
| `rate limit reached` | Try again later. |
| `rejected a request parameter (code 100)` | Often a wrong `FACEBOOK_PAGE_ID`, or an unsupported file. |
| `still processing the video after 30 minutes` | Facebook is slow; the video may still appear in the Page's video library. Check before publishing again to avoid duplicates. |
| Caption or thumbnail warning in the job log | Non-fatal. The caption upload expects a `.srt` named with the locale; only Finnish, Swedish, English and a few other languages are mapped (`toFacebookLocale`). |

## Not covered

* Multiple Pages, per-project Pages, scheduling (`scheduled_publish_time`), crossposting and reels.
* Refreshing or exchanging tokens automatically.
* Verified behaviour against the real Graph API. The request shapes follow Meta's documentation for resumable Page video
  upload, thumbnails and captions; the first real publication should be done as `PRIVATE` (unpublished) and inspected.
