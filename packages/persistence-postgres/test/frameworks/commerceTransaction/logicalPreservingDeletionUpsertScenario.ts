import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../../../src/database/schema";

const oldTime = "2020-01-02T03:04:05.000Z";
const decodeMode = Schema.decodeUnknownResult(Schema.Literals(["deleted", "active", "insert", "ordinary", "sequential", "empty", "explicitDeletion", "escape",
  "missingPartial", "duplicateBatch", "unknownField", "internalId", "scope", "badKey", "foreignKey", "outsideTable", "rollback", "caughtRefusal", "cancellation"]));
const decodeOutput = Schema.decodeUnknownResult(Schema.Struct({ rows: Schema.Array(Schema.JsonObject), transactionTime: Schema.String }));

/** Genuine logical source, committed physical tombstones and the existing atomic
 * owner. Assertions run outside guarded commands so failures retain diagnostics. */
export const logicalPreservingDeletionUpsertScenario = Effect.fn("LogicalPreservingDeletionUpsert.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
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
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-preserving-deletion-upsert" } };
  const participant = defineAtomicCommerceParticipant("neutralPreservingUpsert");
  const seed = defineCommerceCommand("neutralPreservingUpsertSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "owner" }]);
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", ["deleted", "active", "ordinary"].map(entry_key =>
      ({ entry_key, folio_key: "owner", text: "retained", created_at: oldTime, updated_at: oldTime, deleted_at: entry_key === "active" ? null : oldTime })))];
  }));
  const list = defineCommerceCommand("neutralPreservingUpsertRead", "read", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { order: { column: "entry_key", direction: "asc" } })];
  }));
  let invoked = 0;
  let escaped: (() => Effect.Effect<unknown, CommerceTransactionError>) | undefined;
  const upsert = defineCommerceCommand("neutralPreservingUpsert", "write", (ctx, input) => Effect.gen(function* () {
    invoked++;
    const mode = yield* Effect.fromResult(decodeMode(input).pipe(Result.mapError(cause => commerceError("invalidInput", cause))));
    const table = yield* ctx.table(mode === "outsideTable" ? "unadmitted" : "entry");
    const row = mode === "insert" ? { entry_key: "inserted", folio_key: "owner", text: "fresh" }
      : mode === "missingPartial" ? { entry_key: "missing" }
      : mode === "unknownField" || mode === "caughtRefusal" ? { entry_key: "deleted", unadmitted: "forged" }
      : mode === "internalId" ? { entry_key: "deleted", _id: "forged" }
      : mode === "scope" ? { entry_key: "deleted", scope_uuid: "00000000-0000-4000-8000-000000000001" }
      : mode === "badKey" ? { entry_key: 42 }
      : mode === "foreignKey" ? { entry_key: "deleted", folio_key: "missing-owner" }
      : mode === "active" ? { entry_key: "active", updated_at: oldTime }
      : mode === "explicitDeletion" ? { entry_key: "active", deleted_at: oldTime }
      : mode === "ordinary" ? { entry_key: "ordinary" } : { entry_key: "deleted" };
    const writeMode = mode === "ordinary" ? "upsert" : "upsertPreservingDeletion";
    const write = table.write(ctx.manager, writeMode, mode === "empty" ? [] : mode === "duplicateBatch" ? [row, row] : [row]);
    if (mode === "caughtRefusal") { yield* Effect.result(write); return null; }
    const rows = [...yield* write];
    if (mode === "sequential") rows.push(...yield* table.write(ctx.manager, writeMode, [{ entry_key: "deleted", text: "second" }]));
    if (mode === "escape") escaped = () => table.write(ctx.manager, writeMode, [{ entry_key: "deleted", text: "escaped" }]);
    if (mode === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
    if (mode === "cancellation") return yield* Effect.interrupt;
    if (ctx.transactionTime === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    return { rows, transactionTime: yield* ctx.transactionTime };
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [list] }), host => host.initialize([]), host => host.close);
  const receipts: string[] = [];
  const validate: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
    expect(call.events).toEqual([]); expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
    receipts.push(call.commandName);
    if (call.commandName === "neutralPreservingUpsert" && call.input !== "empty") {
      const output = Result.getOrThrow(decodeOutput(call.result));
      expect(activity.mutations.map(mutation => mutation.operation)).toEqual(call.input === "insert" ? ["insert"] : call.input === "sequential" ? ["patch", "patch"] : ["patch"]);
      for (const mutation of activity.mutations) {
        expect(mutation.table).toBe("entry"); expect(mutation.after?.updated_at).toBe(call.input === "ordinary" ? oldTime : output.transactionTime);
      }
    }
  });
  const seedRoot = defineAtomicCommerceCommand("neutralPreservingUpsertSeedRoot", ctx => ctx.call(participant, seed, null));
  const readRoot = defineAtomicCommerceCommand("neutralPreservingUpsertReadRoot", ctx => ctx.call(participant, list, null));
  const root = defineAtomicCommerceCommand("neutralPreservingUpsertRoot", (ctx, input) => ctx.call(participant, upsert, input));
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement, cause => new Error("Neutral preserving-deletion upsert inventory", { cause }));
  const inventory = Effect.gen(function* () {
    return {
      rows: yield* query(fixture.target.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.rowId)),
      revisions: yield* query(fixture.target.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.commitSeq, fxAppRowRevisions.rowId)),
      indexes: yield* query(fixture.target.drizzle.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId)),
      indexRevisions: yield* query(fixture.target.drizzle.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.commitSeq, fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId)),
      unique: yield* query(fixture.target.drizzle.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.canonicalKeySha256)),
      commits: yield* query(fixture.target.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq)),
      facts: yield* query(fixture.target.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal)),
      outcomes: yield* query(fixture.target.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey)),
      wakes: yield* query(fixture.target.drizzle.select().from(fxSystemCommitWakes).orderBy(fxSystemCommitWakes.commitSeq)),
      clocks: yield* query(fixture.target.drizzle.select().from(fxSystemScopeClocks)),
    };
  });
  const commands = [seed, list, upsert], roots = [seedRoot, readRoot, root];
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots,
    participants: [{ participant, logicalStorage, commands, allowPreservingDeletionUpsert: true, validateLogicalCall: validate }],
  }), host => Effect.gen(function* () {
    yield* host.run(host.newRequestKey(), seedRoot, null);
    const before = yield* inventory, request = host.newRequestKey();
    const result = yield* host.run(request, root, "deleted"), output = Result.getOrThrow(decodeOutput(result));
    expect(output.rows).toEqual([{ entry_key: "deleted", folio_key: "owner", text: "retained", created_at: oldTime, updated_at: output.transactionTime, deleted_at: oldTime }]);
    expect(output.transactionTime).not.toBe(oldTime);
    const after = yield* inventory;
    expect(after.rows.map(row => row.rowId)).toEqual(before.rows.map(row => row.rowId));
    for (const name of ["facts", "revisions", "commits", "outcomes", "wakes"] as const) expect(after[name]).toHaveLength(before[name].length + 1);
    const called = invoked, validated = receipts.length;
    expect(yield* host.run(request, root, "deleted")).toEqual(result); expect(invoked).toBe(called); expect(receipts).toHaveLength(validated); expect(yield* inventory).toEqual(after);
    const ordinary = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "ordinary")));
    expect(ordinary.rows).toEqual([{ entry_key: "ordinary", folio_key: "owner", text: "retained", created_at: oldTime, updated_at: oldTime, deleted_at: null }]);
    const active = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "active")));
    expect(active.rows).toEqual([{ entry_key: "active", folio_key: "owner", text: "retained", created_at: oldTime, updated_at: active.transactionTime, deleted_at: null }]); expect(active.transactionTime).not.toBe(oldTime);
    const inserted = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "insert")));
    expect(inserted.rows).toEqual([{ entry_key: "inserted", folio_key: "owner", text: "fresh", created_at: inserted.transactionTime, updated_at: inserted.transactionTime, deleted_at: null }]);
    const sequential = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "sequential")));
    expect(sequential.rows).toEqual(["retained", "second"].map(text => ({ entry_key: "deleted", folio_key: "owner", text, created_at: oldTime, updated_at: sequential.transactionTime, deleted_at: oldTime })));
    expect(Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "empty"))).rows).toEqual([]);
    const explicit = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "explicitDeletion")));
    expect(explicit.rows).toEqual([{ entry_key: "active", folio_key: "owner", text: "retained", created_at: oldTime, updated_at: explicit.transactionTime, deleted_at: oldTime }]);
    expect(yield* host.run(host.newRequestKey(), readRoot, null)).toEqual(expect.arrayContaining([sequential.rows[1], explicit.rows[0], inserted.rows[0], ordinary.rows[0]]));
    for (const mode of ["missingPartial", "duplicateBatch", "unknownField", "internalId", "scope", "badKey", "foreignKey", "outsideTable", "rollback", "caughtRefusal", "cancellation"] as const) {
      const snapshot = yield* inventory;
      if (mode === "cancellation") expect((yield* Effect.exit(host.run(host.newRequestKey(), root, mode)))._tag).toBe("Failure");
      else expect(yield* Effect.result(host.run(host.newRequestKey(), root, mode)))
        .toMatchObject({ _tag: "Failure", failure: { reason: mode === "caughtRefusal" ? "rollbackOnly" : mode === "outsideTable" ? "invalidAuthority" : "invalidInput" } });
      expect(yield* inventory).toEqual(snapshot);
    }
    yield* host.run(host.newRequestKey(), root, "escape");
    if (escaped === undefined) return yield* Effect.die(new Error("Missing retained capability witness"));
    const escapedSnapshot = yield* inventory;
    expect(yield* Effect.result(escaped())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } }); expect(yield* inventory).toEqual(escapedSnapshot);
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots,
      participants: [{ participant, logicalStorage, commands, validateLogicalCall: validate }],
    }), denied => Effect.gen(function* () {
      const snapshot = yield* inventory, calls = invoked;
      expect(yield* Effect.result(denied.run(request, root, "deleted"))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } }); expect(invoked).toBe(calls);
      expect(yield* Effect.result(denied.run(denied.newRequestKey(), root, "deleted"))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } }); expect(yield* inventory).toEqual(snapshot);
    }), denied => denied.close);
    expect(yield* Effect.result(makeAtomicCommerceHost({ ...hostInput, commands: roots,
      participants: [{ participant, logicalStorage, commands, allowPreservingDeletionUpsert: true }],
    }))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [upsert] }), direct => Effect.gen(function* () {
      const snapshot = yield* inventory;
      expect(yield* Effect.result(direct.run(direct.newRequestKey(), upsert, "deleted"))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } }); expect(yield* inventory).toEqual(snapshot);
    }), direct => direct.close);
  }), host => host.close);
});
