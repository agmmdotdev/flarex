import { count, eq } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { logicalCurrencyFixture } from "../../../../medusa-adapter/test/support/logical-currency-fixture";
import { selectApplicationMutationAdmission } from "../../../src/application/applicationMutationAdmission";
import { createApplicationMutationSessionActivationPersistenceV1 } from "../../../src/execution/session/activation";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import { makeBorrowedWorkflowAttempt } from "../../../src/frameworks/commerceTransaction/borrowedWorkflowAttempt";
import { inspectLogicalParticipantAdmissionBundle } from "../../../src/storage/documents/logicalDocuments/participantAdmission";
import { fxSystemTransactionJournals, fxSystemTransactionJournalReceipts } from "../../../src/database/schema";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { applicationMutationActivationFixture } from "../../application/applicationMutationActivationFixture";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../../execution/session/support/activationEvidence";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect, vi } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { inspectLogicalRelationalFailure } from "../../../src/frameworks/commerceTransaction/commerceAdapter";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceParticipants, type LogicalCommerceCallValidation, type LogicalCommerceEventValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { captureAtomicCommerceConfiguration, prepareAtomicCommerceConfiguration } from "../../../src/frameworks/atomicCommerce/configuration";
import { defineCommerceEventContract } from "../../../src/frameworks/atomicCommerce/events";
import { prepareCurrentApplicationBinding } from "../../../src/application/activation/currentBinding";
import { readRelationalSessionCoLocatedInstallation } from "../../../src/database/relationalTransaction/session";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import * as realOwner from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";
import { logicalCommerceInventory } from "../commerceTransaction/logicalCommerceInventory";

const sourceKey = "medusa.neutral-participant-insert-validation";
const origin = { kind: "synthetic", sourceId: "neutral-participant-insert-validation" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: ["entry", "later"].map(tableId => ({ tableId, origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "code", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "name", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "scope", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "note", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "amount", type: "real", nullable: true, default: { kind: "none" }, origin },
    { columnId: "count", type: "integer", nullable: false, default: { kind: "integerLiteral", value: 7 }, origin },
    { columnId: "enabled", type: "boolean", nullable: false, default: { kind: "booleanLiteral", value: false }, origin },
    { columnId: "label", type: "text", nullable: false, default: { kind: "textLiteral", value: "default" }, origin },
    { columnId: "metadata", type: "jsonb", nullable: false, default: { kind: "emptyJsonObject" }, origin },
    { columnId: "ticket", type: "integer", nullable: false, default: { kind: "serialNext" }, origin },
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
      default: { kind: "currentTimestamp" }, origin })),
  ], keys: [{ keyId: tableId + ".primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: tableId + ".scope", kind: "uniqueBtree", columns: ["scope"], predicate: null, origin }],
  constraints: [{ constraintId: tableId + ".count", kind: "integerRange", columnId: "count", minimum: 0, maximum: 10, origin }],
  relationships: [] })), capabilities: [],
}));
// The timestamp correlation row uses a separate source table with no REAL or
// serial fields, so its accepted write cannot satisfy the conversion spy.
const markerOrigin = { kind: "synthetic", sourceId: "neutral-participant-insert-marker" };
const markerSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: markerOrigin.sourceId,
  tables: [{ tableId: "marker", origin: markerOrigin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin: markerOrigin },
    { columnId: "created_at", type: "timestamptz", nullable: false, default: { kind: "currentTimestamp" }, origin: markerOrigin },
  ], keys: [{ keyId: "marker.primary", kind: "primary", columns: ["id"], origin: markerOrigin }], indexes: [], constraints: [], relationships: [] }], capabilities: [],
}));
const decodeInput = Schema.decodeUnknownEffect(Schema.Struct({ label: Schema.String, caught: Schema.Boolean,
  groups: Schema.Array(Schema.Struct({ table: Schema.Literals(["entry", "later"]), rows: Schema.Array(Schema.JsonObject) })) }), { onExcessProperty: "error" });
const decodeEvent = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String }), { onExcessProperty: "error" });
const decodeRead = Schema.decodeUnknownEffect(Schema.Struct({ entries: Schema.Array(Schema.JsonObject), later: Schema.Array(Schema.JsonObject) }));
const revision = "e".repeat(64);
const event = defineCommerceEventContract({ name: "neutral.insert-validation", revision, internal: true,
  decode: value => decodeEvent(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause))) });
