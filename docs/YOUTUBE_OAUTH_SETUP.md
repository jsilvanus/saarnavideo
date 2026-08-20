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
```

## Step 5: Test the Connection

1. Start SaarnaVideo
2. In the UI, click "Connect YouTube"
3. Sign in with your YouTube account
4. Grant permissions when prompted
5. You should be redirected back to SaarnaVideo

The OAuth token is securely stored in the database `YouTubeConnection` table.

## Important Notes

### Security
- Client Secret must never be exposed in client-side code (it's server-side only)
- Access tokens are automatically refreshed as needed
- Tokens are stored securely in the database (encrypted if possible)

### Quota

YouTube API has quota limits:
- Free tier: 10,000 units/day
- Upload video: ~1,600 units
- Set thumbnail: ~50 units
- Get video info: ~1 unit per call

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

### Token Expired
- Tokens automatically refresh when needed
- If manual refresh needed, delete row in `YouTubeConnection` and reconnect

## Privacy & Legal

- Inform users that videos will be uploaded to their YouTube channel
- Respect copyright and community guidelines
- Implement user consent for uploads
- Keep audit trail of who uploaded what and when

## Further Reading

- [YouTube API Documentation](https://developers.google.com/youtube/v3)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
- [YouTube API Quotas](https://developers.google.com/youtube/v3/getting-started#quota)
