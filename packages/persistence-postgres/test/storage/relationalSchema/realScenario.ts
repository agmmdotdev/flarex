import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect, vi } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema, isRelationalColumnValue } from "flarex-protocol/internal/relational-schema";
import { compileLogicalSourceIndexes, compileLogicalSourceUniqueConstraints } from "flarex-protocol/internal/logical-storage-requirements";
import { AppCreationTimeV1Schema, canonicalizeAppDocumentV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema, type CatalogTableId } from "flarex-protocol/catalog";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import type { Json, JsonObject } from "flarex-protocol/json";
import { makeCommerceHost, defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, CommerceTransactionError, type CommerceTransactionError as CommerceError } from "../../../src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { canonicalizeLogicalRelationalRow, prepareLogicalRelationalTableMechanics, prepareLogicalRelationalRealBatch,
  inspectLogicalRelationalRealBatch, executeLogicalRelationalRealBatch, hasLogicalRelationalRealVerdict,
  nativeLogicalRelationalCanonicalRow, type LogicalRelationalRealBatch } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import * as realOwner from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { captureLogicalRealWriteAttempt, inspectLogicalRealWriteAttempt, retainLogicalRealWriteAttempt, retainDetachedLogicalRealWriteAttempt } from "../../../src/storage/documents/logicalDocuments/realWriteEvidence";
import { projectLogicalCommerceActivity, type LogicalCommerceActivity, type LogicalCommerceMutation } from "../../../src/frameworks/commerceTransaction/logicalParticipant";
import { detachLogicalCanonicalDocument } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import type { LogicalDocumentFailure } from "../../../src/storage/documents/logicalDocuments/model";
import { readAppRowAtSnapshotInTransactionEffect, type AppRowReadResultV1, type ReadAppRowError } from "../../../src/storage/documents/appRows";
import { ExecutionDiagnostics } from "../../../src/execution/diagnostics/operation";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemScopeClocks } from "../../../src/database/schema";
import { fxSystemLogicalSourceInitializations } from "../../../src/storage/catalog/logicalStorageInitialization";
import { prepareNeutralLogicalFixture } from "./neutralLogicalFixture";

const stamp = "2026-10-22T00:00:00.000Z";
const kinds = ["main", "initial", "invalid-initial", "references"] as const;
type Kind = typeof kinds[number];
const key = (kind: Kind) => "medusa.neutral-real." + kind;
const evidence = { kind: "synthetic", sourceId: "neutral-real" };
function schemaInput(kind: Kind) {
  const origin = { kind: "synthetic", sourceId: key(kind) }, implicit = { kind: "implicit", sourceId: key(kind) };
  return { owner: "medusa", lineageId: "neutral-real." + kind, tables: [{ tableId: "measure", origin,
    columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      ...["measure", "other"].map(columnId => ({ columnId, type: "real" as const, nullable: true, default: { kind: "none" as const }, origin })),
      { columnId: "count", type: "integer", nullable: false, default: { kind: "integerLiteral", value: 7 }, origin },
      { columnId: "binary64", type: "doublePrecision", nullable: false, default: { kind: "doublePrecisionLiteral", value: 1.25 }, origin },
      ...(kind === "references" ? [{ columnId: "owner_id", type: "text", nullable: true, default: { kind: "none" }, origin }] : []),
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
        default: { kind: "currentTimestamp" as const }, origin: implicit })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
    ], keys: [{ keyId: "measure.primary", kind: "primary", columns: ["id"], origin }],
    indexes: [{ indexId: "measure.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit },
      ...(kind === "references" ? [{ indexId: "measure.owner", kind: "textEquality", columns: ["owner_id"], predicate: null, origin }] : [])],
    constraints: [{ constraintId: "measure.count-range", kind: "integerRange", columnId: "count", minimum: 0, maximum: 10, origin },
      ...(kind === "references" ? [{ constraintId: "measure.owner", kind: "foreignKey", sourceColumns: ["owner_id"],
        targetColumns: [{ tableId: "measure", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }] : [])],
    relationships: kind === "references" ? [{ relationshipId: "measure.owner", kind: "manyToOne", foreignKeyConstraintId: "measure.owner", origin }] : [] }], capabilities: [
      { capabilityId: "measure.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "measure", columnId: "created_at" },
        updatedAtColumn: { tableId: "measure", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: implicit },
      { capabilityId: "measure.deletion", kind: "softDelete", deletedAtColumn: { tableId: "measure", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "measure", indexId: "measure.active" }, origin: implicit },
    ] };
}
const schemaFor = (kind: Kind) => Result.getOrThrow(normalizeRelationalSchema(schemaInput(kind)));
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const row = Schema.decodeUnknownSync(Schema.JsonObject);
const values: readonly Readonly<{ id: string; input: number | null; expected: number | null }>[] = [
  { id: "positive-zero", input: 0, expected: 0 }, { id: "negative-zero", input: -0, expected: 0 },
  { id: "decimal", input: 0.1, expected: 0.1 }, { id: "near-midpoint", input: 1.00000006, expected: 1.0000001 },
  { id: "decimal-midpoint", input: 1.0000000596046448, expected: 1.0000001 },
  { id: "integer-rounding", input: 16777217, expected: 16777216 }, { id: "subnormal", input: 1e-45, expected: 1e-45 },
  { id: "maximum-expanded", input: 3.4028234663852886e38, expected: 3.4028235e38 },
  { id: "maximum-canonical", input: 3.4028235e38, expected: 3.4028235e38 }, { id: "null", input: null, expected: null },
];
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
    : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}

