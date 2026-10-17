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
const decodeMode = Schema.decodeUnknownResult(Schema.Literals(["default", "active", "deleted", "missing", "empty", "mixed", "sequential", "softThenRestore",
  "duplicate", "unknownField", "badKey", "outsideTable", "rollback", "caughtRefusal", "cancellation", "escape"]));
const decodeOutput = Schema.decodeUnknownResult(Schema.Struct({ rows: Schema.Array(Schema.JsonObject), transactionTime: Schema.String }));

/** Neutral real-source proof: active restores can write only under an explicitly
 * selected participant; ordinary atomic/direct restore remains a no-op. */
export const logicalActiveRestoreUpdateScenario = Effect.fn("LogicalActiveRestoreUpdate.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
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
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-active-restore-update" } };
  const participant = defineAtomicCommerceParticipant("neutralActiveRestore");
  const seed = defineCommerceCommand("neutralActiveRestoreSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "owner" }]);
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", ["default", "active", "deleted"].map(entry_key =>
      ({ entry_key, folio_key: "owner", text: "retained", created_at: oldTime, updated_at: oldTime, deleted_at: entry_key === "deleted" ? oldTime : null })))];
  }));
  const list = defineCommerceCommand("neutralActiveRestoreRead", "read", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { order: { column: "entry_key", direction: "asc" } })];
  }));
  let invoked = 0;
  let escaped: (() => Effect.Effect<unknown, CommerceTransactionError>) | undefined;
  const restore = defineCommerceCommand("neutralActiveRestore", "write", (ctx, input) => Effect.gen(function* () {
    invoked++;
    const mode = yield* Effect.fromResult(decodeMode(input).pipe(Result.mapError(cause => commerceError("invalidInput", cause))));
    const table = yield* ctx.table(mode === "outsideTable" ? "unadmitted" : "entry");
    const keys = mode === "empty" ? [] : mode === "mixed" ? [{ entry_key: "default" }, { entry_key: "deleted" }, { entry_key: "missing" }]
      : mode === "duplicate" ? [{ entry_key: "active" }, { entry_key: "active" }]
      : mode === "unknownField" || mode === "caughtRefusal" ? [{ entry_key: "active", text: "forged" }]
      : mode === "badKey" ? [{ entry_key: 42 }]
      : [{ entry_key: mode === "default" || mode === "deleted" || mode === "missing" ? mode : "active" }];
    if (mode === "softThenRestore") yield* table.lifecycle(ctx.manager, "softDelete", keys);
    const write = table.lifecycle(ctx.manager, "restore", keys);
    if (mode === "caughtRefusal") { yield* Effect.result(write); return null; }
    const rows = [...yield* write];
    if (mode === "sequential") rows.push(...yield* table.lifecycle(ctx.manager, "restore", keys));
    if (mode === "escape") escaped = () => table.lifecycle(ctx.manager, "restore", keys);
    if (mode === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
    if (mode === "cancellation") return yield* Effect.interrupt;
    if (ctx.transactionTime === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    return { rows, transactionTime: yield* ctx.transactionTime };
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [list] }), host => host.initialize([]), host => host.close);
  const receipts: string[] = [];
  const validate = (activeUpdates: boolean): LogicalCommerceCallValidation => (call, activity) => Effect.sync(() => {
    expect(call.events).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
    receipts.push(call.commandName);
    if (call.commandName !== "neutralActiveRestore") { expect(activity.lifecycle).toEqual([]); return; }
    const output = Result.getOrThrow(decodeOutput(call.result));
    const count = call.input === "empty" || call.input === "missing" ? 0 : call.input === "mixed" || call.input === "sequential" || call.input === "softThenRestore" ? 2 : 1;
    expect(activity.lifecycle).toHaveLength(count);
    expect(activity.mutations.map(mutation => mutation.operation)).toEqual(activeUpdates ? Array.from({ length: count }, () => "patch") : []);
    expect(activity.lifecycle.map(observation => observation.operation)).toEqual(call.input === "softThenRestore" ? ["softDelete", "restore"] : Array.from({ length: count }, () => "restore"));
    for (const observation of activity.lifecycle) {
      expect(observation.table).toBe("entry");
      if (activeUpdates) { expect(observation.attemptOrdinal).not.toBeNull(); expect(observation.rowAtOperation).toBeNull(); }
      else { expect(observation.attemptOrdinal).toBeNull(); expect(observation.rowAtOperation?.updated_at).toBe(oldTime); }
    }
    for (const mutation of activity.mutations) {
      expect(mutation.table).toBe("entry"); expect(mutation.after?.updated_at).toBe(output.transactionTime);
      expect(mutation.before?._id).toBe(mutation.after?._id); expect(mutation.before?._creationTime).toBe(mutation.after?._creationTime);
      expect(mutation.after?.created_at).toBe(oldTime); expect(mutation.after?.folio_key).toBe("owner"); expect(mutation.after?.text).toBe("retained");
    }
  });
  const seedRoot = defineAtomicCommerceCommand("neutralActiveRestoreSeedRoot", ctx => ctx.call(participant, seed, null));
  const readRoot = defineAtomicCommerceCommand("neutralActiveRestoreReadRoot", ctx => ctx.call(participant, list, null));
  const root = defineAtomicCommerceCommand("neutralActiveRestoreRoot", (ctx, input) => ctx.call(participant, restore, input));
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement, cause => new Error("Neutral active-restore inventory", { cause }));
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
  const commands = [seed, list, restore], roots = [seedRoot, readRoot, root];
  const defaultMember = { participant, logicalStorage, commands, validateLogicalCall: validate(false) };
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots, participants: [defaultMember] }), host => Effect.gen(function* () {
    yield* host.run(host.newRequestKey(), seedRoot, null);
    const before = yield* inventory;
    const output = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "default")));
    expect(output.rows[0]?.updated_at).toBe(oldTime); expect(output.rows[0]?.deleted_at).toBeNull();
    const after = yield* inventory;
    for (const name of ["rows", "revisions", "indexes", "indexRevisions", "unique", "facts"] as const) expect(after[name]).toEqual(before[name]);
  }), host => host.close);
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [restore] }), host => Effect.gen(function* () {
    const before = yield* inventory;
    const output = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), restore, "default")));
    expect(output.rows[0]?.updated_at).toBe(oldTime);
    const after = yield* inventory;
    for (const name of ["rows", "revisions", "indexes", "indexRevisions", "unique", "facts"] as const) expect(after[name]).toEqual(before[name]);
  }), host => host.close);
  const selected: typeof defaultMember & { allowActiveRestoreUpdate?: true } = {
    participant, logicalStorage, commands, allowActiveRestoreUpdate: true, validateLogicalCall: validate(true),
  };
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots, participants: [selected] }), host => Effect.gen(function* () {
    // Prepared host owns its captured selection independently of later mutation.
    delete selected.allowActiveRestoreUpdate;
    const before = yield* inventory, request = host.newRequestKey();
    const result = yield* host.run(request, root, "active"), output = Result.getOrThrow(decodeOutput(result));
    expect(output.rows).toEqual([{ entry_key: "active", folio_key: "owner", text: "retained", created_at: oldTime, updated_at: output.transactionTime, deleted_at: null }]);
    expect(output.transactionTime).not.toBe(oldTime);
    const after = yield* inventory;
    expect(after.rows.map(row => row.rowId)).toEqual(before.rows.map(row => row.rowId));
    expect(after.unique).toEqual(before.unique);
    for (const name of ["facts", "revisions", "commits", "outcomes", "wakes"] as const) expect(after[name]).toHaveLength(before[name].length + 1);
    const calls = invoked, validated = receipts.length;
    expect(yield* host.run(request, root, "active")).toEqual(result); expect(invoked).toBe(calls); expect(receipts).toHaveLength(validated); expect(yield* inventory).toEqual(after);
    const deleted = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "deleted")));
    expect(deleted.rows).toEqual([{ entry_key: "deleted", folio_key: "owner", text: "retained", created_at: oldTime, updated_at: deleted.transactionTime, deleted_at: null }]);
    for (const mode of ["missing", "empty"] as const) expect(Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, mode))).rows).toEqual([]);
    const mixed = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "mixed")));
    expect(mixed.rows.map(row => row.entry_key)).toEqual(["default", "deleted"]);
    expect(mixed.rows.map(row => row.updated_at)).toEqual([mixed.transactionTime, mixed.transactionTime]);
    const sequential = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "sequential")));
    expect(sequential.rows).toHaveLength(2); expect(sequential.rows[0]).toEqual(sequential.rows[1]);
    const transitioned = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "softThenRestore")));
    expect(transitioned.rows[0]?.deleted_at).toBeNull(); expect(transitioned.rows[0]?.updated_at).toBe(transitioned.transactionTime);
    for (const mode of ["duplicate", "unknownField", "badKey", "outsideTable", "rollback", "caughtRefusal", "cancellation"] as const) {
      const snapshot = yield* inventory;
      if (mode === "cancellation") expect((yield* Effect.exit(host.run(host.newRequestKey(), root, mode)))._tag).toBe("Failure");
      else expect(yield* Effect.result(host.run(host.newRequestKey(), root, mode)))
        .toMatchObject({ _tag: "Failure", failure: { reason: mode === "caughtRefusal" ? "rollbackOnly" : mode === "outsideTable" ? "invalidAuthority" : "invalidInput" } });
      expect(yield* inventory).toEqual(snapshot);
    }
    yield* host.run(host.newRequestKey(), root, "escape");
    if (escaped === undefined) return yield* Effect.die(new Error("Missing retained restore capability"));
    const escapedSnapshot = yield* inventory;
    expect(yield* Effect.result(escaped())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } }); expect(yield* inventory).toEqual(escapedSnapshot);
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots, participants: [defaultMember] }), ordinary => Effect.gen(function* () {
      const snapshot = yield* inventory, callbacks = invoked;
      expect(yield* Effect.result(ordinary.run(request, root, "active"))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(invoked).toBe(callbacks); expect(yield* inventory).toEqual(snapshot);
    }), ordinary => ordinary.close);
    expect(yield* Effect.result(makeAtomicCommerceHost({ ...hostInput, commands: roots,
      participants: [{ participant, logicalStorage, commands, allowActiveRestoreUpdate: true }],
    }))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }), host => host.close);
});
