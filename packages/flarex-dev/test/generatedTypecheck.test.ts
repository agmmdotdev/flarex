import { describe, expect, it } from "vitest";
import {
  generatedOutputTypecheckOptions,
  type FlarexGeneratedOutputTypecheckOption,
} from "../src/generatedTypecheck";

describe("generatedOutputTypecheckOptions", () => {
  it("keeps host codegen paths authoritative over structurally wider nested configs", () => {
    const nestedConfig = {
      root: "/stale-root",
      appDir: "stale-app",
      generatedDir: "stale-generated",
      cwd: "/workspace",
    };

    expect(generatedOutputTypecheckOptions({
      root: "/app",
      typecheckGeneratedOutput: nestedConfig as FlarexGeneratedOutputTypecheckOption,
    })).toEqual({
      root: "/app",
      cwd: "/workspace",
    });
  });
});
