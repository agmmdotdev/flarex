import { Deferred, Effect, Fiber } from "effect";
import { expect } from "vitest";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema, TransactionFunctionPathV1Schema, TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "./fixtures/applicationNativeMutationTestFixture";
import type { logicalRelationalAdmissionScenario } from "./logicalRelationalAdmissionScenario";
import type { CommerceCommandContext } from "../src/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../src/commerceTransaction/model";
import { makeCommerceCommandContext } from "../src/commerceTransaction/context";
import { makeLogicalCommerceParticipant } from "../src/commerceTransaction/logicalParticipant";
import { finalizeCommerceCommit } from "../src/commerceTransaction/publication";
import { commerceRequestHash } from "../src/commerceTransaction/request";
import { prepareLogicalRelationalAdmission } from "../src/logicalDocuments/relationalAdmission";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { createCommittedJsonOutcomeResolver } from "../src/committedPointOutcome";
import { canonicalizeJsonOutcome } from "../src/jsonOutcome";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks,
  fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds } from "../src/schema";

/** Real native commands borrow the production participant/finalizer. This test
 * supplies the root transaction, not a duplicate storage or publication engine. */
export const logicalRelationalPublicationScenario = Effect.fn("LogicalRelationalPublication.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, schemaVersionId: CatalogSchemaVersionId,
  source: Parameters<typeof logicalRelationalAdmissionScenario>[2],
  execute: Parameters<typeof logicalRelationalAdmissionScenario>[5],
  verify: (context: CommerceCommandContext) => Effect.Effect<unknown, CommerceTransactionError>,
  concurrentExecute: (context: CommerceCommandContext, code: string) => Effect.Effect<unknown, CommerceTransactionError>,
) {
  const { deploymentId, authority, authorityPorts, control, target } = fixture;
  const prepared = yield* prepareLogicalRelationalAdmission({ controlDb: control.drizzle, authority: authorityPorts },
    fixture.uniqueConstraintEligibility, { deploymentId, scopeId: authority.scopeId, schemaVersionId }, source, { kind: "standalone" });
  const resolved = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authorityPorts);
  const active = yield* fixture.activation.readActive();
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.scopeId));
  const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement, cause => new Error("Publication witness inventory", { cause }));
  const inventory = Effect.gen(function* () {
    return {
      rows: yield* query(target.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.rowId)),
      revisions: yield* query(target.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.commitSeq, fxAppRowRevisions.rowId)),
      indexes: yield* query(target.drizzle.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId)),
      indexRevisions: yield* query(target.drizzle.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.commitSeq, fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId)),
      unique: yield* query(target.drizzle.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.canonicalKeySha256)),
      indexBuilds: yield* query(target.drizzle.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId)),
      uniqueBuilds: yield* query(target.drizzle.select().from(fxSystemUniqueConstraintBuilds).orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId)),
      commits: yield* query(target.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq)),
      changes: yield* query(target.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal)),
      outcomes: yield* query(target.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey)),
      wakes: yield* query(target.drizzle.select().from(fxSystemCommitWakes).orderBy(fxSystemCommitWakes.commitSeq)),
      clocks: yield* query(target.drizzle.select().from(fxSystemScopeClocks)),
    };
  });
  const hash = (bytes: Uint8Array) => commerceRequestHash(bytes, { maximumInputBytes: 1_048_576 });
  const identity = {
    scopeUuid: scope.scopeUuid, requestKey: TransactionRequestKeyV1Schema.make("commerce/logical-publication"),
    expectedFunctionPath: TransactionFunctionPathV1Schema.make("__flarex_private_commerce/nativeProof"),
    expectedIdentityAccessPolicySha256: TransactionIdentityAccessPolicySha256V1Schema.make(yield* hash(new TextEncoder().encode("native-proof-policy"))),
    expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* hash(new TextEncoder().encode("native-proof-write"))),
  };
  const late = new Error("Injected failure after native rows and outcome were written");
  let lateReached = false;
  let lateFactReached = false;
  let invoked = 0;
  const run = (scenario: "success" | "invalid" | "late" | "lateFacts" | "read") => runEffectTransaction(work => target.drizzle.transaction(work),
    "Native participant publication", (tx: FlarexMetadataTransaction) => Effect.scoped(Effect.gen(function* () {
      const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId);
      return yield* prepared.withAdmission(active.selection, tx, resolved.authority, clock, admission => Effect.gen(function* () {
        if (scenario !== "read") {
          const retained = yield* createCommittedJsonOutcomeResolver(tx).resolve(identity);
          if (retained.kind === "available") return retained.successfulResult.valueJson;
          expect(retained.kind).toBe("missing");
        }
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
          { calls: 128, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "native-publication", scenario === "read" ? "read" : "write"), lifetime => lifetime.close);
        const id = yield* lifetime.begin(lifetime.context);
        const working = yield* makeLogicalCommerceParticipant(admission, tx, lifetime, lifetime.context, id);
        const context = makeCommerceCommandContext(lifetime, working, id, lifetime.context,
          () => Effect.fail(commerceError("unsupportedProfile")), () => Effect.fail(commerceError("unadmittedEvent")));
        if (scenario === "read") {
          yield* verify(context);
          yield* lifetime.seal;
          return null;
        }
        invoked++;
        const value = yield* execute(context, scenario === "invalid" ? "missingUpdate" : "success");
        yield* lifetime.seal;
        const closure = yield* working.close();
        const result = yield* Effect.fromResult(canonicalizeJsonOutcome(value));
        yield* finalizeCommerceCommit({ kind: "logical", closure }, lifetime, identity, result, yield* hash(result.canonicalBytes),
          scenario === "late" || scenario === "lateFacts" ? { afterTransactionStep: async event => {
            if (scenario === "late" && event.step === "outcomeWritten") { lateReached = true; throw late; }
            if (scenario === "lateFacts" && event.step === "commitChangeWritten") { lateFactReached = true; throw late; }
          } } : {});
        expect(yield* Effect.result(finalizeCommerceCommit({ kind: "logical", closure }, lifetime, identity, result, yield* hash(result.canonicalBytes))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
        return result.valueJson;
      }));
    })), cause => new Error("Native participant transaction", { cause }));
  const before = yield* inventory;
  expect(yield* Effect.result(run("invalid"))).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
  expect(yield* inventory).toEqual(before);
  expect((yield* Effect.exit(run("lateFacts")))._tag).toBe("Failure");
  expect(lateFactReached).toBe(true);
  expect(yield* inventory).toEqual(before);
  expect((yield* Effect.exit(run("late")))._tag).toBe("Failure");
  expect(lateReached).toBe(true);
  expect(yield* inventory).toEqual(before);
  expect(yield* run("success")).toBe(null);
  const committed = yield* inventory;
  expect(committed.rows).toHaveLength(before.rows.length + 1);
  expect(committed.commits).toHaveLength(before.commits.length + 1);
  expect(committed.changes).toHaveLength(before.changes.length + 1);
  expect(committed.outcomes).toHaveLength(before.outcomes.length + 1);
  expect(committed.wakes).toHaveLength(before.wakes.length + 1);
  yield* run("read");
  expect(yield* run("success")).toBe(null);
  expect(invoked).toBe(4);
  expect(yield* inventory).toEqual(committed);

  if ("pool" in target) {
    yield* Effect.scoped(Effect.gen(function* () {
    // Both commands retain admission/build locks before either enters the
    // publication clock. The first must publish while the second still holds
    // its admission locks, then the second publishes its disjoint row.
    const readyA = yield* Deferred.make<void>();
    const readyB = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const concurrent = (code: string, ready: typeof readyA) => runEffectTransaction(work => target.drizzle.transaction(work),
      "Concurrent native publication", (tx: FlarexMetadataTransaction) => Effect.scoped(Effect.gen(function* () {
        const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId);
        return yield* prepared.withAdmission(active.selection, tx, resolved.authority, clock, admission => Effect.gen(function* () {
          const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
            { calls: 128, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, `native-${code}`, "write"), member => member.close);
          const id = yield* lifetime.begin(lifetime.context);
          const working = yield* makeLogicalCommerceParticipant(admission, tx, lifetime, lifetime.context, id);
          const context = makeCommerceCommandContext(lifetime, working, id, lifetime.context,
            () => Effect.fail(commerceError("unsupportedProfile")), () => Effect.fail(commerceError("unadmittedEvent")));
          yield* concurrentExecute(context, code);
          yield* lifetime.seal;
          const closure = yield* working.close();
          const result = yield* Effect.fromResult(canonicalizeJsonOutcome(null));
          const requestIdentity = { ...identity,
            requestKey: TransactionRequestKeyV1Schema.make(`commerce/logical-${code}`),
            expectedRequestSha256: TransactionRequestSha256V1Schema.make(yield* hash(new TextEncoder().encode(code))),
          };
          yield* Deferred.succeed(ready, undefined);
          yield* Deferred.await(release);
          return yield* finalizeCommerceCommit({ kind: "logical", closure }, lifetime, requestIdentity, result,
            yield* hash(result.canonicalBytes));
        }));
      })), cause => new Error("Concurrent native transaction", { cause }));
    const first = yield* Effect.forkScoped(concurrent("pqa", readyA));
    const second = yield* Effect.forkScoped(concurrent("pqb", readyB));
    yield* Effect.gen(function* () {
      yield* Deferred.await(readyA).pipe(Effect.timeout("10 seconds"));
      yield* Deferred.await(readyB).pipe(Effect.timeout("10 seconds"));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    const after = yield* inventory;
    expect(after.rows).toHaveLength(committed.rows.length + 2);
    expect(after.commits).toHaveLength(committed.commits.length + 2);
    expect(after.outcomes).toHaveLength(committed.outcomes.length + 2);
    })).pipe(Effect.timeout("20 seconds"));
  }
});