type Group = Readonly<{ table: "entry" | "later"; rows: readonly JsonObject[] }>;
type Expected = Readonly<{ kind: "missing" | "null"; table: "entry" | "later"; column: string; row: JsonObject; complete: boolean }>
  | Readonly<{ kind: "unique"; table: "entry" | "later"; key: "primary" | "unique"; values: readonly string[] }>
  | Readonly<{ kind: "check"; table: "entry" | "later" }> | Readonly<{ kind: "real" }> | Readonly<{ kind: "scalar" }>;

function typedFailure<Value>(exit: Exit.Exit<Value, CommerceTransactionError>, reason: CommerceTransactionError["reason"]) {
  if (Exit.isSuccess(exit)) throw new Error("Insert validation unexpectedly succeeded");
  expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
  const first = exit.cause.reasons[0];
  if (first === undefined || !Cause.isFailReason(first)) throw new Error("Expected typed failure without defects or interruption");
  expect(first.error.reason).toBe(reason);
  return first.error;
}

const preparedPolicy = Effect.fn("ParticipantInsertValidation.preparedPolicy")(function* (input: AtomicCommerceHostInput<unknown>, afterCapture?: () => void) {
  return yield* Effect.acquireUseRelease(retainPreparedHost(input.hostRuntime, Effect.gen(function* () {
    const captured = yield* captureAtomicCommerceConfiguration(input);
    if (afterCapture !== undefined) yield* Effect.sync(afterCapture);
    return yield* prepareCurrentApplicationBinding(captured.application, captured.database,
      (binding, context) => prepareAtomicCommerceConfiguration(captured, binding, context.authority), {
        selection: { deploymentId: captured.deploymentId, scopeId: captured.scopeId },
        installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(captured.session, captured.database)),
      });
  })), retained => retained.use(preparation => preparation.withFiniteEntry(({ payload }) => Effect.succeed({
    digest: payload.identityDigest, policies: payload.members.map(member => member.insertValidation ?? null),
  }))), retained => retained.close);
});

/** Supplies rows to genuine admission, writes, conversion, constraints and
 * settlement; the fixture neither validates nor implements storage behavior. */