/** Expected constants are native diagnostic observations. All conversion is
 * performed by the genuine accepting SQL owner, never by fixture arithmetic. */
export async function realScenario(driver: "pglite" | "postgres", finiteCapture = false) {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const sources = [];
    for (const kind of kinds) {
      const schema = schemaFor(kind);
      sources.push(await Effect.runPromise(captureLogicalSchemaSource({ key: key(kind), owner: "medusa", writeProfile: key(kind), evidence,
        definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "measure",
          table: { namespace: "medusa", logicalName: schema.coordinate.lineageId + "/measure" } }] })));
    }
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), {
      name: "neutral-real", sources, ...(finiteCapture ? { finiteCapture: true as const } : {}) });
    if (driver === "postgres") expect((await fixture.persistence.query<{ ordinary: boolean }>(
      "select not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) as ordinary from pg_roles where rolname=current_user")).rows)
      .toEqual([{ ordinary: true }]);
    const insert = defineCommerceCommand("neutralRealInsert", "write", (ctx, input) => Effect.gen(function* () {
      const data = yield* decodeRows(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("measure")).write(ctx.manager, "insert", data)];
    }));
    const update = defineCommerceCommand("neutralRealUpdate", "write", (ctx, input) => Effect.gen(function* () {
      const data = yield* decodeRows(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("measure")).write(ctx.manager, "update", data)];
    }));
    const read = defineCommerceCommand("neutralRealRead", "read", (ctx, id) => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("measure")).find(ctx.manager, { ...(typeof id === "string" ? { predicate: { kind: "in", column: "id", values: [id] } } : {}),
        order: { column: "id", direction: "asc" } })];
    }));
    const lifecycle = defineCommerceCommand("neutralRealLifecycle", "write", (ctx, id) => Effect.gen(function* () {
      const table = yield* ctx.table("measure"), selected = id === null ? [] : [{ id }];
      yield* table.lifecycle(ctx.manager, "softDelete", selected); return [...yield* table.lifecycle(ctx.manager, "restore", selected)];
    }));
    let escaped: (() => Effect.Effect<unknown, CommerceError>) | undefined;
    const pending = defineCommerceCommand("neutralRealPending", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("measure");
      yield* table.write(ctx.manager, "insert", [{ id: "pending", measure: 1.0000000596046448 }]);
      expect(yield* table.find(ctx.manager, { predicate: { kind: "in", column: "id", values: ["pending"] }, order: { column: "id", direction: "asc" } }))
        .toMatchObject([{ id: "pending", measure: 1.0000001, other: null }]);
      yield* table.write(ctx.manager, "update", [{ id: "pending", other: 16777217, binary64: 1.0000000596046448 }]);
      escaped = () => table.write(ctx.manager, "update", [{ id: "pending", measure: 5 }]);
      return [...yield* table.find(ctx.manager, { predicate: { kind: "in", column: "id", values: ["pending"] }, order: { column: "id", direction: "asc" } })];
    }));
    const inverse = defineCommerceCommand("neutralRealInverse", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("measure"), removed = yield* table.delete(ctx.manager, [{ id: "pending" }]);
      if (table.reconstitute === undefined || removed[0] === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      return [...yield* table.reconstitute(ctx.manager, [removed[0]])];
    }));
    const terminalCalls: string[] = [];
    const terminal = defineCommerceCommand("neutralRealTerminalReference", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("measure");
      yield* table.write(ctx.manager, "update", [{ id: "reference-owner", measure: 1.0000000596046448 }]);
      if (ctx.planSetNull === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
      yield* table.delete(ctx.manager, [{ id: "reference-owner" }]); terminalCalls.push("setNull");
      yield* ctx.planSetNull({ sourceTable: "measure", sourceColumn: "owner_id", targetTable: "measure", targetColumn: "id",
        targetKey: "reference-owner", managedUpdate: "preserve" });
      return null;
    }));
    const commands = [insert, update, read, lifecycle, pending, inverse, terminal];
    const prepare = async (kind: Kind, data: readonly JsonObject[] = []) => {
      const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: data }, 1_048_576,
        { invalidInput: () => new Error("Invalid neutral real seed"), hashFailure: cause => new Error("Neutral real seed hash", { cause }) }));
      const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-real" }, commands,
        logicalStorage: { ...fixture.hostInput.logicalStorage, source: { sourceKey: key(kind), writeProfile: key(kind), schema: schemaFor(kind), evidence },
          initialization: { stepId: "neutral-real-seed", datasetSha256: seed.sha256Hex, expectedRowCount: data.length } } };
      const host = await Effect.runPromise(makeCommerceHost(input)); cleanup.push(() => Effect.runPromise(host.close)); return { input, host };
    };
    const main = await prepare("main"); await Effect.runPromise(main.host.initialize([]));
    const snapshot = async () => ({
      rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
      revisions: await fixture.persistence.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
      indexes: await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
      indexRevisions: await fixture.persistence.drizzle.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
      unique: await fixture.persistence.drizzle.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.canonicalKeySha256),
      commits: await fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
      facts: await fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal),
      outcomes: await fixture.persistence.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey),
      clocks: await fixture.persistence.drizzle.select().from(fxSystemScopeClocks),
      initializations: await fixture.persistence.drizzle.select().from(fxSystemLogicalSourceInitializations).orderBy(fxSystemLogicalSourceInitializations.sourceKey),
    });
    const revisionFor = async (id: string) => {
      const current = await snapshot();
      for (const pointer of current.rows) {
        const revision = current.revisions.find(value => value.tableId === pointer.tableId && value.scopeUuid === pointer.scopeUuid && value.commitSeq === pointer.commitSeq
          && Buffer.from(value.rowId).equals(Buffer.from(pointer.rowId)));
        if (revision === undefined || revision.isTombstone) continue;
        const value = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
        if (row(value.valueJson).id === id) return revision;
      }
      throw new Error("Missing neutral real row " + id);
    };
    const run = (command: typeof insert, input: Json) => Effect.runPromise(main.host.run(main.host.newRequestKey(), command, input));
    const refuses = async (operation: () => Promise<unknown>, reason: string) => {
      const before = await snapshot(); let failure: unknown;
      try { await operation(); } catch (cause) { failure = cause; }
      expect(failure).toBeDefined(); expect(reasons(failure)).toContain(reason); expect(await snapshot()).toEqual(before);
    };
    // Empty operations never prepare a forbidden zero-row conversion batch.
    expect(await run(insert, [])).toEqual([]); expect(await run(update, [])).toEqual([]); expect(await run(lifecycle, null)).toEqual([]);
    expect(await Effect.runPromise(main.host.read(read, "missing"))).toEqual([]);
    const output = rows(await run(insert, values.map(value => ({ id: value.id, measure: value.input }))));
    for (const value of values) {
      const stored = output.find(item => item.id === value.id); expect(stored).toMatchObject({ measure: value.expected, other: null, count: 7, binary64: 1.25 });
      if (value.expected === 0) expect(Object.is(stored?.measure, -0)).toBe(false);
    }
    expect(output.find(item => item.id === "decimal-midpoint")?.measure).not.toBe(Math.fround(1.0000000596046448));
    // Primitive membership is finite-only, not a storage canonicality verdict.
    for (const value of [1.0000000596046448, 3.4028235e38, 3.4028236e38, 1e-46]) expect(isRelationalColumnValue("real", true, value)).toBe(true);
    for (const measure of [1e-46, 3.4028236e38, 1e40, -1e40, Number.MIN_VALUE])
      await refuses(() => run(insert, [{ id: "valid-prefix", measure: 0.1 }, { id: "invalid", measure }]), "invalidInput");
    // Complete-row checks follow real SQL conversion. This ordinary integer
    // constraint separates that frontier from premature full validation.
    const constraintConversion = vi.spyOn(realOwner, "executeLogicalRelationalRealBatch");
    try {
      await refuses(() => run(insert, [{ id: "invalid-count", measure: 0.1, count: 11 }]), "invalidInput");
      expect(constraintConversion).toHaveBeenCalled();
    } finally { constraintConversion.mockRestore(); }
    const request = main.host.newRequestKey(), pendingResult = rows(await Effect.runPromise(main.host.run(request, pending, null)));
    expect(pendingResult).toMatchObject([{ measure: 1.0000001, other: 16777216, binary64: 1.0000000596046448 }]);
    const replay = await snapshot(); expect(await Effect.runPromise(main.host.run(request, pending, null))).toEqual(pendingResult); expect(await snapshot()).toEqual(replay);
    const escapedWrite = escaped;
    if (escapedWrite === undefined) throw new Error("Missing actual escaped real table handle");
    await refuses(() => Effect.runPromise(escapedWrite()), "invalidAuthority");
    const historicalRevision = await revisionFor("pending");
    await run(update, [{ id: "pending", measure: 0.1, count: 8 }]);
    const cold = await prepare("main"); expect(await Effect.runPromise(cold.host.read(read, "pending"))).toMatchObject([{ measure: 0.1, other: 16777216, count: 8 }]);
    const historical = await Effect.runPromise(runEffectTransaction<AppRowReadResultV1, ReadAppRowError, Error, FlarexMetadataTransaction>(
      callback => fixture.persistence.drizzle.transaction(callback), "Neutral real historical row", tx => readAppRowAtSnapshotInTransactionEffect(tx,
        { scopeId: fixture.application.authority.scopeId, tableId: historicalRevision.tableId,
          rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(historicalRevision.rowId)), snapshotCommitSeq: historicalRevision.commitSeq }),
      cause => new Error("Neutral real historical row transaction", { cause })));
    expect(historical.kind).toBe("live"); if (historical.kind === "live") expect(historical.document.valueJson).toMatchObject({ measure: 1.0000001, other: 16777216 });
    await run(lifecycle, "pending");
    const participant = defineAtomicCommerceParticipant("neutralReal"), root = defineAtomicCommerceCommand("neutralRealInverseRoot", ctx => ctx.call(participant, inverse, null));
    const atomic = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-real-inverse" },
      executionIsolation: "scopeExclusive", commands: [root], participants: [{ participant, logicalStorage: main.input.logicalStorage,
        commands: [inverse], reconstitution: "advanceUpdatedAt", validateLogicalCall: () => Effect.void }] }));
    cleanup.push(() => Effect.runPromise(atomic.close)); expect(await Effect.runPromise(atomic.run(atomic.newRequestKey(), root, null))).toMatchObject([{ measure: 0.1, other: 16777216 }]);
    // The native-facing original representation belongs to each successful
    // mutation, separately from the canonical SQL result and persisted facts.
    const evidenceCalls: LogicalCommerceActivity[] = [], evidenceAggregates: Array<readonly LogicalCommerceMutation[]> = [];
    const evidenceDelete = defineCommerceCommand("neutralRealEvidenceDelete", "write", ctx => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("measure")).delete(ctx.manager, [{ id: "evidence-a" }, { id: "evidence-b" }])];
    }));
    const evidenceRoot = defineAtomicCommerceCommand("neutralRealEvidenceRoot", ctx => Effect.gen(function* () {
      yield* ctx.call(participant, insert, [{ id: "evidence-a", measure: 16777217 },
        { id: "evidence-b", measure: 1.0000000596046448 }]);
      yield* ctx.call(participant, update, [{ id: "evidence-a", other: 16777217 }]);
      yield* ctx.call(participant, read, "evidence-a");
      return yield* ctx.call(participant, evidenceDelete, null);
    }));
    const evidenceAtomic = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "neutral-real-write-evidence" }, executionIsolation: "scopeExclusive", commands: [evidenceRoot],
      participants: [{ participant, logicalStorage: main.input.logicalStorage, commands: [insert, update, read, evidenceDelete],
        validateLogicalCall: (_call, activity) => Effect.sync(() => { evidenceCalls.push(activity); }),
        validateLogical: (_calls, mutations) => Effect.sync(() => { evidenceAggregates.push(mutations); }) }] }));
    cleanup.push(() => Effect.runPromise(evidenceAtomic.close));
    const evidenceRequest = evidenceAtomic.newRequestKey();
    const evidenceResult = await Effect.runPromise(evidenceAtomic.run(evidenceRequest, evidenceRoot, null));
    expect(evidenceCalls).toHaveLength(4);
    expect(evidenceCalls[0]?.mutations.map(mutation => ({ ordinal: mutation.ordinal, original: mutation.realNormalization,
      stored: mutation.after?.measure }))).toEqual([
      { ordinal: 0, original: { measure: 16777217, other: null }, stored: 16777216 },
      { ordinal: 1, original: { measure: 1.0000000596046448, other: null }, stored: 1.0000001 },
    ]);
    expect(evidenceCalls[1]?.mutations).toMatchObject([{ ordinal: 0, operation: "patch",
      realNormalization: { measure: 16777216, other: 16777217 }, after: { measure: 16777216, other: 16777216 } }]);
    expect(evidenceCalls[2]?.mutations).toEqual([]);
    expect(evidenceCalls[3]?.mutations).toHaveLength(2);
    for (const mutation of evidenceCalls[3]?.mutations ?? []) {
      expect(mutation.operation).toBe("delete"); expect(Object.hasOwn(mutation, "realNormalization")).toBe(false);
    }
    expect(evidenceAggregates).toHaveLength(1);
    expect(evidenceAggregates[0]?.map(mutation => mutation.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(evidenceAggregates[0]?.map(mutation => mutation.realNormalization)).toEqual([
      { measure: 16777217, other: null }, { measure: 1.0000000596046448, other: null },
      { measure: 16777216, other: 16777217 }, undefined, undefined,
    ]);
    const originalFields = evidenceCalls[0]?.mutations[0]?.realNormalization;
    if (originalFields === undefined) throw new Error("Missing authentic REAL write representation");
    expect(Reflect.set(originalFields, "measure", 7)).toBe(false);
    const afterEvidence = await snapshot();
    expect(await Effect.runPromise(evidenceAtomic.run(evidenceRequest, evidenceRoot, null))).toEqual(evidenceResult);
    expect(evidenceCalls).toHaveLength(4); expect(await snapshot()).toEqual(afterEvidence);
    const initialRows = [{ id: "seed-midpoint", measure: 1.0000000596046448 }, { id: "seed-defaults" }, { id: "seed-null", measure: null }];
    const initialized = await prepare("initial", initialRows); expect(await Effect.runPromise(initialized.host.initialize(initialRows))).toEqual({ rowCount: 3 });
    expect(await Effect.runPromise(initialized.host.read(read, "seed-midpoint"))).toMatchObject([{ measure: 1.0000001 }]);
    expect(await Effect.runPromise(initialized.host.read(read, "seed-defaults"))).toMatchObject([{ measure: null, other: null, count: 7, binary64: 1.25 }]);
    const seeded = await snapshot(); expect(await Effect.runPromise(initialized.host.initialize(initialRows))).toEqual({ rowCount: 3 }); expect(await snapshot()).toEqual(seeded);
    const badSeed = [{ id: "seed-prefix", measure: 0.1 }, { id: "seed-overflow", measure: 1e40 }], invalid = await prepare("invalid-initial", badSeed);
    await refuses(() => Effect.runPromise(invalid.host.initialize(badSeed)), "invalidInput");
    // Terminal reference maintenance remains explicitly unsupported for a
    // real-bearing source. Its real FK/index and prior scalar write are genuine;
    // refusal must retain the complete prefix and both endpoint rows.
    const referenceRows = [{ id: "reference-owner", measure: null, owner_id: null },
      { id: "reference-child", measure: 0.1, owner_id: "reference-owner" }], references = await prepare("references", referenceRows);
    expect(await Effect.runPromise(references.host.initialize(referenceRows))).toEqual({ rowCount: 2 });
    const referenceParticipant = defineAtomicCommerceParticipant("neutralRealReference"), referenceRoot =
      defineAtomicCommerceCommand("neutralRealReferenceRoot", ctx => ctx.call(referenceParticipant, terminal, null));
    const referenceAtomic = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "neutral-real-reference-refusal" }, executionIsolation: "scopeExclusive", commands: [referenceRoot],
      participants: [{ participant: referenceParticipant, logicalStorage: references.input.logicalStorage, commands: [terminal],
        setNullPolicy: { managedUpdate: "preserve" }, validateLogicalCall: () => Effect.void }] }));
    cleanup.push(() => Effect.runPromise(referenceAtomic.close));
    await refuses(() => Effect.runPromise(referenceAtomic.run(referenceAtomic.newRequestKey(), referenceRoot, null)), "unsupportedProfile");
    expect(terminalCalls).toEqual(["setNull"]);
    // A genuine altered session is refused; production does not silently SET a
    // preferred formatting profile. The fixture's SET LOCAL is rolled back.
    const settings: string[] = [], actualExecute = realOwner.executeLogicalRelationalRealBatch;
    const withUnsupportedSetting = <Failure>(tx: FlarexMetadataTransaction, batch: LogicalRelationalRealBatch, tableId: CatalogTableId,
      error: LogicalDocumentFailure<Failure>) => Effect.gen(function* () {
      yield* Effect.tryPromise({ try: () => tx.execute(sql.raw("SET LOCAL extra_float_digits = 0")), catch: cause => error("resourceFailure", cause) });
      const setting = () => Effect.tryPromise({ try: async () => {
        const value = await tx.execute(sql`select current_setting('extra_float_digits') as setting`);
        const result = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ setting: Schema.String })) }))(value);
        const current = result.rows[0]; if (current === undefined) throw new Error("Missing actual session setting"); settings.push(current.setting);
      }, catch: cause => error("resourceFailure", cause) });
      yield* setting(); return yield* actualExecute(tx, batch, tableId, error).pipe(Effect.ensuring(setting().pipe(Effect.orDie)));
    });
    // The call-through observer arranges only the genuine accepting SQL
    // session. It preserves the original batch, executor and conversion result.
    const settingObserver = vi.spyOn(realOwner, "executeLogicalRelationalRealBatch").mockImplementation(withUnsupportedSetting);
    try { await refuses(() => Effect.runPromise(main.host.run(main.host.newRequestKey(), insert, [{ id: "unsupported-session", measure: null }])), "unsupportedProfile"); }
    finally { settingObserver.mockRestore(); }
    expect(settings.length).toBeGreaterThanOrEqual(2); expect(settings.every(value => value === "0")).toBe(true);
    const small = await Effect.runPromise(makeCommerceHost({ ...main.input, logicalResources: { ...defaultCommerceResources, commandBytes: 1024 } }));
    cleanup.push(() => Effect.runPromise(small.close));
    await refuses(() => Effect.runPromise(small.run(small.newRequestKey(), insert, Array.from({ length: 8 }, (_, index) => ({ id: "bounded-real-" + index, measure: 1.0000000596046448 })))), "limitExceeded");
    const beforeCancellation = await snapshot(); let convertedWrite = false;
    const cancelled = await Effect.runPromiseExit(main.host.run(main.host.newRequestKey(), insert, [{ id: "cancelled-real", measure: 1.0000000596046448 }]).pipe(
      Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => name === "LogicalDocuments.relationalChange" ? work.pipe(Effect.andThen(Effect.sync(() => { convertedWrite = true; })), Effect.andThen(Effect.interrupt)) : work })));
    expect(Exit.isFailure(cancelled)).toBe(true); expect(convertedWrite).toBe(true); expect(await snapshot()).toEqual(beforeCancellation);
    expect(await Effect.runPromise(main.host.read(read, "cancelled-real"))).toEqual([]);
    // The complete row has valid canonical bytes and hash but an unconverted
    // finite real. A cold read must refuse it rather than silently normalize it.
    const beforeCorruption = await snapshot(), original = await revisionFor("decimal-midpoint");
    const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: original.valueBytes, sha256: original.valueSha256, profile: "appDocument" });
    const { _id, _creationTime, ...fields } = row(decoded.valueJson);
    const corrupted = await canonicalizeAppDocumentV1({ tableId: original.tableId, rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(original.rowId)),
      creationTime: AppCreationTimeV1Schema.make(original.creationTime), fields: { ...fields, measure: 1.0000000596046448 } });
    const match = and(eq(fxAppRowRevisions.scopeUuid, original.scopeUuid), eq(fxAppRowRevisions.tableId, original.tableId), eq(fxAppRowRevisions.rowId, original.rowId), eq(fxAppRowRevisions.commitSeq, original.commitSeq));
    await fixture.persistence.drizzle.update(fxAppRowRevisions).set({ valueBytes: corrupted.canonicalBytes, valueSha256: corrupted.sha256 }).where(match);
    try { await refuses(() => Effect.runPromise(cold.host.read(read, "decimal-midpoint")), "storedCorruption"); }
    finally { await fixture.persistence.drizzle.update(fxAppRowRevisions).set({ valueBytes: original.valueBytes, valueSha256: original.valueSha256 }).where(match); }
    expect(await snapshot()).toEqual(beforeCorruption);
    // Authentic SQL verdict issuance is tested at its private owner. Copied
    // fields/tokens cannot acquire the right to canonicalize a real-bearing row.
    const sourceTable = schemaFor("main").tables[0], binding = fixture.catalog.requirements.evidence.tableBindings.find(value => value.table.logicalName === "neutral-real.main/measure");
    if (sourceTable === undefined || binding === undefined) throw new Error("Missing genuine installed real table");
    const mechanics = prepareLogicalRelationalTableMechanics(sourceTable, schemaFor("main").capabilities), policy = Result.getOrThrow(mechanics.rows);
    const candidate = Result.getOrThrow(policy.normalize({ id: "private-owner", measure: 1.0000000596046448 }, null, stamp));
    const documentId = appDocumentIdV1FromRowIdentity({ tableId: binding.tableId, rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(new Uint8Array(16).fill(39))) });
    expect((await Effect.runPromiseExit(canonicalizeLogicalRelationalRow(mechanics, candidate, documentId, AppCreationTimeV1Schema.make(1))))._tag).toBe("Failure");
    const supplied = [candidate], batch = Result.getOrThrow(prepareLogicalRelationalRealBatch(mechanics, binding.tableId, { mode: "normalize", rows: supplied }, { rows: 1, bytes: 4096 }, (reason, cause) => new Error(reason, { cause })));
    supplied.length = 0; expect(Reflect.set(candidate, "measure", 7)).toBe(false);
    expect(Reflect.apply(inspectLogicalRelationalRealBatch, undefined, [{ ...batch }, binding.tableId, (reason: string) => new Error(reason)]))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    const executeProof = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
        const query = vi.spyOn(tx, "execute");
        try {
          expect(yield* Effect.result(Reflect.apply(executeLogicalRelationalRealBatch, undefined, [tx, { ...batch }, binding.tableId, (reason: string) => new Error(reason)])))
            .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } }); expect(query).not.toHaveBeenCalled();
          expect(yield* Effect.result(executeLogicalRelationalRealBatch(tx, batch, CatalogTableIdSchema.make(binding.tableId + 1), reason => new Error(reason))))
            .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } }); expect(query).not.toHaveBeenCalled();
          return yield* executeLogicalRelationalRealBatch(tx, batch, binding.tableId, (reason, cause) => new Error(reason, { cause }));
        } finally { query.mockRestore(); }
      });
    const normalized = await Effect.runPromise(runEffectTransaction<Effect.Success<ReturnType<typeof executeProof>>,
      Effect.Error<ReturnType<typeof executeProof>>, Error, FlarexMetadataTransaction>(callback => fixture.persistence.drizzle.transaction(callback),
      "Real private verdict proof", executeProof, cause => new Error("Real private verdict transaction", { cause })));
    const accepted = normalized.rows[0]; if (accepted === undefined) throw new Error("Missing actual SQL-normalized row");
    expect(accepted.measure).toBe(1.0000001); expect(Reflect.set(accepted, "measure", 9)).toBe(false);
    const document = await Effect.runPromise(canonicalizeLogicalRelationalRow(mechanics, accepted, documentId, AppCreationTimeV1Schema.make(1)));
    expect(hasLogicalRelationalRealVerdict(mechanics, document)).toBe(true);
    const privateError = (reason: string) => new Error(reason);
    const originalAttempt = Object.freeze({ ordinal: 7, documentId, tableId: binding.tableId, tableName: "measure",
      operation: "insert" as const, before: null, after: document });
    // A successful SQL conversion that never became a write has no proof.
    expect(inspectLogicalRealWriteAttempt(originalAttempt, privateError))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    Result.getOrThrow(captureLogicalRealWriteAttempt(originalAttempt, privateError));
    expect(Result.getOrThrow(inspectLogicalRealWriteAttempt(originalAttempt, privateError)))
      .toEqual({ measure: 1.0000000596046448, other: null });
    const activity = { attempts: [originalAttempt], lifecycle: [], observedRows: [], relationalReads: [], setNull: [], referenceReplacements: [] };
    const names = new Map([[binding.tableId, "measure"]]);
    expect((await Effect.runPromise(projectLogicalCommerceActivity(names, activity))).mutations)
      .toMatchObject([{ ordinal: 7, realNormalization: { measure: 1.0000000596046448, other: null }, after: { measure: 1.0000001 } }]);
    expect(await Effect.runPromiseExit(projectLogicalCommerceActivity(names, { ...activity, attempts: [{ ...originalAttempt }] })))
      .toMatchObject({ _tag: "Failure" });
    const projectedAttempt = Object.freeze({ ...originalAttempt, ordinal: 0 });
    Result.getOrThrow(retainLogicalRealWriteAttempt(originalAttempt, projectedAttempt, 7, privateError));
    expect((await Effect.runPromise(projectLogicalCommerceActivity(names, { ...activity, attempts: [projectedAttempt] }))).mutations)
      .toMatchObject([{ ordinal: 0, realNormalization: { measure: 1.0000000596046448, other: null } }]);
    const detachedAttempt = Object.freeze({ ...originalAttempt, after: detachLogicalCanonicalDocument(document) });
    retainDetachedLogicalRealWriteAttempt(originalAttempt, detachedAttempt);
    expect(Result.getOrThrow(inspectLogicalRealWriteAttempt(detachedAttempt, privateError)))
      .toEqual({ measure: 1.0000000596046448, other: null });
    const copiedOriginal = Object.freeze({ ...originalAttempt });
    const copiedDetached = Object.freeze({ ...copiedOriginal, after: detachLogicalCanonicalDocument(document) });
    retainDetachedLogicalRealWriteAttempt(copiedOriginal, copiedDetached);
    expect(inspectLogicalRealWriteAttempt(copiedDetached, privateError))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    for (const changed of [{ ordinal: 8 }, { tableId: CatalogTableIdSchema.make(binding.tableId + 1) }, { tableName: "foreign" },
      { operation: "patch" as const }, { before: document }, { after: null }])
      expect(retainLogicalRealWriteAttempt(originalAttempt, Object.freeze({ ...originalAttempt, ...changed }), 0, privateError))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    for (const changed of [{ ordinal: 8 }, { tableId: CatalogTableIdSchema.make(binding.tableId + 1) }, { tableName: "foreign" },
      { operation: "patch" as const }, { before: document }]) {
      const forgedDetached = Object.freeze({ ...originalAttempt, ...changed });
      retainDetachedLogicalRealWriteAttempt(originalAttempt, forgedDetached);
      expect(inspectLogicalRealWriteAttempt(forgedDetached, privateError))
        .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    }
    const forgedCanonical = Object.freeze({ ...originalAttempt, after: { ...document } });
    retainDetachedLogicalRealWriteAttempt(originalAttempt, forgedCanonical);
    expect(Result.getOrThrow(inspectLogicalRealWriteAttempt(forgedCanonical, privateError))).toBeUndefined();
    const patchAttempt = Object.freeze({ ...originalAttempt, operation: "patch" as const, before: document });
    Result.getOrThrow(captureLogicalRealWriteAttempt(patchAttempt, privateError));
    const forgedBefore = Object.freeze({ ...patchAttempt, before: { ...document } });
    expect(retainLogicalRealWriteAttempt(patchAttempt, forgedBefore, 0, privateError))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    retainDetachedLogicalRealWriteAttempt(patchAttempt, forgedBefore);
    expect(inspectLogicalRealWriteAttempt(forgedBefore, privateError))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    document.canonicalBytes.fill(0);
    expect(inspectLogicalRealWriteAttempt(originalAttempt, privateError))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    const corruptedDetached = Object.freeze({ ...originalAttempt, after: detachLogicalCanonicalDocument(document) });
    retainDetachedLogicalRealWriteAttempt(originalAttempt, corruptedDetached);
    expect(inspectLogicalRealWriteAttempt(corruptedDetached, privateError))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    expect(hasLogicalRelationalRealVerdict(mechanics, document)).toBe(false);
    expect(nativeLogicalRelationalCanonicalRow(mechanics, document, 4096, reason => new Error(reason))).toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  } finally {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) try { await close(); } catch (cause) { failures.push(cause); }
    if (failures.length) throw new AggregateError(failures, "Neutral real cleanup failed");
  }
}

