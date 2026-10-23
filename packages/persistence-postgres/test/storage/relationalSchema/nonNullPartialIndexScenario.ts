import { eq, inArray } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { Json, JsonObject } from "flarex-protocol/json";
import { prepareNeutralLogicalFixture } from "./neutralLogicalFixture";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../../../src/storage/documents/appRows";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxSystemScopeClocks } from "../../../src/database/schema";
import { logicalIndexReadAccessQuery, logicalPageReadAccessQuery } from "../../../src/storage/documents/logicalReadAccessQueries";
import { selectLogicalIndex, type LogicalWhere } from "../../../src/storage/documents/logicalDocuments/query";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";

const stamp = "2026-10-23T00:00:00.000Z";
const evidence = { kind: "synthetic", sourceId: "neutral-non-null" };
const sourceKey = (kind: string) => "medusa.neutral-non-null." + kind;
function schemaFor(kind: string) {
  const origin = { kind: "synthetic", sourceId: "neutral-non-null." + kind };
  const implicit = { kind: "implicit", sourceId: "neutral-non-null." + kind };
  return Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-non-null." + kind,
    tables: [{ tableId: "entry", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      ...["value", "mixed_value"].map(columnId => ({ columnId, type: "text" as const, nullable: true, default: { kind: "none" as const }, origin })),
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
        default: { kind: "currentTimestamp" as const }, origin: implicit })),
      { columnId: "retired", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
    ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
      { indexId: "entry.non-null", kind: "btree", columns: ["value"], predicate: { kind: "isNotNull", columnId: "value" }, origin },
      { indexId: "entry.mixed", kind: "btree", columns: ["mixed_value", "retired"],
        predicate: { kind: "isNullAndNotNull", nullColumnId: "retired", notNullColumnId: "mixed_value" }, origin },
      { indexId: "entry.active", kind: "btree", columns: ["retired"], predicate: { kind: "isNull", columnId: "retired" }, origin: implicit },
    ], constraints: [], relationships: [] }], capabilities: [
      { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
        updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: implicit },
      { capabilityId: "entry.deletion", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "retired" },
        activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: implicit },
    ] }));
}

/** Real neutral schema admission/build/binding followed by online writes. The
 * pre-build hook supplies row revisions only; production owners create every
 * ordered entry, its revision, and the read eligibility projection. */
