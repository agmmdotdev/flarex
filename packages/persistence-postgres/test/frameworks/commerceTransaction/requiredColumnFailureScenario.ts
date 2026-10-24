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

const sourceKey = "medusa.neutral-required-column";
const evidence = { kind: "synthetic", sourceId: "neutral-required-column" };
const origin = evidence;
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, capabilities: [], tables: [
  { tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "code", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "amount", type: "real", nullable: true, default: { kind: "none" }, origin },
    { columnId: "label", type: "text", nullable: false, default: { kind: "textLiteral", value: "default" }, origin },
    { columnId: "metadata", type: "jsonb", nullable: false, default: { kind: "emptyJsonObject" }, origin },
    { columnId: "created_at", type: "timestamptz", nullable: false, default: { kind: "currentTimestamp" }, origin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] },
] }));
const tableDefinition = schema.tables[0];
if (tableDefinition === undefined) throw new Error("Missing required-column source table");
const tableIdentity = tableDefinition.identity;
const decodeMode = Schema.decodeUnknownEffect(Schema.Literals(["seed", "null", "missing", "caughtNull", "caughtMissing"]));

function requireTypedFailure<Value>(exit: Exit.Exit<Value, CommerceTransactionError>, reason: CommerceTransactionError["reason"]) {
  if (Exit.isSuccess(exit)) throw new Error("Expected the required-column operation to fail");
  expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
  const first = exit.cause.reasons[0];
  if (first === undefined || !Cause.isFailReason(first)) throw new Error("Expected typed failure without defects or interruption");
  expect(first.error.reason).toBe(reason);
  return first.error;
}

/** Actual row rejection and atomic settlement. This consumer only supplies
 * values and inspects storage-issued evidence, never validates required fields. */
