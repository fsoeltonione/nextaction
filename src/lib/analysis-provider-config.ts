type RuntimeBindings = Record<string, string | undefined>;

async function readCloudflareBindings(): Promise<RuntimeBindings> {
  try {
    const module = await import(
      /* @vite-ignore */
      /* webpackIgnore: true */
      "cloudflare:workers"
    );

    const bindings = module.env as RuntimeBindings;
    return bindings ?? {};
  } catch {
    return {};
  }
}

export async function getAnalysisProviderConfig(): Promise<{
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}> {
  const bindings = await readCloudflareBindings();

  return {
    apiKey:
      process.env.ANALYSIS_API_KEY?.trim() ??
      bindings.ANALYSIS_API_KEY?.trim(),
    baseUrl:
      process.env.ANALYSIS_BASE_URL?.trim() ??
      bindings.ANALYSIS_BASE_URL?.trim(),
    model:
      process.env.ANALYSIS_MODEL?.trim() ??
      bindings.ANALYSIS_MODEL?.trim(),
  };
}
