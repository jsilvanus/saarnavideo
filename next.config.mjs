/** @type {import('next').NextConfig} */
const nextConfig = {
  // The e2e harness sets NEXT_DIST_DIR so its `next dev` never shares (and clobbers) the developer's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
