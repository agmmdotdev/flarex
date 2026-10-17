import { Clock, Context, Effect, Schema } from "effect";
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
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxAppRowRevisions } from "../../../src/database/schema";

/** A baseline counterexample using real source participants and settlement.
 * Application creation time is seeded when each participant first opens. Its
 * per-participant insert counter does not encode root-wide write order. */
export const logicalInsertionClockScenario = Effect.fn("LogicalInsertionClock.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, sources: readonly [unknown, unknown], session: RelationalSession, verifyInsertionOrder = false,
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const selections = sources.map(source => ({ ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } } satisfies LogicalCommerceSelectionInput));
  const first = selections[0], second = selections[1];
  if (first === undefined || second === undefined) return yield* Effect.die(new Error("Missing clock witness sources"));
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-insertion-clock" } };
  const a = defineAtomicCommerceParticipant("insertionClockA"), b = defineAtomicCommerceParticipant("insertionClockB");
  const read = defineCommerceCommand("insertionClockOpen", "read", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("folio")).find(ctx.manager, { order: { column: "folio_key", direction: "asc" } })];
  }));
  const insert = defineCommerceCommand("insertionClockInsert", "write", (ctx, input) => Effect.gen(function* () {
    const key = yield* Schema.decodeUnknownEffect(Schema.String)(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return [...yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: key }])];
  }));
  for (const logicalStorage of selections)
    yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [read] }), host => host.initialize([]), host => host.close);
  const actual: Array<{ key: string; creationTime: number }> = [];
  const validate: LogicalCommerceCallValidation = (_call, activity) => Effect.sync(() => {
    for (const mutation of activity.mutations) {
      const row = mutation.after;
      if (row === null || typeof row.folio_key !== "string" || typeof row._creationTime !== "number")
        throw new Error("Missing authentic insertion-clock mutation evidence");
      actual.push({ key: row.folio_key, creationTime: row._creationTime });
    }
  });
  const live = Context.get(Context.empty(), Clock.Clock);
  const clockAt = (time: number): Clock.Clock => ({ currentTimeMillis: Effect.succeed(time), currentTimeMillisUnsafe: () => time,
    currentTimeNanos: Effect.succeed(BigInt(time) * 1_000_000n), currentTimeNanosUnsafe: () => BigInt(time) * 1_000_000n,
    monotonicTimeNanos: live.monotonicTimeNanos, monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    sleep: duration => live.sleep(duration) });
  const root = defineAtomicCommerceCommand("insertionClockRoot", ctx => Effect.gen(function* () {
    yield* ctx.call(a, read, null).pipe(Effect.provideService(Clock.Clock, clockAt(1_000)));
    yield* ctx.call(b, insert, "B-first").pipe(Effect.provideService(Clock.Clock, clockAt(2_000)));
    return yield* ctx.call(a, insert, "A-second").pipe(Effect.provideService(Clock.Clock, clockAt(3_000)));
  }));
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [root], participants: [
    { participant: a, logicalStorage: first, commands: [read, insert], validateLogicalCall: validate },
    { participant: b, logicalStorage: second, commands: [read, insert], validateLogicalCall: validate },
  ] }), host => Effect.gen(function* () {
    const revisions = () => runDrizzleStatementEffect(fixture.target.drizzle.select().from(fxAppRowRevisions),
      cause => new Error("Insertion clock witness inventory", { cause }));
    const before = yield* revisions();
    yield* host.run(host.newRequestKey(), root, null);
    expect(actual).toEqual([{ key: "B-first", creationTime: 2_000 }, { key: "A-second", creationTime: 1_000 }]);
    const after = (yield* revisions()).filter(row => !before.some(old => old.tableId === row.tableId && old.commitSeq === row.commitSeq &&
      Buffer.from(old.rowId).equals(Buffer.from(row.rowId))));
    expect(after).toHaveLength(2); expect(new Set(after.map(row => row.commitSeq)).size).toBe(1);
    expect(after.map(row => row.creationTime).sort((left, right) => left - right)).toEqual([1_000, 2_000]);
    if (verifyInsertionOrder) {
      const first = after.find(row => row.creationTime === 2_000), second = after.find(row => row.creationTime === 1_000);
      expect(first).toMatchObject({ insertionCommitSeq: first?.commitSeq, insertionAttemptOrdinal: 0 });
      expect(second).toMatchObject({ insertionCommitSeq: second?.commitSeq, insertionAttemptOrdinal: 1 });
    }
    console.info("Neutral actual insertion B→A; retained Application creation time sorts A→B", actual);
  }), host => host.close);
});
