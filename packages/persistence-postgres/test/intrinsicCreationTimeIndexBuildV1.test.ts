import { eq } from "drizzle-orm";
import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import {
  canonicalizeFlarexValueV1,
} from "flarex-protocol/value";
import {
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
  orderedIndexRowIdHexV1FromBytesResult,
} from "flarex-protocol/ordered-index";

import {
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
} from "../src/appIndexEntries";
import {
  locateAppIndexDefinitionByIdEffect,
} from "../src/appIndexDefinitions";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
  IntrinsicCreationTimeIndexBuildIntegrationV1Error,
  IntrinsicCreationTimeIndexBuildStateV1Error,
  InvalidIntrinsicCreationTimeIndexBuildInputV1Error,
  type BuildIntrinsicCreationTimeIndexV1Error,
  type IntrinsicCreationTimeIndexBuildResultV1,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import {
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
} from "../src/schema";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "c08-i1-pglite",
  schemaName: "public",
} as const);

describe("C08-I1 intrinsic creation-time index build and maintenance", () => {
  it("exposes one precise private Effect contract and validates its work budget", async () => {
    expectTypeOf<ReturnType<typeof buildIntrinsicCreationTimeIndexV1Effect>>()
      .toEqualTypeOf<import("effect").Effect.Effect<
        IntrinsicCreationTimeIndexBuildResultV1,
        BuildIntrinsicCreationTimeIndexV1Error
      >>();
    const fixture = await makeFixture("input");
    const failure = await runEffectFailure(
      buildIntrinsicCreationTimeIndexV1Effect(fixture.ports, {
        deploymentId: fixture.deploymentId,
        indexDefinitionId: fixture.indexDefinitionId,
        pageSize: 17,
      }),
    );
    expect(failure).toBeInstanceOf(
      InvalidIntrinsicCreationTimeIndexBuildInputV1Error,
    );
  });

  it("advances the exact C4 lifecycle, backfills bounded pages, and cold-replays enabled state", async () => {
    const fixture = await makeFixture("lifecycle", [
      { rowByte: 0x10, creationTime: 10 },
      { rowByte: 0x20, creationTime: 20 },
      { rowByte: 0x30, creationTime: 30 },
    ]);
    const results = await buildUntilEnabled(fixture, 1);
    expect(results.map(result => result.lifecycle)).toEqual([
      "building",
      "backfilling",
      "backfilling",
      "backfilling",
      "validating",
      "validating",
      "validating",
      "enabled",
    ]);
    expect(await currentIndexRows(fixture.persistence)).toHaveLength(3);

    const coldTarget = createPGliteLocatedIndexBuildReconciliationTargetV1(
      fixture.persistence,
      LOCATOR,
    );
    const replay = await runEffect(buildIntrinsicCreationTimeIndexV1Effect({
      ...fixture.ports,
      authority: {
        ...fixture.ports.authority,
        scopeClockTargets: { resolve: async () => coldTarget },
      },
    }, buildInput(fixture, 1)));
    expect(replay).toMatchObject({
      status: "replayed",
      lifecycle: "enabled",
      processedRows: 0,
    });
  });

  it("does not resurrect a deleted row and catches an insert behind the backfill cursor", async () => {
    const fixture = await makeFixture("race", [
      { rowByte: 0x10, creationTime: 10 },
      { rowByte: 0x20, creationTime: 20 },
    ]);
    await buildStep(fixture, 1); // declared -> building
    await buildStep(fixture, 1); // building -> backfilling
    const firstPage = await buildStep(fixture, 1);
    expect(firstPage.cursorRowId).toBe("10".repeat(16));

    await deleteWithoutPriorIndexEntry(fixture, 0x20, 3n, 2n, 20);
    await insertWithOnlineIndexMaintenance(fixture, 0x05, 4n, 5);
    const remaining = await buildUntilEnabled(fixture, 1);
    expect(remaining.at(-1)?.lifecycle).toBe("enabled");

    const rows = await currentIndexRows(fixture.persistence);
    expect(rows.map(row => Buffer.from(row.row_id).toString("hex"))).toEqual([
      "05".repeat(16),
      "10".repeat(16),
    ]);
    expect(rows.map(row => row.commit_seq)).toEqual(["4", "1"]);
  });

  it("rolls back page faults and leaves validating unreachable on exact-content mismatch", async () => {
    const fixture = await makeFixture("rollback", [
      { rowByte: 0x11, creationTime: 11 },
    ]);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);
    const failure = await runEffectFailure(
      buildIntrinsicCreationTimeIndexV1Effect(
        fixture.ports,
        buildInput(fixture, 1),
        {
          faultAfter: point => {
            if (point === "afterEntryWrite") {
              throw new Error("injected page rollback");
            }
          },
        },
      ),
    );
    expect(failure).toBeInstanceOf(
      IntrinsicCreationTimeIndexBuildIntegrationV1Error,
    );
    expect(await currentIndexRows(fixture.persistence)).toEqual([]);
    expect(await buildState(fixture)).toMatchObject({
      lifecycle: "backfilling",
      backfill_cursor_row_id: null,
    });

    await buildStep(fixture, 1);
    await fixture.persistence.query("delete from fx_app_index_entry_current");
    const mismatch = await runEffectFailure(
      buildIntrinsicCreationTimeIndexV1Effect(
        fixture.ports,
        buildInput(fixture, 1),
      ),
    );
    expect(mismatch).toBeInstanceOf(
      IntrinsicCreationTimeIndexBuildStateV1Error,
    );
    expect(mismatch).toMatchObject({ reason: "currentContentsMismatch" });
    expect(await buildState(fixture)).toMatchObject({
      lifecycle: "validating",
    });
  });

  it("rejects a current index entry without an authoritative live row", async () => {
    const fixture = await makeFixture("index-only", [
      { rowByte: 0x12, creationTime: 12 },
    ]);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);
    await fixture.persistence.query("delete from fx_app_row_current");

    const mismatch = await runEffectFailure(
      buildIntrinsicCreationTimeIndexV1Effect(
        fixture.ports,
        buildInput(fixture, 1),
      ),
    );
    expect(mismatch).toBeInstanceOf(
      IntrinsicCreationTimeIndexBuildStateV1Error,
    );
    expect(mismatch).toMatchObject({ reason: "currentContentsMismatch" });
    expect(await buildState(fixture)).toMatchObject({
      lifecycle: "validating",
    });
  });
});