export async function nonNullPartialIndexScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const sources = [];
    for (const kind of ["seeded", "main"]) {
      const schema = schemaFor(kind);
      sources.push(await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey(kind), owner: "medusa", writeProfile: sourceKey(kind), evidence,
        definition: { kind: "relational", schema }, bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: schema.coordinate.lineageId + "/" + table.identity.tableId } })) })));
    }
    let seededTable: number | undefined;
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-non-null", sources,
      beforeIndexBuild: async ({ application, persistence, schemaVersionId, catalog }) => {
        const table = catalog.requirements.evidence.tableBindings.find(binding => binding.table.namespace === "medusa" &&
          binding.table.logicalName === "neutral-non-null.seeded/entry");
        if (table === undefined) throw new Error("Missing neutral seeded table");
        seededTable = table.tableId;
        const clock = await persistence.getScopeClock(application.authority.scopeId);
        if (clock === null) throw new Error("Missing neutral seed clock");
        const rows = [{ id: "seed-member", value: "", mixed_value: "", retired: null },
          { id: "seed-excluded", value: null, mixed_value: "present", retired: stamp }];
        for (const [ordinal, fields] of rows.entries()) {
          const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + BigInt(ordinal + 1));
          const creationTime = decodeAppCreationTimeV1(ordinal + 1);
          const rowId = decodeAppRowIdHexV1((ordinal + 1).toString(16).padStart(2, "0").repeat(16));
          const document = await canonicalizeAppDocumentV1({ tableId: table.tableId,
            rowId, creationTime,
            fields: { ...fields, created_at: stamp, updated_at: stamp } });
          await persistence.drizzle.transaction(async tx => {
            await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
            try {
              await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, { kind: "live", scopeId: application.authority.scopeId,
                tableId: table.tableId, rowId, writeEpoch: clock.epoch, commitSeq, prevCommitSeq: null, schemaVersionId, creationTime,
                value: { codecVersion: document.codecVersion, valueJson: document.valueJson, canonicalBytes: document.canonicalBytes, sha256: document.sha256 } });
              await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(eq(fxSystemScopeClocks.scopeId, application.authority.scopeId));
            } finally { closeInstallationAdmission(tx); }
          });
        }
        const indexIds = catalog.ordered.filter(member => member.definition.access.tableId === table.tableId).map(member => member.definition.indexDefinitionId);
        expect(await persistence.drizzle.select().from(fxAppIndexEntryCurrent).where(inArray(fxAppIndexEntryCurrent.indexDefinitionId, indexIds))).toEqual([]);
      } });
    if (driver === "postgres") {
      const role = await fixture.persistence.query<{ current_user: string; is_superuser: string; rolsuper: boolean;
        rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
        "select current_user,current_setting('is_superuser') as is_superuser,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user");
      expect(role.rows).toEqual([{ current_user: expect.any(String), is_superuser: "off", rolsuper: false,
        rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    }
    const indexesFor = (tableId: number | undefined) => fixture.catalog.ordered.filter(member => member.definition.access.tableId === tableId)
      .map(member => member.definition).filter(definition => definition.physicalSpec.predicate?.kind === "fieldIsNotNull" ||
        definition.physicalSpec.predicate?.kind === "fieldIsNullAndNotNull");
    const seeded = indexesFor(seededTable);
    expect(seeded).toHaveLength(2);
    for (const definition of seeded) {
      const stored = await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.indexDefinitionId, definition.indexDefinitionId));
      expect(stored).toHaveLength(1); expect(Buffer.from(stored[0]?.rowId ?? []).toString("hex")).toBe("01".repeat(16));
      const input = { deploymentId: fixture.application.deploymentId, scopeId: fixture.application.authority.scopeId,
        indexDefinitionId: definition.indexDefinitionId, pageSize: 1 };
      expect(await Effect.runPromise(buildAppDeveloperOrderedIndexV1Effect(fixture.hostInput.logicalStorage.ports, input)))
        .toMatchObject({ status: "replayed", lifecycle: "enabled", processedRows: 0 });
    }
    const mainTable = fixture.catalog.requirements.evidence.tableBindings.find(binding => binding.table.namespace === "medusa" &&
      binding.table.logicalName === "neutral-non-null.main/entry");
    if (mainTable === undefined) throw new Error("Missing main neutral table");
    const definitions = indexesFor(mainTable.tableId); expect(definitions).toHaveLength(2);
    const insert = defineCommerceCommand("neutralNonNullInsert", "write", (ctx, input) => Effect.gen(function* () {
      const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject))(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", rows)];
    }));
    const update = defineCommerceCommand("neutralNonNullUpdate", "write", (ctx, input) => Effect.gen(function* () {
      const row = yield* Schema.decodeUnknownEffect(Schema.JsonObject)(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "update", [row])];
    }));
    const lifecycle = defineCommerceCommand("neutralNonNullLifecycle", "write", (ctx, input) => Effect.gen(function* () {
      const mode = yield* Schema.decodeUnknownEffect(Schema.Literals(["softDelete", "restore"]))(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("entry")).lifecycle(ctx.manager, mode, [{ id: "online" }])];
    }));
    const failed = defineCommerceCommand("neutralNonNullLateFailure", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("entry")).write(ctx.manager, "update", [{ id: "online", value: null, mixed_value: null }]);
      return yield* ctx.refuse(commerceError("invalidInput"));
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => new Error("Invalid neutral non-null seed"), hashFailure: cause => new Error("Neutral non-null seed hash", { cause }) }));
    const hostInput = { ...fixture.hostInput, commands: [insert, update, lifecycle, failed], identityAndAccessPolicy: { profile: "neutral-non-null" },
      logicalStorage: { ...fixture.hostInput.logicalStorage, source: { sourceKey: sourceKey("main"), writeProfile: sourceKey("main"), schema: schemaFor("main"), evidence },
        initialization: { stepId: "neutral-non-null-seed", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } } };
    const host = await Effect.runPromise(makeCommerceHost(hostInput)); cleanup.push(() => Effect.runPromise(host.close));
    await Effect.runPromise(host.initialize([]));
    const run = (command: typeof insert, input: Json) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
    const inventory = async () => ({
      current: await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent).where(inArray(fxAppIndexEntryCurrent.indexDefinitionId,
        fixture.catalog.ordered.filter(member => member.definition.access.tableId === mainTable.tableId).map(member => member.definition.indexDefinitionId)))
        .orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
      revisions: await fixture.persistence.drizzle.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.tableId, mainTable.tableId))
        .orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    });
    const memberCounts = (snapshot: Awaited<ReturnType<typeof inventory>>) => definitions.map(definition => snapshot.current.filter(row => row.indexDefinitionId === definition.indexDefinitionId).length);
    let snapshot = await inventory();
    await run(insert, [{ id: "online", value: null, mixed_value: null }]);
    snapshot = await inventory(); expect(memberCounts(snapshot)).toEqual([0, 0]);
    const request = host.newRequestKey();
    const entered = await Effect.runPromise(host.run(request, update, { id: "online", value: "", mixed_value: "" }));
    snapshot = await inventory(); expect(memberCounts(snapshot)).toEqual([1, 1]);
    expect(await Effect.runPromise(host.run(request, update, { id: "online", value: "", mixed_value: "" }))).toEqual(entered);
    expect(await inventory()).toEqual(snapshot);
    await run(lifecycle, "softDelete"); snapshot = await inventory();
    expect(definitions.map(definition => [definition.physicalSpec.predicate?.kind, snapshot.current.filter(row => row.indexDefinitionId === definition.indexDefinitionId).length]))
      .toEqual(expect.arrayContaining([["fieldIsNotNull", 1], ["fieldIsNullAndNotNull", 0]]));
    await run(lifecycle, "restore"); snapshot = await inventory(); expect(memberCounts(snapshot)).toEqual([1, 1]);
    await expect(run(failed, null)).rejects.toBeDefined(); expect(await inventory()).toEqual(snapshot);
    await run(update, { id: "online", value: null }); snapshot = await inventory();
    expect(definitions.map(definition => [definition.physicalSpec.predicate?.kind, snapshot.current.filter(row => row.indexDefinitionId === definition.indexDefinitionId).length]))
      .toEqual(expect.arrayContaining([["fieldIsNotNull", 0], ["fieldIsNullAndNotNull", 1]]));
    const cold = await Effect.runPromise(makeCommerceHost(hostInput)); cleanup.push(() => Effect.runPromise(cold.close));
    await Effect.runPromise(cold.run(cold.newRequestKey(), update, { id: "online", value: "back", mixed_value: null }));
    snapshot = await inventory();
    expect(definitions.map(definition => [definition.physicalSpec.predicate?.kind, snapshot.current.filter(row => row.indexDefinitionId === definition.indexDefinitionId).length]))
      .toEqual(expect.arrayContaining([["fieldIsNotNull", 1], ["fieldIsNullAndNotNull", 0]]));
    // Cold persisted metadata probes and the ordinary row planner must agree.
    // Missing/null guards and upper-only ranges cannot borrow narrow membership.
    const access = { deploymentId: fixture.application.deploymentId, schemaVersionId: fixture.schemaVersionId, sourceKey: sourceKey("main"), localName: "entry" };
    const located = await Effect.runPromise(Effect.forEach(definitions, definition => locateAppIndexDefinitionByIdEffect(fixture.control.drizzle,
      fixture.application.authority.scopeId, definition.indexDefinitionId)));
    if (located.some(definition => definition === null)) throw new Error("Missing cold ordered definition");
    const valid = located.filter(definition => definition !== null);
    await fixture.control.drizzle.transaction(async tx => {
      const checks: readonly [LogicalWhere, boolean][] = [
        [{ value: "" }, true], [{ value: false }, true], [{ value: 0 }, true], [{ value: null }, false], [{ id: "online" }, false],
        [{ value: { gt: null } }, true], [{ value: { gte: "" } }, true], [{ value: { gte: null } }, false], [{ value: { lt: "z" } }, false],
        [{ mixed_value: "", retired: null }, true], [{ mixed_value: "" }, false], [{ mixed_value: null, retired: null }, false],
      ];
      for (const [where, eligible] of checks) {
        const rows = await logicalIndexReadAccessQuery(tx, access, where);
        const selected = Result.getOrThrow(selectLogicalIndex(valid, mainTable.tableId, where, (reason, cause) => new Error(reason, { cause })));
        expect(rows.some(row => definitions.some(definition => definition.indexDefinitionId === Schema.decodeUnknownSync(Schema.JsonObject)(row.projectionJson).indexDefinitionId)), JSON.stringify(where)).toBe(eligible);
        expect(Option.isSome(selected), JSON.stringify(where)).toBe(eligible);
      }
      for (const [nulls, equality, expected] of [
        [["retired"], { column: "mixed_value", value: "" }, true],
        [[], { column: "mixed_value", value: "" }, false],
        [["retired"], undefined, false],
      ] as const) {
        const rows = await logicalPageReadAccessQuery(tx, access, ["mixed_value", "retired"], equality, nulls);
        expect(rows).toHaveLength(expected ? 1 : 0);
      }
    });
  } finally {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) try { await close(); } catch (cause) { failures.push(cause); }
    if (failures.length > 0) throw new AggregateError(failures, "Neutral non-null fixture cleanup failed");
  }
}
