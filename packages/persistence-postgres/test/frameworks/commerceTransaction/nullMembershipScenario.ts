import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";
import { relationalReadLimits } from "../../../src/execution/preparation/frameworkExecutionPolicy";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../../../src/storage/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile } from "../../../src/frameworks/commerceTransaction/profile";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { commerceHostFixture } from "./commerceHostFixture";
import { commerceInventory } from "./commerceInventory";

const sourceKey = "medusa.neutral-null-membership";
const evidence = { kind: "synthetic", sourceId: "neutral-null-membership" };
const origin = { kind: "synthetic", sourceId: "neutral-null-membership" };
const implicit = { kind: "implicit", sourceId: "neutral-null-membership.lifecycle" };
const decodeRequiredWriteColumn = Schema.decodeUnknownEffect(Schema.Literals(["id", "required_flag"]));
const decodeReadQuery = Schema.decodeUnknownEffect(Schema.JsonObject);
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-null-membership",
  tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "value", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "unindexed", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "flag", type: "boolean", nullable: true, default: { kind: "none" }, origin },
    { columnId: "required_flag", type: "boolean", nullable: false, default: { kind: "booleanLiteral", value: false }, origin },
    { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
      default: { kind: "currentTimestamp" as const }, origin: implicit })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    ...["value", "flag", "required_flag"].map(columnId => ({ indexId: "entry." + columnId, kind: "btree" as const, columns: [columnId], predicate: null, origin })),
    { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit },
  ], constraints: [], relationships: [] }], capabilities: [
    { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
      updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: implicit },
    { capabilityId: "entry.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: implicit },
  ] }));

/** Installed neutral rows and the genuine atomic owner expose query literals
 * separately from write nullability. No adapter, replacement planner or fake
 * receipt issuer participates. */
