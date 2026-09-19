import { Effect, Result, Schema } from "effect";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { appRowIdHexV1ToBytes, decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import type { Json } from "flarex-protocol/json";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { defineCmsCommand, makeCmsHost, type CmsHostTestHooks } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds, fxSystemScopeClocks, fxSystemCommits,
  fxSystemIdempotency, fxSystemCommitWakes, fxSystemCommitAppRowChanges, fxSystemTransactionSessions } from "../src/schema";
import { cmsHostFixture } from "./cmsHostFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const decodeInput = Schema.decodeUnknownResult(Schema.Struct({ count: Schema.Literals([1, 8, 32]), prefix: Schema.NonEmptyString }));
const decodeDocuments = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ _id: Schema.String, title: Schema.String, _creationTime: Schema.Number })));
const decodeIds = Schema.decodeUnknownResult(Schema.Array(Schema.String));
const decodeMove = Schema.decodeUnknownResult(Schema.Struct({ firstId: Schema.String, secondId: Schema.String, firstTitle: Schema.String, temporaryTitle: Schema.String }));

/** Actual active CMS core composition; setup and assertions are outside timing. */
export async function cmsExecutionMeasurementFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  hooks?: CmsHostTestHooks) {
  const { fixture } = await cmsHostFixture(persistence);
  const scope = Result.getOrThrow(projectScopeIdUuidV1Result(fixture.authority.scopeId));
  let executions = 0;
  let priorDocumentReads = 0;
  const insert = defineCmsCommand({ name: "measuredInsert", mode: "write", run: Effect.fn("CmsMeasurement.insert")(function* (ctx, args) {
    const input = yield* Effect.fromResult(decodeInput(args)).pipe(Effect.mapError(() => cmsError("invalidInput")));
    executions++;
    const documents: Json[] = [];
    for (let index = 0; index < input.count; index++) {
      documents.push(yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: `${input.prefix}-${index.toString().padStart(2, "0")}` }));
    }
    return documents;
  }) });
  const read = defineCmsCommand({ name: "measuredReadback", mode: "read", run: Effect.fn("CmsMeasurement.readback")(function* (ctx, args) {
    const ids = yield* Effect.fromResult(decodeIds(args)).pipe(Effect.mapError(() => cmsError("invalidInput")));
    const documents: Json[] = [];
    for (const id of ids) documents.push(yield* ctx.documents.get(ctx.context, undefined, id));
    return documents;
  }) });
  const moveAndReuse = defineCmsCommand({ name: "moveAndReuse", mode: "write", run: Effect.fn("CmsMeasurement.moveAndReuse")(function* (ctx, args) {
    const input = yield* Effect.fromResult(decodeMove(args)).pipe(Effect.mapError(() => cmsError("invalidInput")));
    yield* ctx.documents.patch(ctx.context, ctx.transactionId, input.firstId, { title: input.temporaryTitle });
    yield* ctx.documents.patch(ctx.context, ctx.transactionId, input.secondId, { title: input.firstTitle });
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, input.firstId);
    return yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: input.temporaryTitle });
  }) });
  const host = await runEffect(makeCmsHost({ database: persistence.drizzle, controlDatabase: fixture.control.drizzle, session,
    deploymentId: fixture.deploymentId, authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority,
    application: fixture.relationActivation, commands: [insert, read, moveAndReuse], identityAndAccessPolicy: { subject: "ce2-measurement", policy: "cms-scalar" },
    materialization: {
      observeQuery: query => { if (query.name === "loadPriorDocuments") priorDocumentReads++; },
      intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
      developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle),
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }),
    } }, hooks));
  // Multiple active scopes may share this fixture's physical schema. Each
  // inventory observes only its scope and is never included in telemetry.
  const inventory = async () => ({
    rows: await persistence.drizzle.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid)).orderBy(fxAppRowCurrent.rowId),
    revisions: await persistence.drizzle.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scope.scopeUuid)).orderBy(fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    indexes: await persistence.drizzle.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.scopeUuid, scope.scopeUuid)).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
    indexRevisions: await persistence.drizzle.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.scopeUuid, scope.scopeUuid)).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    claims: await persistence.drizzle.select().from(fxAppUniqueKeys).where(eq(fxAppUniqueKeys.scopeUuid, scope.scopeUuid)).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.rowId),
    builds: await persistence.drizzle.select().from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId, scope.scopeId)).orderBy(fxSystemIndexBuildStates.indexDefinitionId),
    uniqueBuilds: await persistence.drizzle.select().from(fxSystemUniqueConstraintBuilds).where(eq(fxSystemUniqueConstraintBuilds.scopeId, scope.scopeId)).orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId),
    clock: await persistence.drizzle.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, fixture.authority.scopeId)),
    commits: await persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scope.scopeUuid)).orderBy(fxSystemCommits.commitSeq),
    outcomes: await persistence.drizzle.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scope.scopeUuid)).orderBy(fxSystemIdempotency.commitSeq),
    wakes: await persistence.drizzle.select().from(fxSystemCommitWakes).where(eq(fxSystemCommitWakes.scopeUuid, scope.scopeUuid)).orderBy(fxSystemCommitWakes.commitSeq),
    facts: await persistence.drizzle.select().from(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.scopeUuid, scope.scopeUuid)).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.rowId),
    sessions: await persistence.drizzle.select().from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.scopeUuid, scope.scopeUuid)),
  });
  const verifyInserts = async (before: Awaited<ReturnType<typeof inventory>>, inserts: readonly { readonly value: Json; readonly count: number; readonly prefix: string }[]) => {
    const allIds: string[] = [];
    for (const { value, count, prefix } of inserts) {
      const documents = decodeDocuments(value);
      expect(documents.map(document => document.title)).toEqual(Array.from({ length: count }, (_, index) => `${prefix}-${index.toString().padStart(2, "0")}`));
      expect(documents).toHaveLength(count);
      allIds.push(...documents.map(document => document._id));
      expect(await runEffect(host.read(read, documents.map(document => document._id)))).toEqual(value);
    }
    const count = inserts.reduce((sum, insert) => sum + insert.count, 0);
    expect(new Set(allIds).size).toBe(count);
    const after = await inventory();
    expect(after.rows.length - before.rows.length).toBe(count);
    expect(after.revisions.length - before.revisions.length).toBe(count);
    expect(after.claims.length - before.claims.length).toBe(count);
    expect(after.facts.length - before.facts.length).toBe(count);
    expect(after.indexes.length - before.indexes.length).toBe(count * 2);
    expect(after.indexRevisions.length - before.indexRevisions.length).toBe(count * 2);
    const priorSequence = before.clock[0]?.lastCommitSeq;
    if (priorSequence === undefined) throw new Error("Missing scope clock");
    const sequences = inserts.map((_, index) => priorSequence + BigInt(index + 1));
    for (const family of ["commits", "outcomes", "wakes"] as const) {
      expect(after[family].length - before[family].length).toBe(inserts.length);
      expect(after[family].filter(row => row.commitSeq > priorSequence).map(row => row.commitSeq)).toEqual(sequences);
    }
    expect(after.clock[0]?.lastCommitSeq).toBe(priorSequence + BigInt(inserts.length));
    expect(before.builds.length).toBeGreaterThan(0);
    expect(before.uniqueBuilds.length).toBeGreaterThan(0);
    expect(before.builds.every(build => build.maintenanceActivationSequence !== null)).toBe(true);
    expect(before.uniqueBuilds.every(build => build.maintenanceActivationSequence !== null)).toBe(true);
    expect(after.builds).toEqual(before.builds);
    expect(after.uniqueBuilds).toEqual(before.uniqueBuilds);
    expect(after.sessions).toEqual(before.sessions);
    return after;
  };
  const verifyInsert = (before: Awaited<ReturnType<typeof inventory>>, value: Json, count: number, prefix: string) => verifyInserts(before, [{ value, count, prefix }]);
  return { fixture, host, insert, read, moveAndReuse, inventory, verifyInsert, verifyInserts, scope, priorDocumentReadCount: () => priorDocumentReads, executionCount: () => executions };
}

