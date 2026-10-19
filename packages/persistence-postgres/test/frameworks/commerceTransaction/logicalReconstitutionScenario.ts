import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import type { LogicalReconstitutionPolicy } from "../../../src/storage/documents/logicalDocuments/model";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { requireAtomicCommerceScopeExclusion } from "../../../src/frameworks/atomicCommerce/execution";
import { captureAtomicCommerceParticipants, type LogicalCommerceEventValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../../../src/database/schema";

const oldTime = "2020-01-02T03:04:05.000Z";
const decodeMode = Schema.decodeUnknownResult(Schema.Literals([
  "inverse", "missingDeletion", "neverStored", "created", "updated", "deleted", "owner", "business",
  "occupied", "ambiguous", "caughtRefusal", "duplicate", "nextRoot", "softOnly", "softThenDelete", "rollback", "cancellation",
]));

/** Real committed native rows and the production scope-exclusive atomic owner.
 * This fixture has no replacement row store or publication implementation. */
export const logicalReconstitutionScenario = Effect.fn("LogicalReconstitution.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, source: unknown, session: RelationalSession,
  reconstitution: LogicalReconstitutionPolicy = "advanceUpdatedAt",
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const logicalStorage: LogicalCommerceSelectionInput = { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-reconstitution" } };
  const list = defineCommerceCommand("neutralRead", "read", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { order: { column: "entry_key", direction: "asc" } })];
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [list] }),
    host => host.initialize([]), host => host.close);

  const participant = defineAtomicCommerceParticipant("neutralFolio");
  const seed = defineCommerceCommand("neutralSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "first" }, { folio_key: "other" }]);
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [{ entry_key: "retained", folio_key: "first",
      text: "native", created_at: oldTime, updated_at: oldTime, deleted_at: null }])];
  }));
  const remove = defineCommerceCommand("neutralDelete", "write", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).delete(ctx.manager, [{ entry_key: "retained" }])];
  }));
  let retained: JsonObject | undefined;
  let inverseInvocations = 0;
  const inverse = defineCommerceCommand("neutralReconstitution", "write", (ctx, args) => Effect.gen(function* () {
    inverseInvocations++;
    const mode = yield* Effect.fromResult(decodeMode(args).pipe(Result.mapError(cause => commerceError("invalidInput", cause))));
    const table = yield* ctx.table("entry");
    const reconstitute = table.reconstitute;
    if (reconstitute === undefined || ctx.transactionTime === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    if (retained === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    let previous = mode === "neverStored" ? { ...retained, entry_key: "never-stored" } : retained;
    if (mode === "softOnly" || mode === "softThenDelete") {
      const soft = yield* table.lifecycle(ctx.manager, "softDelete", [{ entry_key: "retained" }]);
      const preimage = soft[0];
      if (preimage === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      previous = preimage;
    }
    if (!["missingDeletion", "neverStored", "nextRoot", "softOnly"].includes(mode)) {
      const deleted = yield* table.delete(ctx.manager, [{ entry_key: "retained" }]);
      expect(deleted).toHaveLength(1);
      expect(yield* table.find(ctx.manager, { order: { column: "entry_key", direction: "asc" } })).toEqual([]);
    }
    if (mode === "occupied" || mode === "ambiguous") {
      yield* table.write(ctx.manager, "insert", [{ entry_key: "retained", folio_key: "other", text: "occupant" }]);
      if (mode === "ambiguous") yield* table.delete(ctx.manager, [{ entry_key: "retained" }]);
    }
    if (mode === "caughtRefusal") {
      expect(yield* Effect.result(reconstitute(ctx.manager, [{ ...previous, text: "forged" }])))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      return null;
    }
    const changed = mode === "created" ? { ...previous, created_at: "2020-01-03T03:04:05.000Z" }
      : mode === "updated" ? { ...previous, updated_at: "2020-01-03T03:04:05.000Z" }
      : mode === "deleted" ? { ...previous, deleted_at: oldTime }
      : mode === "owner" ? { ...previous, folio_key: "other" }
      : mode === "business" ? { ...previous, text: "changed" } : previous;
    const restored = yield* reconstitute(ctx.manager, [changed]);
    if (reconstitution === "advanceUpdatedAt") {
      expect(restored).toEqual([{ ...previous, updated_at: yield* ctx.transactionTime }]);
      expect(restored[0]?.updated_at).not.toBe(oldTime);
    }
    if (mode === "duplicate") yield* reconstitute(ctx.manager, [previous]);
    if (mode === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
    if (mode === "cancellation") return yield* Effect.interrupt;
    return [...restored];
  }));
  const validate: LogicalCommerceEventValidation = (calls, mutations, lifecycle, _observed, setNull, replacements) => Effect.sync(() => {
    expect(calls).toHaveLength(1);
    expect(lifecycle).toEqual([]); expect(setNull).toEqual([]); expect(replacements).toEqual([]);
    expect(calls[0]?.events).toEqual([]);
    const name = calls[0]?.commandName;
    expect(mutations.map(mutation => mutation.operation)).toEqual(name === "neutralSeed" ? ["insert", "insert", "insert"]
      : name === "neutralReconstitution" ? ["delete", "insert"] : name === "neutralDelete" ? ["delete"] : []);
    if (name === "neutralReconstitution") {
      const deleted = mutations[0]; const restored = mutations[1];
      expect(deleted?.before?._id).toEqual(expect.any(String));
      expect(deleted?.before?._id).toEqual(expect.any(String));
      expect(deleted?.before?._id).toBe(restored?.after?._id);
      expect(deleted?.before?._creationTime).toBe(restored?.after?._creationTime);
      expect(deleted?.after).toBeNull(); expect(restored?.before).toBeNull();
    }
  });
  const root = (name: string, command: typeof seed) => defineAtomicCommerceCommand(name, ctx => Effect.gen(function* () {
    yield* requireAtomicCommerceScopeExclusion(ctx);
    return yield* ctx.call(participant, command, null);
  }));
  const seedRoot = root("neutralSeedRoot", seed);
  const readRoot = root("neutralReadRoot", list);
  const deleteRoot = root("neutralDeleteRoot", remove);
  const inverseRoot = defineAtomicCommerceCommand("neutralInverseRoot", (ctx, args) => Effect.gen(function* () {
    yield* requireAtomicCommerceScopeExclusion(ctx);
    return yield* ctx.call(participant, inverse, args);
  }));
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement,
    cause => new Error("Neutral reconstitution inventory", { cause }));
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
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, executionIsolation: "scopeExclusive",
    commands: [seedRoot, readRoot, deleteRoot, inverseRoot],
    participants: [{ participant, logicalStorage, commands: [seed, list, remove, inverse], reconstitution, validateLogical: validate }],
  }), host => Effect.gen(function* () {
    const seeded = yield* host.run(host.newRequestKey(), seedRoot, null);
    if (!Array.isArray(seeded) || !isJsonObject(seeded[0])) return yield* Effect.die(new Error("Missing committed native seed"));
    retained = seeded[0];
    expect(yield* host.run(host.newRequestKey(), readRoot, null)).toEqual(seeded);
    const before = yield* inventory;
    const request = host.newRequestKey();
    const result = yield* host.run(request, inverseRoot, "inverse");
    // Assert beyond the command's lifetime boundary so a mismatch reports the
    // complete native values instead of becoming a sticky rollback-only error.
    if (reconstitution === "preserveTimestamps") expect(result).toEqual([retained]);
    const after = yield* inventory;
    expect(after.rows.map(row => row.rowId)).toEqual(before.rows.map(row => row.rowId));
    expect(after.facts).toHaveLength(before.facts.length + 1);
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
    expect(after.wakes).toHaveLength(before.wakes.length + 1);
    const invoked = inverseInvocations;
    expect(yield* host.run(request, inverseRoot, "inverse")).toEqual(result);
    expect(inverseInvocations).toBe(invoked);
    expect(yield* inventory).toEqual(after);
    // Both policies grant the same operation, but their distinct timestamp
    // semantics belong to the canonical participant identity and replay key.
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, executionIsolation: "scopeExclusive",
      commands: [seedRoot, readRoot, deleteRoot, inverseRoot],
      participants: [{ participant, logicalStorage, commands: [seed, list, remove, inverse],
        reconstitution: reconstitution === "advanceUpdatedAt" ? "preserveTimestamps" : "advanceUpdatedAt", validateLogical: validate }],
    }), otherPolicy => Effect.gen(function* () {
      const snapshot = yield* inventory, called = inverseInvocations;
      expect(yield* Effect.result(otherPolicy.run(request, inverseRoot, "inverse")))
        .toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(inverseInvocations).toBe(called);
      expect(yield* inventory).toEqual(snapshot);
    }), otherPolicy => otherPolicy.close);
    // The same command/key cannot replay an outcome issued under the admitted
    // extension when the trusted participant omits that admission.
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, executionIsolation: "scopeExclusive",
      commands: [seedRoot, readRoot, deleteRoot, inverseRoot],
      participants: [{ participant, logicalStorage, commands: [seed, list, remove, inverse], validateLogical: validate }],
    }), denied => Effect.gen(function* () {
      const snapshot = yield* inventory;
      const called = inverseInvocations;
      expect(yield* Effect.result(denied.run(request, inverseRoot, "inverse")))
        .toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(inverseInvocations).toBe(called);
      expect(yield* Effect.result(denied.run(denied.newRequestKey(), inverseRoot, "inverse")))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(yield* inventory).toEqual(snapshot);
    }), denied => denied.close);
    expect(yield* Effect.result(makeAtomicCommerceHost({ ...hostInput, executionIsolation: "scopeExclusive",
      commands: [inverseRoot], participants: [{ participant, logicalStorage, commands: [inverse], reconstitution }],
    }))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    for (const forgedPolicy of [true, false, null, "true", 1, "preserve", {}]) {
      const malformed = { participant, logicalStorage, commands: [inverse], validateLogical: validate, reconstitution };
      // Explicit hostile runtime input, not a type assertion granting authority.
      Object.defineProperty(malformed, "reconstitution", { value: forgedPolicy });
      expect(captureAtomicCommerceParticipants([malformed]))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    // Read in a fresh committed root, then retain the actual latest complete DTO.
    const persisted = yield* host.run(host.newRequestKey(), readRoot, null);
    expect(persisted).toEqual(result);
    if (!Array.isArray(persisted) || !isJsonObject(persisted[0])) return yield* Effect.die(new Error("Missing persisted inverse"));
    retained = persisted[0];
    for (const mode of ["missingDeletion", "neverStored", "created", "updated", "deleted", "owner", "business", "occupied", "ambiguous", "caughtRefusal", "duplicate", "softOnly", "softThenDelete", "rollback", "cancellation"]) {
      const snapshot = yield* inventory;
      if (mode === "cancellation") {
        expect((yield* Effect.exit(host.run(host.newRequestKey(), inverseRoot, mode)))._tag).toBe("Failure");
      } else {
        expect(yield* Effect.result(host.run(host.newRequestKey(), inverseRoot, mode)))
          .toMatchObject({ _tag: "Failure", failure: { reason: mode === "caughtRefusal" ? "rollbackOnly" : "invalidInput" } });
      }
      expect(yield* inventory).toEqual(snapshot);
    }
    yield* host.run(host.newRequestKey(), deleteRoot, null);
    const removed = yield* inventory;
    expect(yield* Effect.result(host.run(host.newRequestKey(), inverseRoot, "nextRoot")))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(yield* inventory).toEqual(removed);
  }), host => host.close);
});
