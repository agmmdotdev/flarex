import { projectScopeIdUuidV1Result, ScopeIdSchema, ScopeEpochSchema, StorageGenerationSchema } from "flarex-protocol/storage-authority";
import { isJsonObject } from "flarex-protocol/json";
import { ne } from "drizzle-orm";
import { expect } from "vitest";
import { Effect, Result, Schema } from "effect";
import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost, defineCmsCommand, type CmsCommandContext } from "../src/cmsTransaction/host";
import { cmsError, cmsLimits } from "../src/cmsTransaction/model";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemOutbox,
  fxSystemCommitAppRowChanges, fxSystemScopeClocks, fxAppUniqueKeys, fxAppIndexEntryCurrent } from "../src/schema";
import { capturePayloadPreferenceProfile } from "../src/payloadPreferences/binding";
import { capturePayloadPreferenceRecord } from "../src/payloadPreferences/value";
import { payloadPreferenceSchemaInput } from "../src/payloadPreferences/schema";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { frameworkMigrationTargetSnapshot } from "../src/migrationCoordination/targetSession";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { prepareFrameworkSchemaArtifactAdmission, makeFrameworkSchemaArtifactRepository } from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { makeFrameworkSchemaArtifactControlSessionStarter } from "../src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../src/frameworkSchema/artifact/postgresControlSession";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { captureFrameworkSchemaAvailabilityHistory, captureFrameworkSchemaAvailabilityHead } from "../src/frameworkSchema/installation/canonical";
import { appendFrameworkSchemaAvailabilityHistoryInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHistoryRepository";
import { compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHeadRepository";
import { payloadScalarFields } from "../src/payloadScalar/contract";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { cmsHostFixture } from "./cmsHostFixture";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { installationBindingReference } from "./frameworkDataBindingPhysicalTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { payloadPreferencePublicationScenario } from "./payloadPreferencePublicationScenario";
const decodeGeneration = Schema.decodeUnknownEffect(StorageGenerationSchema);

export async function payloadPreferenceBindingScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture schema");
  const { fixture, target, bindings, reference, candidate: contentCandidate } = await cmsHostFixture(persistence, { cmsFields: payloadScalarFields,
    physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } });
  const profile = await runEffect(capturePayloadPreferenceProfile(fixture.deploymentId));
  const repository = "pool" in persistence ? Result.getOrThrow(makeFrameworkSchemaArtifactRepository({ controlDb: persistence.drizzle,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({ controlDb: persistence.drizzle, driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(persistence.pool) }),
    readTimeoutMilliseconds: 10000, attemptTimeoutMilliseconds: 10000, recoveryTimeoutMilliseconds: 10000, lockTimeoutMilliseconds: 2000 })) : makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence).repository;
  await runEffect(admitFrameworkSchemaArtifactEffect(repository, Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(profile.artifact))));
  const input = { target, artifactRepository: repository, artifactIdentity: profile.artifact.identity, attemptId: "preference-install", leaseOwnerId: "preference-test",
    leaseDurationMilliseconds: 120000, lockTimeoutMilliseconds: 5000, statementTimeoutMilliseconds: 30000, maximumStepsPerRun: 16 };
  const ready = await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input));
  if (ready.kind !== "ready") throw new Error(`Preference installation incomplete: ${ready.kind}`);
  const availability = ready.availability;
  expect(availability.installation.admission.admission.frame.admissionProfile).toBe("payload-preferences-fresh");
  expect((await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).kind).toBe("ready");
  const physical = availability.installation.plan.plan.physicalLayout.frame.tables[0];
  if (physical === undefined) throw new Error("Missing installed preference table");
  const column = (id: string) => {
    const value = physical.columns.find(column => column.identity.columnId === id);
    if (value === undefined) throw new Error(`Missing preference column ${id}`);
    return value.name;
  };
  // Test-only typed physical fixture; no runtime preference DML port is admitted.
  const table = pgTable(physical.name, { scope: uuid("scope_uuid"), generation: text(column("storage_generation")), id: text(column("id")), key: text(column("key")),
    userCollection: text(column("user_collection")), userId: text(column("user_id")), value: jsonb(column("value")),
    createdAt: timestamp(column("created_at"), { withTimezone: true, mode: "string" }), updatedAt: timestamp(column("updated_at"), { withTimezone: true, mode: "string" }) });
  const record = await runEffect(capturePayloadPreferenceRecord({ id: "preference-a", key: "collection-posts-a", user: { relationTo: "users", value: "user-a" },
    value: { nested: [true, null, String.fromCodePoint(0x1f600), 1.5] }, createdAt: "2026-01-01", updatedAt: "2026-01-01" }));
  await persistence.drizzle.insert(table).values({ scope: Result.getOrThrow(projectScopeIdUuidV1Result(reference.scopeId)).scopeUuid, generation: reference.storageGeneration, id: record.id, key: record.key,
    userCollection: record.user.relationTo, userId: record.user.value, value: record.value, createdAt: record.createdAt, updatedAt: record.updatedAt });
  const retained = await persistence.drizzle.select().from(table);
  expect(retained[0]).toMatchObject({ id: record.id, key: record.key, userCollection: "users", userId: "user-a", value: record.value });
  expect(Date.parse(retained[0]?.createdAt ?? "")).toBe(Date.parse(record.createdAt));
  await runEffectFailure(capturePayloadPreferenceRecord({ ...record, user: { relationTo: "admins", value: "user-a" } }));
  await runEffectFailure(capturePayloadPreferenceRecord({ ...record, extra: true }));
  for (const invalid of [String.fromCharCode(0), String.fromCharCode(0xd800), String.fromCharCode(0xdc00)]) {
    for (const bad of [{ ...record, id: invalid }, { ...record, key: invalid }, { ...record, user: { relationTo: "users", value: invalid } },
      { ...record, value: { nested: [invalid] } }, { ...record, value: { [invalid]: true } }]) {
      expect(await runEffectFailure(capturePayloadPreferenceRecord(bad))).toMatchObject({ reason: "invalidInput" });
    }
  }
  const lifecycle = { ...installationBindingReference(availability), profiles: [profile.profile] };
  const frame = { ...contentCandidate.frame, payloadLifecycle: lifecycle };
  const before = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
  const candidate = await runEffect(bindings.prepare(frame));
  const request = dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "activate-preferences", candidate.sha256, before.head);
  await runEffect(bindings.activate(request));
  expect((await runEffect(bindings.withCurrent(readAdmittedDataBinding))).frame).toEqual(frame);
  const cold = await runEffect(makeDataBindingHost({ database: persistence.drizzle, target, deploymentId: fixture.deploymentId, authority: fixture.authorityPorts, application: fixture.relationActivation }));
  expect((await runEffect(cold.withCurrent(readAdmittedDataBinding))).frame).toEqual(frame);
  for (const changed of [{ ...frame, payloadContent: null }, { ...frame, payloadLifecycle: { ...lifecycle, profiles: [] } },
    { ...frame, payloadLifecycle: { ...lifecycle, profiles: [{ ...profile.profile, contractSha256: "0".repeat(64) }] } },
    { ...frame, payloadLifecycle: { ...lifecycle, readinessSha256: "0".repeat(64) } }]) await runEffectFailure(bindings.prepare(changed));
  let calls = 0;
  const probe = defineCmsCommand({ name: "preference-binding-probe", mode: "read", run: () => Effect.sync(() => { calls += 1; return null; }) });
  const hostInput = { database: persistence.drizzle, controlDatabase: fixture.control.drizzle, session, deploymentId: fixture.deploymentId,
    authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority, application: fixture.relationActivation, commands: [probe], identityAndAccessPolicy: { profile: "preference-binding-only" },
    materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle), developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle),
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle), candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }) } };
  const disabled = await runEffect(makeCmsHost(hostInput));
  expect(await runEffectFailure(disabled.read(probe, {}))).toMatchObject({ reason: "unsupportedProfile" });
  const host = await runEffect(makeCmsHost({ ...hostInput, payloadPreferenceTarget: target }));
  expect(await runEffect(host.read(probe, {}))).toBe(null);
  expect(calls).toBe(1);
  // Reuse this installed fixture for the transaction/receipt slice on both drivers.
  let activeTx: FlarexMetadataTransaction | undefined;
  let escaped: CmsCommandContext | undefined;
  let observedIds: readonly (string | null)[] = [];
  let cleanupCompletions = 0;
  const closedReceipts: unknown[] = [];
  let sawCleanup = false;
  const create = defineCmsCommand({ name: "preference-create-post", mode: "write", run: Effect.fn("PreferenceTest.create")(
    ctx => ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: "cleanup-post", score: 0, enabled: false,
      publishedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })) });
  const cleanupRun = Effect.fn("PreferenceTest.cleanup")(function* (ctx: CmsCommandContext, args: import("flarex-protocol/json").Json) {
    if (!isJsonObject(args) || typeof args.id !== "string") return yield* Effect.fail(cmsError("invalidInput"));
    escaped = ctx;
    if (args.beforeDelete !== true) yield* ctx.documents.delete(ctx.context, ctx.transactionId, args.id);
    const cleanup = ctx.preferences.deleteForPendingPost(ctx.context, args.foreignId === true ? "foreign" : ctx.transactionId,
      args.selector ?? { key: { in: [`collection-posts-${args.id}`] } });
    if (args.catchFailure === true) yield* cleanup.pipe(Effect.catchTag("CmsTransactionError", () => Effect.void));
    else yield* cleanup;
    cleanupCompletions += 1;
    if (activeTx === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
    observedIds = (yield* runDrizzleStatementEffect(activeTx.select({ id: table.id }).from(table), cause => cmsError("statementFailure", cause))).map(row => row.id);
    if (args.failAfter === true) return yield* Effect.fail(cmsError("invalidInput"));
    return null;
  });
  const cleanup = defineCmsCommand({ name: "preference-cleanup-post", mode: "write", run: cleanupRun });
  const cleanupRead = defineCmsCommand({ name: "preference-cleanup-read", mode: "read", run: cleanupRun });
  const cleanupHost = await runEffect(makeCmsHost({ ...hostInput, payloadPreferenceTarget: target, commands: [create, cleanup, cleanupRead] }, {
    afterAdmission: tx => Effect.sync(() => { activeTx = tx; sawCleanup = false; }),
    afterPreferenceClosure: evidence => Effect.sync(() => { closedReceipts.push(evidence); sawCleanup = evidence.length > 0; }),
    afterPreferenceFacts: () => sawCleanup ? Effect.fail(cmsError("unsupportedProfile")) : Effect.void,
  }));
  const post = await runEffect(cleanupHost.run(cleanupHost.newRequestKey(), create, {}));
  if (!isJsonObject(post) || typeof post._id !== "string") throw new Error("Missing cleanup post");
  const postId = post._id;
  const selector = { key: { in: [`collection-posts-${postId}`] } };
  const inventory = async () => ({ rows: await persistence.drizzle.select().from(fxAppRowCurrent), revisions: await persistence.drizzle.select().from(fxAppRowRevisions),
    commits: await persistence.drizzle.select().from(fxSystemCommits), outcomes: await persistence.drizzle.select().from(fxSystemIdempotency),
    wakes: await persistence.drizzle.select().from(fxSystemOutbox), facts: await persistence.drizzle.select().from(fxSystemCommitAppRowChanges),
    clocks: await persistence.drizzle.select().from(fxSystemScopeClocks), unique: await persistence.drizzle.select().from(fxAppUniqueKeys), indexes: await persistence.drizzle.select().from(fxAppIndexEntryCurrent) });
  const foreignScope = ScopeIdSchema.make(`scope_${crypto.randomUUID()}`);
  await persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: foreignScope, storageGeneration: await runEffect(decodeGeneration(reference.storageGeneration)), epoch: ScopeEpochSchema.make(reference.epoch) });
  const publicationBefore = await inventory();
  // A real zero-match query produces a receipt, then the closed publication gate rolls back.
  expect(await runEffectFailure(cleanupHost.run(cleanupHost.newRequestKey(), cleanup, { id: postId }))).toMatchObject({ reason: "unsupportedProfile" });
  expect(cleanupCompletions).toBe(1);
  expect(closedReceipts.at(-1)).toEqual([{ documentId: postId, key: selector.key.in[0], preferenceIds: [] }]);
  const seed = { scope: Result.getOrThrow(projectScopeIdUuidV1Result(reference.scopeId)).scopeUuid, generation: reference.storageGeneration,
    key: selector.key.in[0], userCollection: "users", userId: "user-a", value: { retained: true }, createdAt: record.createdAt, updatedAt: record.updatedAt };
  await persistence.drizzle.insert(table).values([{ ...seed, id: "matching-a" }, { ...seed, id: "matching-b" },
    { ...seed, id: "other-key", key: "collection-posts-unrelated" }, { ...seed, id: "other-generation", generation: "legacy_v1" },
    { ...seed, id: "other-scope", scope: Result.getOrThrow(projectScopeIdUuidV1Result(foreignScope)).scopeUuid }]);
  const preferencesBefore = await persistence.drizzle.select().from(table);
  for (const args of [{ id: postId }, { id: postId, failAfter: true }]) {
    await runEffectFailure(cleanupHost.run(cleanupHost.newRequestKey(), cleanup, args));
    expect(observedIds).not.toContain("matching-a");
    expect(observedIds).not.toContain("matching-b");
    expect(observedIds).toEqual(expect.arrayContaining([record.id, "other-key", "other-generation", "other-scope"]));
    expect(await persistence.drizzle.select().from(table)).toEqual(preferencesBefore);
  }
  const completedBeforeRefusals = cleanupCompletions;
  expect(closedReceipts.at(-1)).toEqual([{ documentId: postId, key: selector.key.in[0], preferenceIds: ["matching-a", "matching-b"] }]);
  for (const args of [{ id: postId, beforeDelete: true }, { id: postId, foreignId: true },
    ...[{ key: { equals: selector.key.in[0] } }, { key: { in: [] } }, { key: { in: [selector.key.in[0], "extra"] } },
      { key: { in: ["collection-users-a"] } }, { key: { in: ["collection-posts-not-pending"] } }, { ...selector, extra: true }].map(selector => ({ id: postId, selector }))]) {
    await runEffectFailure(cleanupHost.run(cleanupHost.newRequestKey(), cleanup, args));
  }
  expect(cleanupCompletions).toBe(completedBeforeRefusals);
  await runEffectFailure(cleanupHost.read(cleanupRead, { id: postId, beforeDelete: true }));
  if (escaped === undefined) throw new Error("Missing escaped request");
  await runEffectFailure(escaped.preferences.deleteForPendingPost(escaped.context, escaped.transactionId, selector));
  // The existing host rejects output charging once a caught operation has latched rollback.
  expect(await runEffectFailure(cleanupHost.run(cleanupHost.newRequestKey(), cleanup, { id: postId, selector: {}, catchFailure: true }))).toMatchObject({ reason: "closed" });
  // Overflow is detected before DELETE, even when the command catches the error.
  await persistence.drizzle.insert(table).values(Array.from({ length: cmsLimits.identities - 1 }, (_, index) => ({ ...seed, id: `overflow-${index}` })));
  const overflowBefore = await persistence.drizzle.select().from(table);
  expect(await runEffectFailure(cleanupHost.run(cleanupHost.newRequestKey(), cleanup, { id: postId, catchFailure: true }))).toMatchObject({ reason: "closed" });
  expect(observedIds).toContain("matching-a");
  expect(await persistence.drizzle.select().from(table)).toEqual(overflowBefore);
  expect(await inventory()).toEqual(publicationBefore);
  // Remove only test seeds so the original withdrawal/retention assertion remains exact.
  await persistence.drizzle.delete(table).where(ne(table.id, record.id));
  await payloadPreferencePublicationScenario({ persistence, hostInput: { ...hostInput, payloadPreferenceTarget: target },
    seed: async (id, preferenceIds) => { await persistence.drizzle.insert(table).values(preferenceIds.map(preferenceId => ({ ...seed, id: preferenceId, key: `collection-posts-${id}` }))); },
    readPreferenceIds: async () => (await persistence.drizzle.select({ id: table.id }).from(table)).map(row => row.id), inventory });
  await persistence.drizzle.delete(table).where(ne(table.id, record.id));
  const schema = payloadPreferenceSchemaInput();
  const malformed = await runEffect(captureRelationalSchemaArtifact({ deploymentId: fixture.deploymentId, provenance: profile.artifact.provenance, schema: { ...schema, tables: schema.tables.map(table => ({ ...table, indexes: [] })) } }));
  const snapshot = frameworkMigrationTargetSnapshot(target);
  if (snapshot === undefined) throw new Error("Missing target snapshot");
  const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: malformed.artifact, targetNamespace: snapshot.namespace, physicalLocator: snapshot.physicalLocator }));
  await runEffectFailure(captureFreshRelationalMigrationPlan({ artifact: malformed.artifact, physicalLayout: layout }));
  await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
    const history = yield* captureFrameworkSchemaAvailabilityHistory({ readiness: availability.readiness.readiness, previous: availability.history.history,
      status: "withdrawn", reasonSha256: "f".repeat(64), recordedAt: "2026-09-06T00:00:00.000Z" });
    const stored = yield* appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(tx, availability.readiness, availability.history, history);
    yield* compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(tx, availability, stored, yield* captureFrameworkSchemaAvailabilityHead(stored.history));
  })));
  await runEffectFailure(host.read(probe, {}));
  const completedBeforeWithdrawal = cleanupCompletions;
  await runEffectFailure(cleanupHost.run(cleanupHost.newRequestKey(), cleanup, { id: postId }));
  expect(cleanupCompletions).toBe(completedBeforeWithdrawal);
  await runEffectFailure(cold.withCurrent(readAdmittedDataBinding));
  expect(calls).toBe(1);
  expect(await persistence.drizzle.select().from(table)).toEqual(retained);
}
