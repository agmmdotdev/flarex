import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency,
  fxSystemCommitAppRowChanges, fxSystemScopeClocks } from "../../../src/database/schema";

const oldTime = "2020-01-02T03:04:05.000Z";
const decodeMode = Schema.decodeUnknownResult(Schema.Literals(["recorded", "pending", "created", "updated", "deleted", "business", "missing", "partial", "duplicate", "caught", "rollback", "generationB", "generationA"]));

/** The private inverse command is trusted business authorization. Storage must
 * independently prove every complete row. Committed tombstones stay immutable;
 * native identities and clocks survive in a fresh internal insertion. */
export const logicalRecordedReplayScenario = Effect.fn("LogicalRecordedReplay.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, source: unknown, session: RelationalSession,
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const logicalStorage: LogicalCommerceSelectionInput = { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-recorded-replay" } };
  const participant = defineAtomicCommerceParticipant("neutralRecordedReplay");
  const read = defineCommerceCommand("recordedRead", "read", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { order: { column: "entry_key", direction: "asc" } })];
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [read] }),
    host => host.initialize([]), host => host.close);
  const seed = defineCommerceCommand("recordedSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "owner" }]);
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", ["active", "deleted", "removed", "sibling"].map(entry_key =>
      ({ entry_key, folio_key: "owner", text: "retained", created_at: oldTime, updated_at: oldTime, deleted_at: entry_key === "deleted" ? oldTime : null })))];
  }));
  const change = defineCommerceCommand("recordedChange", "write", ctx => Effect.gen(function* () {
    const table = yield* ctx.table("entry");
    yield* table.write(ctx.manager, "update", [{ entry_key: "active", text: "changed" }, { entry_key: "deleted", text: "changed" }]);
    yield* table.delete(ctx.manager, [{ entry_key: "removed" }]);
    return null;
  }));
  let retained: JsonObject[] = [], generationB: JsonObject | undefined, invoked = 0;
  const generationChange = defineCommerceCommand("recordedGenerationChange", "write", ctx => Effect.gen(function* () {
    generationB = (yield* (yield* ctx.table("entry")).write(ctx.manager, "update", [{ entry_key: "active", text: "generation B" }]))[0];
    return null;
  }));
  const generationDelete = defineCommerceCommand("recordedGenerationDelete", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("entry")).delete(ctx.manager, [{ entry_key: "active" }]); return null;
  }));
  const inverse = defineCommerceCommand("recordedInverse", "write", (ctx, args) => Effect.gen(function* () {
    invoked++;
    const mode = yield* Effect.fromResult(decodeMode(args).pipe(Result.mapError(cause => commerceError("invalidInput", cause))));
    const table = yield* ctx.table("entry");
    if (table.replay === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    const previous = retained.find(row => row.entry_key === "active");
    if (previous === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    if (mode === "generationB") {
      if (generationB === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      return [...yield* table.replay(ctx.manager, [generationB])];
    }
    if (mode === "generationA") return [...yield* table.replay(ctx.manager, [previous])];
    if (mode === "pending") {
      const pending = (yield* table.write(ctx.manager, "update", [{ entry_key: "active", text: "pending" }]))[0];
      if (pending === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      yield* table.delete(ctx.manager, [{ entry_key: "active" }]);
      return [...yield* table.replay(ctx.manager, [pending])];
    }
    const changed = mode === "created" ? { ...previous, created_at: "2020-01-03T03:04:05.000Z" }
      : mode === "updated" || mode === "caught" ? { ...previous, updated_at: "2020-01-03T03:04:05.000Z" }
      : mode === "deleted" ? { ...previous, deleted_at: oldTime }
      : mode === "business" ? { ...previous, text: "never-recorded" }
      : mode === "missing" ? { ...previous, entry_key: "never-recorded" }
      : previous;
    const replay = table.replay(ctx.manager, mode === "recorded" || mode === "rollback" ? retained.filter(row => row.entry_key !== "sibling")
      : mode === "partial" ? [{ entry_key: "active" }] : mode === "duplicate" ? [changed, changed] : [changed]);
    if (mode === "caught") { yield* Effect.result(replay); return null; }
    const result = yield* replay;
    if (mode === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
    return [...result];
  }));
  const root = defineAtomicCommerceCommand("recordedRoot", (ctx, args) => Effect.gen(function* () {
    if (args === "seed") return yield* ctx.call(participant, seed, null);
    if (args === "change") return yield* ctx.call(participant, change, null);
    if (args === "read") return yield* ctx.call(participant, read, null);
    if (args === "generationChange") return yield* ctx.call(participant, generationChange, null);
    if (args === "generationDelete") return yield* ctx.call(participant, generationDelete, null);
    return yield* ctx.call(participant, inverse, args);
  }));
  const commands = [read, seed, change, inverse, generationChange, generationDelete];
  const byName = new Map([["recordedRead", read], ["recordedSeed", seed], ["recordedChange", change], ["recordedInverse", inverse],
    ["recordedGenerationChange", generationChange], ["recordedGenerationDelete", generationDelete]]);
  const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.sync(() => {
    expect(command).toBe(byName.get(call.commandName));
    expect(call.events).toEqual([]);
    expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
    expect(activity.mutations.every(row => row.table === "entry" || call.commandName === "recordedSeed" && row.table === "folio")).toBe(true);
  });
  const participantInput = { participant, logicalStorage, commands, validateLogicalCall };
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement,
    cause => new Error("Recorded replay inventory", { cause }));
  const inventory = Effect.gen(function* () {
    return { rows: yield* query(fixture.target.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.rowId)),
      revisions: yield* query(fixture.target.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq)),
      commits: yield* query(fixture.target.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq)),
      facts: yield* query(fixture.target.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal)),
      outcomes: yield* query(fixture.target.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey)),
      clocks: yield* query(fixture.target.drizzle.select().from(fxSystemScopeClocks)) };
  });
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [root],
    participants: [{ ...participantInput, allowRecordedRowReplay: true }] }), host => Effect.gen(function* () {
    const seeded = yield* host.run(host.newRequestKey(), root, "seed").pipe(Effect.mapError(cause => new Error("Recorded replay seed", { cause })));
    if (!Array.isArray(seeded) || !seeded.every(isJsonObject)) return yield* Effect.die(new Error("Missing recorded seed"));
    retained = seeded;
    const original = yield* inventory;
    yield* host.run(host.newRequestKey(), root, "change").pipe(Effect.mapError(cause => new Error("Recorded replay forward", { cause })));
    expect(yield* host.run(host.newRequestKey(), root, "read")).not.toEqual(retained);
    const request = host.newRequestKey();
    expect(yield* host.run(request, root, "recorded").pipe(Effect.mapError(cause => new Error("Recorded replay inverse", { cause })))).toEqual(retained.filter(row => row.entry_key !== "sibling"));
    expect(yield* host.run(host.newRequestKey(), root, "read")).toEqual(retained.toSorted((a, b) => String(a.entry_key).localeCompare(String(b.entry_key))));
    const restored = yield* inventory;
    expect(restored.rows.length).toBe(original.rows.length + 1);
    expect(restored.rows.map(row => row.rowId)).toEqual(expect.arrayContaining(original.rows.map(row => row.rowId)));
    const deletedRevisions = restored.revisions.filter(row => row.isTombstone);
    expect(deletedRevisions).toHaveLength(1);
    const tombstone = deletedRevisions[0];
    expect(restored.rows.find(row => JSON.stringify(row.rowId) === JSON.stringify(tombstone?.rowId))?.commitSeq).toBe(tombstone?.commitSeq);
    const fresh = restored.rows.find(row => !original.rows.some(prior => JSON.stringify(prior.rowId) === JSON.stringify(row.rowId)));
    const freshRevision = restored.revisions.find(row => JSON.stringify(row.rowId) === JSON.stringify(fresh?.rowId));
    expect(freshRevision?.isTombstone).toBe(false);
    expect(freshRevision?.insertionCommitSeq).toBe(fresh?.commitSeq);
    expect(freshRevision?.creationTime).toBeGreaterThan(tombstone?.creationTime ?? Number.MAX_SAFE_INTEGER);
    const count = invoked;
    yield* host.run(request, root, "recorded");
    expect(invoked).toBe(count); expect(yield* inventory).toEqual(restored);
    for (const mode of ["created", "updated", "deleted", "business", "missing", "partial", "duplicate", "caught", "rollback"]) {
      const before = yield* inventory;
      expect(yield* Effect.result(host.run(host.newRequestKey(), root, mode))).toMatchObject({ _tag: "Failure" });
      expect(yield* inventory).toEqual(before);
    }
    const pending = yield* host.run(host.newRequestKey(), root, "pending");
    expect(pending).toMatchObject([{ entry_key: "active", text: "pending" }]);
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [root], participants: [participantInput] }), denied => Effect.gen(function* () {
      const before = yield* inventory, count = invoked;
      expect(yield* Effect.result(denied.run(request, root, "recorded"))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(invoked).toBe(count);
      expect(yield* Effect.result(denied.run(denied.newRequestKey(), root, "recorded"))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(yield* inventory).toEqual(before);
    }), denied => denied.close);
    expect(yield* Effect.result(makeAtomicCommerceHost({ ...hostInput, commands: [root],
      participants: [{ participant, logicalStorage, commands, allowRecordedRowReplay: true }] })))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    // An earlier genuine preimage may remain only on a retired physical row.
    // Its value proof must survive a later preimage's fresh-identity restore.
    yield* host.run(host.newRequestKey(), root, "generationChange");
    yield* host.run(host.newRequestKey(), root, "generationDelete");
    const retired = yield* inventory;
    expect(yield* host.run(host.newRequestKey(), root, "generationB")).toEqual([generationB]);
    const newGeneration = yield* inventory;
    const destination = newGeneration.rows.find(row => !retired.rows.some(prior => JSON.stringify(prior.rowId) === JSON.stringify(row.rowId)));
    expect(destination).toBeDefined();
    const earlierKey = host.newRequestKey();
    expect(yield* host.run(earlierKey, root, "generationA")).toEqual(retained.filter(row => row.entry_key === "active"));
    const earlier = yield* inventory;
    expect(earlier.rows.map(row => row.rowId)).toEqual(newGeneration.rows.map(row => row.rowId));
    const destinationAfter = earlier.rows.find(row => JSON.stringify(row.rowId) === JSON.stringify(destination?.rowId));
    expect(destinationAfter?.commitSeq).not.toBe(destination?.commitSeq);
    for (const tombstone of retired.revisions.filter(row => row.isTombstone))
      expect(earlier.rows.find(row => JSON.stringify(row.rowId) === JSON.stringify(tombstone.rowId))?.commitSeq).toBe(tombstone.commitSeq);
    yield* host.run(earlierKey, root, "generationA"); expect(yield* inventory).toEqual(earlier);
    // Repeating a physical replacement and its complete native inverse must
    // not confuse identical retained values with multiple write destinations.
    for (let cycle = 0; cycle < 2; cycle++) {
      yield* host.run(host.newRequestKey(), root, "generationDelete");
      const retiredAgain = yield* inventory;
      for (const mode of ["created", "caught", "rollback"]) {
        expect(yield* Effect.result(host.run(host.newRequestKey(), root, mode))).toMatchObject({ _tag: "Failure" });
        expect(yield* inventory).toEqual(retiredAgain);
      }
      const replayKey = host.newRequestKey();
      expect(yield* host.run(replayKey, root, "generationA")).toEqual(retained.filter(row => row.entry_key === "active"));
      const restoredAgain = yield* inventory;
      const inserted = restoredAgain.rows.filter(row => !retiredAgain.rows.some(prior => JSON.stringify(prior.rowId) === JSON.stringify(row.rowId)));
      expect(inserted).toHaveLength(1);
      const freshRow = inserted[0];
      const freshRevision = restoredAgain.revisions.find(row => JSON.stringify(row.rowId) === JSON.stringify(freshRow?.rowId));
      expect(freshRevision?.isTombstone).toBe(false);
      expect(freshRevision?.insertionCommitSeq).toBe(freshRow?.commitSeq);
      for (const tombstone of retiredAgain.revisions.filter(row => row.isTombstone))
        expect(restoredAgain.rows.find(row => JSON.stringify(row.rowId) === JSON.stringify(tombstone.rowId))?.commitSeq).toBe(tombstone.commitSeq);
      for (const revision of retiredAgain.revisions)
        expect(restoredAgain.revisions.find(row => JSON.stringify(row.rowId) === JSON.stringify(revision.rowId) && row.commitSeq === revision.commitSeq)).toEqual(revision);
      yield* host.run(replayKey, root, "generationA");
      expect(yield* inventory).toEqual(restoredAgain);
    }
  }), host => host.close);
});