export async function realDefinitionRefusals() {
  const schema = schemaInput("main"), table = schema.tables[0]; if (table === undefined) throw new Error("Missing real schema");
  for (const kind of ["btree", "uniqueBtree"]) {
    const checked = Result.getOrThrow(normalizeRelationalSchema({ ...schema, tables: [{ ...table,
      indexes: [...table.indexes, { indexId: "unsupported-real", kind, columns: ["measure"], predicate: null, origin: table.origin }] }] }));
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: key("main"), owner: "medusa", writeProfile: key("main"), evidence,
      definition: { kind: "relational", schema: checked }, bindings: [{ kind: "definition", localName: "measure", table: { namespace: "medusa", logicalName: "neutral-real.main/measure" } }] }));
    expect(Result.isFailure(compileLogicalSourceIndexes(source))).toBe(true);
    if (kind === "uniqueBtree") expect(Result.isFailure(compileLogicalSourceUniqueConstraints(source))).toBe(true);
  }
  expect(Result.isFailure(normalizeRelationalSchema({ ...schema, tables: [{ ...table,
    indexes: [...table.indexes, { indexId: "unsupported-real-text", kind: "textEquality", columns: ["measure"], predicate: null, origin: table.origin }] }] }))).toBe(true);
  expect(Result.isFailure(normalizeRelationalSchema({ ...schema, tables: [{ ...table, columns: table.columns.map(column => column.columnId === "measure"
    ? { ...column, default: { kind: "doublePrecisionLiteral", value: 0.1 } } : column) }] }))).toBe(true);
}