export async function participantInsertValidationScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence: origin,
      definition: { kind: "relational", schema }, bindings: ["entry", "later"].map(localName => ({ kind: "definition", localName,
        table: { namespace: "medusa", logicalName: origin.sourceId + "/" + localName } })) }));
    const markerKey = sourceKey + ".marker";
    const markerSource = await Effect.runPromise(captureLogicalSchemaSource({ key: markerKey, owner: "medusa", writeProfile: markerKey, evidence: markerOrigin,
      definition: { kind: "relational", schema: markerSchema }, bindings: [{ kind: "definition", localName: "marker",
        table: { namespace: "medusa", logicalName: markerOrigin.sourceId + "/marker" } }] }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close),
      { name: "neutral-reference-checkpoint", sources: [source, markerSource] });
    const auditRole = async () => {
      if (driver === "postgres") expect((await fixture.persistence.query(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
        .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    };
    await auditRole();
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence: origin },
      initialization: { stepId: "insert-validation-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const markerStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: markerKey, writeProfile: markerKey, schema: markerSchema, evidence: markerOrigin },
      initialization: { stepId: "insert-marker-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: sourceKey } };
    const read = defineCommerceCommand("insertValidationRead", "read", ctx => Effect.gen(function* () {
      return { entries: [...yield* (yield* ctx.table("entry")).prepareRead({ order: { column: "id", direction: "asc" }, take: 8 }).find(ctx.manager)],
        later: [...yield* (yield* ctx.table("later")).prepareRead({ order: { column: "id", direction: "asc" }, take: 8 }).find(ctx.manager)] };
    }));
    const markerRead = defineCommerceCommand("insertValidationMarkerRead", "read", ctx => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("marker")).prepareRead({ order: { column: "id", direction: "asc" }, take: 8 }).find(ctx.manager)];
    }));
    const stamp = defineCommerceCommand("insertValidationStamp", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("marker");
      const rows = yield* table.write(ctx.manager, "insert", [{ id: "tentative" }]);
      expect(yield* table.prepareRead({ order: { column: "id", direction: "asc" }, take: 8 }).find(ctx.manager)).toEqual(rows);
      const createdAt = rows[0]?.created_at;
      if (typeof createdAt !== "string") return yield* Effect.die(new Error("Missing accepting transaction timestamp"));
      return createdAt;
    }));
    const observations = new Map<string, Readonly<{ failure: CommerceTransactionError; stamp: string; realConversions: number }>>();
    let currentStamp = "";
    let conversionCount = () => 0;
    let rescues = 0;
    const change = defineCommerceCommand("insertValidationChange", "write", (ctx, value) => Effect.gen(function* () {
      const data = yield* decodeInput(value).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const rescueTable = yield* ctx.table("entry");
      let conversionsBeforeGroup = conversionCount();
      const rejected = yield* Effect.exit(Effect.gen(function* () {
        for (const group of data.groups) {
          conversionsBeforeGroup = conversionCount();
          yield* (yield* ctx.table(group.table)).write(ctx.manager, "insert", group.rows);
        }
      }));
      if (Exit.isSuccess(rejected)) return null;
      const failure = typedFailure(rejected, "invalidInput");
      observations.set(data.label, { failure, stamp: currentStamp, realConversions: conversionCount() - conversionsBeforeGroup });
      if (data.caught) {
        typedFailure(yield* Effect.exit(rescueTable.write(ctx.manager, "insert", [{ id: "rescue", code: "valid", name: "Too late" }])), "rollbackOnly");
        rescues++;
        return null;
      }
      return yield* Effect.failCause(rejected.cause);
    }));
    const seed = defineCommerceCommand("insertValidationSeed", "write", ctx => Effect.gen(function* () {
      for (const table of ["entry", "later"]) yield* (yield* ctx.table(table)).write(ctx.manager, "insert", [{ id: "seed", code: "valid", name: "Seed", scope: "occupied" }]);
      return null;
    }));
    const participant = defineAtomicCommerceParticipant("insertValidation");
    const markerParticipant = defineAtomicCommerceParticipant("insertMarker");
    const root = defineAtomicCommerceCommand("insertValidationRoot", (ctx, value) => Effect.gen(function* () {
      yield* ctx.emit(event, { id: "attempt" });
      const createdAt = yield* ctx.call(markerParticipant, stamp, null);
      if (typeof createdAt !== "string") return yield* Effect.die(new Error("Marker lost timestamp"));
      currentStamp = createdAt;
      return yield* ctx.call(participant, change, value);
    }));
    const seedRoot = defineAtomicCommerceCommand("insertValidationSeedRoot", ctx => ctx.call(participant, seed, null));
    let acceptedChanges = 0;
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.sync(() => {
      expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
      expect(call.events).toEqual([]);
      expect(command === seed || command === change).toBe(true);
      expect(activity.mutations).toHaveLength(command === seed ? 2 : 1);
      expect(activity.mutations.every(mutation => mutation.operation === "insert")).toBe(true);
      if (command === change) acceptedChanges++;
    });
    const member = { participant, logicalStorage, commands: [seed, change], validateLogicalCall };
    const markerMember = { participant: markerParticipant, logicalStorage: markerStorage, commands: [stamp] };
    const hostInput = { ...input, commands: [root, seedRoot], participants: [member, markerMember],
      events: { producerRevision: revision, contracts: [event], subscribers: [{ id: "insert-validation", revision }],
        validate: () => Effect.void } };
    const selectedInput = { ...hostInput, participants: [{ ...member, insertValidation: "entityBatch" as const }, markerMember] };
    const coldRead = Effect.fn("ParticipantInsertValidation.coldRead")(function* () {
      const rows = yield* Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }), host => host.read(read, null), host => host.close);
      const markers = yield* Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage: markerStorage, commands: [markerRead] }), host => host.read(markerRead, null), host => host.close);
      return { ...yield* decodeRead(rows).pipe(Effect.orDie), markers };
    });
    for (const selection of [logicalStorage, markerStorage]) await Effect.runPromise(Effect.acquireUseRelease(
      makeCommerceHost({ ...input, logicalStorage: selection, commands: [read] }), host => host.initialize([]), host => host.close));
    const inventory = () => logicalCommerceInventory(fixture.persistence.drizzle);
    await Effect.runPromise(Effect.gen(function* () {
      const omitted = yield* preparedPolicy(hostInput);
      const ownUndefined = { ...member };
      Object.defineProperty(ownUndefined, "insertValidation", { value: undefined, enumerable: true });
      expect(Object.hasOwn(ownUndefined, "insertValidation")).toBe(true);
      expect(yield* preparedPolicy({ ...hostInput, participants: [ownUndefined, markerMember] })).toEqual(omitted);
      const selected = yield* preparedPolicy(selectedInput);
      expect(selected.digest).not.toEqual(omitted.digest);
      expect(selected.policies.filter(policy => policy === "entityBatch")).toHaveLength(1);
      const mutable = { ...member, insertValidation: "entityBatch" as const };
      expect(yield* preparedPolicy({ ...hostInput, participants: [mutable, markerMember] }, () => { Reflect.deleteProperty(mutable, "insertValidation"); })).toEqual(selected);
      expect(Object.hasOwn(mutable, "insertValidation")).toBe(false);
      expect(yield* preparedPolicy({ ...hostInput, participants: [mutable, markerMember] })).toEqual(omitted);
      const beforeAdmission = yield* inventory();
      const { validateLogicalCall: _perCall, ...withoutReceipt } = member;
      let aggregates = 0;
      const validateLogical: LogicalCommerceEventValidation = () => Effect.sync(() => { aggregates++; });
      for (const unsupported of [{ ...withoutReceipt, insertValidation: "entityBatch" as const },
        { ...withoutReceipt, insertValidation: "entityBatch" as const, validateLogical }]) {
        typedFailure(yield* Effect.exit(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, participants: [unsupported, markerMember] }),
          () => Effect.die(new Error("Selected insert validation admitted without per-call receipts")), host => host.close)), "unsupportedProfile");
      }
      expect(aggregates).toBe(0);
      const malformed = { ...member };
      Object.defineProperty(malformed, "insertValidation", { value: "foreign-mode", enumerable: true });
      expect(captureAtomicCommerceParticipants([malformed])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      const withoutLogicalSource = { ...member };
      Reflect.deleteProperty(withoutLogicalSource, "logicalStorage");
      expect(Result.isSuccess(captureAtomicCommerceParticipants([withoutLogicalSource]))).toBe(true);
      Object.defineProperty(withoutLogicalSource, "insertValidation", { value: "entityBatch", enumerable: true });
      expect(captureAtomicCommerceParticipants([withoutLogicalSource])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(yield* inventory()).toEqual(beforeAdmission);
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost(selectedInput), host => host.run(host.newRequestKey(), seedRoot, null), host => host.close);
      const baseline = yield* inventory(), beforeRows = yield* coldRead();
      expect(beforeRows.entries).toHaveLength(1); expect(beforeRows.later).toHaveLength(1); expect(beforeRows.markers).toEqual([]);
      expect(beforeRows.entries[0]?.ticket).toBe(1); expect(beforeRows.later[0]?.ticket).toBe(1);
      const conversion = vi.spyOn(realOwner, "executeLogicalRelationalRealBatch");
      conversionCount = () => conversion.mock.calls.length;
      try {
        for (const selection of ["entityBatch", "default"] as const) {
          yield* Effect.acquireUseRelease(makeAtomicCommerceHost(selection === "entityBatch" ? selectedInput : hostInput), host => Effect.gen(function* () {
            const check = Effect.fn("ParticipantInsertValidation.check")(function* (label: string, groups: readonly Group[], expected: Expected, caught = false) {
              conversion.mockClear();
              const args = { label: selection + "/" + label, caught, groups: groups.map(group => ({ table: group.table, rows: [...group.rows] })) };
              const outcome = yield* Effect.exit(host.run(host.newRequestKey(), root, args));
              typedFailure(outcome, caught ? "rollbackOnly" : "invalidInput");
              const observed = observations.get(args.label);
              if (observed === undefined) return yield* Effect.die(new Error("Missing actual rejection " + args.label));
              if (Exit.isFailure(outcome)) expect(outcome.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === observed.failure), args.label).toBe(true);
              const evidence = inspectLogicalRelationalFailure(observed.failure);
              if (expected.kind === "real" || expected.kind === "scalar") expect(evidence, args.label).toBeUndefined();
              else {
                if (evidence === undefined) return yield* Effect.die(new Error("Missing authentic relational evidence " + args.label));
                const expectedTable = expected.table;
                expect(evidence.table, args.label).toEqual(schema.tables.find(table => table.identity.tableId === expectedTable)?.identity);
                expect(evidence.kind, args.label).toBe(expected.kind);
                expect(Object.isFrozen(evidence)).toBe(true); expect(Object.isFrozen(evidence.candidate)).toBe(true);
                if (expected.kind === "missing" || expected.kind === "null") {
                  expect(evidence).toMatchObject({ kind: expected.kind, column: expected.column, origin: expected.kind === "missing" ? "row" : "input" });
                  if (expected.complete) {
                    const pending = { amount: null, count: 7, enabled: false, label: "default", metadata: {}, note: null, scope: null,
                      created_at: observed.stamp, updated_at: observed.stamp, ...expected.row };
                    expect(evidence.candidate, args.label).toEqual(pending);
                    expect(Object.keys(evidence.candidate ?? {}).sort()).toEqual(Object.keys(pending).sort());
                    expect(Object.hasOwn(evidence.candidate ?? {}, "ticket")).toBe(false);
                    expect(observed.realConversions, args.label).toBe(0);
                  } else expect(evidence.candidate).toEqual(expected.row);
                } else if (expected.kind === "unique") {
                  if (evidence.kind !== "unique") return yield* Effect.die(new Error("Wrong unique evidence"));
                  expect(evidence.key.kind).toBe(expected.key); expect(evidence.values).toEqual(expected.values);
                  expect(evidence.columns).toEqual(expected.key === "primary" ? ["id"] : ["scope"]);
                } else {
                  expect(evidence).toMatchObject({ kind: "check", origin: "row", column: "count", candidate: { amount: 1.0000001, count: 11, code: "valid", name: "Rejected" } });
                  expect(conversion).toHaveBeenCalled();
                }
                const candidate = evidence.candidate;
                if (candidate !== undefined) {
                  expect(Reflect.set(candidate, "name", "tampered")).toBe(false);
                  if (candidate.metadata !== null && typeof candidate.metadata === "object") {
                    expect(Object.isFrozen(candidate.metadata)).toBe(true);
                    expect(Reflect.set(candidate.metadata, "tampered", true)).toBe(false);
                  }
                  expect(inspectLogicalRelationalFailure(observed.failure)?.candidate).toBe(candidate);
                }
              }
              const getter = vi.fn();
              const foreign = Object.freeze(Object.defineProperty({}, "cause", { get: getter }));
              for (const copy of [{ ...observed.failure }, { cause: observed.failure }, JSON.parse(JSON.stringify(observed.failure)), foreign])
                expect(inspectLogicalRelationalFailure(copy)).toBeUndefined();
              expect(getter).not.toHaveBeenCalled();
              expect(acceptedChanges, args.label).toBe(0);
              expect(yield* inventory(), args.label).toEqual(baseline);
              expect(yield* coldRead(), args.label).toEqual(beforeRows);
            });
            const missing: JsonObject = { id: "seed", name: "Missing code", amount: 1.0000000596046448 };
            const nullCode: JsonObject = { id: "seed", code: null, name: "Null code", metadata: { retained: true } };
            const missingLater: JsonObject = { id: "later-missing", name: "Missing later", count: 11, amount: 1.0000000596046448 };
            const collision: JsonObject = { id: "seed", code: "valid", name: "Rejected" };
            const secondary: JsonObject = { id: "fresh", code: "valid", name: "Rejected", scope: "occupied" };
            const primary: Expected = { kind: "unique", table: "entry", key: "primary", values: ["seed"] };
            const required = (row: JsonObject, table: "entry" | "later" = "entry", column = "code", kind: "missing" | "null" = "missing"): Expected =>
              ({ kind, table, column, row, complete: selection === "entityBatch" });
            yield* check("existing-id-missing", [{ table: "entry", rows: [missing] }], selection === "entityBatch" ? required(missing) : primary);
            yield* check("existing-id-null", [{ table: "entry", rows: [nullCode] }], required(nullCode, "entry", "code", "null"));
            yield* check("earlier-primary-later-required", [{ table: "entry", rows: [collision, missingLater] }], selection === "entityBatch" ? required(missingLater) : primary);
            yield* check("earlier-secondary-later-required", [{ table: "entry", rows: [secondary, missingLater] }], selection === "entityBatch" ? required(missingLater)
              : { kind: "unique", table: "entry", key: "unique", values: ["occupied"] });
            const checked = { ...collision, amount: 1.0000000596046448, count: 11 };
            yield* check("check-before-existing-id", [{ table: "entry", rows: [checked] }], selection === "entityBatch" ? { kind: "check", table: "entry" } : primary);
            yield* check("real-before-existing-id", [{ table: "entry", rows: [{ ...collision, amount: 1e40 }] }], selection === "entityBatch" ? { kind: "real" } : primary);
            const invalidScalar = { id: "bad-scalar", code: "valid", name: "Invalid count", count: "invalid" };
            yield* check("earlier-scalar-later-required", [{ table: "entry", rows: [invalidScalar, missingLater] }],
              selection === "entityBatch" ? required(missingLater) : { kind: "scalar" });
            const missingWithInvalidScalar = { id: "missing-and-scalar", name: "Missing code", amount: "invalid" };
            yield* check("same-row-required-before-scalar", [{ table: "entry", rows: [missingWithInvalidScalar] }],
              selection === "entityBatch" ? required(missingWithInvalidScalar) : { kind: "scalar" });
            yield* check("earlier-required-later-scalar", [{ table: "entry", rows: [missingLater, invalidScalar] }],
              selection === "entityBatch" ? required(missingLater) : { kind: "scalar" });
            yield* check("scalar-still-rejected-after-sweep", [{ table: "entry", rows: [
              { id: "tentative-prefix", code: "valid", name: "Prefix" }, invalidScalar] }], { kind: "scalar" });
            yield* check("unknown-column-still-capture-guard", [{ table: "entry", rows: [missingLater,
              { id: "unknown-column", code: "valid", name: "Unknown", unknown: true }] }], { kind: "scalar" });
            yield* check("identity-still-capture-guard", [{ table: "entry", rows: [missingLater,
              { id: 3, code: "valid", name: "Invalid identity" }] }], { kind: "scalar" });
            for (const column of ["created_at", "updated_at"]) {
              const nullTimestamp = { id: "null-" + column, code: "valid", name: "Timestamp null", [column]: null };
              yield* check("earlier-primary-null-" + column, [{ table: "entry", rows: [collision, nullTimestamp] }],
                required(nullTimestamp, "entry", column, "null"));
              yield* check("earlier-check-null-" + column, [{ table: "entry", rows: [checked, nullTimestamp] }],
                required(nullTimestamp, "entry", column, "null"));
            }
            if (selection === "default") return;
            yield* check("valid-prefix-required", [{ table: "entry", rows: [{ id: "valid-prefix", code: "valid", name: "Prefix" }, missingLater] }], required(missingLater));
            yield* check("required-prefix-valid", [{ table: "entry", rows: [missingLater, { id: "valid-suffix", code: "valid", name: "Suffix" }] }], required(missingLater));
            yield* check("row-order-before-column-order", [{ table: "entry", rows: [{ id: "first", code: "valid" }, missingLater] }], required({ id: "first", code: "valid" }, "entry", "name"));
            const reversedNulls = { id: "nulls", name: null, code: null };
            yield* check("metadata-column-order", [{ table: "entry", rows: [reversedNulls] }], required(reversedNulls, "entry", "code", "null"));
            const nullDefault = { id: "null-default", code: "valid", name: "Valid", enabled: null };
            yield* check("explicit-null-default", [{ table: "entry", rows: [nullDefault] }], required(nullDefault, "entry", "enabled", "null"));
            yield* check("required-before-earlier-check", [{ table: "entry", rows: [checked, missingLater] }], required(missingLater));
            yield* check("earlier-group-unique", [{ table: "entry", rows: [secondary] }, { table: "later", rows: [missingLater] }], { kind: "unique", table: "entry", key: "unique", values: ["occupied"] });
            yield* check("later-group-required", [{ table: "entry", rows: [{ id: "earlier-valid", code: "valid", name: "Earlier" }] },
              { table: "later", rows: [secondary, missingLater] }], required(missingLater, "later"));
            yield* check("earlier-group-required", [{ table: "entry", rows: [missingLater] }, { table: "later", rows: [secondary] }], required(missingLater));
            yield* check("earlier-group-check", [{ table: "entry", rows: [checked] }, { table: "later", rows: [missingLater] }], { kind: "check", table: "entry" });
            yield* check("earlier-group-real", [{ table: "entry", rows: [{ ...collision, amount: 1e40 }] }, { table: "later", rows: [missingLater] }], { kind: "real" });
            yield* check("caught-missing", [{ table: "entry", rows: [missing] }], required(missing), true);
            yield* check("caught-null", [{ table: "entry", rows: [nullCode] }], required(nullCode, "entry", "code", "null"), true);
          }), host => host.close);
        }
        expect(rescues).toBe(2);
        conversion.mockClear();
        yield* Effect.acquireUseRelease(makeAtomicCommerceHost(selectedInput), host => host.run(host.newRequestKey(), root,
          { label: "positive", caught: false, groups: [{ table: "entry", rows: [{ id: "committed", code: "valid", name: "Positive", amount: 1.0000000596046448 }] }] }), host => host.close);
        expect(conversion).toHaveBeenCalled(); expect(acceptedChanges).toBe(1);
        const after = yield* coldRead(), committed = after.entries.find(row => row.id === "committed");
        expect(committed).toEqual({ id: "committed", code: "valid", name: "Positive", scope: null, note: null, amount: 1.0000001,
          count: 7, enabled: false, label: "default", metadata: {}, ticket: 2, created_at: currentStamp, updated_at: currentStamp });
        expect(after.markers).toEqual([{ id: "tentative", created_at: currentStamp }]);
        const durable = yield* inventory();
        expect(durable.rows).toHaveLength(baseline.rows.length + 2); expect(durable.revisions).toHaveLength(baseline.revisions.length + 2);
        expect(durable.events).toHaveLength(baseline.events.length + 1); expect(durable.commits).toHaveLength(baseline.commits.length + 1);
      } finally { conversion.mockRestore(); }
    }));
    await auditRole();
  } finally { for (const close of cleanup.reverse()) await close(); }
}

