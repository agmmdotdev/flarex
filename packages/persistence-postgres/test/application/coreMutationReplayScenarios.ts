import { createHash, randomBytes } from "node:crypto";
import { canonicalizeApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Result, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { decodeDocumentValue } from "flarex-protocol/document-value";
import { APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1, assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1, inspectVerifiedApplicationMutationGrantV1,
  prepareApplicationMutationGrantV1, verifyApplicationMutationGrantV1 } from "flarex-protocol/internal/application-mutation-grant-v1";
import { canonicalizeTransactionGrantIdentityAccessPolicyV1Effect, TransactionGrantDeploymentIdV1Schema,
  TransactionGrantKeyIdV1Schema, TransactionGrantTimestampV1Schema,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1, TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1 } from "flarex-protocol/transaction-grant";
import { TransactionAuthorizationGrantIdV1Schema, TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { ScopeEpochUuidV1Schema, ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import { makeCoreApplicationMutationPort, type CoreApplicationMutationConfiguration } from "../../src/application/coreMutation";
import { makeCoreApplicationPrograms } from "../../src/application/coreProgram";
import { compileCoreApplicationSchema } from "../../src/application/coreSchema";
import type { CoreDatabase } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import type { CorePersistenceFixture } from "../core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../core/schemaFixture";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../execution/session/support/activationEvidence";

const scopeUuid = ScopeUuidV1Schema.make("45000000-0000-4000-8000-000000000001");
const epochUuid = ScopeEpochUuidV1Schema.make("45000000-0000-4000-8000-000000000002");
const deploymentId = TransactionGrantDeploymentIdV1Schema.make("registered-upgrade-replay");
const functionPath = TransactionFunctionPathV1Schema.make("items:write");
const requestKey = TransactionRequestKeyV1Schema.make("registered-upgrade-request");
const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
const policy = canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
  policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, auth: { kind: "anonymous" },
  capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
});
const options = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
  randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)), maxBatchDelayMilliseconds: 0 };

function manifest(source: string, change: "none" | "removed" | "kind" | "args" | "internal" | "index" | "validator" = "none") {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({ format: "flarex.application-manifest", version: 1,
    sourceArtifact: { rootSha256: source.repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: "schema.js",
      modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
        { path: "items.js", roles: 1, sourceSha256: "3".repeat(64), sourceByteLength: 48 },
        { path: "schema.js", roles: 2, sourceSha256: "4".repeat(64), sourceByteLength: 48 }] },
    schema: { version: 1, tables: [{ tableId: 1, name: "items", placement: { kind: "global" },
      validator: { type: "object", value: { body: { fieldType: { type: change === "validator" ? "number" : "string" }, optional: false } } } }],
      indexes: change === "index" ? [{ indexId: 1, tableId: 1, name: "by_body", fields: ["body"] }] : [] },
    functions: change === "removed" || change === "index" || change === "validator" ? [] : [{
      path: functionPath, moduleName: "items", exportName: "write", kind: change === "kind" ? "query" : "mutation",
      visibility: change === "internal" ? "internal" : "public", partition: null, returns: null,
      args: { type: "object", value: { body: { fieldType: { type: change === "args" ? "number" : "string" }, optional: false } } },
    }],
  })).manifest;
}

const install = Effect.fn("MutationReplayFixture.install")(function* (
  database: CoreDatabase, value: ReturnType<typeof manifest>, sourcePackageHash = "b".repeat(64),
) {
  const programs = yield* makeCoreApplicationPrograms({ manifest: value, scopeUuid, epochUuid,
    compatibilityDate: "2026-10-01", sha256: hash });
  const candidate = yield* database.prepareApplicationCandidate({ schema: Result.getOrThrow(compileCoreApplicationSchema(value)),
    registration: { deploymentId, scopeUuid, epochUuid, sourceArtifactRootSha256: value.sourceArtifact.rootSha256,
      sourcePackageHash, analyzerIdentity: "c".repeat(64), analyzerPolicyIdentity: "replay-fixture-policy",
      compatibilityDate: "2026-10-01", generation: 1, programs } });
  const selected = yield* database.readApplicationCandidate(candidate);
  if (Option.isNone(selected)) return yield* Effect.die(new Error("Missing prepared replay candidate"));
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(selected.value.schemaProposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateApplicationCandidate(candidate, { programs });
      return programs;
    }
    if (status.state === "failed" || status.state === "overwritten")
      return yield* Effect.die(new Error(`Replay fixture candidate failed: ${status.state}`));
    yield* database.advanceSchema(selected.value.schemaProposal, { pageSize: 8, maxPages: 8 });
  }
  return yield* Effect.die(new Error("Replay fixture candidate did not become ready"));
});

