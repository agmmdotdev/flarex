import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { payloadScalarFields } from "../../payload-adapter/src/conformanceProfile";
import { createApplicationRelationReadPort } from "../src/applicationRelationRead";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { defineCmsCommand, makeCmsHost } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { issueRelationalSession, runRelationalSession, makePostgresRelationalSession, type RelationalSession } from "../src/relationalTransaction/session";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { RelationalSessionError } from "../src/relationalTransaction/model";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../src/scopeClock";
import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { cmsHostFixture } from "./cmsHostFixture";
import { policyManifestFixture } from "./applicationWritePolicyFixture";
import { payloadRelationManifest } from "./payloadRelationFixture";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const decodeCreate = Schema.decodeUnknownEffect(Schema.Struct({ title: Schema.String, relatedPost: Schema.optional(Schema.String) }));
const decodeChange = Schema.decodeUnknownEffect(Schema.Struct({ first: Schema.String, second: Schema.String, target: Schema.String, other: Schema.String }));
const decodeRead = Schema.decodeUnknownEffect(Schema.Struct({ target: Schema.String, first: Schema.String, second: Schema.String }));
const decodeId = Schema.decodeUnknownSync(Schema.Struct({ _id: Schema.String }));

async function snapshotFixture(persistence: PostgresFlarexPersistence, session: RelationalSession, betweenReads: Effect.Effect<void>) {
  const manifest = await payloadRelationManifest((await policyManifestFixture(undefined, true, payloadScalarFields)).manifest, true, true);
  const resource = await cmsHostFixture(persistence, { cmsFields: payloadScalarFields,
    cmsManifest: { manifest: manifest.manifest, manifestSha256: createHash("sha256").update(manifest.canonicalBytes).digest("hex") } });
  const { fixture } = resource;
  const create = defineCmsCommand({ name: "snapshotCreate", mode: "write", run: Effect.fn(function* (ctx, args) {
    const input = yield* decodeCreate(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    return yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", {
      ...input, score: 0, enabled: false, publishedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", relatedPosts: [],
    });
  }) });
  const change = defineCmsCommand({ name: "snapshotChange", mode: "write", run: Effect.fn(function* (ctx, args) {
    const input = yield* decodeChange(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    yield* ctx.documents.patch(ctx.context, ctx.transactionId, input.first, { title: "changed-first", relatedPost: input.other });
    yield* ctx.documents.patch(ctx.context, ctx.transactionId, input.second, { title: "changed-second", relatedPost: input.target });
    return null;
  }) });
  let reads = 0;
  const read = defineCmsCommand({ name: "snapshotRead", mode: "read", run: Effect.fn(function* (ctx, args) {
    reads++;
    const input = yield* decodeRead(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
    const first = yield* ctx.documents.get(ctx.context, undefined, input.first);
    const before = yield* ctx.relations.incoming(ctx.context, undefined, "relatedPost", input.target, 8);
    yield* betweenReads;
    const after = yield* ctx.relations.incoming(ctx.context, undefined, "relatedPost", input.target, 8);
    // This document was not loaded before the concurrent commit. A request cache
    // cannot substitute for a consistent PostgreSQL snapshot here.
    const second = yield* ctx.documents.get(ctx.context, undefined, input.second);
    return { first, second, before: [...before.docs], after: [...after.docs] };
  }) });
  const host = await runEffect(makeCmsHost({ database: persistence.drizzle, controlDatabase: fixture.control.drizzle, session,
    deploymentId: fixture.deploymentId, authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority,
    application: fixture.relationActivation, commands: [create, change, read], identityAndAccessPolicy: { subject: "snapshot-witness" },
    relationReads: createApplicationRelationReadPort(fixture.control.drizzle, fixture.pointCommitAuthority, fixture.relationCommit, fixture.fold),
    materialization: {
      applicationRelations: fixture.relationCommit,
      intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
      developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle),
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }),
    } }));
  const target = decodeId(await runEffect(host.run(host.newRequestKey(), create, { title: "target" })))._id;
  const other = decodeId(await runEffect(host.run(host.newRequestKey(), create, { title: "other" })))._id;
  const first = await runEffect(host.run(host.newRequestKey(), create, { title: "first", relatedPost: target }));
  const second = await runEffect(host.run(host.newRequestKey(), create, { title: "second" }));
  const input = { target, other, first: decodeId(first)._id, second: decodeId(second)._id };
  return { ...resource, host, read, change, input, first, second, readCount: () => reads };
}

