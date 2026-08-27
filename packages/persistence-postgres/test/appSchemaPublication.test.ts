import {
  canonicalizeSchemaManifestV1,
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestJson,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { count, eq } from "drizzle-orm";
import { Cause, Effect, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  getPreparedAppSchemaPublicationV1StateResult,
  prepareAppSchemaPublicationV1Effect,
} from "../src/appSchemaPublicationPreparation";
import {
  AppSchemaPublicationV1QuotaExceededError,
  enforceAppSchemaPublicationV1CanonicalByteQuotaResult,
  enforceAppSchemaPublicationV1DeclarationQuotasResult,
  MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
  MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
  MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES,
  MAX_APP_SCHEMA_PUBLICATION_V1_TABLES,
} from "../src/appSchemaPublicationPolicy";
import {
  AppSchemaPublicationV1RetryExhaustedError,
  AppSchemaPublicationV1TransactionError,
  publishAppSchemaV1WithRepositoryEffect,
  MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS,
  runAppSchemaPublicationV1AttemptsEffect,
  type AppSchemaPublicationV1Repository,
  type PublishAppSchemaV1Error,
  type PublishAppSchemaV1Result,
} from "../src/appSchemaPublication";
import { createPGlitePersistence } from "../src/pglite";
import {
  fxControlIndexDefinitions,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersions,
  fxControlTables,
  fxSystemIndexBuildStates,
} from "../src/schema";
import { SchemaManifestAppSchemaBindingPlanStaleError } from "../src/schemaManifestAppSchemaBindings";
import { ensureStableTableIdentityEffect } from "../src/stableTableCatalog";
import type { StableTableCatalogTransaction } from "../src/stableTableCatalog";
import { runEffect } from "./effectTestRuntime";

type ThrowingQuotaPolicyExport = Extract<
  keyof typeof import("../src/appSchemaPublicationPolicy"),
  | "enforceAppSchemaPublicationV1DeclarationQuotas"
  | "enforceAppSchemaPublicationV1CanonicalByteLowerBound"
  | "enforceAppSchemaPublicationV1CanonicalByteQuota"
>;

const prepareAppSchemaPublicationV1 = (
  ...args: Parameters<typeof prepareAppSchemaPublicationV1Effect>
) => runEffect(prepareAppSchemaPublicationV1Effect(...args));

const getPreparedAppSchemaPublicationV1State = (
  ...args: Parameters<typeof getPreparedAppSchemaPublicationV1StateResult>
) => Result.getOrThrow(getPreparedAppSchemaPublicationV1StateResult(...args));

const publishAppSchemaV1WithRepository = (
  ...args: Parameters<typeof publishAppSchemaV1WithRepositoryEffect>
) => runEffect(publishAppSchemaV1WithRepositoryEffect(...args));

describe("app-schema V1 publication facade", () => {
  it("keeps the coordinator Effect-native behind the runtime facade", () => {
    expectTypeOf<
      ReturnType<typeof publishAppSchemaV1WithRepositoryEffect>
    >().toEqualTypeOf<Effect.Effect<
      PublishAppSchemaV1Result,
      PublishAppSchemaV1Error
    >>();
  });

  it("publishes and exactly replays the complete projection", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_facade_replay";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(
      deploymentId,
      "schema_publication_v1_facade_replay",
    );

    const created = await persistence.publishAppSchemaV1(input);
    const replayed = await persistence.publishAppSchemaV1(input);

    expect(created).toEqual(replayed);
    expect(created.manifest).toEqual(created.artifact.manifestJson);
    expect(created.manifest.tableDefinitions.tables).toMatchObject([
      { logicalName: "users", tableId: 1 },
    ]);
    expect(created.manifest.indexBindings.indexes).toMatchObject([
      { descriptor: "byEmail", logicalIndexId: 1, tableId: 1 },
    ]);
    expect(created.creationTimeIndexDefinitions).toMatchObject([
      { indexDefinitionId: 1, access: { kind: "by_creation_time", tableId: 1 } },
    ]);
    expect(created.developerIndexDefinitions).toMatchObject([
      {
        indexDefinitionId: 2,
        access: { kind: "developer", tableId: 1, logicalIndexId: 1 },
      },
    ]);
    expect(created.schemaVersionIndexBindings).toMatchObject([
      { logicalIndexId: 1, indexDefinitionId: 2 },
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

  it("snapshots once, then replans and rehashes every stale attempt", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_facade_stale";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(
      deploymentId,
      "schema_publication_v1_facade_stale",
    );
    const initial = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      input,
    );
    const initialState = getPreparedAppSchemaPublicationV1State(initial);
    const initialCanonical = await canonicalizeSchemaManifestV1(
      decodeSchemaManifestJson(initialState.logicalBindings.manifest),
    );
    let transactionAttempts = 0;
    const digest = vi.spyOn(crypto.subtle, "digest");
    const digestCountsAtTransaction: number[] = [];
    const repository = {
      db: persistence.drizzle,
      async runTransaction<Result>(
        run: (tx: StableTableCatalogTransaction) => Promise<Result>,
      ): Promise<Result> {
        transactionAttempts += 1;
        digestCountsAtTransaction.push(digest.mock.calls.length);
        if (transactionAttempts === 1) {
          const firstTable = input.tables[0];
          const firstIndex = input.indexes[0];
          if (firstTable === undefined || firstIndex === undefined) {
            throw new Error("Expected mutable publication fixtures.");
          }
          replaceOwnDataProperty(firstTable, "logicalName", "mutatedAfterCall");
          replaceOwnDataProperty(firstIndex.fields, 0, "mutatedAfterCall");
          await runEffect(
            ensureStableTableIdentityEffect(persistence.drizzle, {
              deploymentId,
              namespace: "payload",
              logicalName: "allocator_winner",
            }),
          );
        }
        return persistence.drizzle.transaction(run);
      },
    } satisfies AppSchemaPublicationV1Repository;

    try {
      const result = await publishAppSchemaV1WithRepository(
        repository,
        input,
      );

      expect(transactionAttempts).toBe(2);
      expect(digestCountsAtTransaction).toHaveLength(2);
      expect(digestCountsAtTransaction[1]).toBeGreaterThan(
        digestCountsAtTransaction[0] ?? 0,
      );
      expect(result.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "users", tableId: 2 },
      ]);
      expect(result.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byEmail", logicalIndexId: 1, tableId: 2 },
      ]);
      expect(Array.from(result.artifact.manifestSha256)).not.toEqual(
        Array.from(initialCanonical.sha256),
      );
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 2,
        indexes: 1,
        schemaVersions: 1,
        definitions: 2,
        schemaBindings: 1,
        buildStates: 0,
      });
    } finally {
      digest.mockRestore();
    }
  });

  it("retries only typed combined-stale outcomes and retains the last cause", async () => {
    const staleErrors = Array.from(
      { length: MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS },
      (_, attempt) =>
        new SchemaManifestAppSchemaBindingPlanStaleError({
          reason: "tableCatalogHighWaterChanged",
          observedTableId: null,
          currentTableId: CatalogTableIdSchema.make(attempt + 1),
        }),
    );
    let attempts = 0;

    const exhausted = await runEffect(
      runAppSchemaPublicationV1AttemptsEffect(
        "deployment_schema_publication_v1_exhausted",
        () => {
        const stale = staleErrors[attempts];
        attempts += 1;
        if (stale === undefined) {
          return Effect.die(new Error("Expected a typed stale fixture."));
        }
        return Effect.fail(stale);
        },
      ),
    ).catch((error: unknown) => error);

    expect(attempts).toBe(MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS);
    expect(exhausted).toBeInstanceOf(
      AppSchemaPublicationV1RetryExhaustedError,
    );
    expect(exhausted).toMatchObject({
      deploymentId: "deployment_schema_publication_v1_exhausted",
      attempts: MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS,
      lastStale: staleErrors.at(-1)?.stale,
      cause: staleErrors.at(-1),
    });

    const terminal = new Error("terminal publication failure");
    let terminalAttempts = 0;
    const rejected = await runEffect(
      runAppSchemaPublicationV1AttemptsEffect(
        "deployment_schema_publication_v1_terminal",
        () => {
          terminalAttempts += 1;
          return Effect.fail(terminal);
        },
      ),
    ).catch((error: unknown) => error);
    expect(terminalAttempts).toBe(1);
    expect(rejected).toBe(terminal);
  });

  it("retains the initiating Effect cause when transaction cleanup fails", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_rollback_failure";
    await insertDeployment(persistence, deploymentId);
    const rollbackFailure = new Error("injected transaction rollback failure");
    let transactionAttempts = 0;
    const repository = {
      db: persistence.drizzle,
      async runTransaction<Result>(
        run: (tx: StableTableCatalogTransaction) => Promise<Result>,
      ): Promise<Result> {
        transactionAttempts += 1;
        await runEffect(ensureStableTableIdentityEffect(
          persistence.drizzle,
          {
            deploymentId,
            namespace: "payload",
            logicalName: "allocator_winner",
          },
        ));
        try {
          return await persistence.drizzle.transaction(run);
        } catch {
          throw rollbackFailure;
        }
      },
    } satisfies AppSchemaPublicationV1Repository;

    const failure = await publishAppSchemaV1WithRepository(
      repository,
      publicationInput(
        deploymentId,
        "schema_publication_v1_rollback_failure",
      ),
    ).catch((cause: unknown) => cause);

    expect(transactionAttempts).toBe(1);
    expect(failure).toBeInstanceOf(AppSchemaPublicationV1TransactionError);
    expect(failure).toMatchObject({ cause: rollbackFailure });
    if (!(failure instanceof AppSchemaPublicationV1TransactionError)) {
      throw new Error("Expected a typed publication transaction failure.");
    }
    expect(failure.callbackCause).toBeDefined();
    if (failure.callbackCause !== undefined) {
      expect(Cause.hasFails(failure.callbackCause)).toBe(true);
      expect(failure.callbackCause.toString()).toContain(
        "stable table catalog advanced",
      );
    }
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 1,
      indexes: 0,
      schemaVersions: 0,
      definitions: 0,
      schemaBindings: 0,
      buildStates: 0,
    });
  });

  it("enforces fixed declaration and canonical-byte quotas at their boundaries", () => {
    expectTypeOf<ThrowingQuotaPolicyExport>().toEqualTypeOf<never>();
    expect(
      Result.isSuccess(
        enforceAppSchemaPublicationV1DeclarationQuotasResult(
          Array.from({
            length: MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
          }),
          [],
        ),
      ),
    ).toBe(true);
    const workItemLimit = enforceAppSchemaPublicationV1DeclarationQuotasResult(
      Array.from({
        length: MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS + 1,
      }),
      [],
    );
    expect(Result.isFailure(workItemLimit)).toBe(true);
    if (Result.isFailure(workItemLimit)) {
      expect(workItemLimit.failure).toEqual(
        new AppSchemaPublicationV1QuotaExceededError({
          reason: "definitionWorkItemCountExceeded",
          tableCount:
            MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS + 1,
          developerIndexCount: 0,
          actualCount:
            MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS + 1,
          maximumCount:
            MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
        }),
      );
    }
    expect(
      Result.isSuccess(
        enforceAppSchemaPublicationV1CanonicalByteQuotaResult(
          MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
        ),
      ),
    ).toBe(true);
    const canonicalByteLimit =
      enforceAppSchemaPublicationV1CanonicalByteQuotaResult(
        MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES + 1,
      );
    expect(Result.isFailure(canonicalByteLimit)).toBe(true);
    if (Result.isFailure(canonicalByteLimit)) {
      expect(canonicalByteLimit.failure).toEqual(
        new AppSchemaPublicationV1QuotaExceededError({
          reason: "canonicalBytesExceeded",
          actualBytes: MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES + 1,
          maximumBytes: MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
        }),
      );
    }
    const tableLimit = enforceAppSchemaPublicationV1DeclarationQuotasResult(
      Array.from({ length: MAX_APP_SCHEMA_PUBLICATION_V1_TABLES + 1 }),
      [],
    );
    expect(Result.isFailure(tableLimit)).toBe(true);
    if (Result.isFailure(tableLimit)) {
      expect(tableLimit.failure).toEqual(
        new AppSchemaPublicationV1QuotaExceededError({
          reason: "tableCountExceeded",
          actualCount: MAX_APP_SCHEMA_PUBLICATION_V1_TABLES + 1,
          maximumCount: MAX_APP_SCHEMA_PUBLICATION_V1_TABLES,
        }),
      );
    }
    const developerIndexLimit =
      enforceAppSchemaPublicationV1DeclarationQuotasResult(
        [],
        Array.from({
          length: MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES + 1,
        }),
      );
    expect(Result.isFailure(developerIndexLimit)).toBe(true);
    if (Result.isFailure(developerIndexLimit)) {
      expect(developerIndexLimit.failure).toEqual(
        new AppSchemaPublicationV1QuotaExceededError({
          reason: "developerIndexCountExceeded",
          actualCount:
            MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES + 1,
          maximumCount:
            MAX_APP_SCHEMA_PUBLICATION_V1_DEVELOPER_INDEXES,
        }),
      );
    }
  });

  it("rejects declaration counts before reading the catalog or opening a transaction", async () => {
    let databaseRead = false;
    let transactionOpened = false;
    const repository = {
      get db(): never {
        databaseRead = true;
        throw new Error("The catalog must not be read for a count violation.");
      },
      async runTransaction<Result>(
        _run: (tx: StableTableCatalogTransaction) => Promise<Result>,
      ): Promise<Result> {
        transactionOpened = true;
        throw new Error("A count violation must not open a transaction.");
      },
    } satisfies AppSchemaPublicationV1Repository;
    const valid = publicationInput(
      "deployment_schema_publication_v1_count_quota",
      "schema_publication_v1_count_quota",
    );

    await expect(
      publishAppSchemaV1WithRepository(repository, {
        ...valid,
        tables: Array.from(
          { length: MAX_APP_SCHEMA_PUBLICATION_V1_TABLES + 1 },
          () => appTable("users"),
        ),
      }),
    ).rejects.toMatchObject({
      name: "AppSchemaPublicationV1QuotaExceededError",
      issue: {
        reason: "tableCountExceeded",
        actualCount: MAX_APP_SCHEMA_PUBLICATION_V1_TABLES + 1,
        maximumCount: MAX_APP_SCHEMA_PUBLICATION_V1_TABLES,
      },
    });
    expect(databaseRead).toBe(false);
    expect(transactionOpened).toBe(false);

    await expect(
      publishAppSchemaV1WithRepository(repository, {
        ...valid,
        tables: Array.from(
          {
            length:
              MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS + 1,
          },
          (_, index) => appTable(`table${index}`),
        ),
        indexes: [],
      }),
    ).rejects.toMatchObject({
      name: "AppSchemaPublicationV1QuotaExceededError",
      issue: {
        reason: "definitionWorkItemCountExceeded",
        tableCount:
          MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS + 1,
        developerIndexCount: 0,
        actualCount:
          MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS + 1,
        maximumCount:
          MAX_APP_SCHEMA_PUBLICATION_V1_DEFINITION_WORK_ITEMS,
      },
    });
    expect(databaseRead).toBe(false);
    expect(transactionOpened).toBe(false);
  });

  it("rejects JSON-escape amplification before cloning or catalog access", async () => {
    let databaseRead = false;
    let transactionOpened = false;
    const repository = {
      get db(): never {
        databaseRead = true;
        throw new Error("The catalog must not be read for an early byte violation.");
      },
      async runTransaction<Result>(
        _run: (tx: StableTableCatalogTransaction) => Promise<Result>,
      ): Promise<Result> {
        transactionOpened = true;
        throw new Error("An early byte violation must not open a transaction.");
      },
    } satisfies AppSchemaPublicationV1Repository;
    const clone = vi.spyOn(globalThis, "structuredClone");
    const escapedControlLiteral = "\u0001".repeat(
      Math.floor(
        MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES / 6,
      ) + 1,
    );

    try {
      await expect(
        publishAppSchemaV1WithRepository(repository, {
          deploymentId: "deployment_schema_publication_v1_oversized",
          schemaVersionId: CatalogSchemaVersionIdSchema.make(
            "schema_publication_v1_oversized",
          ),
          version: CatalogSchemaVersionSchema.make(1),
          tables: [literalTable("oversized", escapedControlLiteral)],
          indexes: [],
        }),
      ).rejects.toMatchObject({
        name: "AppSchemaPublicationV1QuotaExceededError",
        issue: {
          reason: "canonicalByteLowerBoundExceeded",
          maximumBytes:
            MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
        },
      });
      expect(clone).not.toHaveBeenCalled();
      expect(databaseRead).toBe(false);
      expect(transactionOpened).toBe(false);
    } finally {
      clone.mockRestore();
    }
  });

  it("retains the exact post-preparation byte gate before the transaction", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_exact_byte_fallback";
    await insertDeployment(persistence, deploymentId);
    const baseline = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      {
        deploymentId,
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          "schema_publication_v1_exact_byte_calibration",
        ),
        version: CatalogSchemaVersionSchema.make(1),
        tables: [literalTable("exactFallback", "")],
        indexes: [],
      },
    );
    const baselineState =
      getPreparedAppSchemaPublicationV1State(baseline);
    const baselineCanonical = await canonicalizeSchemaManifestV1(
      decodeSchemaManifestJson(baselineState.logicalBindings.manifest),
    );
    const literalLength =
      MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES -
      baselineCanonical.canonicalBytes.byteLength +
      1;
    if (literalLength <= 0) {
      throw new Error("Expected positive exact-byte fallback fixture length.");
    }
    const transaction = vi.spyOn(persistence.drizzle, "transaction");

    try {
      await expect(
        persistence.publishAppSchemaV1({
          deploymentId,
          schemaVersionId: CatalogSchemaVersionIdSchema.make(
            "schema_publication_v1_exact_byte_fallback",
          ),
          version: CatalogSchemaVersionSchema.make(2),
          tables: [
            literalTable("exactFallback", "x".repeat(literalLength)),
          ],
          indexes: [],
        }),
      ).rejects.toMatchObject({
        name: "AppSchemaPublicationV1QuotaExceededError",
        issue: {
          reason: "canonicalBytesExceeded",
          actualBytes:
            MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES + 1,
          maximumBytes:
            MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
        },
      });
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function insertDeployment(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

function publicationInput(deploymentId: string, schemaVersionId: string) {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [appIndex("users", "byEmail", ["email"])],
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
        },
      },
    },
  };
}

