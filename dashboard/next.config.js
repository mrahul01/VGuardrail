/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output produces a self-contained `server.js` that
  // bundles only the production dependencies required to run the
  // dashboard. This is what the Docker image copies into its
  // runtime stage.
  output: "standalone",
  experimental: {
    serverActions: true,
  },
};

module.exports = nextConfig;
