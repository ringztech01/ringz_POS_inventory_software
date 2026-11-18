import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Floor plan images (Part 7) are up to 8 MB; the action itself rejects
      // anything larger. The default is 1 MB.
      bodySizeLimit: "9mb",
    },
    // proxy.ts runs on every route, and buffers request bodies up to this
    // size (10 MB by default — larger ones arrive cut short). The digital
    // menu's media uploads (Part 8 Step 5) take 3D models up to 15 MB and
    // videos up to 30 MB; each upload route refuses anything bigger itself.
    proxyClientMaxBodySize: "32mb",
  },
};

export default nextConfig;
