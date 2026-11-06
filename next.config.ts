import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Greeting image uploads are up to 2 MB; the limit counts the raw multipart body.
    serverActions: { bodySizeLimit: "3mb" },
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
