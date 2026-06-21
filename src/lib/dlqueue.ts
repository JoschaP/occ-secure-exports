// Pure state transformations for the download queue.
//
// The queue is a plain `Record<string, DlItem>` keyed by S3 object key. Every
// mutation is a pure function returning a new map (or the same reference when
// nothing changed), so the reducers are trivially unit-testable in isolation
// from React and the Tauri event plumbing in App.tsx.

import type { DownloadPlanItem } from "./tree";
import type { FileResult, ProgressEvent } from "../types";

export interface DlItem {
  key: string;
  /** Relative destination path — used as the display name and for retry. */
  relPath: string;
  /** Destination folder chosen for this download (retry + reveal context). */
  destDir: string;
  done: number;
  total: number;
  status: "running" | "ok" | "error";
  error?: string;
  /** Final saved path, once done — used by "show in folder". */
  path?: string;
}

export type DlMap = Record<string, DlItem>;

/** Queue the given plan as running items under one destination folder. New
 *  entries are merged in (an in-flight queue is never replaced wholesale). */
export function addItems(
  items: DlMap,
  plan: DownloadPlanItem[],
  destDir: string,
): DlMap {
  if (plan.length === 0) return items;
  const added: DlMap = {};
  for (const p of plan) {
    added[p.key] = {
      key: p.key,
      relPath: p.relPath,
      destDir,
      done: 0,
      total: 0,
      status: "running",
    };
  }
  return { ...items, ...added };
}

/** Apply a progress tick. Ignored if the key isn't in the queue (a stale event
 *  from a cleared item). */
export function applyProgress(items: DlMap, e: ProgressEvent): DlMap {
  const cur = items[e.key];
  if (!cur) return items;
  return {
    ...items,
    [e.key]: { ...cur, done: e.done, total: e.total },
  };
}

/** Apply a completion event, flipping the item to ok/error. On success the
 *  progress bar is snapped to full so a missing final tick can't leave it shy
 *  of 100%. Ignored for unknown keys. */
export function applyFileDone(items: DlMap, e: FileResult): DlMap {
  const cur = items[e.key];
  if (!cur) return items;
  return {
    ...items,
    [e.key]: {
      ...cur,
      status: e.ok ? "ok" : "error",
      error: e.error ?? undefined,
      path: e.path ?? cur.path,
      done: e.ok ? cur.total || cur.done : cur.done,
    },
  };
}

/** Reset a finished/failed item back to running for a retry. Ignored for
 *  unknown keys. */
export function markRetrying(items: DlMap, key: string): DlMap {
  const cur = items[key];
  if (!cur) return items;
  return {
    ...items,
    [key]: { ...cur, status: "running", done: 0, error: undefined },
  };
}

/** Drop every finished (ok/error) item, keeping only those still running. */
export function clearFinished(items: DlMap): DlMap {
  const next: DlMap = {};
  for (const [k, v] of Object.entries(items)) {
    if (v.status === "running") next[k] = v;
  }
  return next;
}
