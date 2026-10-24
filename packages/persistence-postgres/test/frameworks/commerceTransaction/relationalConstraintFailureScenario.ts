import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { inspectLogicalRelationalFailure } from "../../../src/frameworks/commerceTransaction/commerceAdapter";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";
import { logicalCommerceInventory } from "./logicalCommerceInventory";

const sourceKey = "medusa.neutral-constraint-failure";
const origin = { kind: "synthetic", sourceId: "neutral-constraint-failure" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, capabilities: [], tables: [
  { tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "scope", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "segment", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
    { columnId: "amount", type: "real", nullable: true, default: { kind: "none" }, origin },
    { columnId: "label", type: "text", nullable: false, default: { kind: "textLiteral", value: "default" }, origin },
    { columnId: "code", type: "text", nullable: false, default: { kind: "textLiteral", value: "allowed" }, origin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: "entry.activeScope", kind: "uniqueBtree", columns: ["scope"],
      predicate: { kind: "allNull", columnIds: ["deleted_at", "segment"] }, origin },
    { indexId: "entry.activeSegment", kind: "uniqueBtree", columns: ["scope", "segment"],
      predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
  ], constraints: [{ constraintId: "entry.code", kind: "textSet", columnId: "code", values: ["allowed"], origin }], relationships: [] },
  { tableId: "condition", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "entry_id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "reference", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "reference_id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "condition.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: "condition.activeReference", kind: "uniqueBtree", columns: ["entry_id", "reference", "reference_id"],
      predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
  ], constraints: [], relationships: [] },
] }));
const entry = schema.tables.find(table => table.identity.tableId === "entry");
const condition = schema.tables.find(table => table.identity.tableId === "condition");
if (entry === undefined || condition === undefined) throw new Error("Missing constraint failure tables");
const entryIdentity = entry.identity, conditionIdentity = condition.identity;
const primaryIdentity = entry.keys[0]?.identity, checkIdentity = entry.constraints[0]?.identity;
if (primaryIdentity === undefined || checkIdentity === undefined) throw new Error("Missing constraint failure identities");
const expectedPrimary = primaryIdentity, expectedCheck = checkIdentity;
const decodeInput = Schema.decodeUnknownEffect(Schema.Struct({ mode: Schema.Literals(["seed", "history", "primary", "activeScope", "activeSegment", "composite", "check"]), caught: Schema.Boolean }));
// Decode the cold host's JSON presentation, not its storage acceptance rules.
const decodeColdRead = Schema.decodeUnknownEffect(Schema.Struct({
  entries: Schema.Array(Schema.Struct({ id: Schema.String, scope: Schema.String, segment: Schema.NullOr(Schema.String),
    deleted_at: Schema.NullOr(Schema.String), amount: Schema.NullOr(Schema.Number), label: Schema.String, code: Schema.String })),
  conditions: Schema.Array(Schema.Struct({ id: Schema.String, entry_id: Schema.String, reference: Schema.String,
    reference_id: Schema.String, deleted_at: Schema.NullOr(Schema.String) })),
}).annotate({ parseOptions: { onExcessProperty: "error" } }));

function typedFailure<Value>(exit: Exit.Exit<Value, CommerceTransactionError>, reason: CommerceTransactionError["reason"]) {
  if (Exit.isSuccess(exit)) throw new Error("Expected constraint failure");
  expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
  const first = exit.cause.reasons[0];
  if (first === undefined || !Cause.isFailReason(first)) throw new Error("Expected typed failure only");
  expect(first.error.reason).toBe(reason);
  return first.error;
}

/** Genuine admission, storage rejection, rollback and cold reads. This fixture
 * supplies inputs and inspects private evidence; it implements no row checks,
 * unique matching, settlement, or replacement durable inventory logic. */
