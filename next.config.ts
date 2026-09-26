import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "cloudflare:workers": "./src/utils/cloudflare-workers-fallback.ts",
    },
  },
};

export default nextConfig;
