import { describe, expect, it } from "vitest";

import {
  summarizeKeyChecks,
  isFresh,
  CHECK_TTL_MS,
  type CachedCheck,
} from "./keycheck";
import type { KeyMatchStatus } from "../types";

const NOW = 1_000_000;
const at = (status: KeyMatchStatus, ageMs = 0): CachedCheck => ({
  status,
  at: NOW - ageMs,
});
const cache = (entries: Record<string, CachedCheck>) =>
  new Map(Object.entries(entries));

describe("isFresh", () => {
  it("is false for missing entries", () => {
    expect(isFresh(undefined, NOW)).toBe(false);
  });
  it("is true within the TTL and false once exceeded", () => {
    expect(isFresh(at("match", CHECK_TTL_MS - 1), NOW)).toBe(true);
    expect(isFresh(at("match", CHECK_TTL_MS + 1), NOW)).toBe(false);
  });
});

describe("summarizeKeyChecks", () => {
  it("returns null when nothing is cached yet", () => {
    expect(summarizeKeyChecks(["a.age", "b.age"], new Map(), NOW)).toBeNull();
  });

  it("counts each fresh status for the given keys", () => {
    const c = cache({
      "a.age": at("match"),
      "b.age": at("mismatch"),
      "c.age": at("match"),
      "d.json": at("plain"),
    });
    expect(
      summarizeKeyChecks(["a.age", "b.age", "c.age", "d.json"], c, NOW),
    ).toEqual({ matches: 2, mismatches: 1, plain: 1, unknown: 0 });
  });

  it("ignores keys not in the cache", () => {
    const c = cache({ "a.age": at("match") });
    expect(summarizeKeyChecks(["a.age", "b.age"], c, NOW)).toEqual({
      matches: 1,
      mismatches: 0,
      plain: 0,
      unknown: 0,
    });
  });

  it("treats stale entries as unknown (re-probe needed)", () => {
    const c = cache({
      "a.age": at("match", CHECK_TTL_MS + 1), // expired
      "b.age": at("mismatch"), // fresh
    });
    expect(summarizeKeyChecks(["a.age", "b.age"], c, NOW)).toEqual({
      matches: 0,
      mismatches: 1,
      plain: 0,
      unknown: 0,
    });
  });
});
