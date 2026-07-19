import {
  canonicalizeSchemaManifestV1,
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestJson,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import {
  MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
} from "../src";
import type {
  PublishAppSchemaV1Input,
  PublishAppSchemaV1Result,
} from "../src";
import {
  getPreparedAppSchemaPublicationV1State,
  prepareAppSchemaPublicationV1,
  type PreparedAppSchemaPublicationV1,
} from "../src/appSchemaPublicationPreparation";
import {
  AppSchemaPublicationV1ProjectionError,
  publishPreparedAppSchemaV1InTransaction,
} from "../src/appSchemaPublicationTransaction";
import {
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
  prepareAppDeveloperIndexDefinitionBindingV1,
} from "../src/appIndexDefinitions";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { applySchemaManifestAppSchemaBindingsV1InTransaction } from "../src/schemaManifestAppSchemaBindings";
import { ensureSchemaVersionArtifactInTransaction } from "../src/schemaVersionArtifacts";
import { ensureStableTableIdentityEffect } from "../src/stableTableCatalog";
import { runEffect } from "./effectTestRuntime";
import {
  acquirePostgresDeploymentLock,
  postgresUrl,
  waitForBlockedPostgresDeploymentLocks,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres app-schema V1 publication", () => {
  it("converges concurrent identical app-schema publications", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_concurrent_replay";
      await insertDeployment(persistence, deploymentId);
      const input = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_concurrent_replay",
      );

      const [firstAttempt, secondAttempt] = await queueTwoBehindDeploymentLock(
        persistence,
        deploymentId,
        () => persistence.publishAppSchemaV1(input),
        () => persistence.publishAppSchemaV1(input),
      );
      const first = fulfilledResult(firstAttempt);
      const second = fulfilledResult(secondAttempt);
      const replayed = await persistence.publishAppSchemaV1(input);

      expect(second).toEqual(first);
      expect(replayed).toEqual(first);
      expect(first.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "users", tableId: 1 },
      ]);
      expect(first.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byEmail", logicalIndexId: 1, tableId: 1 },
      ]);
      expect(first.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 1 },
      ]);
      expect(first.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 2 },
      ]);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 1,
        schemaVersions: 1,
        definitions: 2,
        schemaBindings: 1,
        buildStates: 0,
      });
    });
  }, 30_000);

  it("replans and commits competing publications from the same frontiers", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_competing";
      await insertDeployment(persistence, deploymentId);
      const firstInput = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_competing_first",
        { version: 1, tableLogicalName: "users", descriptor: "byEmail" },
      );
      const secondInput = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_competing_second",
        { version: 2, tableLogicalName: "posts", descriptor: "byAuthor" },
      );
      const initialSecondHash = await preparedManifestHash(
        persistence,
        secondInput,
      );

      const [firstAttempt, secondAttempt] = await queueTwoBehindDeploymentLock(
        persistence,
        deploymentId,
        () => persistence.publishAppSchemaV1(firstInput),
        () => persistence.publishAppSchemaV1(secondInput),
      );
      const first = fulfilledResult(firstAttempt);
      const second = fulfilledResult(secondAttempt);

      expect(first.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "users", tableId: 1 },
      ]);
      expect(first.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byEmail", logicalIndexId: 1, tableId: 1 },
      ]);
      expect(first.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 1 },
      ]);
      expect(first.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 2 },
      ]);
      expect(second.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "posts", tableId: 2 },
      ]);
      expect(second.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byAuthor", logicalIndexId: 2, tableId: 2 },
      ]);
      expect(second.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 3 },
      ]);
      expect(second.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 4 },
      ]);
      expect(Array.from(second.artifact.manifestSha256)).not.toEqual(
        Array.from(initialSecondHash),
      );
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 2,
        indexes: 2,
        schemaVersions: 2,
        definitions: 4,
        schemaBindings: 2,
        buildStates: 0,
      });
    });
  }, 30_000);

  it("replans after an external table-frontier allocation wins", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_table_frontier";
      await insertDeployment(persistence, deploymentId);
      const input = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_table_frontier",
      );
      const initialHash = await preparedManifestHash(persistence, input);

      const [allocationAttempt, publicationAttempt] =
        await queueTwoBehindDeploymentLock(
          persistence,
          deploymentId,
          () => runEffect(
            ensureStableTableIdentityEffect(persistence.drizzle, {
                deploymentId,
                namespace: "payload",
                logicalName: "allocator_winner",
              }),
          ),
          () => persistence.publishAppSchemaV1(input),
        );
      const allocation = fulfilledResult(allocationAttempt);
      const publication = fulfilledResult(publicationAttempt);

      expect(allocation.table.tableId).toBe(1);
      expect(publication.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "users", tableId: 2 },
      ]);
      expect(publication.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byEmail", logicalIndexId: 1, tableId: 2 },
      ]);
      expect(publication.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 1 },
      ]);
      expect(publication.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 2 },
      ]);
      expect(Array.from(publication.artifact.manifestSha256)).not.toEqual(
        Array.from(initialHash),
      );
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 2,
        indexes: 1,
        schemaVersions: 1,
        definitions: 2,
        schemaBindings: 1,
        buildStates: 0,
      });
    });
  }, 30_000);

  it("replans after an index-only frontier race", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_index_frontier";
      await insertDeployment(persistence, deploymentId);
      await persistence.publishAppSchemaV1(
        publicationInput(
          deploymentId,
          "schema_publication_v1_pg_index_frontier_baseline",
          { version: 1, indexes: [] },
        ),
      );
      const firstInput = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_index_frontier_first",
        { version: 2, descriptor: "byOther" },
      );
      const secondInput = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_index_frontier_second",
        { version: 3, descriptor: "byEmail" },
      );
      const initialSecondHash = await preparedManifestHash(
        persistence,
        secondInput,
      );

      const [firstAttempt, secondAttempt] = await queueTwoBehindDeploymentLock(
        persistence,
        deploymentId,
        () => persistence.publishAppSchemaV1(firstInput),
        () => persistence.publishAppSchemaV1(secondInput),
      );
      const first = fulfilledResult(firstAttempt);
      const second = fulfilledResult(secondAttempt);

      expect(first.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byOther", logicalIndexId: 1, tableId: 1 },
      ]);
      expect(second.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byEmail", logicalIndexId: 2, tableId: 1 },
      ]);
      expect(first.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 1 },
      ]);
      expect(first.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 2 },
      ]);
      expect(second.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 1 },
      ]);
      expect(second.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 3 },
      ]);
      expect(Array.from(second.artifact.manifestSha256)).not.toEqual(
        Array.from(initialSecondHash),
      );
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 2,
        schemaVersions: 3,
        definitions: 3,
        schemaBindings: 2,
        buildStates: 0,
      });
    });
  }, 30_000);

  it("rolls a stale conflicting loser back without leaking catalog rows", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_conflict";
      const schemaVersionId = "schema_publication_v1_pg_conflict";
      await insertDeployment(persistence, deploymentId);
      const winnerInput = publicationInput(deploymentId, schemaVersionId, {
        version: 1,
        tableLogicalName: "users",
        descriptor: "byEmail",
      });
      const loserInput = publicationInput(deploymentId, schemaVersionId, {
        version: 1,
        tableLogicalName: "posts",
        descriptor: "byAuthor",
      });

      const [winnerAttempt, loserAttempt] = await queueTwoBehindDeploymentLock(
        persistence,
        deploymentId,
        () => persistence.publishAppSchemaV1(winnerInput),
        () => persistence.publishAppSchemaV1(loserInput),
      );
      const winner = fulfilledResult(winnerAttempt);

      expect(winner.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "users", tableId: 1 },
      ]);
      expect(loserAttempt).toMatchObject({
        status: "rejected",
        error: {
          name: "SchemaVersionArtifactConflictError",
          conflict: { reason: "artifactMismatch" },
        },
      });
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 1,
        schemaVersions: 1,
        definitions: 2,
        schemaBindings: 1,
        buildStates: 0,
      });

      const recovered = await persistence.publishAppSchemaV1({
        ...loserInput,
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          "schema_publication_v1_pg_conflict_recovered",
        ),
        version: CatalogSchemaVersionSchema.make(2),
      });
      expect(recovered.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "posts", tableId: 2 },
      ]);
      expect(recovered.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byAuthor", logicalIndexId: 2, tableId: 2 },
      ]);
      expect(recovered.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 3 },
      ]);
      expect(recovered.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 4 },
      ]);
    });
  }, 30_000);

  it("rolls all newly projected rows back on a late projection failure", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_late_projection";
      await insertDeployment(persistence, deploymentId);
      const targetInput = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_late_projection_target",
        { version: 1, descriptor: "byEmail" },
      );
      const target = await prepareAppSchemaPublicationV1(
        persistence.drizzle,
        targetInput,
      );
      const targetState = getPreparedAppSchemaPublicationV1State(target);
      await persistence.drizzle.transaction(async (tx) => {
        await applySchemaManifestAppSchemaBindingsV1InTransaction(
          tx,
          targetState.logicalBindings,
        );
        await ensureSchemaVersionArtifactInTransaction(tx, targetState.artifact);
      });

      const historical = await prepareAppSchemaPublicationV1(
        persistence.drizzle,
        publicationInput(
          deploymentId,
          "schema_publication_v1_pg_late_projection_history",
          {
            version: 2,
            indexes: [
              { descriptor: "byEmail", field: "email" },
              { descriptor: "byPhone", field: "phone" },
            ],
          },
        ),
      );
      const historicalState =
        getPreparedAppSchemaPublicationV1State(historical);
      await persistence.drizzle.transaction((tx) =>
        applySchemaManifestAppSchemaBindingsV1InTransaction(
          tx,
          historicalState.logicalBindings,
        )
      );
      const extraIndex =
        historicalState.logicalBindings.manifest.indexBindings.indexes.find(
          (index) => index.descriptor === "byPhone",
        );
      if (extraIndex === undefined) {
        throw new Error("Expected the historical byPhone logical index.");
      }
      const extraBinding = await prepareAppDeveloperIndexDefinitionBindingV1({
        deploymentId,
        schemaVersionId: target.schemaVersionId,
        tableId: extraIndex.tableId,
        logicalIndexId: extraIndex.logicalIndexId,
        logicalSpec: extraIndex.spec,
      });
      await persistence.drizzle.transaction((tx) =>
        runEffect(
          ensureAppDeveloperIndexDefinitionBindingV1InTransaction(
            tx,
            extraBinding,
          ),
        )
      );
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 2,
        schemaVersions: 1,
        definitions: 1,
        schemaBindings: 1,
        buildStates: 0,
      });

      await expect(
        persistence.publishAppSchemaV1(targetInput),
      ).rejects.toMatchObject({
        name: "AppSchemaPublicationV1ProjectionError",
        issue: {
          reason: "schemaBindingCountMismatch",
          expectedCount: 1,
          actualCount: 2,
        },
      });
      await expect(
        persistence.publishAppSchemaV1(targetInput),
      ).rejects.toBeInstanceOf(AppSchemaPublicationV1ProjectionError);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 2,
        schemaVersions: 1,
        definitions: 1,
        schemaBindings: 1,
        buildStates: 0,
      });

      const clean = await persistence.publishAppSchemaV1(
        publicationInput(
          deploymentId,
          "schema_publication_v1_pg_late_projection_clean",
          { version: 2, descriptor: "byEmail" },
        ),
      );
      expect(clean.creationTimeIndexDefinitions).toMatchObject([
        { indexDefinitionId: 2 },
      ]);
      expect(clean.developerIndexDefinitions).toMatchObject([
        { indexDefinitionId: 3 },
      ]);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 2,
        schemaVersions: 2,
        definitions: 3,
        schemaBindings: 2,
        buildStates: 0,
      });
    });
  }, 30_000);

  it("publishes and exactly replays the full projection sequentially", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_replay";
      await insertDeployment(persistence, deploymentId);
      const input = publicationInput(
        deploymentId,
        "schema_publication_v1_pg_replay",
      );
      const prepared = await prepareAppSchemaPublicationV1(
        persistence.drizzle,
        input,
      );

      const created = await publishPrepared(persistence, prepared);
      const replayed = await publishPrepared(
        persistence,
        await prepareAppSchemaPublicationV1(persistence.drizzle, input),
      );

      expect(created.creationTimeIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([1]);
      expect(created.developerIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([2]);
      expect(replayed.creationTimeIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([1]);
      expect(replayed.developerIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([2]);
      expect(replayed.artifact.manifestJson).toEqual(replayed.manifest);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 1,
        schemaVersions: 1,
        definitions: 2,
        schemaBindings: 1,
        buildStates: 0,
      });
    });
  }, 30_000);

  it("rolls the whole projection back with its caller transaction", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_rollback";
      await insertDeployment(persistence, deploymentId);
      const prepared = await prepareAppSchemaPublicationV1(
        persistence.drizzle,
        publicationInput(deploymentId, "schema_publication_v1_pg_rollback"),
      );

      await expect(
        persistence.drizzle.transaction(async (tx) => {
          await publishPreparedAppSchemaV1InTransaction(tx, prepared);
          throw new Error("injected real Postgres D2c rollback");
        }),
      ).rejects.toThrow("injected real Postgres D2c rollback");
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 0,
        indexes: 0,
        schemaVersions: 0,
        definitions: 0,
        schemaBindings: 0,
        buildStates: 0,
      });

      const committed = await publishPrepared(persistence, prepared);
      expect(committed.creationTimeIndexDefinitions[0]?.indexDefinitionId).toBe(1);
      expect(committed.developerIndexDefinitions[0]?.indexDefinitionId).toBe(2);
    });
  }, 30_000);

  it("publishes the current operational work limit within the bounded gate", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_publication_v1_pg_operational_limit";
      await insertDeployment(persistence, deploymentId);
      const input = nearLimitPublicationInput(
        deploymentId,
        "schema_publication_v1_pg_operational_limit",
      );
      const expectedTableCount = Math.floor(
        MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS / 2,
      );
      const expectedIndexCount =
        MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS -
        expectedTableCount;

      const result = await persistence.publishAppSchemaV1(input);

      expect(result.manifest.tableDefinitions.tables).toHaveLength(
        expectedTableCount,
      );
      expect(result.manifest.indexBindings.indexes).toHaveLength(
        expectedIndexCount,
      );
      expect(result.creationTimeIndexDefinitions).toHaveLength(
        expectedTableCount,
      );
      expect(result.developerIndexDefinitions).toHaveLength(
        expectedIndexCount,
      );
      expect(result.schemaVersionIndexBindings).toHaveLength(
        expectedIndexCount,
      );
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: expectedTableCount,
        indexes: expectedIndexCount,
        schemaVersions: 1,
        definitions:
          MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
        schemaBindings: expectedIndexCount,
        buildStates: 0,
      });
    });
  }, 30_000);
});