/** Real grant preparation, Ed25519 signature and verifier; the fixture supplies only host keys. */
const issuer = Effect.fn("MutationReplayFixture.issuer")(function* () {
  const keys = yield* Effect.tryPromise(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  if (!("privateKey" in keys)) return yield* Effect.die(new Error("Missing replay fixture signing key"));
  const kid = TransactionGrantKeyIdV1Schema.make("registered-upgrade-replay-key");
  let ordinal = 0;
  return Effect.fn("MutationReplayFixture.issue")(function* (
    input: Parameters<CoreApplicationMutationConfiguration<unknown, unknown>["issueGrant"]>[0],
  ) {
    const now = yield* Clock.currentTimeMillis;
    const segments = yield* prepareApplicationMutationGrantV1({ ...input, kid,
      grantId: TransactionAuthorizationGrantIdV1Schema.make(`registered-upgrade-grant-${++ordinal}`),
      issuedAt: TransactionGrantTimestampV1Schema.make(new Date(now).toISOString()),
      expiresAt: TransactionGrantTimestampV1Schema.make(new Date(now + 60_000).toISOString()) });
    const signature = yield* Effect.tryPromise(async () => new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey,
      copyBytesToArrayBuffer(segments.signingInput))));
    return yield* verifyApplicationMutationGrantV1(assembleApplicationMutationGrantJwsV1(segments, signature),
      createApplicationMutationGrantVerifierNamespaceV1({ deploymentId, grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        trustedNowEpochMilliseconds: Effect.succeed(now), keys: [{ kid, publicKey: keys.publicKey,
          purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1, state: "active", issuedAtInclusiveEpochMilliseconds: 0 }] }));
  });
});

function soleFailure<A, E>(exit: Exit.Exit<A, E>) {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected replay witness failure");
  expect(exit.cause.reasons).toHaveLength(1);
  const reason = exit.cause.reasons[0];
  if (reason === undefined || !Cause.isFailReason(reason)) throw new Error(Cause.pretty(exit.cause));
  return reason.error;
}

