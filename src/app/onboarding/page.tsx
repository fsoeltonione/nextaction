import { redirect } from "next/navigation";

type OnboardingSearchParams = {
  url?: string | string[];
  workspace_id?: string | string[];
  mode?: string | string[];
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<OnboardingSearchParams>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  // URL-first activation is retained as metadata only. Keep the pending
  // context when handing off to the embed-first activation form; no crawler,
  // scanner, or AI analysis runs on this route.
  for (const key of ["url", "workspace_id", "mode"] as const) {
    const value = params[key];
    const firstValue = Array.isArray(value) ? value[0] : value;
    if (typeof firstValue === "string" && firstValue.trim()) {
      query.set(key, firstValue);
    }
  }

  const suffix = query.toString();
  redirect(suffix ? `/activate?${suffix}` : "/activate");
}
