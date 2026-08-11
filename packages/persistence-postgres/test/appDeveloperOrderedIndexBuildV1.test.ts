import { eq } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
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
  locateAppIndexDefinitionByIdEffect,
} from "../src/appIndexDefinitions";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  AppDeveloperOrderedIndexBuildIntegrationV1Error,
  AppDeveloperOrderedIndexBuildDecisionUncertainV1Error,
  AppDeveloperOrderedIndexBuildStateV1Error,
  AppDeveloperOrderedIndexDefinitionUnavailableV1Error,
  buildAppDeveloperOrderedIndexV1Effect,
  type AppDeveloperOrderedIndexBuildResultV1,
  type BuildAppDeveloperOrderedIndexV1Error,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  createLocatedIndexBuildReconciliationTargetV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "../src/transactionSessionActivation";
import { LocatedReadCommittedTransactionFailureV1 } from
  "../src/transactionSessionAttemptKernel";
import { fxSystemScopeClocks } from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "c08-developer-build-pglite",
  schemaName: "public",
} as const);

describe("C08 developer ordered-index build", () => {
  it("keeps the developer entry point exact instead of widening intrinsic acceptance", async () => {
    const fixture = await makeFixture("exact-kind", []);
    const failure = await runEffectFailure(buildAppDeveloperOrderedIndexV1Effect(
      fixture.ports,
      {
        deploymentId: fixture.deploymentId,
        indexDefinitionId: fixture.intrinsicDefinitionId,
        pageSize: 1,
      },
    ));
    expect(failure).toBeInstanceOf(
      AppDeveloperOrderedIndexDefinitionUnavailableV1Error,
    );
    expect(failure).toMatchObject({ reason: "notDeveloper" });
  });

  it("exposes one typed private Effect contract and advances the existing C4 row", async () => {
    expectTypeOf<ReturnType<typeof buildAppDeveloperOrderedIndexV1Effect>>()
      .toEqualTypeOf<import("effect").Effect.Effect<
        AppDeveloperOrderedIndexBuildResultV1,
        BuildAppDeveloperOrderedIndexV1Error
      >>();
    const fixture = await makeFixture("lifecycle", [
      { rowByte: 0x10, name: "Zoe" },
      { rowByte: 0x20, name: "Ada" },
    ]);
    const results = await buildUntilEnabled(fixture, 1);
    expect(results.map(result => result.lifecycle)).toEqual([
      "building",
      "backfilling",
      "backfilling",
      "validating",
      "validating",
      "enabled",
    ]);
    const rows = await currentIndexRows(fixture);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.row_id_hex)).toEqual([
      "20".repeat(16),
      "10".repeat(16),
    ]);

    const coldTarget = createPGliteLocatedIndexBuildReconciliationTargetV1(
      fixture.persistence,
      LOCATOR,
    );
    const replay = await runEffect(buildAppDeveloperOrderedIndexV1Effect({
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

  it("rolls back a page fault and retries the exact S10 append", async () => {
    const fixture = await makeFixture("rollback", [
      { rowByte: 0x11, name: "Ada" },
    ]);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);
    const failure = await runEffectFailure(
      buildAppDeveloperOrderedIndexV1Effect(
        fixture.ports,
        buildInput(fixture, 1),
        {
          faultAfter: point => {
            if (point === "afterEntryWrite") {
              throw new Error("injected developer-index page rollback");
            }
          },
        },
      ),
    );
    expect(failure).toBeInstanceOf(
      AppDeveloperOrderedIndexBuildIntegrationV1Error,
    );
    expect(await currentIndexRows(fixture)).toEqual([]);
    expect(await buildState(fixture)).toMatchObject({
      lifecycle: "backfilling",
      cursor: null,
    });

    await buildUntilEnabled(fixture, 1);
    expect(await currentIndexRows(fixture)).toHaveLength(1);
  });

  it("surfaces a committed uncertain step and cold-replays without duplicate sidecars", async () => {
    const fixture = await makeFixture("uncertain", [
      { rowByte: 0x15, name: "Ada" },
    ]);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);

    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.persistence.drizzle,
    );
    let injected = false;
    const uncertainTarget = createLocatedIndexBuildReconciliationTargetV1(
      fixture.persistence.drizzle,
      LOCATOR,
      async (work) => {
        const result = await baseRunner(work);
        if (!injected) {
          injected = true;
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost developer build response"),
          }));
        }
        return result;
      },
    );
    const failure = await runEffectFailure(
      buildAppDeveloperOrderedIndexV1Effect({
        ...fixture.ports,
        authority: {
          ...fixture.ports.authority,
          scopeClockTargets: { resolve: async () => uncertainTarget },
        },
      }, buildInput(fixture, 1)),
    );
    expect(injected).toBe(true);
    expect(failure).toBeInstanceOf(
      AppDeveloperOrderedIndexBuildDecisionUncertainV1Error,
    );
    expect(await buildState(fixture)).toMatchObject({
      lifecycle: "validating",
      cursor: null,
    });
    expect(await currentIndexRows(fixture)).toHaveLength(1);
    expect(await indexRevisionCount(fixture)).toBe(1);

    const results = await buildUntilEnabled(fixture, 1);
    expect(results.at(-1)?.lifecycle).toBe("enabled");
    expect(await currentIndexRows(fixture)).toHaveLength(1);
    expect(await indexRevisionCount(fixture)).toBe(1);
  });

  it("fails closed on canonical document corruption without advancing state", async () => {
    const fixture = await makeFixture("corruption", [
      { rowByte: 0x12, name: "Ada" },
    ]);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);
    await fixture.persistence.query(
      `update fx_app_row_rev
          set value_sha256 = decode(repeat('00', 32), 'hex')
        where scope_uuid = $1`,
      ["c08d0000-0000-0000-0000-000000000001"],
    );

    const failure = await runEffectFailure(buildAppDeveloperOrderedIndexV1Effect(
      fixture.ports,
      buildInput(fixture, 1),
    ));
    expect(failure).toBeInstanceOf(AppDeveloperOrderedIndexBuildStateV1Error);
    expect(failure).toMatchObject({ reason: "storedDocumentInvalid" });
    expect(await currentIndexRows(fixture)).toEqual([]);
    expect(await buildState(fixture)).toMatchObject({
      lifecycle: "backfilling",
      cursor: null,
    });
  });

  it("rejects a canonical document whose trusted identity does not match the row", async () => {
    const fixture = await makeFixture("identity", [
      { rowByte: 0x13, name: "Ada" },
    ]);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);
    const wrongRowId = decodeAppRowIdHexV1("99".repeat(16));
    const wrongDocument = await canonicalizeAppDocumentV1({
      tableId: decodeCatalogTableId(1),
      rowId: wrongRowId,
      creationTime: decodeAppCreationTimeV1(1),
      fields: { name: "Ada" },
    });
    await fixture.persistence.query(
      `update fx_app_row_rev
          set value_json = $1::jsonb, value_bytes = $2, value_sha256 = $3
        where scope_uuid = $4`,
      [
        JSON.stringify(wrongDocument.valueJson),
        wrongDocument.canonicalBytes,
        wrongDocument.sha256,
        "c08d0000-0000-0000-0000-000000000001",
      ],
    );
    const failure = await runEffectFailure(buildAppDeveloperOrderedIndexV1Effect(
      fixture.ports,
      buildInput(fixture, 1),
    ));
    expect(failure).toBeInstanceOf(AppDeveloperOrderedIndexBuildStateV1Error);
    expect(failure).toMatchObject({ reason: "storedDocumentInvalid" });
    expect(await currentIndexRows(fixture)).toEqual([]);
  });

  it("rejects an oversized derived ordered key before writing sidecars", async () => {
    const fixture = await makeFixture("key-limit", [
      { rowByte: 0x14, name: "x".repeat(3_000) },
    ]);
    await buildStep(fixture, 1);
    await buildStep(fixture, 1);
    const failure = await runEffectFailure(buildAppDeveloperOrderedIndexV1Effect(
      fixture.ports,
      buildInput(fixture, 1),
    ));
    expect(failure).toBeInstanceOf(AppDeveloperOrderedIndexBuildStateV1Error);
    expect(failure).toMatchObject({ reason: "indexKeyLimitExceeded" });
    expect(await currentIndexRows(fixture)).toEqual([]);
    expect(await buildState(fixture)).toMatchObject({
      lifecycle: "backfilling",
      cursor: null,
    });
  });
});

