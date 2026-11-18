import { Effect } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { capturePrivateJsonData } from "../../../src/values/privateJsonData";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";
import { numberMembershipSchema as schema, numberMembershipOrigin as evidence } from "../../storage/relationalSchema/numberMembershipSchema";

const sourceKey = "medusa.neutral-number-membership";
const rows = [
  { id: "a", cohort: "selected", version: 1, measure: 1e-7 },
  { id: "b", cohort: "selected", version: 2, measure: 1e21 },
  { id: "c", cohort: "selected", version: 1, measure: 0 },
  { id: "d", cohort: "selected", version: 1, measure: null },
  { id: "e", cohort: "selected", version: 1, measure: Number.MIN_VALUE },
  { id: "f", cohort: "selected", version: 1, measure: Number.MAX_VALUE },
  { id: "int-low", cohort: "selected", version: -2147483648, measure: null },
  { id: "int-high", cohort: "selected", version: 2147483647, measure: null },
  { id: "foreign", cohort: "foreign", version: 1, measure: 1e-7 },
];
const membership = (column: string, values: readonly number[]): JsonObject => ({ kind: "numberIn", column, values });
const selection = (predicate: JsonObject): JsonObject => ({ fields: ["id"], order: { column: "id", direction: "asc" },
  take: 8, predicate: { kind: "and", children: [{ kind: "in", column: "cohort", values: ["selected"] }, predicate] } });

/** Real installation, logical rows, atomic settlement and PostgreSQL expression
 * evaluation. The harness supplies data and assertions, never query semantics. */
