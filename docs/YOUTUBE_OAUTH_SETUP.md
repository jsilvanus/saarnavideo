# YouTube OAuth Setup Guide

This guide explains how to set up YouTube OAuth credentials for SaarnaVideo to enable uploading videos to YouTube.

## Prerequisites

- Google Cloud Project (create at https://console.cloud.google.com)
- YouTube account with channel in good standing
- Domain with HTTPS support (for OAuth callback)

## Step 1: Create Google Cloud Project

1. Visit https://console.cloud.google.com
2. Click "Select a Project" → "NEW PROJECT"
3. Name: "SaarnaVideo"
4. Create project (wait ~1 minute)

## Step 2: Enable YouTube Data API

1. In Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "YouTube Data API v3"
3. Click on it, then "ENABLE"
4. Wait ~30 seconds for activation

## Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"
3. If prompted to create OAuth consent screen:
   - Choose "External" as user type
   - Fill in:
     - App name: "SaarnaVideo"
     - User support email: your-email@example.com
     - Developer contact: your-email@example.com
   - Skip optional scopes (we'll specify them in the app)
   - Save and continue

4. For OAuth Client ID:
   - Application type: "Web application"
   - Name: "SaarnaVideo Web"
   - Authorized redirect URIs:
     ```
     https://saarnavideo.example.com/api/integrations/youtube/callback
     http://localhost:3000/api/integrations/youtube/callback (for development)
     ```
   - Create

5. Copy and save:
   - Client ID
   - Client Secret

## Step 4: Configure SaarnaVideo

Set environment variables in your deployment:

```bash
YOUTUBE_CLIENT_ID=your-client-id-here
YOUTUBE_CLIENT_SECRET=your-client-secret-here
YOUTUBE_REDIRECT_URI=https://saarnavideo.example.com/api/integrations/youtube/callback
YOUTUBE_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)   # app and worker, keep it stable
```

The app asks for two scopes: `youtube.upload` (the video and its thumbnail) and `youtube.force-ssl` (caption tracks,
playlists). A connection made before `youtube.force-ssl` was requested still uploads videos; the publish panel then says
to reconnect for playlists and caption tracks.

## Step 5: Test the Connection

1. Start SaarnaVideo
2. In the UI, click "Connect YouTube"
3. Sign in with your YouTube account
4. Grant permissions when prompted
5. You should be redirected back to SaarnaVideo

The OAuth token is securely stored in the database `YouTubeConnection` table.

## Before the first real upload (read this)

- **Publishing status of the consent screen.** While the OAuth consent screen is in **Testing**, Google expires the
  refresh token after **7 days**: uploads then fail with "YouTube access was revoked or has expired". Set the app to
  **In production** (Google Auth Platform → Audience → Publish app). An unverified app in production shows a warning
  screen at connect time, which is fine for one church account.
- **Uploads from an unaudited API project are locked private.** Google locks every video uploaded through a Cloud
  project created after 28 July 2020 to private until the project passes the YouTube API compliance audit
  (https://support.google.com/youtube/contact/yt_api_form). Until then choose Private (or a scheduled release, which
  also stays private) and change the visibility in YouTube Studio. Unlisted/Public requests are accepted by the API but
  end up private.
- **Custom thumbnails** need a verified channel (phone verification in YouTube Studio); otherwise the thumbnail step
  fails soft and the publication shows a note.

## What a publication does

1. Uploads the latest final video with the resumable protocol in 8 MiB chunks (`YOUTUBE_UPLOAD_CHUNK_BYTES`).
   Refused chunks, 5xx and network errors are retried with backoff; after each failure the worker asks YouTube how far
   the upload got, so a lost answer never uploads the video twice. The session URL is stored on the publication:
   if the worker stops, another worker (or the restarted one) puts the publication back in the queue after 90 s and
   continues the same upload. A 401 refreshes the access token once.
2. Metadata: title, description, tags, category, language, made-for-kids flag, visibility or a scheduled release
   (`publishAt`, uploaded private) and "notify subscribers" come from the publish panel's "YouTube details"; empty
   fields use the project (title; preacher and Gospel reference as description). `{{name}}` project variables work.
3. Thumbnail (latest final THUMBNAIL output, max 2 MB), the playlist entry and the caption track (SRT rendered with the
   video) follow. These never fail the publication; problems are shown as a note on it and in the job log.

Never verified against the real YouTube API: everything above is exercised against `e2e/fake-youtube-server.ts`.

## Important Notes

### Security
- Client Secret must never be exposed in client-side code (it's server-side only)
- Access tokens are automatically refreshed as needed
- Tokens are stored securely in the database (encrypted if possible)

### Quota

YouTube API has quota limits (10,000 units/day by default). One publication costs about:
- videos.insert: 1,600 units (check the current value in Google's quota calculator; it has changed before)
- thumbnails.set: 50, playlistItems.insert: 50, captions.insert: 400, playlists.list: 1 per page

`quotaExceeded` errors say so in the publication's error text; the quota resets at midnight Pacific time.

If you exceed quota, consider:
- Requesting higher quota via Google Cloud Console
- Implementing queue with daily limits
- Batching operations

### Testing Without Real Credentials

For CI/CD or development:
1. Use environment variable mocks
2. Stub YouTube API responses
3. See `src/integrations/youtube.test.ts` for examples

## Troubleshooting

### "Redirect URI mismatch" Error
- Verify callback URL matches registered URIs exactly (including protocol, domain, path)
- Regenerate credentials if URL cannot be changed

### "Invalid client" Error
- Verify `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` are set correctly
- Check for extra spaces or line breaks in environment variables

### "Access Denied" During Authorization
- Verify OAuth consent screen is configured
- Account may need to be added as test user in development

### Videos Upload but with Errors
- Check quota usage in Google Cloud Console
- Verify video file format (H.264 video, AAC audio recommended)
- Check YouTube account is in good standing (no strikes/suspensions)

### Token Expired / "access was revoked or has expired"
- Access tokens refresh automatically (also once after an unexpected 401)
- `invalid_grant` means the refresh token is gone: the consent screen is still in Testing (7-day limit), the user
  revoked access, or the password changed. Disconnect and connect the account again.

## Privacy & Legal

- Inform users that videos will be uploaded to their YouTube channel
- Respect copyright and community guidelines
- Implement user consent for uploads
- Keep audit trail of who uploaded what and when

## Further Reading

- [YouTube API Documentation](https://developers.google.com/youtube/v3)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
- [YouTube API Quotas](https://developers.google.com/youtube/v3/getting-started#quota)
