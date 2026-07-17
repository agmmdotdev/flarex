import { describe, expect, it } from "vitest";

import { commandOutput } from "../scripts/commandOutput";

describe("command output", () => {
  it("returns trimmed UTF-8 stdout while preserving interior whitespace", () => {
    expect(
      commandOutput(process.execPath, [
        "-e",
        "process.stdout.write('  first\\nsecond  ')",
      ]),
    ).toBe("first\nsecond");
  });

  it("propagates child-process failures", () => {
    expect(
      () => commandOutput(process.execPath, [
        "-e",
        "process.exit(7)",
      ]),
    ).toThrow();
  });
});
