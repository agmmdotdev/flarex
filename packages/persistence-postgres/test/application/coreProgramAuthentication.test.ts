import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { canonicalizeTransactionGrantIdentityAccessPolicyV1Effect, TransactionGrantDeploymentIdV1Schema,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 } from "flarex-protocol/transaction-grant";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { makeCoreApplicationMutationPort } from "../../src/application/coreMutation";
import { captureCoreApplicationProgramProfile, makeCoreApplicationPrograms, readCoreApplicationProgram } from "../../src/application/coreProgram";
import type { CoreDatabase, CoreProgramDefinition } from "../../src/core/api";

const hash = (value: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(value).digest()));
const makePrograms = () => makeCoreApplicationPrograms({ scopeUuid: "45000000-0000-4000-8000-000000000001",
  epochUuid: "45000000-0000-4000-8000-000000000002", compatibilityDate: "2026-06-14", sha256: hash,
  manifest: { format: "flarex.application-manifest", version: 1,
    sourceArtifact: { rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: null,
      modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
        { path: "items.js", roles: 1, sourceSha256: "3".repeat(64), sourceByteLength: 48 }] },
    schema: { version: 1, tables: [], indexes: [] },
    functions: ["mutation", "query"].map(kind => ({ path: `items:${kind}`, moduleName: "items", exportName: kind,
      kind, visibility: "public", args: { type: "object", value: { scores: { optional: false,
        fieldType: { type: "record", keys: { type: "string" }, values: { type: "number" } } } } },
      returns: null, partition: null })),
  },
});

function metadataDatabase(program: CoreProgramDefinition, forbidden: () => Effect.Effect<never>): CoreDatabase {
  return {
    selectProgram: () => Effect.succeed(program),
    resolveApplicationRequest: () => Effect.succeed({ kind: "missing" }),
    claimRequest: forbidden, claimApplicationRequest: forbidden, recoverRequest: forbidden, assertOpen: forbidden(), close: forbidden,
    beginQuery: forbidden, withQueryTarget: forbidden, assertQueryTarget: forbidden, prepareSchema: forbidden, readApplicationRegistration: forbidden, schemaStatus: forbidden, advanceSchemaWork: forbidden,
    readApplicationCandidate: forbidden, abandonApplicationCandidate: forbidden,
    prepareApplicationCandidate: forbidden, activateApplicationCandidate: forbidden, readActiveApplicationCandidate: forbidden,
    advanceSchema: forbidden, activateSchema: forbidden, publishPrograms: forbidden, lookupProgram: forbidden,
    bindNative: forbidden, readNativeBinding: forbidden, beginNative: forbidden,
    bindNativeInitialization: forbidden,
    bindNativeRoot: forbidden, readNativeRootBinding: forbidden, beginNativeRoot: forbidden, bindNativeRootRecovery: forbidden,
    readNativeRootRequestEvidence: forbidden, resolveCommittedNativeRootRequest: forbidden,
    resolveRequest: forbidden, abortRequest: forbidden, begin: forbidden, commit: forbidden,
    publishedTimestamp: forbidden(), readAuthorityEpoch: forbidden(), advanceAuthorityEpoch: forbidden,
  };
}

it("authenticates current program metadata before claim, recovery, grants or execution", async () => {
  const programs = await Effect.runPromise(makePrograms());
  const definition = programs.find(program => program.identity.functionPath === "items:mutation");
  if (definition === undefined) throw new Error("Missing current mutation");
  let touched = false;
  const forbidden = () => Effect.sync(() => { touched = true; throw new Error("Unauthenticated request touched authority"); });
  const database = metadataDatabase({ ...definition, metadata: { ...definition.metadata, validatorIdentityEncoding: 3 } }, forbidden);
  const port = makeCoreApplicationMutationPort({ database,
    deploymentId: TransactionGrantDeploymentIdV1Schema.make("current-authentication-witness"), maximumAttempts: 1,
    issueGrant: forbidden, execute: forbidden,
    sha256: hash,
  });
  await Effect.runPromise(Effect.gen(function* () {
    const policy = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    const refused = yield* Effect.result(port.invoke(TransactionFunctionPathV1Schema.make("items:mutation"),
      { scores: { Ada: 42 } }, TransactionRequestKeyV1Schema.make("unauthenticated-current-program"), policy));
    expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "metadataInvalid" });
    expect(touched).toBe(false);
  }));
});

it("returns a keyed query marker after source-profile checks and leaves package admission to the query owner", async () => {
  const programs = await Effect.runPromise(makePrograms());
  const definition = programs.find(program => program.identity.functionPath === "items:query");
  if (definition === undefined) throw new Error("Missing current query");
  let touched = false, resolutions = 0;
  const forbidden = () => Effect.sync(() => { touched = true; throw new Error("Query inference touched mutation authority"); });
  await Effect.runPromise(Effect.gen(function* () {
    const program = yield* readCoreApplicationProgram(definition, hash);
    const expectedProgramProfile = yield* Effect.fromResult(captureCoreApplicationProgramProfile({ scopeUuid: program.scopeUuid,
      epochUuid: program.epochUuid, sourceArtifactRootSha256: program.runtimeTarget.sourceArtifactRootSha256,
      sourcePackageHash: "a".repeat(64) }));
    expect(expectedProgramProfile.sourcePackageHash).toBe("a".repeat(64));
    expect(Result.isFailure(captureCoreApplicationProgramProfile({ ...expectedProgramProfile, sourcePackageHash: "malformed" })))
      .toBe(true);
    const database: CoreDatabase = { ...metadataDatabase(definition, forbidden), resolveApplicationRequest: () => Effect.sync(() => {
      resolutions++; return { kind: "missing" as const };
    }) };
    const configuration = { database, expectedProgramProfile,
      deploymentId: TransactionGrantDeploymentIdV1Schema.make("keyed-query-inference"), maximumAttempts: 1,
      issueGrant: forbidden, execute: forbidden, sha256: hash };
    const port = makeCoreApplicationMutationPort(configuration);
    const identity = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 });
    const input = [TransactionFunctionPathV1Schema.make("items:query"), { scores: { Ada: 42 } },
      TransactionRequestKeyV1Schema.make("missing-keyed-query"), identity] as const;
    expect(yield* port.infer(...input)).toEqual({ kind: "query" });
    expect(resolutions).toBe(1);
    const strict = yield* Effect.result(port.invoke(...input));
    expect(Result.isFailure(strict) && strict.failure).toMatchObject({ reason: "unsupportedSelection" });
    const stale = makeCoreApplicationMutationPort({ ...configuration,
      expectedProgramProfile: { ...expectedProgramProfile, sourceArtifactRootSha256: "f".repeat(64) } });
    const refused = yield* Effect.result(stale.infer(...input));
    expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "unsupportedSelection" });
    expect(touched).toBe(false);
  }));
});
