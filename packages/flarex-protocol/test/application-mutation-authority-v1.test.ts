import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type ApplicationMutationExecutionAuthorityV1Error,
} from "../src/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from "../src/application-runtime-target-v1";

describe("ApplicationMutationExecutionAuthorityV1", () => {
  it("pins one canonical Application mutation authority and owns its bytes", async () => {
    const input = await authorityInput();
    const canonical = await runEffect(
      canonicalizeApplicationMutationExecutionAuthorityV1(input),
    );

    input.runtimeTarget.function.args.value.id.fieldType.tableName = "changed";
    const firstBytes = canonical.canonicalBytes;
    const firstSha256 = canonical.sha256;
    firstBytes.fill(0);
    firstSha256.fill(0);

    expect(canonical.authority.runtimeTarget.function.args).toEqual({
      type: "object",
      value: {
        id: {
          fieldType: { type: "id", tableName: "recipes" },
          optional: false,
        },
      },
    });
    expect(new TextDecoder().decode(canonical.canonicalBytes))
      .toMatchInlineSnapshot(`"{"activationSequence":"17","activeHeadSha256":"7777777777777777777777777777777777777777777777777777777777777777","format":"flarex.application-mutation-execution-authority","runtimeTarget":{"analysisId":"analysis-17","candidateId":"candidate-17","executionModulePath":"_flarex/application.js","format":"flarex.application-runtime-target","function":{"args":{"type":"object","value":{"id":{"fieldType":{"tableName":"recipes","type":"id"},"optional":false}}},"entrySha256":"6666666666666666666666666666666666666666666666666666666666666666","exportName":"update","kind":"mutation","moduleName":"recipes","partition":null,"path":"recipes:update","returns":{"type":"null"},"visibility":"public"},"functionCatalogSha256":"4444444444444444444444444444444444444444444444444444444444444444","manifestSha256":"2222222222222222222222222222222222222222222222222222222222222222","publicationSha256":"5555555555555555555555555555555555555555555555555555555555555555","revisionId":"revision-17","schemaSha256":"3333333333333333333333333333333333333333333333333333333333333333","scopeId":"scope-cooking","sourceArtifactRootSha256":"1111111111111111111111111111111111111111111111111111111111111111","version":1},"runtimeTargetSha256":"8f2adc43a66db4bd8361e87b0a183fab36aac84a7a2bb941b5f84ff2652c3717","schemaVersionId":"schema-v17","version":1}"`);
    expect(hex(canonical.sha256)).toMatchInlineSnapshot(`"a3aa8205a0619985bc48cd5b5664f9ca70a5b2cdca8748772b4784b69f803eaa"`);
    expect(canonical.canonicalBytes).not.toBe(canonical.canonicalBytes);
    expect(canonical.sha256).not.toBe(canonical.sha256);
  });

  it("rejects a query target and a mismatched runtime-target digest", async () => {
    const query = await authorityInput();
    query.runtimeTarget.function.kind = "query";
    await expectFailureReason(query, "invalidRuntimeTarget");

    const mismatch = await authorityInput();
    mismatch.runtimeTargetSha256 = "f".repeat(64);
    await expectFailureReason(mismatch, "runtimeTargetDigestMismatch");
  });

  it("canonicalizes an internal mutation target without changing the authority format", async () => {
    const internal = await authorityInput();
    internal.runtimeTarget.function.visibility = "internal";
    internal.runtimeTargetSha256 = await sha256Hex(Result.getOrThrow(
      canonicalizeApplicationRuntimeTargetV1(internal.runtimeTarget),
    ).canonicalBytes);

    const canonical = await runEffect(
      canonicalizeApplicationMutationExecutionAuthorityV1(internal),
    );

    expect(canonical.authority.format).toBe(
      "flarex.application-mutation-execution-authority",
    );
    expect(canonical.authority.version).toBe(1);
    expect(canonical.authority.runtimeTarget.function).toMatchObject({
      kind: "mutation",
      visibility: "internal",
    });
  });

  it("rejects invalid sequence bounds and accessor-backed input without invoking it", async () => {
    const zero = await authorityInput();
    zero.activationSequence = "0";
    await expectFailureReason(zero, "invalidShape");

    const overflow = await authorityInput();
    overflow.activationSequence = "9223372036854775808";
    await expectFailureReason(overflow, "invalidShape");

    let reads = 0;
    const accessor = await authorityInput();
    Object.defineProperty(accessor, "runtimeTarget", {
      enumerable: true,
      get() {
        reads += 1;
        return mutationTarget();
      },
    });
    await expectFailureReason(accessor, "invalidShape");
    expect(reads).toBe(0);
  });
});

async function expectFailureReason(
  input: unknown,
  reason: ApplicationMutationExecutionAuthorityV1Error["reason"],
): Promise<void> {
  const result = await runEffect(
    canonicalizeApplicationMutationExecutionAuthorityV1(input).pipe(
      Effect.result,
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
}

async function authorityInput() {
  const runtimeTarget = mutationTarget();
  const canonicalTarget = Result.getOrThrow(
    canonicalizeApplicationRuntimeTargetV1(runtimeTarget),
  );
  return {
    format: "flarex.application-mutation-execution-authority" as const,
    version: 1 as const,
    runtimeTarget,
    runtimeTargetSha256: await sha256Hex(canonicalTarget.canonicalBytes),
    activationSequence: "17",
    activeHeadSha256: "7".repeat(64),
    schemaVersionId: "schema-v17",
  };
}

function mutationTarget() {
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
      path: "recipes:update",
      moduleName: "recipes",
      exportName: "update",
      kind: "mutation" as "mutation" | "query",
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

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  return hex(digest);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