describe.skipIf(postgresUrl === null)("CMS PostgreSQL snapshots", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it.each(["binding", "revocation"] as const)("rejects a %s transition after snapshot formation before admission", transition => withPersistence(async persistence => {
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const base = makePostgresRelationalSession(persistence);
    const session = issueRelationalSession(persistence.drizzle, (profile, work) => runRelationalSession(base, profile, tx => Effect.gen(function* () {
      if (profile === "snapshotRead") {
        yield* runDrizzleStatementEffect(tx.execute(sql`select 1`), cause => new RelationalSessionError({ reason: "resourceFailure", cause }));
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
      }
      return yield* work(tx);
    })).pipe(Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
    const tested = await snapshotFixture(persistence, session, Effect.void);
    const before = await runEffect(tested.bindings.withCurrent(readAdmittedDataBinding));
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const reader = yield* tested.host.read(tested.read, tested.input).pipe(Effect.result, Effect.forkScoped);
      yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
      if (transition === "binding") {
        yield* tested.bindings.activate(dataBindingActivationRequest(tested.reference.scopeId, tested.reference.storageGeneration,
          "snapshot-race-rebind", tested.candidate.sha256, before.head));
      } else {
        yield* Effect.promise(() => persistence.drizzle.transaction(tx => runEffect(
          advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, tested.fixture.authority.scopeId))));
      }
      yield* Deferred.succeed(release, undefined);
      const outcome = yield* Fiber.join(reader);
      expect(outcome).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority", cause: { cause: { cause: { code: "40001" } } } } });
      expect(tested.readCount()).toBe(0);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
    if (transition === "binding") {
      expect(await runEffect(tested.host.read(tested.read, tested.input))).toMatchObject({ before: [tested.input.first] });
      expect(tested.readCount()).toBe(1);
    } else {
      // The old binding embeds the old authorization epoch; a fresh request
      // must also reject it until the binding owner deliberately rebinds it.
      expect(await runEffectFailure(tested.host.read(tested.read, tested.input))).toMatchObject({ reason: "bindingChanged" });
      expect(tested.readCount()).toBe(0);
    }
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);
  it("keeps document and incoming-relation reads coherent across a real publication", () => withPersistence(async persistence => {
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const pause = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)));
    const tested = await snapshotFixture(persistence, makePostgresRelationalSession(persistence), pause);
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const reader = yield* tested.host.read(tested.read, tested.input).pipe(Effect.forkScoped);
      yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
      yield* Effect.promise(async () => {
        await expect(persistence.drizzle.transaction(async tx => {
          await tx.execute(sql`set local lock_timeout = '100ms'`);
          return runEffect(advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, tested.fixture.authority.scopeId));
        })).rejects.toMatchObject({ operation: "lockForUpdate", cause: { cause: { code: "55P03" } } });
      });
      const key = tested.host.newRequestKey();
      expect(yield* tested.host.run(key, tested.change, tested.input)).toBe(null);
      expect(yield* Deferred.isDone(release)).toBe(false);
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(reader)).toEqual({ first: tested.first, second: tested.second,
        before: [tested.input.first], after: [tested.input.first] });
      expect(yield* tested.host.read(tested.read, tested.input)).toMatchObject({
        first: { title: "changed-first" }, second: { title: "changed-second" },
        before: [tested.input.second], after: [tested.input.second],
      });
      expect(yield* tested.host.run(key, tested.change, tested.input)).toBe(null);
      expect(tested.readCount()).toBe(2);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
    expect(persistence.pool.waitingCount).toBe(0);
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);
  it("expires a stalled snapshot callback and releases its lifecycle protection", () => withPersistence(async persistence => {
    let finalized = false;
    const tested = await snapshotFixture(persistence, makePostgresRelationalSession(persistence),
      Effect.never.pipe(Effect.ensuring(Effect.sync(() => { finalized = true; }))));
    const failure = await runEffectFailure(tested.host.read(tested.read, tested.input).pipe(Effect.timeout("20 seconds")));
    expect(failure).toMatchObject({ reason: "resourceFailure", cause: { reason: "resourceFailure", cause: {
      _tag: "PhysicalSessionResourceIssue", phase: "callback", cause: { _tag: "PhysicalSessionDeadlineIssue", deadlineKind: "initial" },
    } } });
    expect(finalized).toBe(true);
    expect(tested.readCount()).toBe(1);
    await expect(persistence.drizzle.transaction(tx => runEffect(
      advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, tested.fixture.authority.scopeId)))).resolves.toEqual({ previous: 0n, current: 1n });
    expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
  }), 120_000);
});
