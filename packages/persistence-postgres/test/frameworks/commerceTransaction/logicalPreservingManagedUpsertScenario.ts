import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallObservation, LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import type { LogicalCommerceActivity } from "../../../src/frameworks/commerceTransaction/logicalParticipant";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../../../src/database/schema";

const oldTime = "2020-01-02T03:04:05.000Z";
const forgedTime = "2035-01-02T03:04:05.000Z";
const decodeMode = Schema.decodeUnknownResult(Schema.Literals(["historical", "active", "equal", "explicitMatch", "insert", "legacy",
  "createdForgery", "updatedForgery", "deletionForgery", "freshManaged", "caughtRefusal", "rollback", "cancellation"]));
const decodeOutput = Schema.decodeUnknownResult(Schema.Struct({ rows: Schema.Array(Schema.JsonObject), transactionTime: Schema.String }));

/** The same authenticated logical source exercises both explicit merge modes;
 * observations are asserted after the guarded callback has returned. */
export const logicalPreservingManagedUpsertScenario = Effect.fn("LogicalPreservingManagedUpsert.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, source: unknown, session: RelationalSession,
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const logicalStorage: LogicalCommerceSelectionInput = { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.managed-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-preserving-managed-upsert" } };
  const participant = defineAtomicCommerceParticipant("neutralManagedUpsert");
  const seed = defineCommerceCommand("neutralManagedUpsertSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "owner" }]);
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", ["historical", "active", "legacy"].map(entry_key =>
      ({ entry_key, folio_key: "owner", text: "before", created_at: oldTime, updated_at: oldTime, deleted_at: entry_key === "active" ? null : oldTime })))];
  }));
  const read = defineCommerceCommand("neutralManagedUpsertRead", "read", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { order: { column: "entry_key", direction: "asc" } })];
  }));
  let invoked = 0;
  const upsert = defineCommerceCommand("neutralManagedUpsert", "write", (ctx, input) => Effect.gen(function* () {
    invoked++;
    const mode = yield* Effect.fromResult(decodeMode(input).pipe(Result.mapError(cause => commerceError("invalidInput", cause))));
    const table = yield* ctx.table("entry");
    const row = mode === "insert" ? { entry_key: "inserted", folio_key: "owner", text: "fresh" }
      : mode === "active" ? { entry_key: "active", text: "changed" }
      : mode === "legacy" ? { entry_key: "legacy", text: "changed" }
      : mode === "equal" ? { entry_key: "historical" }
      : mode === "explicitMatch" ? { entry_key: "historical", created_at: oldTime, updated_at: oldTime, deleted_at: oldTime }
      : mode === "createdForgery" ? { entry_key: "historical", created_at: forgedTime }
      : mode === "updatedForgery" || mode === "caughtRefusal" ? { entry_key: "historical", updated_at: forgedTime }
      : mode === "deletionForgery" ? { entry_key: "historical", deleted_at: null }
      : mode === "freshManaged" ? { entry_key: "fresh-forged", folio_key: "owner", text: "fresh", created_at: oldTime }
      : { entry_key: "historical", text: "changed" };
    if (mode === "caughtRefusal") {
      yield* table.write(ctx.manager, "upsertPreservingDeletion", [{ entry_key: "active", text: "must roll back" }]);
      yield* Effect.result(table.write(ctx.manager, "upsertPreservingDeletion", [row]));
      return null;
    }
    const rows = [...yield* table.write(ctx.manager, "upsertPreservingDeletion", [row])];
    if (mode === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
    if (mode === "cancellation") return yield* Effect.interrupt;
    if (ctx.transactionTime === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    return { rows, transactionTime: yield* ctx.transactionTime };
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [read] }), host => host.initialize([]), host => host.close);
  const receipts: { call: LogicalCommerceCallObservation; activity: LogicalCommerceActivity }[] = [];
  const validate: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => { receipts.push({ call, activity }); });
  const seedRoot = defineAtomicCommerceCommand("neutralManagedUpsertSeedRoot", ctx => ctx.call(participant, seed, null));
  const readRoot = defineAtomicCommerceCommand("neutralManagedUpsertReadRoot", ctx => ctx.call(participant, read, null));
  const root = defineAtomicCommerceCommand("neutralManagedUpsertRoot", (ctx, input) => ctx.call(participant, upsert, input));
  const commands = [seed, read, upsert], roots = [seedRoot, readRoot, root];
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement, cause => new Error("Neutral managed-upsert inventory", { cause }));
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
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots,
    participants: [{ participant, logicalStorage, commands, allowPreservingDeletionUpsert: "preserveTimestamps", validateLogicalCall: validate }],
  }), host => Effect.gen(function* () {
    yield* host.run(host.newRequestKey(), seedRoot, null);
    const before = yield* inventory, request = host.newRequestKey();
    const result = yield* host.run(request, root, "historical"), output = Result.getOrThrow(decodeOutput(result));
    const historical = { entry_key: "historical", folio_key: "owner", text: "changed", created_at: oldTime, updated_at: oldTime, deleted_at: oldTime };
    expect(output.rows).toEqual([historical]); expect(output.transactionTime).not.toBe(oldTime);
    const after = yield* inventory;
    expect(after.rows.map(row => row.rowId)).toEqual(before.rows.map(row => row.rowId));
    for (const name of ["facts", "revisions", "commits", "outcomes", "wakes"] as const) expect(after[name]).toHaveLength(before[name].length + 1);
    const called = invoked, validated = receipts.length;
    expect(yield* host.run(request, root, "historical")).toEqual(result);
    expect(invoked).toBe(called); expect(receipts).toHaveLength(validated); expect(yield* inventory).toEqual(after);
    for (const mode of ["equal", "explicitMatch"] as const) {
      expect(Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, mode))).rows).toEqual([historical]);
      const receipt = receipts.at(-1);
      if (receipt === undefined) return yield* Effect.die(new Error("Missing successful merge receipt"));
      expect(receipt.call.events).toEqual([]);
      expect(receipt.activity.lifecycle).toEqual([]);
      expect(receipt.activity.mutations).toHaveLength(1);
      expect(receipt.activity.mutations[0]).toMatchObject({ table: "entry", operation: "patch", before: historical, after: historical });
    }
    const active = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "active")));
    expect(active.rows).toEqual([{ entry_key: "active", folio_key: "owner", text: "changed", created_at: oldTime, updated_at: oldTime, deleted_at: null }]);
    const inserted = Result.getOrThrow(decodeOutput(yield* host.run(host.newRequestKey(), root, "insert")));
    expect(inserted.rows).toEqual([{ entry_key: "inserted", folio_key: "owner", text: "fresh", created_at: inserted.transactionTime, updated_at: inserted.transactionTime, deleted_at: null }]);
    const insertion = receipts.at(-1);
    expect(insertion?.activity.mutations.map(mutation => mutation.operation)).toEqual(["insert"]);
    for (const mode of ["createdForgery", "updatedForgery", "deletionForgery", "freshManaged", "caughtRefusal", "rollback", "cancellation"] as const) {
      const snapshot = yield* inventory;
      if (mode === "cancellation") expect((yield* Effect.exit(host.run(host.newRequestKey(), root, mode)))._tag).toBe("Failure");
      else expect(yield* Effect.result(host.run(host.newRequestKey(), root, mode)))
        .toMatchObject({ _tag: "Failure", failure: { reason: mode === "caughtRefusal" ? "rollbackOnly" : "invalidInput" } });
      expect(yield* inventory).toEqual(snapshot);
    }
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots,
      participants: [{ participant, logicalStorage, commands, allowPreservingDeletionUpsert: true, validateLogicalCall: validate }],
    }), advancing => Effect.gen(function* () {
      const snapshot = yield* inventory, calls = invoked;
      expect(yield* Effect.result(advancing.run(request, root, "historical"))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(invoked).toBe(calls); expect(yield* inventory).toEqual(snapshot);
      const advancingRequest = advancing.newRequestKey();
      const legacy = Result.getOrThrow(decodeOutput(yield* advancing.run(advancingRequest, root, "legacy")));
      expect(legacy.rows).toEqual([{ entry_key: "legacy", folio_key: "owner", text: "changed", created_at: oldTime, updated_at: legacy.transactionTime, deleted_at: oldTime }]);
      expect(legacy.transactionTime).not.toBe(oldTime);
      const committed = yield* inventory, previousCalls = invoked;
      expect(yield* Effect.result(host.run(advancingRequest, root, "legacy"))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(invoked).toBe(previousCalls); expect(yield* inventory).toEqual(committed);
    }), advancing => advancing.close);
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots,
      participants: [{ participant, logicalStorage, commands, validateLogicalCall: validate }],
    }), denied => Effect.gen(function* () {
      const snapshot = yield* inventory;
      expect(yield* Effect.result(denied.run(denied.newRequestKey(), root, "historical"))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      expect(yield* inventory).toEqual(snapshot);
    }), denied => denied.close);
    expect(yield* Effect.result(makeAtomicCommerceHost({ ...hostInput, commands: roots,
      participants: [{ participant, logicalStorage, commands, allowPreservingDeletionUpsert: "preserveTimestamps" }],
    }))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(yield* host.run(host.newRequestKey(), readRoot, null)).toEqual(expect.arrayContaining([historical, active.rows[0], inserted.rows[0]]));
  }), host => host.close);
});
