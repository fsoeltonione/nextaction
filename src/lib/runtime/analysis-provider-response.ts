export function parseAnalysisProviderResponse(responseText: string): unknown {
  const trimmed = responseText.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    const doneMarker = "data: [DONE]";
    const markerIndex = trimmed.lastIndexOf(doneMarker);

    if (markerIndex <= 0) {
      throw error;
    }

    const suffix = trimmed.slice(markerIndex + doneMarker.length).trim();
    if (suffix !== "") {
      throw error;
    }

    const jsonCandidate = trimmed.slice(0, markerIndex).trimEnd();
    if (jsonCandidate.length === 0) {
      throw error;
    }

    return JSON.parse(jsonCandidate) as unknown;
  }
}