export async function nullMembershipScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "entry",
        table: { namespace: "medusa", logicalName: "neutral-null-membership/entry" } }] }));
    // This existing fixture name selects setup identity only; the captured
    // schema, source and table bindings above own the membership contract.
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-null-implication", sources: [source] });
    if (driver === "postgres") {
      const role = await fixture.persistence.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user");
      expect(role.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    }
    const seed = defineCommerceCommand("neutralNullMembershipSeed", "write", ctx => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [
        { id: "a", value: "text", unindexed: "value", flag: true, required_flag: true },
        { id: "b", value: null, flag: null }, { id: "c", value: "null", flag: false },
      ])];
    }));
    const read = defineCommerceCommand("neutralNullMembershipRead", "read", (ctx, input) => Effect.gen(function* () {
      const query = yield* decodeReadQuery(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const program = (yield* ctx.table("entry")).prepareRead(query);
      const rows = yield* program.find(ctx.manager);
      return { rows: [...rows], count: yield* program.count(ctx.manager) };
    }));
    const retainedQuery = () => ({ fields: ["id"], includeIdentities: true, order: { column: "id", direction: "asc" },
      predicate: { kind: "in", column: "id", values: [null, "a", null, "a"] }, take: 8 });
    const retained = defineCommerceCommand("neutralNullMembershipRetained", "read", ctx => Effect.gen(function* () {
      const query = retainedQuery(), program = (yield* ctx.table("entry")).prepareRead(query);
      const rows = yield* program.find(ctx.manager);
      query.predicate.values.splice(0, query.predicate.values.length, "c"); query.take = 0;
      return { rows: [...rows], count: yield* program.count(ctx.manager) };
    }));
    const invalidWrite = defineCommerceCommand("neutralNullMembershipInvalidWrite", "write", (ctx, input) => Effect.gen(function* () {
      const column = yield* decodeRequiredWriteColumn(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const table = yield* ctx.table("entry");
      yield* table.write(ctx.manager, "insert", [{ id: "must-rollback" }]);
      const invalid: JsonObject = column === "id" ? { id: null } : { id: "invalid-boolean", required_flag: null };
      yield* table.write(ctx.manager, "insert", [invalid]).pipe(Effect.result);
      return null;
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "neutral-null-membership-seed", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-null-membership" } };
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("neutralNullMembership");
    const seedRoot = defineAtomicCommerceCommand("neutralNullMembershipSeedRoot", ctx => ctx.call(participant, seed, null));
    const readRoot = defineAtomicCommerceCommand("neutralNullMembershipReadRoot", (ctx, query) => ctx.call(participant, read, query));
    const retainedRoot = defineAtomicCommerceCommand("neutralNullMembershipRetainedRoot", ctx => ctx.call(participant, retained, null));
    const writeRoot = defineAtomicCommerceCommand("neutralNullMembershipInvalidWriteRoot", (ctx, column) => ctx.call(participant, invalidWrite, column));
    const receipts: Array<Parameters<LogicalCommerceCallValidation>[1]> = [];
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
      if (call.commandName !== "neutralNullMembershipRead" && call.commandName !== "neutralNullMembershipRetained") return;
      expect(activity.mutations).toEqual([]); expect(activity.lifecycle).toEqual([]); expect(call.events).toEqual([]);
      receipts.push(activity);
    });
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...input, commands: [seedRoot, readRoot, retainedRoot, writeRoot],
      participants: [{ participant, logicalStorage, commands: [seed, read, retained, invalidWrite], validateLogicalCall }] }), host => Effect.gen(function* () {
      yield* host.run(host.newRequestKey(), seedRoot, null);
      const query: JsonObject = { fields: ["id"], includeIdentities: true, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: [null] } };
      // SQL id IN (NULL) is an empty read even for a nonnullable primary key.
      // Before the correction this genuine owner refuses invalidInput here.
      expect(yield* host.run(host.newRequestKey(), readRoot, query)).toEqual({ rows: [], count: 0 });
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query, total: 0, returned: 0, orderedIdentities: [] })));
      expect(receipts[0]?.observedRows.filter(row => row.table === "entry")).toEqual([]);
      const membership = (column: string, values: readonly Json[]): JsonObject => ({ kind: "in", column, values });
      const selection = (predicate: Json): JsonObject => ({ fields: ["id"], includeIdentities: true,
        order: { column: "id", direction: "asc" }, predicate });
      const selected = Effect.fn(function* (predicate: Json, ids: readonly string[]) {
        const query = selection(predicate);
        expect(yield* host.run(host.newRequestKey(), readRoot, query)).toEqual({ rows: ids.map(id => ({ id })), count: ids.length });
        const activity = receipts.at(-1);
        expect(activity?.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query, total: ids.length, returned: ids.length,
          orderedIdentities: ids.map(id => ({ id })) })));
        return activity;
      });
      for (const [predicate, ids] of [
        [membership("id", [null, "c", "a", null, "a"]), ["a", "c"]],
        [membership("id", []), []],
        [membership("value", [null]), []],
        [membership("value", [null, "text", null, "text"]), ["a"]],
        [membership("value", [null, "null"]), ["c"]],
        [membership("flag", [null]), []],
        [membership("flag", [null, true, null, true]), ["a"]],
        [membership("flag", [null, false, true, false]), ["a", "c"]],
        [membership("required_flag", [null]), []],
        [membership("required_flag", [null, true]), ["a"]],
        [membership("required_flag", [null, false, null, false]), ["b", "c"]],
        [{ kind: "and", children: [membership("id", [null]), membership("value", ["text", null])] }, []],
        [{ kind: "or", children: [membership("id", [null]), membership("value", ["text", null])] }, ["a"]],
        [{ kind: "and", children: [membership("id", ["a", "b", "c", null]),
          { kind: "or", children: [membership("value", [null]), membership("flag", [null, false])] }] }, ["c"]],
        // A PostgreSQL-only leaf forces whole-tree residual evaluation. The
        // stored string "null" must not match an SQL NULL operand.
        [{ kind: "and", children: [membership("id", ["a", "b", "c"]),
          { kind: "or", children: [membership("value", [null]),
            { kind: "postgresText", column: "value", operator: "like", value: "text" }] }] }, ["a"]],
        [{ kind: "and", children: [membership("id", ["a", "b", "c"]),
          { kind: "or", children: [membership("value", [null, "null"]),
            { kind: "postgresText", column: "value", operator: "like", value: "text" }] }] }, ["a", "c"]],
        [{ kind: "and", children: [membership("id", ["a", "b", "c"]),
          { kind: "or", children: [membership("flag", [null, true]),
            { kind: "postgresText", column: "value", operator: "like", value: "absent" }] }] }, ["a"]],
        [{ kind: "and", children: [membership("id", ["a", "b", "c"]),
          { kind: "or", children: [membership("required_flag", [null, false]),
            { kind: "postgresText", column: "value", operator: "like", value: "absent" }] }] }, ["b", "c"]],
      ] satisfies Array<readonly [JsonObject, readonly string[]]>) yield* selected(predicate, ids);
      const raw = [null, "a", null, "a"];
      const activity = yield* selected(membership("id", raw), ["a"]);
      raw.splice(0, raw.length, "c");
      const captured = activity?.relationalReads[0]?.query;
      if (captured === undefined || !isJsonObject(captured) || captured.predicate === undefined || !isJsonObject(captured.predicate))
        throw new Error("Missing captured raw membership query");
      expect(captured.predicate.values).toEqual([null, "a", null, "a"]);
      expect(Reflect.set(captured, "take", 0)).toBe(false);
      const capturedValues = captured.predicate.values;
      if (!Array.isArray(capturedValues)) throw new Error("Missing captured membership values");
      expect(Reflect.set(capturedValues, "0", "c")).toBe(false);
      expect(yield* host.run(host.newRequestKey(), retainedRoot, null)).toEqual({ rows: [{ id: "a" }], count: 1 });
      expect(receipts.at(-1)?.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query: retainedQuery(), total: 1, returned: 1,
        orderedIdentities: [{ id: "a" }] })));
      // Charge every raw operand before removing NULL/nonmatching points or
      // deduplicating repeated equalities. Existing ceilings are unchanged.
      yield* selected(membership("id", Array.from({ length: relationalReadLimits.filterOperands }, () => null)), []);
      yield* selected(membership("id", Array.from({ length: relationalReadLimits.filterOperands }, (_, index) => index % 2 === 0 ? null : "a")), ["a"]);
      const refused = Effect.fn(function* (predicate: Json, reason = "invalidInput") {
        const receiptCount = receipts.length;
        expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, selection(predicate))))
          .toMatchObject({ _tag: "Failure", failure: { reason } });
        expect(receipts).toHaveLength(receiptCount);
      });
      yield* refused(membership("id", Array.from({ length: relationalReadLimits.filterOperands + 1 }, () => null)), "limitExceeded");
      yield* refused(membership("id", Array.from({ length: relationalReadLimits.filterOperands + 1 }, () => "a")), "limitExceeded");
      for (const predicate of [
        // NULL literals do not grant a missing indexed text access recipe;
        // even raw empty membership retains the existing unindexed refusal.
        membership("unindexed", []), membership("unindexed", [null, null]),
        membership("unindexed", ["value"]), membership("unindexed", [null, "value"]),
        membership("not_a_field", [null]), membership("amount", [null]), membership("id", [null, true]), membership("flag", [null, "true"]),
        membership("required_flag", [null, "false"]),
        { kind: "and", children: [membership("id", [null]), membership("not_a_field", [null])] },
        { kind: "or", children: [membership("id", [null]), membership("flag", [null, "wrong-type"])] },
        { kind: "not", child: membership("id", [null]) },
        { kind: "postgresText", column: "value", operator: "notIn", values: [null] },
        { kind: "numericIn", column: "amount", values: [null] },
        { kind: "indexedPoints", columns: ["id", "value"], values: [["a", null]] },
      ] satisfies JsonObject[]) yield* refused(predicate);
      for (const column of ["id", "required_flag"]) {
        expect(yield* Effect.result(host.run(host.newRequestKey(), writeRoot, column)))
          .toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
        yield* selected(membership("id", ["a", "b", "c", "must-rollback", "invalid-boolean"]), ["a", "b", "c"]);
      }
    }), host => host.close));
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
}