export async function cmsExecutionMeasurementCorrectness(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession) {
  const tested = await cmsExecutionMeasurementFixture(persistence, session);
  for (const count of [1, 8, 32]) {
    const before = await tested.inventory();
    const args = { count, prefix: `correct-${count}` };
    const key = tested.host.newRequestKey();
    const value = await runEffect(tested.host.run(key, tested.insert, args));
    const after = await tested.verifyInsert(before, value, count, args.prefix);
    const executed = tested.executionCount();
    expect(await runEffect(tested.host.run(key, tested.insert, args))).toEqual(value);
    expect(tested.executionCount()).toBe(executed);
    expect(await tested.inventory()).toEqual(after);
    expect(await runEffectFailure(tested.host.run(tested.host.newRequestKey(), tested.insert, args))).toMatchObject({ reason: "uniqueConflict" });
    expect(await tested.inventory()).toEqual(after);
  }
  // Preserve the actual growing-catalog failure: more stored identities than
  // the request budget must not prevent a selective unique insert or conflict.
  for (let batch = 0; batch < 9; batch++) {
    const before = await tested.inventory();
    const prefix = `growth-${batch}`;
    const value = await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 32, prefix }));
    await tested.verifyInsert(before, value, 32, prefix);
  }
  const large = await tested.inventory();
  expect(large.rows.length).toBeGreaterThan(256);
  const final = await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "after-growth" }));
  const afterGrowth = await tested.verifyInsert(large, final, 1, "after-growth");
  expect(await runEffectFailure(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 1, prefix: "correct-1" })))
    .toMatchObject({ reason: "uniqueConflict" });
  expect(await tested.inventory()).toEqual(afterGrowth);

  const pair = decodeDocuments(await runEffect(tested.host.run(tested.host.newRequestKey(), tested.insert, { count: 8, prefix: "pending" })));
  const first = pair[0]; const second = pair[1];
  if (first === undefined || second === undefined) throw new Error("Expected pending reuse inputs");
  const priorReadsBefore = tested.priorDocumentReadCount();
  const reused = await runEffect(tested.host.run(tested.host.newRequestKey(), tested.moveAndReuse,
    { firstId: first._id, secondId: second._id, firstTitle: first.title, temporaryTitle: "reused-title" }));
  expect(tested.priorDocumentReadCount() - priorReadsBefore).toBe(1);
  const readback = await runEffect(tested.host.read(tested.read, [first._id, second._id]));
  expect(readback).toEqual([null, { ...second, title: first.title }]);
  expect(reused).toMatchObject({ title: "reused-title" });

  const finalDocument = decodeDocuments(final)[0];
  if (finalDocument === undefined) throw new Error("Expected single-row insert");
  const finalIdentity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(finalDocument._id));
  const original = (await tested.inventory()).claims.find(claim => claim.tableId === finalIdentity.tableId &&
    bytesEqualFullScan(claim.rowId, appRowIdHexV1ToBytes(finalIdentity.rowId)));
  if (original === undefined) throw new Error("Expected durable claim");
  const identity = and(eq(fxAppUniqueKeys.scopeUuid, original.scopeUuid), eq(fxAppUniqueKeys.constraintId, original.constraintId),
    eq(fxAppUniqueKeys.localeKey, original.localeKey), eq(fxAppUniqueKeys.canonicalKeySha256, original.canonicalKeySha256));
  // The key lookup must authenticate bytes even if the digest slot still matches.
  const damaged = new Uint8Array(original.encodedKey);
  damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 1;
  await persistence.drizzle.update(fxAppUniqueKeys).set({ encodedKey: damaged }).where(identity);
  try {
    const corrupted = await tested.inventory();
    expect(await runEffectFailure(tested.host.run(tested.host.newRequestKey(), tested.insert,
      { count: 1, prefix: "after-growth" }))).toMatchObject({ reason: "storedCorruption" });
    expect(await tested.inventory()).toEqual(corrupted);
  } finally { await persistence.drizzle.update(fxAppUniqueKeys).set({ encodedKey: original.encodedKey }).where(identity); }
  const secondIdentity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(second._id));
  const otherClaim = (await tested.inventory()).claims.find(claim => claim.tableId === secondIdentity.tableId &&
    bytesEqualFullScan(claim.rowId, appRowIdHexV1ToBytes(secondIdentity.rowId)));
  if (otherClaim === undefined) throw new Error("Expected another durable claim");
  const otherSlot = and(eq(fxAppUniqueKeys.scopeUuid, otherClaim.scopeUuid), eq(fxAppUniqueKeys.constraintId, otherClaim.constraintId),
    eq(fxAppUniqueKeys.localeKey, otherClaim.localeKey), eq(fxAppUniqueKeys.canonicalKeySha256, otherClaim.canonicalKeySha256));
  await persistence.drizzle.delete(fxAppUniqueKeys).where(otherSlot);
  try {
    await persistence.drizzle.update(fxAppUniqueKeys).set({ rowId: otherClaim.rowId }).where(identity);
    const corrupted = await tested.inventory();
    expect(await runEffectFailure(tested.host.run(tested.host.newRequestKey(), tested.insert,
      { count: 1, prefix: "after-growth" }))).toMatchObject({ reason: "storedCorruption" });
    expect(await tested.inventory()).toEqual(corrupted);
  } finally {
    await persistence.drizzle.update(fxAppUniqueKeys).set({ rowId: original.rowId }).where(identity);
    await persistence.drizzle.insert(fxAppUniqueKeys).values(otherClaim);
  }
}
