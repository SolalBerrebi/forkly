/**
 * Persisted "what should + new session default to?" preference, set during
 * onboarding and editable later. Stored in localStorage as a single object
 * so we capture provider + model + transport together — picking just one
 * of the three would yield invalid combos.
 */

import type { TransportId } from "./ipc";

const STORAGE_KEY = "forkly:preferred-provider";
const ONBOARDED_KEY = "forkly:onboarded";

export interface PreferredProvider {
  providerId: string;
  modelId: string;
  transportId: TransportId;
}

export function getPreferredProvider(): PreferredProvider | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PreferredProvider>;
    if (
      typeof parsed.providerId === "string" &&
      typeof parsed.modelId === "string" &&
      typeof parsed.transportId === "string"
    ) {
      return parsed as PreferredProvider;
    }
  } catch {
    // fall through
  }
  return null;
}

export function setPreferredProvider(pref: PreferredProvider) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
}

export function isOnboarded(): boolean {
  if (typeof window === "undefined") return true; // SSR safety
  return window.localStorage.getItem(ONBOARDED_KEY) === "1";
}

export function markOnboarded() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDED_KEY, "1");
}

export function resetOnboarded() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ONBOARDED_KEY);
}
