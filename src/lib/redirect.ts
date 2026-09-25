const APPROVED_PREFIXES = ["/dashboard", "/onboarding"];

export function safeInternalRedirect(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://nextaction.invalid");

    if (parsed.origin !== "https://nextaction.invalid") {
      return fallback;
    }

    const approved = APPROVED_PREFIXES.some(
      (prefix) =>
        parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`),
    );

    if (!approved) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}
