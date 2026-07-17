import { describe, expect, it } from "vitest";

import {
  requiredEnvironmentValue,
  requiredUntrimmedEnvironmentValue,
} from "../scripts/h05Environment";

describe("H05 environment values", () => {
  it("trims identifiers and rejects missing or blank values", () => {
    expect(requiredEnvironmentValue("  account-id  ", "ACCOUNT_ID")).toBe(
      "account-id",
    );
    expect(() => requiredEnvironmentValue(undefined, "ACCOUNT_ID")).toThrow(
      "ACCOUNT_ID is required.",
    );
    expect(() => requiredEnvironmentValue("", "ACCOUNT_ID")).toThrow(
      "ACCOUNT_ID is required.",
    );
    expect(() => requiredEnvironmentValue(" \t\n", "ACCOUNT_ID")).toThrow(
      "ACCOUNT_ID is required.",
    );
  });

  it("preserves secrets verbatim and rejects only missing or empty values", () => {
    expect(requiredUntrimmedEnvironmentValue("  token  ", "API_TOKEN")).toBe(
      "  token  ",
    );
    expect(requiredUntrimmedEnvironmentValue(" ", "API_TOKEN")).toBe(" ");
    expect(() =>
      requiredUntrimmedEnvironmentValue(undefined, "API_TOKEN"),
    ).toThrow("API_TOKEN is required.");
    expect(() => requiredUntrimmedEnvironmentValue("", "API_TOKEN")).toThrow(
      "API_TOKEN is required.",
    );
  });
});
