import { describe, expect, it } from "vitest";
import {
  runFlarexDevCli,
  type FlarexDeployJsonOutput,
  type FlarexDevCliOptions,
} from "flarex-dev";

class StringWriter {
  value = "";

  write(chunk: string): void {
    this.value += chunk;
  }
}

describe("flarex-dev package entrypoint", () => {
  it("exports the CLI runner and deploy JSON output types", async () => {
    const stdout = new StringWriter();
    const options = {
      argv: ["help"],
      stdout,
    } satisfies FlarexDevCliOptions;

    await expect(runFlarexDevCli(options)).resolves.toBe(0);

    const output: FlarexDeployJsonOutput = {
      command: "deploy",
      result: "activated",
      started: { pushId: "push1", state: "analyzed" },
      finished: { pushId: "push1", state: "activated" },
    };
    expect(output.result).toBe("activated");
    expect(stdout.value).toContain("flarex-dev <command>");
  });
});