export async function requiredColumnFailureScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "entry",
        table: { namespace: "medusa", logicalName: evidence.sourceId + "/entry" } }] }));
    // This existing fixture name selects setup identity; the captured source
    // above remains the schema and value authority for this independent fixture.
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close),
      { name: "neutral-reference-checkpoint", sources: [source] });
    const auditRole = async () => {
      if (driver === "postgres") expect((await fixture.persistence.query(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
        .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    };
    await auditRole();
    const read = defineCommerceCommand("requiredColumnRead", "read", ctx => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("entry")).prepareRead({ order: { column: "id", direction: "asc" }, take: 4 }).find(ctx.manager)];
    }));
    const issued = new Map<string, CommerceTransactionError>();
    let rescued = 0;
    const change = defineCommerceCommand("requiredColumnChange", "write", (ctx, input) => Effect.gen(function* () {
      const mode = yield* decodeMode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const table = yield* ctx.table("entry");
      if (mode === "seed") return [...yield* table.write(ctx.manager, "insert", [{ id: "seed", code: "valid" }])];
      const earlier = (yield* table.write(ctx.manager, "insert", [{ id: "tentative-" + mode, code: "pending" }]))[0];
      if (earlier === undefined || typeof earlier.created_at !== "string") return yield* Effect.die(new Error("Missing actual accepting timestamp"));
      const isNull = mode === "null" || mode === "caughtNull";
      const metadata = { retained: true };
      const candidate: JsonObject = isNull ? { id: "rejected-" + mode, code: null, amount: 1.0000000596046448, metadata }
        : { id: "rejected-" + mode, amount: 1.0000000596046448 };
      const rejected = yield* Effect.exit(table.write(ctx.manager, "insert", [candidate]));
      const failure = requireTypedFailure(rejected, "invalidInput");
      const provenance = inspectLogicalRelationalFailure(failure);
      expect(provenance).toMatchObject({ origin: isNull ? "input" : "row", kind: isNull ? "null" : "missing",
        table: tableIdentity, column: "code" });
      const expected = isNull ? { id: "rejected-" + mode, code: null, amount: 1.0000000596046448, metadata: { retained: true } }
        : { id: "rejected-" + mode, amount: 1.0000000596046448, label: "default", metadata: {}, created_at: earlier.created_at };
      metadata.retained = false;
      expect(provenance?.candidate).toEqual(expected);
      expect(Object.isFrozen(provenance?.candidate)).toBe(true);
      expect(Object.isFrozen(provenance?.candidate?.metadata)).toBe(true);
      if (isNull) expect(Object.hasOwn(provenance?.candidate ?? {}, "label")).toBe(false);
      else expect(Object.hasOwn(provenance?.candidate ?? {}, "code")).toBe(false);
      for (const copy of [{ ...failure }, { cause: failure }, JSON.parse(JSON.stringify(failure))])
        expect(inspectLogicalRelationalFailure(copy)).toBeUndefined();
      issued.set(mode, failure);
      if (mode === "caughtNull" || mode === "caughtMissing") {
        requireTypedFailure(yield* Effect.exit(table.write(ctx.manager, "insert", [{ id: "rescue-" + mode, code: "too-late" }])), "rollbackOnly");
        rescued++;
        return null;
      }
      if (Exit.isSuccess(rejected)) return yield* Effect.die(new Error("Expected retained failure Cause"));
      return yield* Effect.failCause(rejected.cause);
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "required-column-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-required-column" } };
    const coldRead = Effect.fn("RequiredColumn.coldRead")(function* () {
      return yield* Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }),
        host => host.read(read, null), host => host.close);
    });
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("requiredColumn");
    const root = defineAtomicCommerceCommand("requiredColumnRoot", (ctx, mode) => ctx.call(participant, change, mode));
    let successfulCalls = 0;
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.sync(() => {
      expect(command).toBe(change); expect(call.input).toBe("seed"); expect(call.events).toEqual([]);
      expect(activity.mutations).toHaveLength(1); expect(activity.mutations[0]).toMatchObject({ table: "entry", operation: "insert" });
      expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
      successfulCalls++;
    });
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...input, commands: [root],
      participants: [{ participant, logicalStorage, commands: [change], validateLogicalCall }] }), host => Effect.gen(function* () {
      const initial = yield* logicalCommerceInventory(fixture.persistence.drizzle);
      expect(yield* coldRead()).toEqual([]);
      for (const mode of ["null", "missing", "caughtNull", "caughtMissing"] as const) {
        const exit = yield* Effect.exit(host.run(host.newRequestKey(), root, mode));
        requireTypedFailure(exit, mode === "caughtNull" || mode === "caughtMissing" ? "rollbackOnly" : "invalidInput");
        const original = issued.get(mode);
        if (original === undefined) return yield* Effect.die(new Error("Missing storage-issued failure"));
        if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
        const required = inspectLogicalRelationalFailure(original);
        if (required?.kind !== "missing" && required?.kind !== "null") return yield* Effect.die(new Error("Expected required-column evidence"));
        expect(required.column).toBe("code");
        expect(yield* logicalCommerceInventory(fixture.persistence.drizzle)).toEqual(initial);
        expect(yield* coldRead()).toEqual([]);
      }
      expect(rescued).toBe(2); expect(successfulCalls).toBe(0);
      yield* host.run(host.newRequestKey(), root, "seed");
      expect(successfulCalls).toBe(1);
      expect(yield* coldRead()).toEqual([{ id: "seed", code: "valid", amount: null, label: "default", metadata: {}, created_at: expect.any(String) }]);
      const committed = yield* logicalCommerceInventory(fixture.persistence.drizzle);
      expect(committed.rows).toHaveLength(initial.rows.length + 1);
      expect(committed.revisions).toHaveLength(initial.revisions.length + 1);
      expect(committed.commits).toHaveLength(initial.commits.length + 1);
      expect(committed.events).toEqual(initial.events);
    }), host => host.close));
    await auditRole();
  } finally { for (const close of cleanup.reverse()) await close(); }
}
