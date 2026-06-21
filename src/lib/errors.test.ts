import { describe, expect, it } from "vitest";

import { errCode, errText } from "./errors";

describe("errText", () => {
  it("reads the message from a structured core error", () => {
    expect(errText({ code: "s3", message: "Storage down" })).toBe(
      "Storage down",
    );
  });

  it("reads the message from an Error instance", () => {
    expect(errText(new Error("boom"))).toBe("boom");
  });

  it("stringifies a plain string or other value", () => {
    expect(errText("raw failure")).toBe("raw failure");
    expect(errText(42)).toBe("42");
  });
});

describe("errCode", () => {
  it("returns the code for a structured core error", () => {
    expect(errCode({ code: "missing_credentials", message: "x" })).toBe(
      "missing_credentials",
    );
  });

  it("returns undefined for non-core errors", () => {
    expect(errCode("just a string")).toBeUndefined();
    expect(errCode(new Error("e"))).toBeUndefined();
    expect(errCode({ message: "no code field" })).toBeUndefined();
    expect(errCode(null)).toBeUndefined();
  });
});