/** The displaced physical compatibility host shares read-literal semantics,
 * without making nonnullable writes valid or granting a logical capability. */
export async function nullMembershipPhysicalScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const close = (release: () => Promise<void>) => cleanup.push(release);
    const resource = driver === "postgres" ? await (async () => {
      const resource = await createFileScopedPostgresFixture(); close(resource.dispose);
      return { persistence: resource.persistence, session: makePostgresRelationalSession(resource.persistence) };
    })() : await createRelationalPGliteFixture({ registerCleanup: close });
    const control = driver === "postgres" ? resource.persistence : await createMigratedPGlitePersistence(close);
    const seed = defineCommerceCommand("neutralPhysicalNullSeed", "write", ctx => ctx.store.write(ctx.manager, "insert", [
      { id: "a", value: "text", flag: true, required_flag: true }, { id: "b", value: null, flag: null }, { id: "c", value: "null", flag: false },
    ]));
    const read = defineCommerceCommand("neutralPhysicalNullRead", "read", (ctx, query) => Effect.gen(function* () {
      const program = ctx.store.prepareRead(query);
      return { rows: [...yield* program.find(ctx.manager)], count: yield* program.count(ctx.manager) };
    }));
    const retained = defineCommerceCommand("neutralPhysicalNullRetained", "read", ctx => Effect.gen(function* () {
      const query = { fields: ["id"], order: { column: "id", direction: "asc" }, take: 8,
        predicate: { kind: "in", column: "id", values: [null, "a", null, "a"] } };
      const program = ctx.store.prepareRead(query), rows = yield* program.find(ctx.manager);
      query.predicate.values.splice(0, query.predicate.values.length, "c"); query.take = 0;
      return { rows: [...rows], count: yield* program.count(ctx.manager) };
    }));
    const invalidWrite = defineCommerceCommand("neutralPhysicalNullWriteRefusal", "write", (ctx, input) => Effect.gen(function* () {
      const column = yield* decodeRequiredWriteColumn(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      yield* ctx.store.write(ctx.manager, "insert", [{ id: "must-rollback" }]);
      const invalid: JsonObject = column === "id" ? { id: null } : { id: "invalid-boolean", required_flag: null };
      yield* ctx.store.write(ctx.manager, "insert", [invalid]).pipe(Effect.result);
      return null;
    }));
    const fixture = await commerceHostFixture(resource.persistence, resource.session, Effect.fn(function* (deploymentId, target) {
      const captured = yield* captureRelationalSchemaArtifact({ deploymentId, schema: relationalSchemaSourceFromDefinition(schema),
        provenance: { kind: "sourceSnapshot", repository: "https://example.com/neutral-null-membership", revision: "a".repeat(40), paths: ["entry.ts"] } });
      const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
      const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "neutral-null-membership",
        [{ tableId: "entry", keyId: "entry.primary", update: "existingPrimaryKey" }]);
      return { profile, initialization: { rows: undefined } };
    }), [seed, read, retained, invalidWrite], control, () => ({
      capture: () => Effect.fail(commerceError("unadmittedEvent")),
      validate: events => Effect.sync(() => { expect(events).toEqual([]); }),
      deliver: () => Effect.void,
    }));
    close(() => Effect.runPromise(fixture.host.close));
    if (driver === "postgres") {
      const role = await fixture.persistence.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user");
      expect(role.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    }
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), seed, null));
    const membership = (column: string, values: readonly Json[]): JsonObject => ({ kind: "in", column, values });
    const select = (predicate: Json) => fixture.host.read(read, { fields: ["id"], order: { column: "id", direction: "asc" }, predicate });
    for (const [predicate, ids] of [
      [membership("id", [null]), []], [membership("id", [null, "c", "a", null, "a"]), ["a", "c"]],
      [membership("value", [null]), []], [membership("value", [null, "text", null]), ["a"]],
      [membership("flag", [null]), []], [membership("flag", [null, true, false, true]), ["a", "c"]],
      [membership("required_flag", [null]), []], [membership("required_flag", [null, true]), ["a"]],
      [membership("required_flag", [null, false, null, false]), ["b", "c"]],
      [{ kind: "and", children: [membership("id", [null]), membership("value", ["text"])] }, []],
      [{ kind: "or", children: [membership("id", [null]), membership("value", [null, "null"])] }, ["c"]],
      [membership("id", Array.from({ length: relationalReadLimits.filterOperands }, () => null)), []],
      [membership("id", Array.from({ length: relationalReadLimits.filterOperands }, (_, index) => index % 2 === 0 ? null : "a")), ["a"]],
    ] satisfies Array<readonly [JsonObject, readonly string[]]>)
      expect(await Effect.runPromise(select(predicate))).toEqual({ rows: ids.map(id => ({ id })), count: ids.length });
    expect(await Effect.runPromise(fixture.host.read(retained, null))).toEqual({ rows: [{ id: "a" }], count: 1 });
    for (const [predicate, reason] of [
      [membership("id", Array.from({ length: relationalReadLimits.filterOperands + 1 }, () => null)), "limitExceeded"],
      [membership("id", Array.from({ length: relationalReadLimits.filterOperands + 1 }, () => "a")), "limitExceeded"],
      [membership("not_a_field", [null]), "unsupportedProfile"], [membership("id", [null, true]), "invalidInput"],
      [membership("required_flag", [null, "false"]), "invalidInput"],
      [{ kind: "and", children: [membership("id", [null]), membership("not_a_field", [null])] }, "unsupportedProfile"],
      [{ kind: "not", column: "id", child: membership("id", [null]) }, "invalidInput"],
    ] satisfies Array<readonly [JsonObject, string]>)
      expect(await Effect.runPromise(Effect.result(select(predicate)))).toMatchObject({ _tag: "Failure", failure: { reason } });
    const before = await commerceInventory(fixture);
    for (const column of ["id", "required_flag"]) {
      expect(await Effect.runPromise(Effect.result(fixture.host.run(fixture.host.newRequestKey(), invalidWrite, column))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
      expect(await commerceInventory(fixture)).toEqual(before);
    }
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
}
