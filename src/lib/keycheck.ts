import type { KeyMatchStatus } from "../types";

export interface KeyCheckSummary {
  matches: number;
  mismatches: number;
  plain: number;
  unknown: number;
}

/** A cached per-key check result with the time (epoch ms) it was recorded. */
export interface CachedCheck {
  status: KeyMatchStatus;
  at: number;
}

/** How long a cached key-check result stays valid before it is re-probed. */
export const CHECK_TTL_MS = 5 * 60 * 1000;

/** True if `entry` exists and has not yet exceeded the TTL at time `now`. */
export function isFresh(
  entry: CachedCheck | undefined,
  now: number,
  ttlMs: number = CHECK_TTL_MS,
): entry is CachedCheck {
  return entry !== undefined && now - entry.at <= ttlMs;
}

/**
 * Aggregate cached per-key check results for the given keys, ignoring entries
 * that are missing or stale (older than `ttlMs`). Returns `null` when nothing
 * fresh is known yet, so the UI can stay quiet instead of flashing a
 * misleading "all clear".
 */
export function summarizeKeyChecks(
  keys: string[],
  cache: Map<string, CachedCheck>,
  now: number,
  ttlMs: number = CHECK_TTL_MS,
): KeyCheckSummary | null {
  const summary: KeyCheckSummary = {
    matches: 0,
    mismatches: 0,
    plain: 0,
    unknown: 0,
  };
  let known = 0;
  for (const key of keys) {
    const entry = cache.get(key);
    if (!isFresh(entry, now, ttlMs)) continue;
    known++;
    if (entry.status === "match") summary.matches++;
    else if (entry.status === "mismatch") summary.mismatches++;
    else if (entry.status === "plain") summary.plain++;
    else summary.unknown++;
  }
  return known > 0 ? summary : null;
}
