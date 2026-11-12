import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Floor plan images (Part 7) are up to 8 MB; the action itself rejects
      // anything larger. The default is 1 MB.
      bodySizeLimit: "9mb",
    },
  },
};

export default nextConfig;
