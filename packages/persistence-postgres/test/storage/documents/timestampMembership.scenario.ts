import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../relationalSchema/neutralLogicalFixture";
import { timestampMembershipSchema as schema, timestampMembershipOrigin as evidence,
  timestampMembershipBoundary as boundary, timestampMembershipQuery as query } from "./timestampMembership.schema";
import { readTimestampMembershipAtSnapshot } from "./timestampMembership.historical";

const sourceKey = "medusa.neutral-timestamp-membership";
const membership = (values: readonly (string | null)[], column = "starts_at"): JsonObject => ({ kind: "in", column, values });
const ids = (input: unknown) => Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(input).map(row => row.id);

export async function timestampMembershipScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "entry",
        table: { namespace: "medusa", logicalName: evidence.sourceId + "/entry" } }] }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-timestamp", sources: [source] });
    if (driver === "postgres") expect((await fixture.persistence.query(
      "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    const seed = defineCommerceCommand("timestampMembershipSeed", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [
        { id: "before", starts_at: "2026-10-29T09:59:59.999Z", deleted_at: null },
        { id: "equal", starts_at: boundary, deleted_at: null },
        { id: "future", starts_at: "2026-10-29T10:00:00.001Z", deleted_at: null },
        { id: "null", starts_at: null, deleted_at: null },
        { id: "deleted", starts_at: boundary, deleted_at: boundary },
      ].map(row => ({ ...row, cohort: "bounded", unindexed_at: row.starts_at, partial_at: row.starts_at })));
      return null;
    }));
    const read = defineCommerceCommand("timestampMembershipRead", "read", (ctx, input) => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("entry")).find(ctx.manager, input)];
    }));
    let invocations = 0;
    const overlay = defineCommerceCommand("timestampMembershipOverlay", "write", (ctx, input) => Effect.gen(function* () {
      invocations++;
      const store = yield* ctx.table("entry"), retained = store.prepareRead(query(membership([boundary])));
      const before = [...yield* retained.find(ctx.manager)];
      yield* store.write(ctx.manager, "update", [{ id: "future", starts_at: boundary, unindexed_at: boundary, partial_at: boundary },
        { id: "equal", starts_at: null, unindexed_at: null, partial_at: null }]);
      const after = [...yield* retained.find(ctx.manager)];
      if (input === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
      return { before, after };
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const sourceInput = { sourceKey, writeProfile: sourceKey, schema, evidence };
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: sourceInput,
      initialization: { stepId: "timestamp-membership-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const identityAndAccessPolicy = { profile: "neutral-timestamp-membership" };
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, logicalStorage, identityAndAccessPolicy, commands: [read] }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("timestampMembership");
    const seedRoot = defineAtomicCommerceCommand("timestampMembershipSeedRoot", ctx => ctx.call(participant, seed, null));
    const readRoot = defineAtomicCommerceCommand("timestampMembershipReadRoot", (ctx, input) => ctx.call(participant, read, input));
    const overlayRoot = defineAtomicCommerceCommand("timestampMembershipOverlayRoot", (ctx, input) => ctx.call(participant, overlay, input));
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy,
      commands: [seedRoot, readRoot, overlayRoot], participants: [{ participant, logicalStorage, commands: [seed, read, overlay], validateLogicalCall: () => Effect.void }] }), host => Effect.gen(function* () {
      yield* host.run(host.newRequestKey(), seedRoot, null);
      for (const [predicate, expected] of [
        [membership([boundary, null, boundary]), ["deleted", "equal"]], [membership([null]), []], [membership([]), []],
        [membership(["0001-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z"]), []],
        [{ kind: "and", children: [{ kind: "in", column: "id", values: ["equal"] }, membership([boundary], "unindexed_at")] }, ["equal"]],
        [{ kind: "and", children: [{ kind: "in", column: "cohort", values: ["bounded"] }, membership([boundary], "unindexed_at")] }, ["deleted", "equal"]],
        [{ kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, membership([boundary], "partial_at")] }, ["equal"]],
        [{ kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, { kind: "or", children: [
          { kind: "lessThan", column: "starts_at", value: boundary }, membership([boundary]),
        ] }] }, ["before", "equal"]],
      ] satisfies Array<readonly [JsonObject, readonly string[]]>)
        expect(ids(yield* host.run(host.newRequestKey(), readRoot, query(predicate)))).toEqual(expected);
      for (const predicate of [membership([boundary], "unindexed_at"), membership([boundary], "partial_at"),
        membership(["2026-10-29T10:00:00Z"]), membership(Array.from({ length: 257 }, () => boundary))])
        expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, query(predicate)))).toMatchObject({ _tag: "Failure" });
      // Standalone read host uses the authenticated compact metadata owner;
      // the same native predicate must retain type/index/partial-index facts.
      yield* Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, logicalStorage, identityAndAccessPolicy, commands: [read] }), reader => Effect.gen(function* () {
        expect(ids(yield* reader.read(read, query(membership([boundary]))))).toEqual(["deleted", "equal"]);
        expect(ids(yield* reader.read(read, query({ kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, membership([boundary], "partial_at")] })))).toEqual(["equal"]);
        expect(yield* Effect.result(reader.read(read, query(membership([boundary], "unindexed_at")))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      }), reader => reader.close);
      const oldClock = yield* Effect.tryPromise({ try: () => fixture.persistence.getScopeClock(fixture.application.authority.scopeId), catch: cause => commerceError("resourceFailure", cause) });
      if (oldClock === null) throw new Error("Missing genuine historical timestamp clock");
      expect(yield* Effect.result(host.run(host.newRequestKey(), overlayRoot, "rollback")))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(ids(yield* host.run(host.newRequestKey(), readRoot, query(membership([boundary]))))).toEqual(["deleted", "equal"]);
      const requestKey = host.newRequestKey(), changedValue = yield* host.run(requestKey, overlayRoot, null);
      const changed = Schema.decodeUnknownSync(Schema.Struct({ before: Schema.Array(Schema.JsonObject), after: Schema.Array(Schema.JsonObject) }))(changedValue);
      expect(ids(changed.before)).toEqual(["deleted", "equal"]); expect(ids(changed.after)).toEqual(["deleted", "future"]);
      const callsBeforeReplay = invocations;
      expect(yield* host.run(requestKey, overlayRoot, null)).toEqual(changedValue); expect(invocations).toBe(callsBeforeReplay);
      const historical = yield* readTimestampMembershipAtSnapshot(fixture, sourceInput, oldClock.lastCommitSeq, query(membership([boundary])));
      expect(ids(historical.rows)).toEqual(["deleted", "equal"]);
      expect(historical.indexReads.length).toBeGreaterThan(0); expect(historical.dependencies.length).toBeGreaterThan(0);
      expect(ids(yield* host.run(host.newRequestKey(), readRoot, query(membership([boundary]))))).toEqual(["deleted", "future"]);
    }), host => host.close));
  } finally { for (const close of cleanup.reverse()) await close(); }
}