export async function numberMembershipScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "entry",
        table: { namespace: "medusa", logicalName: evidence.sourceId + "/entry" } }] }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close),
      { name: "neutral-number-membership", sources: [source], finiteCapture: true });
    if (driver === "postgres") expect((await fixture.persistence.query(
      "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    const seed = defineCommerceCommand("numberMembershipSeed", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", rows); return null;
    }));
    const read = defineCommerceCommand("numberMembershipRead", "read", (ctx, input) => Effect.gen(function* () {
      const query = (yield* ctx.table("entry")).prepareRead(input);
      return { rows: [...yield* query.find(ctx.manager)], count: yield* query.count(ctx.manager) };
    }));
    const retained = defineCommerceCommand("numberMembershipRetained", "read", ctx => Effect.gen(function* () {
      const values = [1], query = (yield* ctx.table("entry")).prepareRead(selection(membership("version", values)));
      const found = [...yield* query.find(ctx.manager)]; values[0] = 2;
      return { rows: found, count: yield* query.count(ctx.manager) };
    }));
    const overlay = defineCommerceCommand("numberMembershipOverlay", "write", (ctx, input) => Effect.gen(function* () {
      const table = yield* ctx.table("entry");
      yield* table.write(ctx.manager, "update", [{ id: "c", version: 2 }]);
      const query = table.prepareRead(selection(membership("version", [2])));
      const result = { rows: [...yield* query.find(ctx.manager)], count: yield* query.count(ctx.manager) };
      if (input === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
      return result;
    }));
    const caughtInvalid = defineCommerceCommand("numberMembershipCaughtInvalid", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("entry");
      yield* table.write(ctx.manager, "insert", [{ id: "must-rollback", cohort: "foreign", version: 1 }]);
      const refused = yield* table.prepareRead(selection({ kind: "numberIn", column: "version", values: ["1"] })).find(ctx.manager).pipe(Effect.result);
      expect(refused).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      return null;
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "number-membership-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const identityAndAccessPolicy = { profile: "neutral-number-membership" };
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, logicalStorage, identityAndAccessPolicy, commands: [read] }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("numberMembership");
    const seedRoot = defineAtomicCommerceCommand("numberMembershipSeedRoot", ctx => ctx.call(participant, seed, null));
    const readRoot = defineAtomicCommerceCommand("numberMembershipReadRoot", (ctx, input) => ctx.call(participant, read, input));
    const retainedRoot = defineAtomicCommerceCommand("numberMembershipRetainedRoot", ctx => ctx.call(participant, retained, null));
    const overlayRoot = defineAtomicCommerceCommand("numberMembershipOverlayRoot", (ctx, input) => ctx.call(participant, overlay, input));
    const caughtRoot = defineAtomicCommerceCommand("numberMembershipCaughtRoot", ctx => ctx.call(participant, caughtInvalid, null));
    const receipts: Array<Parameters<LogicalCommerceCallValidation>[1]> = [];
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
      expect(call.events).toEqual([]); if (call.mode === "read") receipts.push(activity);
    });
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy,
      commands: [seedRoot, readRoot, retainedRoot, overlayRoot, caughtRoot],
      participants: [{ participant, logicalStorage, commands: [seed, read, retained, overlay, caughtInvalid], validateLogicalCall }] }), host => Effect.gen(function* () {
      yield* host.run(host.newRequestKey(), seedRoot, null);
      for (const [column, values, ids] of [
        ["version", [1], ["a", "c", "d", "e", "f"]], ["version", [2], ["b"]],
        ["version", [-2147483648, 2147483647], ["int-high", "int-low"]],
        ["measure", [1e-7, 1e21, -0, Number.MIN_VALUE, Number.MAX_VALUE], ["a", "b", "c", "e", "f"]],
        ["measure", [], []],
      ] as const) {
        for (const postgres of [false, true]) {
          const predicate = postgres ? { kind: "and", children: [membership(column, values),
            { kind: "postgresText", column: "id", operator: "like", value: "%" }] } : membership(column, values);
          const query = selection(predicate);
          expect(yield* host.run(host.newRequestKey(), readRoot, query)).toEqual({ rows: ids.map(id => ({ id })), count: ids.length });
          // The command boundary owns canonical JSON capture, including -0 -> 0.
          // Preserve the caller's signed zero while checking the actual receipt.
          const canonicalQuery = yield* Effect.fromResult(capturePrivateJsonData(query, defaultCommerceResources.commandBytes, commerceError, { canonicalNumbers: true }));
          expect(receipts.at(-1)?.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query: canonicalQuery.value, total: ids.length, returned: ids.length })));
          if (column === "measure" && values.length !== 0) expect(Object.is(values[2], -0)).toBe(true);
        }
      }
      expect(yield* host.run(host.newRequestKey(), retainedRoot, null)).toEqual({ rows: ["a", "c", "d", "e", "f"].map(id => ({ id })), count: 5 });
      expect(yield* Effect.result(host.run(host.newRequestKey(), overlayRoot, "rollback")))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(yield* host.run(host.newRequestKey(), readRoot, selection(membership("version", [2])))).toEqual({ rows: [{ id: "b" }], count: 1 });
      const key = host.newRequestKey(), changed = yield* host.run(key, overlayRoot, null);
      expect(changed).toEqual({ rows: [{ id: "b" }, { id: "c" }], count: 2 });
      expect(yield* host.run(key, overlayRoot, null)).toEqual(changed);
      expect(yield* Effect.result(host.run(host.newRequestKey(), caughtRoot, null)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
      expect(yield* host.run(host.newRequestKey(), readRoot, { fields: ["id"], order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: ["must-rollback"] } })).toEqual({ rows: [], count: 0 });
    }), host => host.close));
    // A selective numeric residual cannot shrink the indexed candidate cohort
    // before the existing resource owner charges it.
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy, commands: [readRoot],
      participants: [{ participant, logicalStorage, commands: [read], validateLogicalCall,
        logicalResources: { ...defaultCommerceResources, catalogRows: 4, queryRows: 4, writeBatchRows: 4 } }] }), host => Effect.gen(function* () {
      expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, { ...selection(membership("version", [999])), take: 1 })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }), host => host.close));
  } finally { for (const close of cleanup.reverse()) await close(); }
}
