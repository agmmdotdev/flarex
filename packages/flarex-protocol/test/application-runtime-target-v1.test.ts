import { Result } from "effect";
import { describe, expect, it } from "vitest";
import type { ValidatorJsonV1 } from "../src/validator-json";

import {
  canonicalizeApplicationRuntimeTargetV1,
  decodeApplicationRuntimeTargetV1,
  captureApplicationRuntimeTargetV1,
  applicationRuntimeTargetWireV1,
} from "../src/application-runtime-target-v1";

describe("ApplicationRuntimeTargetV1", () => {
  it("canonicalizes one whole-bundle function target and owns the input", () => {
    const input = target();
    const canonical = Result.getOrThrow(
      canonicalizeApplicationRuntimeTargetV1(input),
    );
    input.function.args.value.id.fieldType.tableName = "changed";

    expect(canonical.target.function.args).toEqual({
      type: "object",
      value: {
        id: {
          fieldType: { type: "id", tableName: "users" },
          optional: false,
        },
      },
    });
    expect(Object.isFrozen(canonical.target.function.args)).toBe(true);
    expect(canonical.canonicalText).toBe(
      new TextDecoder().decode(canonical.canonicalBytes),
    );
    expect(canonical.canonicalText).not.toContain("semantic");
  });

  it("selects current record wire admission independently from semantic capture", () => {
    const base = target();
    const record = { type: "record", keys: { type: "string" }, values: { type: "number" } };
    const semantic = { ...base, function: { ...base.function,
      args: { type: "object", value: { scores: { fieldType: record, optional: false } } },
      returns: { type: "union", value: [{ type: "null" }, record] },
    } };
    const captured = Result.getOrThrow(captureApplicationRuntimeTargetV1(semantic));
    const wire = applicationRuntimeTargetWireV1(captured);
    expect(Result.getOrThrow(decodeApplicationRuntimeTargetV1(wire))).toEqual(captured);
    expect(Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1(captured)).target).toEqual(captured);
    expect(wire.function).toMatchObject({
      args: { value: { scores: { fieldType: { type: "record", values: { fieldType: { type: "number" }, optional: false } } } } },
      returns: { type: "union", value: [{ type: "null" }, { type: "record", values: { fieldType: { type: "number" }, optional: false } }] },
    });
    expect(Result.isFailure(decodeApplicationRuntimeTargetV1(semantic))).toBe(true);
    expect(Result.isFailure(captureApplicationRuntimeTargetV1(wire))).toBe(true);
  });

  it("rejects a function path that disagrees with module and export", () => {
    const input = target();
    input.function.path = "other:get";
    const decoded = decodeApplicationRuntimeTargetV1(input);

    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure.reason).toBe("invalidFunctionPath");
    }
  });

  it("accepts the manifest path spelling for a default export", () => {
    const input = target();
    input.function.path = "users";
    input.function.exportName = "default";

    expect(Result.isSuccess(decodeApplicationRuntimeTargetV1(input))).toBe(true);
  });

  it("changes canonical identity inputs when publication or function changes", () => {
    const first = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1(target()));
    const changedPublication = target();
    changedPublication.publicationSha256 = "b".repeat(64);
    const second = Result.getOrThrow(
      canonicalizeApplicationRuntimeTargetV1(changedPublication),
    );
    const changedFunction = target();
    changedFunction.function.entrySha256 = "c".repeat(64);
    const third = Result.getOrThrow(
      canonicalizeApplicationRuntimeTargetV1(changedFunction),
    );

    expect(second.canonicalText).not.toBe(first.canonicalText);
    expect(third.canonicalText).not.toBe(first.canonicalText);
  });

  it("admits deep semantic declaration graphs within the actual runtime-target byte budget", () => {
    let validator: unknown = { type: "string" };
    for (let depth = 0; depth < 256; depth += 1) {
      validator = { type: "array", value: validator };
    }
    const base = target();
    const input: unknown = {
      ...base,
      function: { ...base.function, args: validator },
    };
    const result = decodeApplicationRuntimeTargetV1(input);

    expect(Result.isSuccess(result)).toBe(true);
  });

  it("measures shared validator expansion against the target byte budget before rendering", () => {
    let validator: ValidatorJsonV1 = { type: "string" };
    for (let index = 0; index < 40; index++) validator = { type: "union", value: [validator, validator] };
    const base = target();
    const canonical = canonicalizeApplicationRuntimeTargetV1({ ...base, function: { ...base.function, args: validator } });
    expect(Result.isFailure(canonical) && canonical.failure).toMatchObject({ reason: "bytesExceeded" });
  });

  it("rejects accessor-backed and changing validator input without invoking it", () => {
    let reads = 0;
    const input = target();
    Object.defineProperty(input.function, "args", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? { type: "null" } : { type: "string" };
      },
    });
    const result = decodeApplicationRuntimeTargetV1(input);

    expect(Result.isFailure(result)).toBe(true);
    expect(reads).toBe(0);
  });

  it("rejects nested accessors and cyclic validators as typed failures", () => {
    let nestedReads = 0;
    const accessorInput = target();
    Object.defineProperty(accessorInput.function.args.value.id, "fieldType", {
      enumerable: true,
      get() {
        nestedReads += 1;
        return { type: "string" };
      },
    });
    const cyclicBase = target();
    const cyclic: { type: "array"; value?: unknown } = { type: "array" };
    cyclic.value = cyclic;
    const cyclicInput: unknown = {
      ...cyclicBase,
      function: { ...cyclicBase.function, args: cyclic },
    };

    expect(Result.isFailure(decodeApplicationRuntimeTargetV1(accessorInput)))
      .toBe(true);
    expect(nestedReads).toBe(0);
    expect(Result.isFailure(decodeApplicationRuntimeTargetV1(cyclicInput)))
      .toBe(true);
  });
});

function target() {
  return {
    format: "flarex.application-runtime-target" as const,
    validatorIdentityEncoding: 2 as const,
    version: 1 as const,
    scopeId: "scope",
    revisionId: "revision",
    candidateId: "candidate",
    analysisId: "analysis",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path: "users:get",
      moduleName: "users",
      exportName: "get",
      kind: "query" as const,
      visibility: "public" as const,
      args: {
        type: "object" as const,
        value: {
          id: {
            fieldType: { type: "id" as const, tableName: "users" },
            optional: false,
          },
        },
      },
      returns: { type: "null" as const },
      partition: null,
      entrySha256: "6".repeat(64),
    },
  };
}