export function registerCoreMutationReplayScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  const run = <E>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, E, Scope.Scope>) => async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(body(fixture).pipe(Effect.timeout("60 seconds")))); }
    finally { await fixture.close(); }
  };
  describe(label, () => {
    it("recovers committed A before B's removed, changed-kind, changed-args and internal admission, retaining exact correlation", run(fixture => Effect.gen(function* () {
      let database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
      const original = yield* install(database, manifest("a"));
      const issueGrant = yield* issuer();
      const identity = yield* policy;
      let executions = 0;
      const makePort = (source: string, expectedEpoch: string = epochUuid) => makeCoreApplicationMutationPort({ database, deploymentId, maximumAttempts: 3,
        expectedProgramProfile: { scopeUuid, epochUuid: ScopeEpochUuidV1Schema.make(expectedEpoch), sourceArtifactRootSha256: source.repeat(64) }, issueGrant, sha256: hash,
        execute: input => Effect.gen(function* () {
          executions++;
          yield* input.transaction.insert("items", input.arguments);
          return { body: input.arguments.body ?? null };
        }) });
      const first = yield* makePort("a").invoke(functionPath, { body: "hello" }, requestKey, identity);
      expect(first.disposition).toBe("published");
      yield* install(database, manifest("9"));
      expect(soleFailure(yield* Effect.exit(makePort("a").invoke(functionPath, { body: "hello" },
        TransactionRequestKeyV1Schema.make("stale-fresh-request"), identity)))).toMatchObject({ reason: "unsupportedSelection" });
      expect(yield* makePort("9").invoke(functionPath, { body: "hello" }, requestKey, identity))
        .toEqual({ ...first, disposition: "replayed" });
      for (const [ordinal, change] of (["kind", "args", "internal", "removed"] as const).entries()) {
        const source = (ordinal + 11).toString(16);
        yield* install(database, manifest(source, change));
        const replay = yield* makePort(source).invoke(functionPath, { body: "hello" }, requestKey, identity);
        expect(replay).toEqual({ ...first, disposition: "replayed" });
        expect(yield* makePort(source).infer(functionPath, { body: "hello" }, requestKey, identity))
          .toEqual({ kind: "mutation", outcome: replay });
        if (change === "kind") expect(yield* makePort(source).infer(functionPath, { body: "hello" },
          TransactionRequestKeyV1Schema.make("fresh-keyed-query"), identity)).toEqual({ kind: "query" });
        expect(yield* makePort("a").invoke(functionPath, { body: "hello" }, requestKey, identity)).toEqual(replay);
        const fresh = yield* Effect.exit(makePort(source).invoke(functionPath, { body: "hello" },
          TransactionRequestKeyV1Schema.make(`fresh-${change}`), identity));
        expect(soleFailure(fresh)).toMatchObject({ reason: change === "kind" ? "unsupportedSelection"
          : change === "args" ? "argumentsInvalid" : change === "internal" ? "internalFunction" : "programUnavailable" });
      }
      const originalProgram = original[0];
      if (originalProgram === undefined) return yield* Effect.die(new Error("Missing original mutation program"));
      expect(originalProgram.identity).toEqual((yield* database.lookupProgram(originalProgram.identity)).identity);
      expect(soleFailure(yield* Effect.exit(makePort("e").invoke(functionPath, { body: "changed" }, requestKey, identity))))
        .toMatchObject({ reason: "requestMismatch" });
      expect(soleFailure(yield* Effect.exit(makePort("e").invoke(TransactionFunctionPathV1Schema.make("items:other"),
        { body: "hello" }, requestKey, identity)))).toMatchObject({ reason: "requestMismatch" });
      const otherIdentity = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
        policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1, auth: { kind: "verifiedBearer",
          tokenIdentifier: "https://identity.test|other", issuer: "https://identity.test", subject: "other", claims: {} },
        capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1 });
      expect(soleFailure(yield* Effect.exit(makePort("e").invoke(functionPath, { body: "hello" }, requestKey, otherIdentity))))
        .toMatchObject({ reason: "requestMismatch" });
      expect(soleFailure(yield* Effect.exit(makePort("e", "45000000-0000-4000-8000-000000000003")
        .invoke(functionPath, { body: "hello" }, requestKey, identity)))).toMatchObject({ reason: "unsupportedSelection" });
      yield* database.close();
      database = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), owner => owner.close());
      expect(yield* makePort("e").invoke(functionPath, { body: "hello" }, requestKey, identity))
        .toEqual({ ...first, disposition: "replayed" });
      expect(executions).toBe(1);
    })), 90_000);

    it("pins fresh mutation admission to auth-only package changes while preserving exact committed outcomes", run(fixture => Effect.gen(function* () {
      const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
      const value = manifest("a");
      const original = yield* install(database, value, "1".repeat(64));
      const issueGrant = yield* issuer(), identity = yield* policy;
      let executions = 0;
      const port = (sourcePackageHash: string) => makeCoreApplicationMutationPort({ database, deploymentId, maximumAttempts: 3,
        expectedProgramProfile: { scopeUuid, epochUuid, sourceArtifactRootSha256: value.sourceArtifact.rootSha256, sourcePackageHash },
        issueGrant, sha256: hash, execute: input => Effect.gen(function* () {
          executions++; yield* input.transaction.insert("items", input.arguments); return "original-result";
        }) });
      const first = yield* port("1".repeat(64)).invoke(functionPath, { body: "hello" }, requestKey, identity);
      const updated = yield* install(database, value, "2".repeat(64));
      expect(updated).toEqual(original);
      expect(yield* port("1".repeat(64)).invoke(functionPath, { body: "hello" }, requestKey, identity))
        .toEqual({ ...first, disposition: "replayed" });
      const freshKey = TransactionRequestKeyV1Schema.make("auth-only-fresh-request");
      expect(soleFailure(yield* Effect.exit(port("1".repeat(64)).invoke(functionPath, { body: "hello" }, freshKey, identity))))
        .toMatchObject({ reason: "authorityRevoked" });
      expect((yield* port("2".repeat(64)).invoke(functionPath, { body: "hello" }, freshKey, identity)).disposition).toBe("published");
      expect(executions).toBe(2);
    })), 90_000);

    it("rechecks the auth-only package in the same fresh claim after B activates between selection and claim", run(fixture => Effect.gen(function* () {
      const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
      const value = manifest("a");
      const original = yield* install(database, value, "1".repeat(64));
      const signGrant = yield* issuer(), identity = yield* policy;
      const selected = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let executions = 0;
      const port = makeCoreApplicationMutationPort({ database, deploymentId, maximumAttempts: 3, sha256: hash,
        expectedProgramProfile: { scopeUuid, epochUuid, sourceArtifactRootSha256: value.sourceArtifact.rootSha256,
          sourcePackageHash: "1".repeat(64) },
        issueGrant: input => Effect.gen(function* () {
          const grant = yield* signGrant(input); yield* Deferred.succeed(selected, undefined); yield* Deferred.await(release); return grant;
        }), execute: () => Effect.sync(() => { executions++; return "must not execute"; }) });
      const held = yield* Effect.forkChild(Effect.exit(port.invoke(functionPath, { body: "hello" }, requestKey, identity)));
      yield* Effect.gen(function* () {
        yield* Deferred.await(selected);
        expect(yield* install(database, value, "2".repeat(64))).toEqual(original);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      expect(soleFailure(yield* Fiber.join(held))).toMatchObject({ reason: "authorityRevoked" });
      expect(executions).toBe(0);
    })), 90_000);

    it("checks query source and auth-only package in its captured snapshot while a held query retains A", run(fixture => Effect.gen(function* () {
      const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
      const value = manifest("a", "kind");
      const original = yield* install(database, value, "1".repeat(64));
      const seed = yield* database.begin();
      const id = yield* seed.insert("items", { body: "before" });
      yield* database.commit(yield* seed.finalize());
      const pin = { sourceArtifactRootSha256: value.sourceArtifact.rootSha256, sourcePackageHash: "1".repeat(64) };
      const held = yield* Effect.acquireRelease(database.beginQuery(functionPath, pin), operation => operation.abort());
      expect(Option.getOrThrow(yield* held.transaction.get(id)).body).toBe("before");
      expect(yield* install(database, value, "2".repeat(64))).toEqual(original);
      const writer = yield* database.begin();
      yield* writer.patch(id, { body: "after" });
      yield* database.commit(yield* writer.finalize());
      expect(Option.getOrThrow(yield* held.transaction.get(id)).body).toBe("before");
      yield* held.finish();
      expect(soleFailure(yield* Effect.exit(database.beginQuery(functionPath, pin)))).toMatchObject({ reason: "authorityRevoked" });
      expect(soleFailure(yield* Effect.exit(database.beginQuery(functionPath, { sourceArtifactRootSha256: "f".repeat(64),
        sourcePackageHash: "2".repeat(64) })))).toMatchObject({ reason: "authorityRevoked" });
      const current = yield* Effect.acquireRelease(database.beginQuery(functionPath, { ...pin, sourcePackageHash: "2".repeat(64) }),
        operation => operation.abort());
      expect(Option.getOrThrow(yield* current.transaction.get(id)).body).toBe("after");
      yield* current.finish();
    })), 90_000);

    it("refuses fresh public A selected before B removes its head when no request claim existed at activation", run(fixture => Effect.gen(function* () {
      const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
      yield* install(database, manifest("a"));
      const signGrant = yield* issuer(), identity = yield* policy;
      const selected = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let executions = 0;
      const port = makeCoreApplicationMutationPort({ database, deploymentId, maximumAttempts: 3, sha256: hash,
        expectedProgramProfile: { scopeUuid, epochUuid, sourceArtifactRootSha256: "a".repeat(64), sourcePackageHash: "b".repeat(64) },
        issueGrant: input => Effect.gen(function* () {
          const grant = yield* signGrant(input);
          yield* Deferred.succeed(selected, undefined);
          yield* Deferred.await(release);
          return grant;
        }),
        execute: () => Effect.sync(() => { executions++; return "must not execute"; }) });
      const held = yield* Effect.forkChild(Effect.exit(port.invoke(functionPath, { body: "hello" }, requestKey, identity)));
      yield* Effect.gen(function* () {
        yield* Deferred.await(selected);
        yield* install(database, manifest("b", "removed"));
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      expect(soleFailure(yield* Fiber.join(held))).toMatchObject({ reason: "authorityRevoked" });
      expect(executions).toBe(0);
    })), 90_000);

    for (const change of ["index", "validator"] as const) it(`retries claimed A after B removes its head using B's current ${change} metadata`, run(fixture => Effect.gen(function* () {
      const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), owner => owner.close());
      const original = yield* install(database, manifest("a"));
      const issueGrant = yield* issuer();
      const identity = yield* policy;
      const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      const programs: string[] = [], grants: string[] = [];
      let executions = 0;
      const port = makeCoreApplicationMutationPort({ database, deploymentId, maximumAttempts: 3, issueGrant, sha256: hash,
        expectedProgramProfile: { scopeUuid, epochUuid, sourceArtifactRootSha256: "a".repeat(64), sourcePackageHash: "b".repeat(64) },
        execute: input => Effect.gen(function* () {
          executions++;
          programs.push(input.program.definition.identity.programHash);
          grants.push(inspectVerifiedApplicationMutationGrantV1(input.grant).payload.executionAuthoritySha256);
          yield* input.transaction.insert("items", input.arguments);
          if (executions === 1) { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); }
          else if (change === "index") expect(yield* input.transaction.scan("items", "by_body")).toHaveLength(1);
          return { body: input.arguments.body ?? null };
        }) });
      const held = yield* Effect.forkChild(Effect.exit(port.invoke(functionPath, { body: "hello" }, requestKey, identity)));
      yield* Effect.gen(function* () {
        yield* Deferred.await(entered);
        yield* install(database, manifest("b", change), "c".repeat(64));
        const busy = yield* Effect.exit(port.invoke(functionPath, { body: "hello" }, requestKey, identity));
        expect(soleFailure(busy)).toMatchObject({ reason: "inProgress" });
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      const completed = yield* Fiber.join(held);
      if (change === "index") {
        expect(Exit.isSuccess(completed) && completed.value).toMatchObject({ disposition: "published", value: { body: "hello" } });
      } else {
        expect(soleFailure(completed)).toMatchObject({ reason: "documentValidation" });
        expect(soleFailure(yield* Effect.exit(port.invoke(functionPath, { body: "hello" }, requestKey, identity))))
          .toMatchObject({ reason: "terminalRequest" });
      }
      expect(executions).toBe(2);
      expect(programs).toEqual([original[0]?.identity.programHash, original[0]?.identity.programHash]);
      expect(new Set(grants).size).toBe(1);
    })), 90_000);

    for (const state of ["claimed", "committed"] as const) it(`reconciles an uncertain ${state} acknowledgement after B removes A without fresh-body permission`, run(fixture => Effect.gen(function* () {
      let armed = false, executions = 0;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        yield* fixture.persistence.write(lease, batch);
        if (armed && batch.documents.some(entry => {
          if (entry.deleted) return false;
          const value = Result.getOrThrow(decodeDocumentValue(entry.jsonValue));
          return typeof value === "object" && value !== null && !Array.isArray(value) && "state" in value && value.state === state;
        })) { armed = false; return yield* new CorePersistenceError({ reason: "uncertainWrite" }); }
      }) };
      let database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), owner => owner.close());
      yield* install(database, manifest("a"));
      const issueGrant = yield* issuer(), identity = yield* policy;
      const port = () => makeCoreApplicationMutationPort({ database, deploymentId, maximumAttempts: 3, issueGrant, sha256: hash,
        expectedProgramProfile: { scopeUuid, epochUuid, sourceArtifactRootSha256: "a".repeat(64) },
        execute: input => Effect.gen(function* () { executions++; yield* input.transaction.insert("items", input.arguments); return "committed-A"; }) });
      armed = true;
      expect(soleFailure(yield* Effect.exit(port().invoke(functionPath, { body: "hello" }, requestKey, identity))))
        .toMatchObject({ reason: "uncertainWrite" });
      yield* database.close();
      database = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), options), owner => owner.close());
      yield* install(database, manifest("b", "removed"));
      const recovered = yield* Effect.exit(port().invoke(functionPath, { body: "hello" }, requestKey, identity));
      if (state === "committed") expect(Exit.isSuccess(recovered) && recovered.value)
        .toMatchObject({ disposition: "replayed", value: "committed-A" });
      else expect(soleFailure(recovered)).toMatchObject({ reason: "terminalRequest" });
      expect(soleFailure(yield* Effect.exit(port().invoke(functionPath, { body: "different" }, requestKey, identity))))
        .toMatchObject({ reason: "requestMismatch" });
      expect(soleFailure(yield* Effect.exit(port().invoke(functionPath, { body: "hello" },
        TransactionRequestKeyV1Schema.make("unrelated-fresh-request"), identity)))).toMatchObject({ reason: "programUnavailable" });
      expect(executions).toBe(state === "claimed" ? 0 : 1);
    })), 90_000);
  });
}