/** The journal and prepared-host issuers authenticate both branches before the
 * borrowed factory selects its policy. The positive control executes a real
 * Currency read; the selected refusal must occur before invoking that command.
 * No bundle, source admission or prepared-member authenticity is mocked. */
export async function participantInsertValidationBorrowedScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const markerKey = sourceKey + ".borrowed-marker";
    const markerSource = await Effect.runPromise(captureLogicalSchemaSource({ key: markerKey, owner: "medusa", writeProfile: markerKey,
      evidence: markerOrigin, definition: { kind: "relational", schema: markerSchema }, bindings: [{ kind: "definition", localName: "marker",
        table: { namespace: "medusa", logicalName: markerOrigin.sourceId + "/marker" } }] }));
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [markerSource] });
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const markerStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: markerKey, writeProfile: markerKey,
      schema: markerSchema, evidence: markerOrigin }, initialization: { stepId: "borrowed-insert-marker-empty",
      datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    if (driver === "postgres") expect((await fixture.persistence.query(
      "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    const application = fixture.application;
    const active = await Effect.runPromise(application.activation.readActive());
    const admission = await Effect.runPromise(selectApplicationMutationAdmission(active.selection, "users:create", {
      deploymentId: fixture.deploymentId, controlDb: fixture.control.drizzle,
      authority: application.authorityPorts, schema: application.schema,
    }));
    const activation = createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority, { leaseDurationMilliseconds: 60_000 });
    const store = createSessionJournalStorePersistence(application.sessionAuthority, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
    const participant = defineAtomicCommerceParticipant("insertValidationBorrowed");
    const markerParticipant = defineAtomicCommerceParticipant("insertMarkerBorrowed");
    let invoked = 0, receipts = 0;
    const read = defineCommerceCommand("insertValidationBorrowedRead", "read", ctx => Effect.gen(function* () {
      invoked++;
      return [...yield* (yield* ctx.table("currency")).prepareRead({ fields: ["code"], take: 1,
        order: { column: "code", direction: "asc" } }).find(ctx.manager)];
    }));
    const markerRead = defineCommerceCommand("insertValidationBorrowedMarkerRead", "read", ctx => Effect.gen(function* () {
      invoked++;
      return [...yield* (yield* ctx.table("marker")).prepareRead({ fields: ["id"], take: 1,
        order: { column: "id", direction: "asc" } }).find(ctx.manager)];
    }));
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, logicalStorage: markerStorage, commands: [markerRead] }),
      host => host.initialize([]), host => host.close));
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.sync(() => {
      expect(command === read || command === markerRead).toBe(true);
      expect(call.commandName).toBe(command === read ? "insertValidationBorrowedRead" : "insertValidationBorrowedMarkerRead"); expect(call.mode).toBe("read");
      expect(activity.mutations).toEqual([]); expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]);
      expect(activity.referenceReplacements).toEqual([]); expect(call.events).toEqual([]); receipts++;
    });
    const root = defineAtomicCommerceCommand("insertValidationBorrowedRoot", ctx => ctx.call(participant, read, null));
    const member = { participant, commands: [read], logicalStorage: fixture.hostInput.logicalStorage, validateLogicalCall };
    const markerMember = { participant: markerParticipant, commands: [markerRead], logicalStorage: markerStorage, validateLogicalCall };
    const events = { producerRevision: revision, contracts: [event], subscribers: [{ id: "insert-validation-borrowed", revision }], validate: () => Effect.void };
    const inventory = () => logicalCommerceInventory(fixture.persistence.drizzle);
    for (const selection of ["default", "entityBatch"] as const) {
      const selected = { ...member, ...(selection === "entityBatch" ? { insertValidation: "entityBatch" as const } : {}) };
      const input = { ...fixture.hostInput, commands: [root], participants: [selected, markerMember], events };
      const evidence = await applicationMutationActivationFixture({ deploymentId: fixture.deploymentId, selection: active.selection,
        executionAuthority: admission.executionAuthority, requestKey: `insert-validation-borrowed-${driver}-${selection}`,
        grantId: `insert-validation-borrowed-grant-${driver}-${selection}` });
      const activated = await Effect.runPromise(activation.activateEffect(evidence));
      if (activated.status !== "created") throw new Error("Expected actual fresh borrowed-policy attempt");
      const attempt = await Effect.runPromise(store.openAttemptEffect({
        selector: { deploymentId: activated.anchor.deploymentId, scopeId: activated.anchor.scopeId,
          sessionId: activated.anchor.sessionId, attemptFence: activated.anchor.attemptFence },
        snapshotToken: activated.anchor.snapshotToken, schemaVersionId: application.active.basis.schemaVersionId,
        executionClaim: activated.executionClaim,
      }));
      await Effect.runPromise(Effect.acquireUseRelease(retainPreparedHost(input.hostRuntime, Effect.gen(function* () {
        const captured = yield* captureAtomicCommerceConfiguration(input);
        return yield* prepareCurrentApplicationBinding(captured.application, captured.database,
          (binding, context) => prepareAtomicCommerceConfiguration(captured, binding, context.authority), {
            selection: { deploymentId: captured.deploymentId, scopeId: captured.scopeId },
            installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(captured.session, captured.database)),
          });
      })), retained => retained.use(preparation => preparation.withFiniteEntry(({ payload }) => Effect.gen(function* () {
        const preparedMembers = payload.members.filter(member => member.kind === "logical");
        const preparedMember = preparedMembers.find(member => member.participant === participant);
        if (payload.members.length !== 2 || preparedMembers.length !== 2 || preparedMember === undefined)
          return yield* Effect.die(new Error("Expected two actual independent prepared logical participants"));
        expect(preparedMember.insertValidation).toBe(selection === "entityBatch" ? "entityBatch" : undefined);
        expect(Object.isFrozen(preparedMember)).toBe(true);
        const profileRevision = encodeBytesToLowercaseHex(payload.identityDigest);
        const bundle = yield* store.admitLogicalParticipantsEffect(attempt, { participant: "neutral.insert-validation.borrowed",
          operationMethods: ["run"], profileRevision, sources: preparedMembers.map(member => ({ selection: member.prepared,
            application: active.selection, methods: member.commandNames })) });
        const issued = inspectLogicalParticipantAdmissionBundle(bundle, attempt, "neutral.insert-validation.borrowed", "run", profileRevision);
        if (issued === null || issued.admissions.length !== 2)
          return yield* Effect.die(new Error("Missing actual journal-issued source bundle"));
        const before = yield* inventory(), beforeInvoked = invoked, beforeReceipts = receipts;
        const borrowedInput = { bundle, admissions: issued.admissions, attempt, participant: "neutral.insert-validation.borrowed",
          method: "run", profileRevision, members: preparedMembers, events, pendingRows: [] };
        if (selection === "entityBatch") {
          const result = yield* Effect.exit(makeBorrowedWorkflowAttempt(borrowedInput));
          if (Exit.isSuccess(result)) {
            yield* result.value.abort;
            return yield* Effect.die(new Error("Selected entity-batch policy entered an unsupported borrowed view"));
          }
          typedFailure(result, "unsupportedProfile");
          expect(invoked).toBe(beforeInvoked); expect(receipts).toBe(beforeReceipts);
        } else {
          yield* Effect.acquireUseRelease(makeBorrowedWorkflowAttempt(borrowedInput), borrowed => Effect.gen(function* () {
            const result = yield* borrowed.context.call(participant, read, null);
            expect(result).toHaveLength(1); expect(result).toMatchObject([{ code: expect.any(String) }]);
            expect(yield* borrowed.context.call(markerParticipant, markerRead, null)).toEqual([]);
            const closed = yield* borrowed.close;
            expect(closed.changes.attempts).toEqual([]); expect(closed.eventIntents).toEqual([]);
            expect(closed.workCalls).toBeGreaterThan(0);
          }), borrowed => borrowed.abort);
          expect(invoked).toBe(beforeInvoked + 2); expect(receipts).toBe(beforeReceipts + 2);
        }
        expect(yield* inventory()).toEqual(before);
        const journal = yield* runDrizzleStatementEffect(fixture.persistence.drizzle.select({ count: count() }).from(fxSystemTransactionJournals)
          .where(eq(fxSystemTransactionJournals.sessionId, activated.anchor.sessionId)), cause => new Error("Read actual policy journal", { cause }));
        const operationReceipts = yield* runDrizzleStatementEffect(fixture.persistence.drizzle.select({ count: count() }).from(fxSystemTransactionJournalReceipts)
          .where(eq(fxSystemTransactionJournalReceipts.sessionId, activated.anchor.sessionId)), cause => new Error("Read actual policy receipts", { cause }));
        expect(journal).toEqual([{ count: 1 }]);
        // These direct borrowed-view probes neither invoke an admitted outer
        // journal operation nor invent a durable completion receipt.
        expect(operationReceipts).toEqual([{ count: 0 }]);
      }))), retained => retained.close));
    }
    expect(invoked).toBe(2); expect(receipts).toBe(2);
  } finally { for (const close of cleanup.reverse()) await close(); }
}
