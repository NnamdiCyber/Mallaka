import type { Lease } from "./types";

/** Last-known lease state, kept so the app still works offline (labelled "last updated" in the UI). */
export interface SavedLease {
  lease: Lease;
  savedAt: string;
}

const key = (id: string) => `mallaka:lease:${id}`;
const LIST_KEY = "mallaka:lease-ids";

export function saveLease(lease: Lease, now = new Date()): void {
  try {
    localStorage.setItem(key(lease.id), JSON.stringify({ lease, savedAt: now.toISOString() } satisfies SavedLease));
    const ids = new Set<string>(JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]"));
    ids.add(lease.id);
    localStorage.setItem(LIST_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage full or blocked: the app still works online */
  }
}

export function loadSavedLeases(): SavedLease[] {
  try {
    const ids: string[] = JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]");
    return ids
      .map((id) => localStorage.getItem(key(id)))
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as SavedLease);
  } catch {
    return [];
  }
}
