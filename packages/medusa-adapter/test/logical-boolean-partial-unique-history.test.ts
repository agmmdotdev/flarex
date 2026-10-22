import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareBooleanPartialIndexSchema } from "./support/boolean-partial-index-schema";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { runEffectTransaction } from "../../persistence-postgres/src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/database/metadataTransaction";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../persistence-postgres/src/scope/scopeClock";
import { makeLogicalDocumentWorkingSet, type LogicalDocumentReadTestHooks } from "../../persistence-postgres/src/storage/documents/logicalDocuments/workingSet";
import { prepareLogicalRelationalValueValidation } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalValues";
import { locateAppIndexDefinitionByIdEffect } from "../../persistence-postgres/src/storage/indexes/appIndexDefinitions";
import { locateAppUniqueConstraintDefinitionsForSchemaEffect } from "../../persistence-postgres/src/storage/unique/appUniqueConstraintDefinitions";
import { fxControlIndexDefinitions, fxControlLogicalReadTables, fxAppUniqueKeys, fxAppRowCurrent,
  fxAppRowRevisions, fxAppIndexEntryRevisions, fxSystemCommits } from "../../persistence-postgres/src/database/schema";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const sourceKey = "medusa.boolean-partial-unique-history", evidence = { kind: "nativeDml", sourceId: "BooleanPartialAddress.history" };
const error = (reason: string, cause?: unknown) => new Error(reason, { cause });
let schema: Effect.Success<ReturnType<typeof prepareBooleanPartialIndexSchema>>;
let tableName: string;
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let owners: Awaited<ReturnType<typeof prepareOwners>>;
const insert = defineCommerceCommand("booleanUniqueHistoryInsert", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "insert", input)];
}));
const update = defineCommerceCommand("booleanUniqueHistoryUpdate", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "update", input)];
}));
const run = (command: typeof insert, input: Json) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
const transact = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
  runEffectTransaction(callback => fixture.persistence.drizzle.transaction(callback), "Boolean historical unique read", work,
    cause => error("statementFailure", cause));
const currentClock = () => transact(tx => lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.application.authority.scopeId));
const claims = () => fixture.persistence.drizzle.select().from(fxAppUniqueKeys)
  .where(eq(fxAppUniqueKeys.constraintId, owners.conditionalUnique.uniqueConstraintDefinitionId));
const durable = async () => ({
  rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
  revisions: await fixture.persistence.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
  indexRevisions: await fixture.persistence.drizzle.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.indexDefinitionId,
    fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq, fxAppIndexEntryRevisions.encodedKey),
  claims: await claims(), commits: await fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
});

async function prepareOwners() {
  const [table] = await fixture.control.drizzle.select().from(fxControlLogicalReadTables).where(and(
    eq(fxControlLogicalReadTables.deploymentId, fixture.deploymentId), eq(fxControlLogicalReadTables.schemaVersionId, fixture.schemaVersionId),
    eq(fxControlLogicalReadTables.sourceKey, sourceKey), eq(fxControlLogicalReadTables.localName, tableName)));
  if (table === undefined) throw new Error("Missing installed Boolean table binding");
  const rows = await fixture.control.drizzle.select().from(fxControlIndexDefinitions).where(and(
    eq(fxControlIndexDefinitions.deploymentId, fixture.deploymentId), eq(fxControlIndexDefinitions.tableId, table.tableId)));
  const indexes = await Effect.runPromise(Effect.forEach(rows, row => locateAppIndexDefinitionByIdEffect(fixture.control.drizzle,
    fixture.application.authority.scopeId, row.indexDefinitionId).pipe(Effect.flatMap(located => located === null
      ? Effect.die("Missing authenticated Boolean index definition") : Effect.succeed(located)))));
  const unique = await Effect.runPromise(locateAppUniqueConstraintDefinitionsForSchemaEffect(fixture.control.drizzle, fixture.deploymentId,
    fixture.application.authority.scopeId, fixture.schemaVersionId, [table.tableId], 16));
  if (unique === null) throw new Error("Missing authenticated Boolean unique definitions");
  const conditionalUnique = unique.find(definition => definition.physicalSpec.predicate?.kind === "fieldIsNullAndBooleanEquals");
  const conditionalIndex = indexes.find(definition => definition.physicalSpec.predicate?.kind === "fieldIsNullAndBooleanEquals" &&
    definition.physicalSpec.orderedFields[0]?.kind === "documentPath" && definition.physicalSpec.orderedFields[0].path === "parent_id");
  const relational = schema.tables[0];
  if (conditionalUnique === undefined || conditionalIndex === undefined || relational === undefined) throw new Error("Missing exact conditional unique/index pair");
  expect(conditionalUnique.physicalSpec.orderedFields).toEqual(["parent_id"]);
  expect(conditionalIndex.physicalSpec.predicate).toEqual(conditionalUnique.physicalSpec.predicate);
  const values = await Effect.runPromise(prepareLogicalRelationalValueValidation(fixture.control.drizzle,
    fixture.deploymentId, fixture.schemaVersionId, { kind: "fresh" }));
  return { table: { tableId: table.tableId, logicalName: tableName, relational }, indexes, unique, conditionalUnique, conditionalIndex, values };
}