interface Fixture {
  readonly persistence: PGliteFlarexPersistence;
  readonly deploymentId: string;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly indexDefinitionId: ReturnType<typeof decodeCatalogIndexDefinitionId>;
  readonly intrinsicDefinitionId: ReturnType<
    typeof decodeCatalogIndexDefinitionId
  >;
  readonly ports: Parameters<typeof buildAppDeveloperOrderedIndexV1Effect>[0];
}

async function makeFixture(
  suffix: string,
  rows: ReadonlyArray<Readonly<{ rowByte: number; name: string }>>,
): Promise<Fixture> {
  const persistence = await createMigratedPGlitePersistence();
  const deploymentId = `deployment_c08_dev_${suffix}`;
  const scopeId = ScopeIdSchema.make(
    "scope_c08d0000-0000-0000-0000-000000000001",
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_c08_dev_${suffix}`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_c08_dev_${suffix}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [
      scopeId,
      ScopeEpochSchema.make("epoch_c08d0000-0000-0000-0000-000000000001"),
    ],
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
    indexes: [{
      tableLogicalName: "users",
      descriptor: "by_name",
      fields: ["name"],
    }],
  });
  for (const [index, row] of rows.entries()) {
    await insertRow(
      persistence,
      scopeId,
      schemaVersionId,
      row.rowByte,
      BigInt(index + 1),
      row.name,
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
  const reconciliation = await runEffect(reconcilePublishedIndexBuildsV1Effect(
    ports,
    { deploymentId, schemaVersionId },
  ));
  if (reconciliation.status !== "reconciled") {
    throw new Error("Developer index fixture did not reconcile definitions.");
  }
  let indexDefinitionId: Fixture["indexDefinitionId"] | undefined;
  let intrinsicDefinitionId: Fixture["intrinsicDefinitionId"] | undefined;
  for (const candidate of reconciliation.definitionIds) {
    const definition = await runEffect(locateAppIndexDefinitionByIdEffect(
      persistence.drizzle,
      scopeId,
      candidate,
    ));
    if (definition?.access.kind === "developer") {
      indexDefinitionId = candidate;
    } else if (definition?.access.kind === "by_creation_time") {
      intrinsicDefinitionId = candidate;
    }
  }
  if (indexDefinitionId === undefined || intrinsicDefinitionId === undefined) {
    throw new Error("Developer index fixture omitted a required definition.");
  }
  return {
    persistence,
    deploymentId,
    scopeId,
    schemaVersionId,
    indexDefinitionId,
    intrinsicDefinitionId,
    ports,
  };
}

async function insertRow(
  persistence: PGliteFlarexPersistence,
  scopeId: Fixture["scopeId"],
  schemaVersionId: Fixture["schemaVersionId"],
  rowByte: number,
  commitSeqValue: bigint,
  name: string,
): Promise<void> {
  const rowId = decodeAppRowIdHexV1(
    rowByte.toString(16).padStart(2, "0").repeat(16),
  );
  const tableId = decodeCatalogTableId(1);
  const creationTime = decodeAppCreationTimeV1(Number(commitSeqValue));
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { name },
  });
  const clock = await persistence.getScopeClock(scopeId);
  if (clock === null) throw new Error("Developer index scope clock missing.");
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

function buildInput(fixture: Fixture, pageSize: number) {
  return {
    deploymentId: fixture.deploymentId,
    indexDefinitionId: fixture.indexDefinitionId,
    pageSize,
  };
}

function buildStep(fixture: Fixture, pageSize: number) {
  return runEffect(buildAppDeveloperOrderedIndexV1Effect(
    fixture.ports,
    buildInput(fixture, pageSize),
  ));
}

async function buildUntilEnabled(fixture: Fixture, pageSize: number) {
  const results: AppDeveloperOrderedIndexBuildResultV1[] = [];
  for (let step = 0; step < 16; step += 1) {
    const current = await buildStep(fixture, pageSize);
    results.push(current);
    if (current.lifecycle === "enabled") return results;
  }
  throw new Error("Developer index build did not converge within 16 steps.");
}

function currentIndexRows(fixture: Fixture) {
  return fixture.persistence.query<{
    row_id_hex: string;
    encoded_key_hex: string;
  }>(
    `select encode(row_id, 'hex') as row_id_hex,
            encode(encoded_key, 'hex') as encoded_key_hex
       from fx_app_index_entry_current
      where index_definition_id = $1
      order by encoded_key, row_id`,
    [fixture.indexDefinitionId],
  ).then(result => result.rows);
}

function buildState(fixture: Fixture) {
  return fixture.persistence.query<{
    lifecycle: string;
    cursor: Uint8Array | null;
  }>(
    `select lifecycle, backfill_cursor_row_id as cursor
       from fx_system_index_build_state
      where scope_id = $1 and index_definition_id = $2`,
    [fixture.scopeId, fixture.indexDefinitionId],
  ).then(result => result.rows[0]);
}

function indexRevisionCount(fixture: Fixture) {
  return fixture.persistence.query<{ count: string }>(
    `select count(*)::text as count
       from fx_app_index_entry_rev
      where index_definition_id = $1`,
    [fixture.indexDefinitionId],
  ).then(result => Number(result.rows[0]?.count ?? "0"));
}
