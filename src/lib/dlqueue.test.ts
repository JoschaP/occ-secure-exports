import { describe, expect, it } from "vitest";

import {
  type DlItem,
  type DlMap,
  addItems,
  applyFileDone,
  applyProgress,
  clearFinished,
  markRetrying,
} from "./dlqueue";

const running = (over: Partial<DlItem> = {}): DlItem => ({
  key: "k",
  relPath: "a/b.json",
  destDir: "/dest",
  done: 0,
  total: 0,
  status: "running",
  ...over,
});

describe("addItems", () => {
  it("queues a plan as running items under the destination", () => {
    const out = addItems(
      {},
      [
        { key: "k1", relPath: "one.json" },
        { key: "k2", relPath: "sub/two.json" },
      ],
      "/dest",
    );
    expect(Object.keys(out)).toEqual(["k1", "k2"]);
    expect(out.k1).toMatchObject({
      key: "k1",
      relPath: "one.json",
      destDir: "/dest",
      done: 0,
      total: 0,
      status: "running",
    });
  });

  it("merges into an existing queue without dropping in-flight items", () => {
    const existing: DlMap = { old: running({ key: "old" }) };
    const out = addItems(existing, [{ key: "new", relPath: "n" }], "/d");
    expect(Object.keys(out).sort()).toEqual(["new", "old"]);
    expect(out.old).toBe(existing.old);
  });

  it("returns the same reference for an empty plan", () => {
    const existing: DlMap = { old: running({ key: "old" }) };
    expect(addItems(existing, [], "/d")).toBe(existing);
  });
});

describe("applyProgress", () => {
  it("updates done/total for a known key", () => {
    const items: DlMap = { k: running() };
    const out = applyProgress(items, { key: "k", done: 50, total: 100 });
    expect(out.k).toMatchObject({ done: 50, total: 100, status: "running" });
  });

  it("ignores a tick for an unknown key (returns same ref)", () => {
    const items: DlMap = { k: running() };
    expect(applyProgress(items, { key: "gone", done: 1, total: 2 })).toBe(
      items,
    );
  });
});

describe("applyFileDone", () => {
  it("snaps progress to full on success", () => {
    const items: DlMap = { k: running({ done: 90, total: 100 }) };
    const out = applyFileDone(items, {
      key: "k",
      ok: true,
      error: null,
      path: "/dest/a/b.json",
      bytes: 100,
    });
    expect(out.k).toMatchObject({
      status: "ok",
      done: 100,
      path: "/dest/a/b.json",
      error: undefined,
    });
  });

  it("records an error and preserves progress on failure", () => {
    const items: DlMap = { k: running({ done: 40, total: 100 }) };
    const out = applyFileDone(items, {
      key: "k",
      ok: false,
      error: "wrong key",
      path: null,
      bytes: 0,
    });
    expect(out.k).toMatchObject({
      status: "error",
      error: "wrong key",
      done: 40,
    });
  });

  it("ignores completion for an unknown key", () => {
    const items: DlMap = { k: running() };
    const out = applyFileDone(items, {
      key: "gone",
      ok: true,
      error: null,
      path: null,
      bytes: 0,
    });
    expect(out).toBe(items);
  });
});

describe("markRetrying", () => {
  it("resets a failed item back to running and clears the error", () => {
    const items: DlMap = {
      k: running({ status: "error", error: "boom", done: 10 }),
    };
    const out = markRetrying(items, "k");
    expect(out.k).toMatchObject({
      status: "running",
      done: 0,
      error: undefined,
    });
  });

  it("ignores an unknown key", () => {
    const items: DlMap = { k: running() };
    expect(markRetrying(items, "gone")).toBe(items);
  });
});

describe("clearFinished", () => {
  it("drops ok/error items and keeps running ones", () => {
    const items: DlMap = {
      a: running({ key: "a", status: "ok" }),
      b: running({ key: "b", status: "error" }),
      c: running({ key: "c", status: "running" }),
    };
    const out = clearFinished(items);
    expect(Object.keys(out)).toEqual(["c"]);
    expect(out.c).toBe(items.c);
  });
});