/** Same lower-owner construction used by productHistoricalWorkingSetScenario.
 * Installed commerce owns every committed setup write. This disposable pending
 * working set has no materializer or settlement path. */
const attempt = (snapshotCommitSeq: CommitSeq, id: string, parent: string, conflict: boolean) => Effect.scoped(Effect.gen(function* () {
  const clock = yield* currentClock();
  expect(clock.lastCommitSeq > snapshotCommitSeq).toBe(true);
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
    { calls: 32, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, "boolean-historical-unique", "write"), value => value.close);
  const indexQueries: Array<Parameters<NonNullable<LogicalDocumentReadTestHooks<Error>["observeIndexQuery"]>>[0]> = [];
  const conflicts: string[][] = [];
  const working = yield* makeLogicalDocumentWorkingSet<Error>({ readTransaction: transact, snapshotCommitSeq,
    scopeId: fixture.application.authority.scopeId, clock, lifetime, tables: [owners.table], relationalCapabilities: schema.capabilities,
    requireAdmission: Effect.void, validateDocument: write => Effect.fromResult(owners.values.validate(write.tableId, write.document))
      .pipe(Effect.mapError(cause => error("documentInvalid", cause))), error,
    uniqueConflict: constraint => { conflicts.push([...constraint.orderedFields]); return error("uniqueConflict"); },
    limits: { pageRows: 32, identities: 32, documentBytes: 65_536 },
  }, AppCreationTimeV1Schema.make(1), owners.unique, owners.indexes, { observeIndexQuery: query => { indexQueries.push(query); } });
  const transactionId = yield* lifetime.begin(lifetime.context);
  const table = yield* working.relationalTable(lifetime.context, transactionId, tableName);
  const result = yield* Effect.result(table.write(lifetime.context, "insert", [{ id, parent_id: parent, selected: true }]));
  if (conflict) {
    expect(result).toMatchObject({ _tag: "Failure", failure: { message: "uniqueConflict" } });
    expect(conflicts).toEqual([["parent_id"]]); expect(working.attemptCount()).toBe(0);
  } else {
    expect(result).toMatchObject({ _tag: "Success", success: [{ id, parent_id: parent, selected: true }] });
    expect(conflicts).toEqual([]); expect(working.attemptCount()).toBe(1);
    yield* lifetime.seal;
    const closed = yield* working.close();
    expect(closed.uniqueReads.find(read => read.constraintId === owners.conditionalUnique.uniqueConstraintDefinitionId)?.owner).toBeNull();
    const retained = closed.indexReads.find(read => read.definition.indexDefinitionId === owners.conditionalIndex.indexDefinitionId);
    expect(retained).toBeDefined(); expect(retained?.entries).toEqual([]);
  }
  // The conditional unique callback is reached through the real historical
  // ordered-index reader, with the installed definition and pinned sequence.
  const conditionalReads = indexQueries.filter(query => String(query.params[1]) === String(owners.conditionalIndex.indexDefinitionId));
  expect(conditionalReads).toHaveLength(1);
  expect(conditionalReads[0]?.sql).toContain("fx_read_snapshot_index_page");
  expect(String(conditionalReads[0]?.params[2])).toBe(String(snapshotCommitSeq));
}));

describe("installed Boolean partial unique history", { concurrent: false }, () => {
  beforeAll(async () => {
    schema = await Effect.runPromise(prepareBooleanPartialIndexSchema());
    const table = schema.tables[0]; if (table === undefined) throw new Error("Missing native Boolean table"); tableName = table.identity.tableId;
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: tableName,
        table: { namespace: "medusa", logicalName: "boolean-partial-history/addresses" } }] }));
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => error("invalidDataset"), hashFailure: cause => error("datasetHash", cause) }));
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands: [insert, update], logicalStorage: {
      ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "boolean-history-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } } }));
    cleanup.push(() => Effect.runPromise(host.close)); await Effect.runPromise(host.initialize([])); owners = await prepareOwners();
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("rejects a historical owner even after its current conditional claim is released", async () => {
    await run(insert, [{ id: "historical-a", parent_id: "parent-p", selected: true }]);
    const snapshot = await Effect.runPromise(currentClock()); expect(await claims()).toHaveLength(1);
    await run(update, [{ id: "historical-a", selected: false }]); expect(await claims()).toEqual([]);
    const before = await durable();
    await Effect.runPromise(attempt(snapshot.lastCommitSeq, "historical-b", "parent-p", true));
    expect(await durable()).toEqual(before);
  });

  it("retains historical absence despite a later current claim without publishing a pending insert", async () => {
    const snapshot = await Effect.runPromise(currentClock()); expect(await claims()).toEqual([]);
    await run(insert, [{ id: "current-c", parent_id: "parent-q", selected: true }]); expect(await claims()).toHaveLength(1);
    const before = await durable();
    await Effect.runPromise(attempt(snapshot.lastCommitSeq, "historical-pending-b", "parent-q", false));
    expect(await durable()).toEqual(before);
  });
});