function literalTable(
  logicalName: string,
  literal: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          oversized: {
            fieldType: { type: "literal", value: literal },
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

async function catalogCounts(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<{
  readonly tables: number;
  readonly indexes: number;
  readonly schemaVersions: number;
  readonly definitions: number;
  readonly schemaBindings: number;
  readonly buildStates: number;
}> {
  const [
    [tables],
    [indexes],
    [schemaVersions],
    [definitions],
    [schemaBindings],
    [buildStates],
  ] = await Promise.all([
    persistence.drizzle.select({ count: count() }).from(
      fxControlTables,
    ).where(eq(fxControlTables.deploymentId, deploymentId)),
    persistence.drizzle.select({ count: count() }).from(
      fxControlIndexes,
    ).where(eq(fxControlIndexes.deploymentId, deploymentId)),
    persistence.drizzle.select({ count: count() }).from(
      fxControlSchemaVersions,
    ).where(eq(fxControlSchemaVersions.deploymentId, deploymentId)),
    persistence.drizzle.select({ count: count() }).from(
      fxControlIndexDefinitions,
    ).where(eq(fxControlIndexDefinitions.deploymentId, deploymentId)),
    persistence.drizzle.select({ count: count() }).from(
      fxControlSchemaVersionIndexBindings,
    ).where(eq(
      fxControlSchemaVersionIndexBindings.deploymentId,
      deploymentId,
    )),
    persistence.drizzle.select({ count: count() }).from(
      fxSystemIndexBuildStates,
    ),
  ]);
  return {
    tables: tables?.count ?? -1,
    indexes: indexes?.count ?? -1,
    schemaVersions: schemaVersions?.count ?? -1,
    definitions: definitions?.count ?? -1,
    schemaBindings: schemaBindings?.count ?? -1,
    buildStates: buildStates?.count ?? -1,
  };
}

function replaceOwnDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
