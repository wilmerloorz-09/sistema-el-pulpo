export function formatSplitCodeLabel(splitCode: string | null | undefined) {
  const normalized = String(splitCode ?? "").trim();
  if (!normalized) return "";

  return normalized.replace(/(\d+)\s+([A-Z])$/i, "$1$2");
}
