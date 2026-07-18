import { isNonArrayRecord } from "@flarex/utils/records";
import { describe, expect, it } from "vitest";

import { decodeH05EvidenceWindow } from "../h05/evidenceWindow";

describe("H05 evidence windows", () => {
  it.each([
    {
      fieldOrder: "startedAtFirst" as const,
      expectedKeys: ["startedAt", "finishedAt"],
      expectedPaths: ["window.startedAt", "window.finishedAt"],
    },
    {
      fieldOrder: "finishedAtFirst" as const,
      expectedKeys: ["finishedAt", "startedAt"],
      expectedPaths: ["window.finishedAt", "window.startedAt"],
    },
  ])("preserves $fieldOrder decoding and key order", ({
    fieldOrder,
    expectedKeys,
    expectedPaths,
  }) => {
    const decodedPaths: string[] = [];
    const window = decodeH05EvidenceWindow(
      {
        finishedAt: "2026-07-11T10:00:07.000Z",
        startedAt: "2026-07-11T10:00:00.000Z",
      },
      "window",
      (value, _path, _keys) => {
        if (!isNonArrayRecord(value)) {
          throw new Error("window must be an object.");
        }
        return value;
      },
      (value, path) => {
        decodedPaths.push(path);
        if (typeof value !== "string") throw new Error(`${path} must be a string.`);
        return value;
      },
      fieldOrder,
    );

    expect(decodedPaths).toEqual(expectedPaths);
    expect(Object.keys(window)).toEqual(expectedKeys);
  });

  it("delegates exact-record validation before decoding either timestamp", () => {
    const decodedPaths: string[] = [];
    const recordCalls: Array<{
      readonly path: string;
      readonly keys: readonly string[];
    }> = [];

    expect(() => decodeH05EvidenceWindow(
      { startedAt: "2026-07-11T10:00:00.000Z" },
      "window",
      (_value, path, keys) => {
        recordCalls.push({ path, keys });
        throw new Error("record rejected");
      },
      (_value, path) => {
        decodedPaths.push(path);
        return "unused";
      },
      "startedAtFirst",
    )).toThrow("record rejected");
    expect(recordCalls).toEqual([{
      path: "window",
      keys: ["finishedAt", "startedAt"],
    }]);
    expect(decodedPaths).toEqual([]);
  });
});