export async function relationalConstraintFailureScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence: origin,
      definition: { kind: "relational", schema }, bindings: ["entry", "condition"].map(localName => ({ kind: "definition", localName,
        table: { namespace: "medusa", logicalName: origin.sourceId + "/" + localName } })) }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-reference-checkpoint", sources: [source] });
    const auditRole = async () => {
      if (driver === "postgres") expect((await fixture.persistence.query(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
        .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    };
    await auditRole();
    const read = defineCommerceCommand("constraintRead", "read", ctx => Effect.gen(function* () {
      return { entries: [...yield* (yield* ctx.table("entry")).prepareRead({ order: { column: "id", direction: "asc" }, take: 8 }).find(ctx.manager)],
        conditions: [...yield* (yield* ctx.table("condition")).prepareRead({ order: { column: "id", direction: "asc" }, take: 8 }).find(ctx.manager)] };
    }));
    const issued = new Map<string, CommerceTransactionError>(), definitions = new Map<string, number>();
    let rescued = 0;
    const change = defineCommerceCommand("constraintChange", "write", (ctx, input) => Effect.gen(function* () {
      const { mode, caught } = yield* decodeInput(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const entries = yield* ctx.table("entry"), conditions = yield* ctx.table("condition");
      if (mode === "seed") {
        yield* entries.write(ctx.manager, "insert", [{ id: "base", scope: "us", amount: 1.0000000596046448 }, { id: "segment", scope: "us", segment: "ca" }]);
        yield* conditions.write(ctx.manager, "insert", [{ id: "condition", entry_id: "base", reference: "group", reference_id: "one" }]);
        return null;
      }
      if (mode === "history") {
        const deleted_at = "2026-10-24T00:00:00.000Z";
        yield* entries.write(ctx.manager, "insert", [{ id: "historical", scope: "us", deleted_at }]);
        yield* conditions.write(ctx.manager, "insert", [{ id: "historical-condition", entry_id: "base", reference: "group", reference_id: "one", deleted_at }]);
        return null;
      }
      // A successful earlier write must also disappear when the later genuine
      // constraint rejection poisons the root, including when caught locally.
      yield* entries.write(ctx.manager, "insert", [{ id: "tentative", scope: "gb", segment: "pending" }]);
      const candidate: JsonObject = mode === "primary" ? { id: "base", scope: "gb" }
        : mode === "activeScope" ? { id: "rejected", scope: "us" }
        : mode === "activeSegment" ? { id: "rejected", scope: "us", segment: "ca" }
        : mode === "composite" ? { id: "rejected", entry_id: "base", reference: "group", reference_id: "one" }
        : { id: "rejected", scope: "gb", segment: "check", amount: 1.0000000596046448, code: "invalid" };
      const rejected = yield* Effect.exit((mode === "composite" ? conditions : entries).write(ctx.manager, "insert", [candidate]));
      const failure = typedFailure(rejected, "invalidInput");
      const evidence = inspectLogicalRelationalFailure(failure);
      if (evidence === undefined) return yield* Effect.die(new Error("Missing storage-issued constraint evidence"));
      expect(evidence.table).toEqual(mode === "composite" ? conditionIdentity : entryIdentity);
      expect(Object.isFrozen(evidence)).toBe(true); expect(Object.isFrozen(evidence.table)).toBe(true);
      expect(Object.isFrozen(evidence.candidate)).toBe(true);
      if (mode === "check") {
        if (evidence.kind !== "check") return yield* Effect.die(new Error("Expected CHECK evidence"));
        expect(evidence).toMatchObject({ origin: "row", kind: "check", column: "code", constraint: expectedCheck });
        // Same decimal-midpoint wire result as storage/relationalSchema/realScenario.ts.
        expect(evidence.candidate).toEqual({ id: "rejected", scope: "gb", segment: "check", amount: 1.0000001, code: "invalid", deleted_at: null, label: "default" });
      } else {
        if (evidence.kind !== "unique") return yield* Effect.die(new Error("Expected unique evidence"));
        expect(Object.isFrozen(evidence.key)).toBe(true); expect(Object.isFrozen(evidence.columns)).toBe(true); expect(Object.isFrozen(evidence.values)).toBe(true);
        if (mode === "primary") {
          expect(evidence).toEqual({ origin: "input", kind: "unique", table: entryIdentity,
            key: { kind: "primary", identity: expectedPrimary }, columns: ["id"], values: ["base"], candidate });
          expect(Object.hasOwn(evidence.candidate ?? {}, "label")).toBe(false);
        } else {
          expect(evidence.origin).toBe("row"); expect(evidence.key.kind).toBe("unique");
          if (evidence.key.kind !== "unique") return yield* Effect.die(new Error("Expected actual catalog unique identity"));
          const definition = evidence.key.definitionId;
          expect(Number.isSafeInteger(definition)).toBe(true); expect(definition).toBeGreaterThan(0);
          const previous = definitions.get(mode); if (previous !== undefined) expect(definition).toBe(previous);
          definitions.set(mode, definition);
          expect(evidence.columns).toEqual(mode === "activeScope" ? ["scope"] : mode === "activeSegment" ? ["scope", "segment"] : ["entry_id", "reference", "reference_id"]);
          expect(evidence.values).toEqual(mode === "activeScope" ? ["us"] : mode === "activeSegment" ? ["us", "ca"] : ["base", "group", "one"]);
          expect(evidence.candidate).toEqual(mode === "composite" ? { ...candidate, deleted_at: null }
            : { segment: null, deleted_at: null, amount: null, label: "default", code: "allowed", ...candidate });
        }
      }
      expect(Object.hasOwn(failure, "constraint")).toBe(false);
      for (const copy of [{ ...failure }, { cause: failure }, JSON.parse(JSON.stringify(failure)), Object.freeze(new Error("copied"))])
        expect(inspectLogicalRelationalFailure(copy)).toBeUndefined();
      issued.set(mode + "/" + caught, failure);
      if (caught) {
        typedFailure(yield* Effect.exit(entries.write(ctx.manager, "insert", [{ id: "rescue", scope: "fr" }])), "rollbackOnly");
        rescued++; return null;
      }
      if (Exit.isSuccess(rejected)) return yield* Effect.die(new Error("Expected full failed Cause"));
      return yield* Effect.failCause(rejected.cause);
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence: origin },
      initialization: { stepId: "constraint-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-constraint-failure" } };
    const coldRead = Effect.fn("ConstraintFailure.coldRead")(function* () {
      const value = yield* Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }), host => host.read(read, null), host => host.close);
      return yield* decodeColdRead(value).pipe(Effect.orDie);
    });
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }), host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("constraintFailure");
    const root = defineAtomicCommerceCommand("constraintRoot", (ctx, input) => ctx.call(participant, change, input));
    let acceptedCalls = 0;
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.sync(() => {
      expect(command).toBe(change); expect(call.events).toEqual([]);
      expect(call.input).toMatchObject({ mode: acceptedCalls === 0 ? "seed" : "history", caught: false });
      expect(activity.mutations).toHaveLength(acceptedCalls === 0 ? 3 : 2);
      expect(activity.mutations.every(item => item.operation === "insert")).toBe(true);
      expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
      acceptedCalls++;
    });
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...input, commands: [root],
      participants: [{ participant, logicalStorage, commands: [change], validateLogicalCall }] }), host => Effect.gen(function* () {
      yield* host.run(host.newRequestKey(), root, { mode: "seed", caught: false });
      const baseline = yield* logicalCommerceInventory(fixture.persistence.drizzle), expectedRows = yield* coldRead();
      expect(expectedRows.entries).toHaveLength(2); expect(expectedRows.conditions).toHaveLength(1);
      expect(expectedRows.entries.find(row => row.id === "base")?.amount).toBe(1.0000001);
      for (const mode of ["primary", "activeScope", "activeSegment", "composite", "check"] as const) for (const caught of [false, true]) {
        const exit = yield* Effect.exit(host.run(host.newRequestKey(), root, { mode, caught }));
        typedFailure(exit, caught ? "rollbackOnly" : "invalidInput");
        const failure = issued.get(mode + "/" + caught);
        if (failure === undefined) return yield* Effect.die(new Error("Missing actual failure identity"));
        if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === failure)).toBe(true);
        expect(yield* logicalCommerceInventory(fixture.persistence.drizzle)).toEqual(baseline);
        expect(yield* coldRead()).toEqual(expectedRows);
      }
      expect(new Set(definitions.values()).size).toBe(3); expect(rescued).toBe(5); expect(acceptedCalls).toBe(1);
      yield* host.run(host.newRequestKey(), root, { mode: "history", caught: false });
      const after = yield* coldRead(); expect(after.entries).toHaveLength(3); expect(after.conditions).toHaveLength(2); expect(acceptedCalls).toBe(2);
    }), host => host.close));
    await auditRole();
  } finally { for (const close of cleanup.reverse()) await close(); }
}