import { env } from "cloudflare:workers";

type RuntimeBindings = Record<string, string | undefined>;

const cloudflareEnv = env as RuntimeBindings;

export function getAnalysisProviderConfig(): {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
} {
  return {
    apiKey:
      process.env.ANALYSIS_API_KEY?.trim() ||
      cloudflareEnv.ANALYSIS_API_KEY?.trim(),
    baseUrl:
      process.env.ANALYSIS_BASE_URL?.trim() ||
      cloudflareEnv.ANALYSIS_BASE_URL?.trim(),
    model:
      process.env.ANALYSIS_MODEL?.trim() ||
      cloudflareEnv.ANALYSIS_MODEL?.trim(),
  };
}
