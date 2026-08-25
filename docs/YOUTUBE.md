# YouTube integration

## OAuth setup

1. Enable the YouTube Data API in the Google Cloud project used by SaarnaVideo.
2. Create OAuth 2.0 credentials for a Web application.
3. Add the exact value of `YOUTUBE_REDIRECT_URI` as an authorized redirect URI.
4. Configure:

```text
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/integrations/youtube/callback
YOUTUBE_TOKEN_ENCRYPTION_KEY=<64 hex characters>
```

Generate the encryption key with:

```bash
openssl rand -hex 32
```

The encryption key must remain stable. Losing or changing it means previously stored OAuth tokens cannot be decrypted and the account must be connected again.

## Source workflow

A project accepts a normal YouTube URL (`watch`, `youtu.be`, `shorts`, or `live`). The URL is stored as a `YOUTUBE` source. When generation is requested, the application creates a `DOWNLOAD` media job and the worker uses the yt-dlp included in its Docker image to acquire the source. Rendering jobs depend on the download job.

The web application never needs yt-dlp installed on the host.

## Publication workflow

1. Connect the YouTube account through **Connect YouTube**.
2. Generate a normal VIDEO output.
3. Request publication from the project.
4. The application creates a queued `Publication`.
5. The worker obtains/refreshes the OAuth access token and uploads the MP4.
6. If a thumbnail is available, it is uploaded to the new YouTube video.
7. The resulting YouTube video ID and publication status are stored in PostgreSQL.

Publication defaults to **private**. Public publishing must be explicitly requested.

## Security

OAuth `state` is generated server-side and stored in an HttpOnly, SameSite cookie for the callback check. Access and refresh tokens are encrypted using AES-256-GCM before being stored in the database.

The database should be treated as sensitive even though the OAuth tokens are encrypted. Never commit OAuth client secrets or `YOUTUBE_TOKEN_ENCRYPTION_KEY`.
