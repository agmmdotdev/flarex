import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalizeApplicationActionExecutionAuthorityV1,
  type ApplicationActionExecutionAuthorityV1Error,
} from "../src/application-action-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "../src/application-runtime-target-v1";

describe("ApplicationActionExecutionAuthorityV1", () => {
  it("pins one canonical public action authority and owns its bytes", async () => {
    const input = await authorityInput();
    const canonical = await Effect.runPromise(
      canonicalizeApplicationActionExecutionAuthorityV1(input),
    );

    input.runtimeTarget.function.args.value.id.fieldType.tableName = "changed";
    canonical.canonicalBytes.fill(0);
    canonical.sha256.fill(0);

    expect(canonical.authority.runtimeTarget.function.args).toEqual({
      type: "object",
      value: {
        id: {
          fieldType: { type: "id", tableName: "recipes" },
          optional: false,
        },
      },
    });
    expect(new TextDecoder().decode(canonical.canonicalBytes)).toContain(
      '"format":"flarex.application-action-execution-authority"',
    );
    expect(canonical.canonicalBytes).not.toBe(canonical.canonicalBytes);
    expect(canonical.sha256).not.toBe(canonical.sha256);
  });

  it("rejects non-action, internal, and mismatched runtime targets", async () => {
    const mutation = await authorityInput();
    mutation.runtimeTarget.function.kind = "mutation";
    await expectFailureReason(mutation, "invalidRuntimeTarget");

    const internal = await authorityInput();
    internal.runtimeTarget.function.visibility = "internal";
    await expectFailureReason(internal, "invalidRuntimeTarget");

    const mismatch = await authorityInput();
    mismatch.runtimeTargetSha256 = "f".repeat(64);
    await expectFailureReason(mismatch, "runtimeTargetDigestMismatch");
  });

  it("rejects accessor-backed input without invoking it", async () => {
    let reads = 0;
    const accessor = await authorityInput();
    Object.defineProperty(accessor, "runtimeTarget", {
      enumerable: true,
      get() {
        reads += 1;
        return actionTarget();
      },
    });
    await expectFailureReason(accessor, "invalidShape");
    expect(reads).toBe(0);
  });
});

async function expectFailureReason(
  input: unknown,
  reason: ApplicationActionExecutionAuthorityV1Error["reason"],
): Promise<void> {
  const result = await Effect.runPromise(
    canonicalizeApplicationActionExecutionAuthorityV1(input).pipe(
      Effect.result,
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
}

async function authorityInput() {
  const runtimeTarget = actionTarget();
  const canonicalTarget = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1(runtimeTarget),
  );
  return {
    format: "flarex.application-action-execution-authority" as const,
    version: 1 as const,
    runtimeTarget,
    runtimeTargetSha256: await sha256Hex(canonicalTarget.canonicalBytes),
    activationSequence: "17",
    activeHeadSha256: "7".repeat(64),
    schemaVersionId: "schema-v17",
  };
}

function actionTarget() {
  return {
    format: "flarex.application-runtime-target" as const,
    version: 1 as const,
    scopeId: "scope-cooking",
    revisionId: "revision-17",
    candidateId: "candidate-17",
    analysisId: "analysis-17",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path: "recipes:notify",
      moduleName: "recipes",
      exportName: "notify",
      kind: "action" as "action" | "mutation",
      visibility: "public" as "public" | "internal",
      args: {
        type: "object" as const,
        value: {
          id: {
            fieldType: { type: "id" as const, tableName: "recipes" },
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