interface Fixture {
  readonly persistence: PGliteFlarexPersistence;
  readonly deploymentId: string;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly indexDefinitionId: ReturnType<
    typeof decodeCatalogIndexDefinitionId
  >;
  readonly ports: Parameters<typeof buildIntrinsicCreationTimeIndexV1Effect>[0];
}

async function makeFixture(
  suffix: string,
  rows: ReadonlyArray<Readonly<{
    rowByte: number;
    creationTime: number;
  }>> = [],
): Promise<Fixture> {
  const persistence = await createMigratedPGlitePersistence();
  const deploymentId = `deployment_c08_${suffix}`;
  const scopeId = ScopeIdSchema.make(
    "scope_c0800000-0000-0000-0000-000000000001",
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_c08_${suffix}`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_c08_${suffix}`,
  });
  await persistence.insertScopeMetadata({ scopeId, deploymentId, physicalLocator: LOCATOR });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, ScopeEpochSchema.make(
      "epoch_c0800000-0000-0000-0000-000000000001",
    )],
  );
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [{
      logicalName: "users",
      definition: {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: {
          type: "object",
          value: {
            name: { fieldType: { type: "string" }, optional: false },
          },
        },
      },
    }],
    indexes: [],
  });
  for (const [index, row] of rows.entries()) {
    await insertRow(
      persistence,
      scopeId,
      schemaVersionId,
      row.rowByte,
      BigInt(index + 1),
      row.creationTime,
    );
  }
  const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
    persistence,
    LOCATOR,
  );
  const ports = {
    controlDb: persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (value: string) =>
          persistence.getScopeMetadataByDeploymentId(value),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
  } as const;
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId,
    schemaVersionId,
  }));
  return {
    persistence,
    deploymentId,
    scopeId,
    schemaVersionId,
    indexDefinitionId: decodeCatalogIndexDefinitionId(1),
    ports,
  };
}

async function insertRow(
  persistence: PGliteFlarexPersistence,
  scopeId: Fixture["scopeId"],
  schemaVersionId: Fixture["schemaVersionId"],
  rowByte: number,
  commitSeqValue: bigint,
  creationTimeValue: number,
): Promise<void> {
  const rowId = decodeAppRowIdHexV1(rowByte.toString(16).padStart(2, "0").repeat(16));
  const tableId = decodeCatalogTableId(1);
  const creationTime = decodeAppCreationTimeV1(creationTimeValue);
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
  const document = await canonicalizeFlarexValueV1({
    _id: documentId,
    _creationTime: creationTime,
    name: `row-${rowByte}`,
  }, "appDocument");
  const clock = await persistence.getScopeClock(scopeId);
  if (clock === null) throw new Error("C08 fixture scope clock missing");
  const commitSeq = CommitSeqSchema.make(commitSeqValue);
  await persistence.drizzle.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId,
      tableId,
      rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
      eq(fxSystemScopeClocks.scopeId, scopeId),
    );
  });
}

