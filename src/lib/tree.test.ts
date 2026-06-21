import { describe, expect, it } from "vitest";

import {
  buildDownloadPlan,
  buildTree,
  checkableAgeKeys,
  collectKeys,
} from "./tree";
import type { ObjectInfo } from "../types";

const objects: ObjectInfo[] = [
  { key: "acme/api/2026-06-20/a.json.age", size: 10, lastModified: null },
  { key: "acme/api/manifest.json", size: 20, lastModified: null },
  { key: "acme/README.txt", size: 5, lastModified: null },
];

describe("buildTree / collectKeys", () => {
  it("collects every object key beneath a folder", () => {
    const tree = buildTree(objects);
    const acme = tree.find((n) => n.name === "acme")!;
    expect(collectKeys(acme).sort()).toEqual(
      [
        "acme/api/2026-06-20/a.json.age",
        "acme/api/manifest.json",
        "acme/README.txt",
      ].sort(),
    );
  });
});

describe("checkableAgeKeys", () => {
  it("returns only directly-selected .age files", () => {
    expect(
      checkableAgeKeys([
        { isFolder: false, key: "x/a.json.age" },
        { isFolder: false, key: "x/b.json" }, // not encrypted
      ]),
    ).toEqual(["x/a.json.age"]);
  });

  it("never probes a selected folder, even if it contains .age files", () => {
    // A folder node carries no `key`; its .age contents must NOT be checked.
    expect(
      checkableAgeKeys([
        { isFolder: true, key: undefined },
        { isFolder: true, key: undefined },
      ]),
    ).toEqual([]);
  });

  it("ignores folders mixed in with a selected file", () => {
    expect(
      checkableAgeKeys([
        { isFolder: true, key: undefined },
        { isFolder: false, key: "x/a.json.age" },
      ]),
    ).toEqual(["x/a.json.age"]);
  });

  it("matches the .age suffix case-insensitively", () => {
    expect(
      checkableAgeKeys([{ isFolder: false, key: "x/A.JSON.AGE" }]),
    ).toEqual(["x/A.JSON.AGE"]);
  });
});

describe("buildDownloadPlan", () => {
  const tree = buildTree(objects); // acme/{api/{2026-06-20/a.json.age, manifest.json}, README.txt}
  const acme = tree.find((n) => n.name === "acme")!;
  const api = acme.children!.find((n) => n.name === "api")!;

  it("downloads a single file flat (name only, .age stripped)", () => {
    const dateDir = api.children!.find((n) => n.name === "2026-06-20")!;
    const file = dateDir.children!.find((n) => n.name === "a.json.age")!;
    expect(buildDownloadPlan([file])).toEqual([
      { key: "acme/api/2026-06-20/a.json.age", relPath: "a.json" },
    ]);
  });

  it("preserves structure under a selected folder as a top-level dir", () => {
    expect(buildDownloadPlan([acme])).toEqual([
      { key: "acme/api/2026-06-20/a.json.age", relPath: "acme/api/2026-06-20/a.json" },
      { key: "acme/api/manifest.json", relPath: "acme/api/manifest.json" },
      { key: "acme/README.txt", relPath: "acme/README.txt" },
    ]);
  });

  it("de-duplicates when a folder and a file inside it are both selected", () => {
    const file = api.children!.find((n) => n.name === "manifest.json")!;
    const plan = buildDownloadPlan([api, file]);
    const keys = plan.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length); // no dupes
  });
});
