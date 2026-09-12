import { cmsHostFixture } from "./cmsHostFixture";
import { assertCmsParticipantAdmission } from "./cmsParticipantAdmission";
import { expect } from "vitest";
import { Effect, Exit } from "effect";
import { and, eq } from "drizzle-orm";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction, readBoundedCurrentAppRowsInTransactionEffect } from "../src/appRows";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { isJsonObject } from "flarex-protocol/json";

import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";

import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";

import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { defineCmsCommand, makeCmsHost, type CmsCommandContext } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import type { PointCommitTransactionProofStepV1 } from "../src/pointCommitTransaction";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks, fxSystemTransactionSessions, fxSystemCommitAppRowChanges, fxSystemSnapshotLeases, fxSystemTransactionJournals, fxAppIndexEntryRevisions, fxAppIndexEntryCurrent, fxAppUniqueKeys, fxSystemAppSchemaCandidateValidations } from "../src/schema";

import { runEffect, runEffectFailure } from "./effectTestRuntime";

export async function cmsHostScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession) {
  const { fixture, tables, bindings, reference, candidate } = await cmsHostFixture(persistence);
  const posts = tables.find(table => table.logicalName === "posts");
  if (posts === undefined) throw new Error("Expected conformance posts binding");
  let callbacks = 0;
  let escaped: CmsCommandContext | undefined;
  const create = defineCmsCommand({ name: "create", mode: "write", run: Effect.fn("CmsTest.create")(function* (ctx, args) {
    callbacks += 1;
    escaped = ctx;
    const document = yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", args);
    if (typeof document._id !== "string") return yield* Effect.fail(cmsError("storedCorruption"));
    yield* ctx.documents.patch(ctx.context, Promise.resolve(ctx.transactionId), document._id, { title: "updated" });
    const found = yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts", { where: { title: "updated" }, offset: 0, limit: 32 });
    expect(found.total).toBe(1);
    return yield* ctx.documents.get(ctx.context, ctx.transactionId, document._id);
  }) });
  const read = defineCmsCommand({ name: "read", mode: "read", run: Effect.fn("CmsTest.read")(function* (ctx) {
    const found = yield* ctx.documents.find(ctx.context, undefined, "posts", { where: {}, offset: 0, limit: 32 });
    return { docs: [...found.docs], total: found.total };
  }) });
  const edit = defineCmsCommand({ name: "edit", mode: "write", run: Effect.fn("CmsTest.edit")(function* (ctx, args) {
    if (!isJsonObject(args) || typeof args.id !== "string") return yield* Effect.fail(cmsError("invalidInput"));
    yield* ctx.documents.patch(ctx.context, ctx.transactionId, args.id, { title: "updated" });
    return yield* ctx.documents.replace(ctx.context, ctx.transactionId, args.id, { title: "final" });
  }) });
  const netZero = defineCmsCommand({ name: "netZero", mode: "write", run: Effect.fn("CmsTest.netZero")(function* (ctx) {
    const row = yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: "ephemeral" });
    if (typeof row._id !== "string") return yield* Effect.fail(cmsError("storedCorruption"));
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, row._id);
    expect(yield* ctx.documents.get(ctx.context, ctx.transactionId, row._id)).toBeNull();
    return null;
  }) });
  const invalid = defineCmsCommand({ name: "invalid", mode: "write", run: Effect.fn("CmsTest.invalid")(function* (ctx) {
    yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: 42 }).pipe(Effect.catch(() => Effect.void));
    return null;
  }) });
  const borrowedCommit = defineCmsCommand({ name: "borrowedCommit", mode: "write", run: ctx => ctx.commit(ctx.transactionId).pipe(Effect.catch(() => Effect.succeed(null))) });
  const nestedFailure = defineCmsCommand({ name: "nestedFailure", mode: "write", run: ctx => ctx.nested(invalid, null).pipe(Effect.catch(() => Effect.succeed(null))) });
  const invalidId = defineCmsCommand({ name: "invalidId", mode: "write", run: ctx => ctx.documents.find(ctx.context, "foreign", "posts", { where: {}, offset: 0, limit: 32 })
    .pipe(Effect.as(null), Effect.catch(() => Effect.succeed(null))) });
  const remove = defineCmsCommand({ name: "remove", mode: "write", run: Effect.fn("CmsTest.remove")(function* (ctx, args) {
    if (typeof args !== "string") return yield* Effect.fail(cmsError("invalidInput"));
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, args);
    return null;
  }) });
  const sameValue = defineCmsCommand({ name: "sameValue", mode: "write", run: Effect.fn("CmsTest.sameValue")(function* (ctx, args) {
    if (typeof args !== "string") return yield* Effect.fail(cmsError("invalidInput"));
    return yield* ctx.documents.patch(ctx.context, ctx.transactionId, args, { title: "final" });
  }) });
  const tooMany = defineCmsCommand({ name: "tooMany", mode: "read", run: Effect.fn("CmsTest.tooMany")(function* (ctx) {
    for (let index = 0; index < 65; index += 1) yield* ctx.begin();
    return null;
  }) });
  const tooLarge = defineCmsCommand({ name: "tooLarge", mode: "write", run: ctx =>
    ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: "x".repeat(65_536) }) });
  const duplicate = defineCmsCommand({ name: "duplicate", mode: "write", run: Effect.fn("CmsTest.duplicate")(function* (ctx) {
    yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: "same" });
    yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: "same" }).pipe(Effect.catch(error => {
      expect(error.reason).toBe("uniqueConflict");
      return Effect.succeed(null);
    }));
    return null;
  }) });
  const pendingId = defineCmsCommand({ name: "pendingId", mode: "write", run: Effect.fn("CmsTest.pendingId")(function* (ctx) {
    const row = yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: "pending-id" });
    if (typeof row._id !== "string") return yield* Effect.fail(cmsError("storedCorruption"));
    yield* Effect.forkChild(ctx.documents.patch(ctx.context, new Promise<string>(() => {}), row._id, { title: "late" }).pipe(Effect.exit));
    yield* Effect.yieldNow;
    return null;
  }) });
  const callBoundary = defineCmsCommand({ name: "callBoundary", mode: "read", run: Effect.fn("CmsTest.callBoundary")(function* (ctx, args) {
    if (typeof args !== "number") return yield* Effect.fail(cmsError("invalidInput"));
    for (let count = 0; count < args; count += 1) yield* ctx.begin();
    return null;
  }) });
  const bulk = defineCmsCommand({ name: "bulk", mode: "write", run: Effect.fn("CmsTest.bulk")(function* (ctx, args) {
    if (!isJsonObject(args) || typeof args.count !== "number" || typeof args.prefix !== "string") return yield* Effect.fail(cmsError("invalidInput"));
    for (let index = 0; index < args.count; index += 1) yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: `${args.prefix}-${index}` });
    return null;
  }) });
  const nestedSuccess = defineCmsCommand({ name: "nestedSuccess", mode: "write", run: ctx => ctx.nested(netZero, null) });
  const paging = defineCmsCommand({ name: "paging", mode: "write", run: Effect.fn("CmsTest.paging")(function* (ctx) {
    const base = yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts", { where: {}, offset: 0, limit: 32 });
    expect(base.total).toBe(32);
    const pending: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const row = yield* ctx.documents.insert(ctx.context, ctx.transactionId, "posts", { title: `paging-${index}` });
      if (typeof row._id !== "string") return yield* Effect.fail(cmsError("storedCorruption"));
      pending.push(row._id);
    }
    const expectedIds = [...base.docs.map(row => row._id), ...pending].sort();
    const page = yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts", { where: {}, offset: 1, limit: 2 });
    expect(page.total).toBe(35);
    expect(page.docs.map(row => row._id)).toEqual(expectedIds.slice(1, 3));
    const first = pending[0];
    if (first === undefined) return yield* Effect.fail(cmsError("storedCorruption"));
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, first);
    expect((yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts", { where: {}, offset: 32, limit: 2 })).total).toBe(34);
    expect((yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts", { where: { title: "paging-0" }, offset: 0, limit: 2 })).total).toBe(0);
    for (const id of pending.slice(1)) yield* ctx.documents.delete(ctx.context, ctx.transactionId, id);
    return null;
  }) });
  const commands = [create, read, edit, netZero, invalid, borrowedCommit, nestedFailure, invalidId, remove, sameValue, tooMany, tooLarge, duplicate,
    pendingId, callBoundary, bulk, nestedSuccess, paging];
  const input = { database: persistence.drizzle, controlDatabase: fixture.control.drizzle, session, deploymentId: fixture.deploymentId,
    authority: fixture.authorityPorts, pointCommitAuthority: fixture.pointCommitAuthority, application: fixture.relationActivation, commands,
    identityAndAccessPolicy: { subject: "private-conformance", policy: "cms-scalar" }, materialization: {
      intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
      developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle),
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation, pointCommitAuthority: fixture.pointCommitAuthority }),
    } };
  const host = await runEffect(makeCmsHost(input));
  const inventory = async () => ({ rows: await persistence.drizzle.select().from(fxAppRowCurrent), revisions: await persistence.drizzle.select().from(fxAppRowRevisions),
    clock: await persistence.drizzle.select().from(fxSystemScopeClocks), commits: await persistence.drizzle.select().from(fxSystemCommits),
    outcomes: await persistence.drizzle.select().from(fxSystemIdempotency), wakes: await persistence.drizzle.select().from(fxSystemCommitWakes),
    facts: await persistence.drizzle.select().from(fxSystemCommitAppRowChanges), sessions: await persistence.drizzle.select().from(fxSystemTransactionSessions),
    journals: await persistence.drizzle.select().from(fxSystemTransactionJournals), leases: await persistence.drizzle.select().from(fxSystemSnapshotLeases),
    indexRevisions: await persistence.drizzle.select().from(fxAppIndexEntryRevisions), indexes: await persistence.drizzle.select().from(fxAppIndexEntryCurrent),
    uniqueKeys: await persistence.drizzle.select().from(fxAppUniqueKeys), candidates: await persistence.drizzle.select().from(fxSystemAppSchemaCandidateValidations) });
  const initial = await inventory();
  await assertCmsParticipantAdmission(input);
  expect(await inventory()).toEqual(initial);
  expect(await runEffect(host.read(read, null))).toEqual({ docs: [], total: 0 });
  expect(await runEffect(host.read(callBoundary, 63))).toBeNull();
  expect(await runEffectFailure(host.read(callBoundary, 64))).toMatchObject({ reason: "limitExceeded" });
  expect(await inventory()).toEqual(initial);
  const key = host.newRequestKey();
  const created = await runEffect(host.run(key, create, { title: "original" }));
  if (!isJsonObject(created) || typeof created._id !== "string") throw new Error("Expected created document");
  expect(created.title).toBe("updated");
  const published = await inventory();
  expect(published.revisions).toHaveLength(initial.revisions.length + 1);
  expect(published.commits).toHaveLength(initial.commits.length + 1);
  expect(published.outcomes).toHaveLength(initial.outcomes.length + 1);
  expect(published.wakes).toHaveLength(initial.wakes.length + 1);
  expect(published.facts).toHaveLength(initial.facts.length + 1);
  expect(published.sessions).toEqual(initial.sessions);
  expect(published.journals).toEqual(initial.journals);
  expect(published.leases).toEqual(initial.leases);
  expect(published.indexRevisions.length).toBeGreaterThan(initial.indexRevisions.length);
  expect(published.uniqueKeys).toHaveLength(initial.uniqueKeys.length + 1);
  expect(await runEffect(host.run(key, create, { title: "original" }))).toEqual(created);
  expect(callbacks).toBe(1);
  expect(await inventory()).toEqual(published);
  expect(await runEffectFailure(host.run(key, create, { title: "collision" }))).toMatchObject({ reason: "requestConflict" });
  if (escaped === undefined) throw new Error("Expected captured request");
  expect(await runEffectFailure(escaped.begin(escaped.transactionId))).toMatchObject({ reason: "invalidAuthority" });
  for (const command of [invalid, borrowedCommit, nestedFailure, invalidId, tooMany, tooLarge, duplicate, pendingId]) {
    expect(await runEffectFailure(host.run(host.newRequestKey(), command, null))).toBeDefined();
    expect(await inventory()).toEqual(published);
  }
  const edited = await runEffect(host.run(host.newRequestKey(), edit, { id: created._id }));
  expect(edited).toMatchObject({ _id: created._id, _creationTime: created._creationTime, title: "final" });
  const afterEdit = await inventory();
  expect(afterEdit.revisions).toHaveLength(published.revisions.length + 1);
  expect(afterEdit.revisions.at(-1)?.prevCommitSeq).toEqual(published.revisions.at(-1)?.commitSeq);
  await runEffect(host.run(host.newRequestKey(), netZero, null));
  const afterZero = await inventory();
  expect(afterZero.revisions).toEqual(afterEdit.revisions);
  expect(afterZero.facts).toEqual(afterEdit.facts);
  expect(afterZero.commits).toHaveLength(afterEdit.commits.length + 1);
  expect(afterZero.outcomes).toHaveLength(afterEdit.outcomes.length + 1);
  expect(afterZero.wakes).toHaveLength(afterEdit.wakes.length + 1);
  let retained: readonly object[] = [];
  const receiptAttacks: ((receipts: readonly object[]) => readonly object[])[] = [
    receipts => { retained = receipts; return receipts.map(receipt => ({ ...receipt })); },
    () => retained,
    receipts => receipts.slice(1),
    receipts => [...receipts, {}],
    receipts => [...receipts].reverse(),
    receipts => receipts.map(() => receipts[0] ?? {}),
    receipts => new Array<object>(receipts.length),
  ];
  for (const transformReceipts of receiptAttacks) {
    const attacked = await runEffect(makeCmsHost(input, { transformReceipts }));
    expect(await runEffectFailure(attacked.run(attacked.newRequestKey(), edit, { id: created._id }))).toMatchObject({ reason: "invalidAuthority" });
    expect(await inventory()).toEqual(afterZero);
  }
  const steps: PointCommitTransactionProofStepV1[] = [];
  const observed = await runEffect(makeCmsHost({ ...input, materialization: { ...input.materialization,
    afterTransactionStep: async event => { steps.push(event.step); } } }));
  await runEffect(observed.run(observed.newRequestKey(), sameValue, created._id));
  const afterSame = await inventory();
  expect(afterSame.revisions).toHaveLength(afterZero.revisions.length + 1);
  expect(steps).toEqual(expect.arrayContaining(["tentativeRowWritten", "commitHeaderWritten", "commitChangeWritten", "outcomeWritten", "wakeWritten", "clockAdvanced"]));
  for (const failedStep of new Set(steps)) {
    const fault = new Error(`Fault after ${failedStep}`);
    const failing = await runEffect(makeCmsHost({ ...input, materialization: { ...input.materialization,
      afterTransactionStep: async event => { if (event.step === failedStep) throw fault; } } }));
    expect(Exit.isFailure(await runEffect(Effect.exit(failing.run(failing.newRequestKey(), edit, { id: created._id }))))).toBe(true);
    expect(await inventory()).toEqual(afterSame);
  }
  await runEffect(host.run(host.newRequestKey(), remove, created._id));
  const deleted = await inventory();
  expect(deleted.revisions.at(-1)).toMatchObject({ isTombstone: true, prevCommitSeq: afterSame.revisions.at(-1)?.commitSeq });
  expect(await runEffect(host.read(read, null))).toEqual({ docs: [], total: 0 });
  expect(await runEffectFailure(host.run(host.newRequestKey(), sameValue, created._id))).toMatchObject({ reason: "documentMissing" });
  expect(await inventory()).toEqual(deleted);
  const outcome = deleted.outcomes.find(row => row.requestKey === key);
  const header = deleted.commits.find(row => row.commitSeq === outcome?.commitSeq);
  const clock = deleted.clock[0];
  if (outcome === undefined || header === undefined || clock === undefined) throw new Error("Expected retained outcome/header");
  const retainedFacts = deleted.facts.filter(row => row.commitSeq === header.commitSeq);
  await persistence.drizzle.delete(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.commitSeq, header.commitSeq));
  await persistence.drizzle.delete(fxSystemCommits).where(eq(fxSystemCommits.commitSeq, header.commitSeq));
  expect(await runEffectFailure(host.run(key, create, { title: "original" }))).toMatchObject({ reason: "storedCorruption" });
  await persistence.drizzle.update(fxSystemScopeClocks).set({ oldestAvailableCommitSeq: CommitSeqSchema.make(header.commitSeq + 1n) })
    .where(eq(fxSystemScopeClocks.scopeId, clock.scopeId));
  expect(await runEffect(host.run(key, create, { title: "original" }))).toEqual(created);
  await persistence.drizzle.insert(fxSystemCommits).values(header);
  if (retainedFacts.length > 0) await persistence.drizzle.insert(fxSystemCommitAppRowChanges).values(retainedFacts);
  await persistence.drizzle.update(fxSystemScopeClocks).set({ oldestAvailableCommitSeq: clock.oldestAvailableCommitSeq })
    .where(eq(fxSystemScopeClocks.scopeId, clock.scopeId));
  await persistence.drizzle.update(fxSystemIdempotency).set({ resultState: "expired", resultValueCodecVersion: null,
    resultSemanticBytes: null, resultBytes: null, resultSha256: null, resultExpiredAt: new Date() }).where(eq(fxSystemIdempotency.requestKey, outcome.requestKey));
  expect(await runEffectFailure(host.run(key, create, { title: "original" }))).toMatchObject({ reason: "resultUnavailable" });
  await persistence.drizzle.update(fxSystemIdempotency).set(outcome).where(eq(fxSystemIdempotency.requestKey, outcome.requestKey));
  expect(callbacks).toBe(1);
  const beforeNested = await inventory();
  await runEffect(host.run(host.newRequestKey(), nestedSuccess, null));
  const afterNested = await inventory();
  expect(afterNested.commits).toHaveLength(beforeNested.commits.length + 1);
  expect(afterNested.outcomes).toHaveLength(beforeNested.outcomes.length + 1);
  expect(afterNested.wakes).toHaveLength(beforeNested.wakes.length + 1);
  expect(afterNested.revisions).toEqual(beforeNested.revisions);
  await runEffect(host.run(host.newRequestKey(), bulk, { count: 32, prefix: "accepted-limit" }));
  const exactLimit = await inventory();
  expect(exactLimit.rows).toHaveLength(afterNested.rows.length + 32);
  expect(await runEffectFailure(host.run(host.newRequestKey(), bulk, { count: 33, prefix: "rejected-limit" })))
    .toMatchObject({ reason: "limitExceeded" });
  expect(await inventory()).toEqual(exactLimit);
  await runEffect(host.run(host.newRequestKey(), paging, null));
  const beforeBounds = await inventory();
  const rollbackProbe = new Error("Rollback bounded-read fixture");
  await expect(persistence.drizzle.transaction(async tx => {
    const locked = await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId));
    const snapshotCommitSeq = locked.lastCommitSeq;
    const bounds = { scopeId: fixture.authority.scopeId, tableId: posts.tableId, snapshotCommitSeq,
      maximumIdentities: 256, maximumDocumentBytes: 65_536, maximumTotalValueBytes: 1_048_576 };
    const seed = async (ordinal: number) => {
      const rowId = decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0"));
      const creationTime = decodeAppCreationTimeV1(ordinal);
      const document = await canonicalizeAppDocumentV1({ tableId: posts.tableId, rowId, creationTime, fields: { title: `bounded-${ordinal}` } });
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, { kind: "live", scopeId: fixture.authority.scopeId,
        tableId: posts.tableId, rowId, writeEpoch: fixture.authority.epoch, commitSeq: snapshotCommitSeq, prevCommitSeq: null,
        schemaVersionId: fixture.relation.binding.schemaVersionId, creationTime, value: document });
    };
    for (let count = beforeBounds.rows.length; count < 256; count += 1) await seed(100_000 + count);
    expect(await runEffect(readBoundedCurrentAppRowsInTransactionEffect(tx, bounds))).toHaveLength(256);
    await seed(200_000);
    expect(await runEffectFailure(readBoundedCurrentAppRowsInTransactionEffect(tx, bounds))).toMatchObject({ issue: { reason: "rowLimitExceeded" } });
    throw rollbackProbe;
  })).rejects.toBe(rollbackProbe);
  await expect(persistence.drizzle.transaction(async tx => {
    const locked = await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId));
    // Each corrupt projection is below the per-row JSON allowance, but together
    // they exceed the aggregate allowance while canonical bytea remains tiny.
    await tx.update(fxAppRowRevisions).set({ valueJson: { title: "x".repeat(200_000) } }).where(and(
      eq(fxAppRowRevisions.tableId, posts.tableId), eq(fxAppRowRevisions.isTombstone, false)));
    expect(await runEffectFailure(readBoundedCurrentAppRowsInTransactionEffect(tx, {
      scopeId: fixture.authority.scopeId, tableId: posts.tableId, snapshotCommitSeq: locked.lastCommitSeq,
      maximumIdentities: 256, maximumDocumentBytes: 65_536, maximumTotalValueBytes: 1_048_576,
    }))).toMatchObject({ issue: { reason: "rowLimitExceeded" } });
    throw rollbackProbe;
  })).rejects.toBe(rollbackProbe);
  expect(await inventory()).toEqual(beforeBounds);
  return { host, input, read, edit, create, netZero, inventory, created, key, fixture, bindings,
    activationRequest: dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "cms-host-activate", candidate.sha256, null), callbackCount: () => callbacks };
}