async function deleteWithoutPriorIndexEntry(
  fixture: Fixture,
  rowByte: number,
  commitSeqValue: bigint,
  prevCommitSeqValue: bigint,
  creationTimeValue: number,
): Promise<void> {
  const clock = await fixture.persistence.getScopeClock(fixture.scopeId);
  if (clock === null) throw new Error("C08 fixture scope clock missing");
  const commitSeq = CommitSeqSchema.make(commitSeqValue);
  await fixture.persistence.drizzle.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "tombstone",
      scopeId: fixture.scopeId,
      tableId: decodeCatalogTableId(1),
      rowId: decodeAppRowIdHexV1(
        rowByte.toString(16).padStart(2, "0").repeat(16),
      ),
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: CommitSeqSchema.make(prevCommitSeqValue),
      schemaVersionId: fixture.schemaVersionId,
      creationTime: decodeAppCreationTimeV1(creationTimeValue),
    });
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
      eq(fxSystemScopeClocks.scopeId, fixture.scopeId),
    );
  });
}

async function insertWithOnlineIndexMaintenance(
  fixture: Fixture,
  rowByte: number,
  commitSeqValue: bigint,
  creationTimeValue: number,
): Promise<void> {
  const clock = await fixture.persistence.getScopeClock(fixture.scopeId);
  if (clock === null) throw new Error("C08 fixture scope clock missing");
  const definition = await runEffect(locateAppIndexDefinitionByIdEffect(
    fixture.persistence.drizzle,
    fixture.scopeId,
    fixture.indexDefinitionId,
  ));
  if (definition === null) throw new Error("C08 intrinsic definition missing");
  const rowId = decodeAppRowIdHexV1(
    rowByte.toString(16).padStart(2, "0").repeat(16),
  );
  const creationTime = decodeAppCreationTimeV1(creationTimeValue);
  const commitSeq = CommitSeqSchema.make(commitSeqValue);
  const tableId = decodeCatalogTableId(1);
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
  const document = await canonicalizeFlarexValueV1({
    _id: documentId,
    _creationTime: creationTime,
    name: `row-${rowByte}`,
  }, "appDocument");
  await fixture.persistence.drizzle.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: fixture.scopeId,
      tableId,
      rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: fixture.schemaVersionId,
      creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    const indexRowId = Result.getOrThrow(
      orderedIndexRowIdHexV1FromBytesResult(appRowIdHexV1ToBytes(rowId)),
    );
    const entry = await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
      tx,
      {
        kind: "live",
        scopeId: fixture.scopeId,
        definition,
        encodedKey: encodeAppOrderedIndexKeyV1({
          spec: definition.physicalSpec,
          values: [orderedIndexCreationTimeV1(creationTime)],
        }),
        rowId: indexRowId,
        writeEpoch: clock.epoch,
        commitSeq,
        prevCommitSeq: null,
      },
    );
    if (Result.isFailure(entry)) throw entry.failure;
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
      eq(fxSystemScopeClocks.scopeId, fixture.scopeId),
    );
  });
}

function buildInput(fixture: Fixture, pageSize: number) {
  return {
    deploymentId: fixture.deploymentId,
    indexDefinitionId: fixture.indexDefinitionId,
    pageSize,
  };
}

function buildStep(fixture: Fixture, pageSize: number) {
  return runEffect(buildIntrinsicCreationTimeIndexV1Effect(
    fixture.ports,
    buildInput(fixture, pageSize),
  ));
}

async function buildUntilEnabled(fixture: Fixture, pageSize: number) {
  const results: IntrinsicCreationTimeIndexBuildResultV1[] = [];
  for (let step = 0; step < 16; step += 1) {
    const current = await buildStep(fixture, pageSize);
    results.push(current);
    if (current.lifecycle === "enabled") return results;
  }
  throw new Error("C08 builder did not reach enabled within its bounded proof");
}

function currentIndexRows(persistence: PGliteFlarexPersistence) {
  return persistence.query<{
    row_id: Uint8Array;
    commit_seq: string;
  }>(
    `select row_id, commit_seq::text as commit_seq
       from fx_app_index_entry_current order by row_id`,
  ).then(result => result.rows);
}

function buildState(fixture: Fixture) {
  return fixture.persistence.query<{
    lifecycle: string;
    backfill_cursor_row_id: Uint8Array | null;
  }>(
    `select lifecycle, backfill_cursor_row_id
       from fx_system_index_build_state
      where scope_id = $1 and index_definition_id = $2`,
    [fixture.scopeId, fixture.indexDefinitionId],
  ).then(result => result.rows[0]);
}
