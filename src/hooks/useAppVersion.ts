import { useEffect, useState } from "react";

const VERSION_STORAGE_KEY = "elpulpo-app-version";
const BUILT_AT_STORAGE_KEY = "elpulpo-app-built-at";

function formatVersion(value: string | null) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  return clean.length > 12 ? clean.slice(0, 12) : clean;
}

function normalizeText(value: unknown) {
  const clean = String(value ?? "").trim();
  return clean || null;
}

export function useAppVersion() {
  const [versionInfo, setVersionInfo] = useState(() => ({
    version: formatVersion(window.localStorage.getItem(VERSION_STORAGE_KEY)),
    fullVersion: normalizeText(window.localStorage.getItem(VERSION_STORAGE_KEY)),
    builtAt: normalizeText(window.localStorage.getItem(BUILT_AT_STORAGE_KEY)),
  }));

  useEffect(() => {
    let cancelled = false;

    const loadVersion = async () => {
      try {
        const response = await fetch(`/app-version.json?t=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const payload = await response.json();
        const fullVersion = normalizeText(payload?.version);
        const nextVersion = formatVersion(fullVersion);
        const builtAt = normalizeText(payload?.builtAt);
        if (!cancelled && nextVersion) {
          setVersionInfo({ version: nextVersion, fullVersion, builtAt });
          window.localStorage.setItem(VERSION_STORAGE_KEY, fullVersion ?? nextVersion);
          if (builtAt) {
            window.localStorage.setItem(BUILT_AT_STORAGE_KEY, builtAt);
          }
        }
      } catch {
        // La version es informativa; no debe bloquear la navegacion.
      }
    };

    void loadVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  return versionInfo;
}
