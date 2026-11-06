import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Documents are up to 20 MB; the limit counts the raw multipart body, so leave headroom.
    serverActions: { bodySizeLimit: "25mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
