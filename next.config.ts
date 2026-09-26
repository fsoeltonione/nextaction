import type { NextConfig } from "next";

const isVinextCloudflareBuild = process.env.VINEXT_CLOUDFLARE === "1";

const nextConfig: NextConfig = isVinextCloudflareBuild
  ? {}
  : {
      turbopack: {
        resolveAlias: {
          "cloudflare:workers": "./src/utils/cloudflare-workers-fallback.ts",
        },
      },
    };

export default nextConfig;