interface PublicationInputOptions {
  readonly version?: number;
  readonly tableLogicalName?: string;
  readonly descriptor?: string;
  readonly indexes?: ReadonlyArray<{
    readonly descriptor: string;
    readonly field: string;
  }>;
}

function publicationInput(
  deploymentId: string,
  schemaVersionId: string,
  options: PublicationInputOptions = {},
): PublishAppSchemaV1Input {
  const tableLogicalName = options.tableLogicalName ?? "users";
  const indexes = options.indexes ?? [
    { descriptor: options.descriptor ?? "byEmail", field: "email" },
  ];
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(options.version ?? 1),
    tables: [appTable(tableLogicalName)],
    indexes: indexes.map((index) =>
      appIndex(tableLogicalName, index.descriptor, [index.field])
    ),
  };
}

function nearLimitPublicationInput(
  deploymentId: string,
  schemaVersionId: string,
): PublishAppSchemaV1Input {
  const tableCount = Math.floor(
    MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS / 2,
  );
  const indexCount =
    MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS - tableCount;
  const tableNames = Array.from(
    { length: tableCount },
    (_, index) => `table${index.toString().padStart(3, "0")}`,
  );
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(1),
    tables: tableNames.map(appTable),
    indexes: Array.from({ length: indexCount }, (_, index) => {
      const tableLogicalName = tableNames[index % tableNames.length];
      if (tableLogicalName === undefined) {
        throw new Error("Expected at least one near-limit table fixture.");
      }
      return appIndex(
        tableLogicalName,
        `byEmail${index.toString().padStart(3, "0")}`,
        ["email"],
      );
    }),
  };
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          email: {
            fieldType: { type: "string" },
            optional: false,
          },
          phone: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
}

