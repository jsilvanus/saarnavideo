/** @type {import('next').NextConfig} */
const nextConfig = {
  // The e2e harness sets NEXT_DIST_DIR so its `next dev` never shares (and clobbers) the developer's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  
  // Allow large file uploads (multipart form data).
  // Default is 10MB; increase to 500MB to support video file uploads.
  // Addresses: "Request body exceeded 10MB" errors in file upload endpoints.
  experimental: {
    middlewareClientMaxBodySize: "500MB",
  },
};

export default nextConfig;
