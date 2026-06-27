import { describe, expect, it } from "vitest";
import { validateDiagnostics, validateSourcePackage } from "../src/deployment/Validation";
import { HttpError } from "../src/http";
import type { PushSourcePackage } from "../src/types";

describe("deployment validation", () => {
  it("normalizes source package modules and function paths", () => {
    const normalized = validateSourcePackage({
      modules: [
        sourceModule("functions/list.ts"),
        sourceModule("convex/_generated/server.ts"),
        sourceModule("schema.ts"),
      ],
      functions: ["functions/list.ts"],
      schema: "schema.ts",
      execution: "convex/_generated/server.ts",
    });

    expect(normalized.modules.map(module => module.path)).toEqual([
      "convex/_generated/server.ts",
      "functions/list.ts",
      "schema.ts",
    ]);
    expect(normalized.functions).toEqual(["functions/list.ts"]);
  });

  it("preserves source package validation error messages", () => {
    expect(() =>
      validateSourcePackage({
        modules: "not-modules",
        functions: [],
        execution: "convex/_generated/server.ts",
      } as unknown as PushSourcePackage)
    ).toThrow(new HttpError(400, "Source package modules must be an array."));

    expect(() =>
      validateSourcePackage({
        modules: [sourceModule("convex/_generated/server.ts")],
        functions: ["missing.ts"],
        execution: "convex/_generated/server.ts",
      })
    ).toThrow(new HttpError(400, "Source package function module missing.ts is missing."));
  });

  it("normalizes diagnostics and keeps the newest 100 entries", () => {
    const diagnostics = Array.from({ length: 101 }, (_, index) => ({
      level: "log" as const,
      message: `diagnostic ${index}`,
    }));

    const normalized = validateDiagnostics(diagnostics);

    expect(normalized).toHaveLength(100);
    expect(normalized[0]).toEqual({ level: "log", message: "diagnostic 1" });
    expect(normalized[99]).toEqual({ level: "log", message: "diagnostic 100" });
  });

  it("preserves diagnostics validation error messages", () => {
    expect(() => validateDiagnostics("not-diagnostics")).toThrow(
      new HttpError(400, "Push diagnostics must be an array."),
    );
    expect(() => validateDiagnostics([{ level: "debug", message: "too chatty" }])).toThrow(
      new HttpError(400, "Push diagnostic at index 0 has an invalid level."),
    );
  });
});

function sourceModule(path: string): PushSourcePackage["modules"][number] {
  return {
    path,
    environment: "isolate",
    sha256: "a".repeat(64),
    source: `export default ${JSON.stringify(path)};`,
  };
}