async function insertDeployment(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

type OperationAttempt<Result> =
  | { readonly status: "fulfilled"; readonly result: Result }
  | { readonly status: "rejected"; readonly error: unknown };

async function attemptOperation<Result>(
  run: () => Promise<Result>,
): Promise<OperationAttempt<Result>> {
  try {
    return { status: "fulfilled", result: await run() };
  } catch (error) {
    return { status: "rejected", error };
  }
}

function fulfilledResult<Result>(
  attempt: OperationAttempt<Result>,
): Result {
  if (attempt.status === "rejected") throw attempt.error;
  return attempt.result;
}

async function queueTwoBehindDeploymentLock<First, Second>(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
  startFirst: () => Promise<First>,
  startSecond: () => Promise<Second>,
): Promise<
  readonly [OperationAttempt<First>, OperationAttempt<Second>]
> {
  const lock = await acquirePostgresDeploymentLock(
    persistence,
    deploymentId,
  );
  let firstAttempt: Promise<OperationAttempt<First>> | undefined;
  let secondAttempt: Promise<OperationAttempt<Second>> | undefined;
  let released = false;
  let setupError: unknown;
  try {
    firstAttempt = attemptOperation(startFirst);
    await waitForBlockedPostgresDeploymentLocks(persistence, lock, 1);
    secondAttempt = attemptOperation(startSecond);
    await waitForBlockedPostgresDeploymentLocks(persistence, lock, 2);
    await lock.client.query("commit");
    released = true;
  } catch (error) {
    setupError = error;
  } finally {
    if (!released) {
      await lock.client.query("rollback").catch(() => undefined);
    }
    lock.client.release();
  }

  if (setupError !== undefined) {
    const attempts: Array<Promise<unknown>> = [];
    if (firstAttempt !== undefined) attempts.push(firstAttempt);
    if (secondAttempt !== undefined) attempts.push(secondAttempt);
    await Promise.allSettled(attempts);
    throw setupError;
  }
  if (firstAttempt === undefined || secondAttempt === undefined) {
    throw new Error("Expected two queued Postgres operations.");
  }
  return Promise.all([firstAttempt, secondAttempt]);
}

async function preparedManifestHash(
  persistence: PostgresFlarexPersistence,
  input: PublishAppSchemaV1Input,
): Promise<Uint8Array> {
  const prepared = await prepareAppSchemaPublicationV1(
    persistence.drizzle,
    input,
  );
  const state = getPreparedAppSchemaPublicationV1State(prepared);
  const canonical = await canonicalizeSchemaManifestV1(
    decodeSchemaManifestJson(state.logicalBindings.manifest),
  );
  return canonical.sha256;
}

function publishPrepared(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedAppSchemaPublicationV1,
) {
  return persistence.drizzle.transaction((tx) =>
    publishPreparedAppSchemaV1InTransaction(tx, prepared)
  );
}

async function catalogCounts(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<{
  readonly tables: number;
  readonly indexes: number;
  readonly schemaVersions: number;
  readonly definitions: number;
  readonly schemaBindings: number;
  readonly buildStates: number;
}> {
  const result = await persistence.query<{
    tables: number;
    indexes: number;
    schema_versions: number;
    definitions: number;
    schema_bindings: number;
    build_states: number;
  }>(
    `
      select
        (select count(*)::int from fx_control_table where deployment_id = $1) as tables,
        (select count(*)::int from fx_control_index where deployment_id = $1) as indexes,
        (select count(*)::int from fx_control_schema_version where deployment_id = $1) as schema_versions,
        (select count(*)::int from fx_control_index_definition where deployment_id = $1) as definitions,
        (select count(*)::int from fx_control_schema_version_index_binding where deployment_id = $1) as schema_bindings,
        (select count(*)::int from fx_system_index_build_state) as build_states
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected catalog count row.");
  return {
    tables: row.tables,
    indexes: row.indexes,
    schemaVersions: row.schema_versions,
    definitions: row.definitions,
    schemaBindings: row.schema_bindings,
    buildStates: row.build_states,
  };
}
