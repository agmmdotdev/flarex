import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { canonicalizeApplicationRuntimeTargetV1 } from "../src/application-runtime-target-v1";
import { decodeApplicationTransactionWorkerRequestV1Effect } from "../src/application-worker-v1";
import { normalizeFlarexValueV1 } from "../src/value";

it("gets historical verification only from the trusted definition and refuses request-selected generations", async () => {
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target", version: 1, scopeId: "scope", revisionId: "revision",
    candidateId: "candidate", analysisId: "analysis", sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64), schemaSha256: "3".repeat(64), functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64), executionModulePath: "_flarex/execution.js", function: {
      path: "items:query", moduleName: "items", exportName: "query", kind: "query", visibility: "public",
      args: { type: "object", value: {} }, returns: null, partition: null, entrySha256: "6".repeat(64),
    },
  })).target;
  const { validatorIdentityEncoding: _encoding, ...legacy } = target;
  const request = { format: "flarex.application-transaction-worker-request", version: 1,
    target, auth: { kind: "anonymous" }, arguments: {}, argumentSemanticBytes: normalizeFlarexValueV1({}).semanticSizeBytes, tables: [],
    context: { mode: "query", executionId: "identity-check", randomSeed: new Uint8Array(32),
      executionTime: 1_800_000_000_000, snapshotTimestamp: 1n } };
  expect((await Effect.runPromise(decodeApplicationTransactionWorkerRequestV1Effect(request))).target.validatorIdentityEncoding).toBe(2);
  expect((await Effect.runPromise(decodeApplicationTransactionWorkerRequestV1Effect({ ...request, target: legacy }, "convex", 1)))
    .target.validatorIdentityEncoding).toBeUndefined();
  for (const refused of [{ ...request, target: legacy }, { ...request, validatorIdentityEncoding: 1 },
    { ...request, target: { ...target, validatorIdentityEncoding: 3 } }]) {
    expect(Result.isFailure(await Effect.runPromise(Effect.result(decodeApplicationTransactionWorkerRequestV1Effect(refused))))).toBe(true);
  }
  expect(Result.isFailure(await Effect.runPromise(Effect.result(decodeApplicationTransactionWorkerRequestV1Effect(request, "convex", 1))))).toBe(true);
});
