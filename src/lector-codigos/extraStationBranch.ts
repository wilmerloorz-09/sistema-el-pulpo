const STORAGE_KEY = "extraStationBranchId";

export function getExtraStationBranchId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setExtraStationBranchId(branchId: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, branchId);
    localStorage.setItem(STORAGE_KEY, branchId);
    localStorage.setItem("activeBranchId", branchId);
  } catch {
    // ignore
  }
}

export function clearExtraStationBranchId() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
