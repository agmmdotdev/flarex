import {
  canonicalizeSchemaManifestV1,
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestJson,
  decodeSchemaManifestTableDefinitionsV1,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EnsureAppSchemaVersionArtifactV1Input,
  EnsureSchemaVersionArtifactInput,
  EnsureSchemaVersionArtifactResult,
  FlarexPersistence,
} from "../src";
import {
  AppSchemaVersionArtifactRetryExhaustedError,
  ensureAppSchemaVersionArtifactV1WithRepository,
  ensurePreparedAppSchemaVersionArtifactV1InTransaction,
  InvalidAppSchemaVersionArtifactV1InputError,
  InvalidPreparedAppSchemaVersionArtifactV1Error,
  MAX_APP_SCHEMA_VERSION_ARTIFACT_ATTEMPTS,
  prepareAppSchemaVersionArtifactV1,
  runAppSchemaVersionArtifactV1Attempts,
  type AppSchemaVersionArtifactV1Repository,
  type AppSchemaVersionArtifactV1Transaction,
} from "../src/appSchemaVersionArtifacts";
import { createPGlitePersistence } from "../src/pglite";
import {
  prepareSchemaManifestAppTableBindingsV1,
  SchemaManifestTableBindingPlanStaleError,
} from "../src/schemaManifestTableBindings";
import {
  ensureSchemaVersionArtifactInTransaction,
  getSchemaVersionArtifactByVersion,
  prepareSchemaVersionArtifact,
  SchemaVersionArtifactConflictError,
} from "../src/schemaVersionArtifacts";
import {
  ensureStableTableIdentityInTransaction,
  getStableTableIdentityByName,
} from "../src/stableTableCatalog";

type PublicInternalPublicationExport = Extract<
  keyof typeof import("../src"),
  | "prepareAppSchemaVersionArtifactV1"
  | "ensurePreparedAppSchemaVersionArtifactV1InTransaction"
  | "ensureAppSchemaVersionArtifactV1WithRepository"
  | "runAppSchemaVersionArtifactV1Attempts"
  | "prepareSchemaVersionArtifact"
  | "ensureSchemaVersionArtifactInTransaction"
  | "ensureStableTableIdentityInTransaction"
>;

type PublicPublicationMethod = Extract<
  keyof FlarexPersistence,
  "ensureAppSchemaVersionArtifactV1"
>;

type CallerComputedManifest = Omit<
  EnsureAppSchemaVersionArtifactV1Input,
  "manifest"
> & {
  readonly manifest: { readonly caller: true };
};

type CallerComputedManifestAccepted = CallerComputedManifest extends
  EnsureAppSchemaVersionArtifactV1Input
  ? true
  : false;

describe("app schema version artifact publication", () => {
  it("keeps one high-level facade and hides every swappable child boundary", () => {
    expectTypeOf<PublicInternalPublicationExport>().toEqualTypeOf<never>();
    expectTypeOf<PublicPublicationMethod>()
      .toEqualTypeOf<"ensureAppSchemaVersionArtifactV1">();
    expectTypeOf<CallerComputedManifestAccepted>().toEqualTypeOf<false>();
    expectTypeOf<
      Awaited<
        ReturnType<FlarexPersistence["ensureAppSchemaVersionArtifactV1"]>
      >
    >().toEqualTypeOf<EnsureSchemaVersionArtifactResult>();
  });

  it("atomically publishes coherent mappings and replays the exact artifact", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_publish";
    await insertDeployment(persistence, deploymentId);
    const input = appSchemaInput(
      deploymentId,
      "schema_app_publish",
      ["users", "products"],
    );

    const created = await persistence.ensureAppSchemaVersionArtifactV1(input);
    expect(created.status).toBe("created");
    const createdSection = decodeSchemaManifestTableDefinitionsV1(
      created.artifact.manifestJson,
    );
    expect(tableIdentities(createdSection)).toEqual([
      { logicalName: "products", tableId: 1 },
      { logicalName: "users", tableId: 2 },
    ]);
    await expectCatalogMatchesSection(
      persistence,
      deploymentId,
      createdSection,
    );

    const reversed = await persistence.ensureAppSchemaVersionArtifactV1({
      ...input,
      tables: [...input.tables].reverse(),
    });
    expect(reversed).toMatchObject({
      status: "existing",
      artifact: { createdAt: created.artifact.createdAt },
    });
    expect(Array.from(reversed.artifact.manifestSha256)).toEqual(
      Array.from(created.artifact.manifestSha256),
    );

    await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "payload_internal",
    });
    const replayAfterFrontierAdvance =
      await persistence.ensureAppSchemaVersionArtifactV1(input);
    expect(replayAfterFrontierAdvance.status).toBe("existing");
    expect(Array.from(replayAfterFrontierAdvance.artifact.manifestSha256))
      .toEqual(Array.from(created.artifact.manifestSha256));
    await expectCatalogMatchesSection(
      persistence,
      deploymentId,
      createdSection,
    );
    await expect(rowCounts(persistence, deploymentId)).resolves.toEqual({
      artifacts: 1,
      tables: 3,
    });
  });

  it("rolls planned mappings back when immutable artifact replay conflicts", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_conflict";
    await insertDeployment(persistence, deploymentId);
    const schemaVersionId = CatalogSchemaVersionIdSchema.make(
      "schema_app_conflict",
    );
    const version = CatalogSchemaVersionSchema.make(1);
    const existing = await ensureArtifact(persistence, {
      deploymentId,
      schemaVersionId,
      version,
      manifest: { legacy: true },
    });

    await expect(
      persistence.ensureAppSchemaVersionArtifactV1({
        deploymentId,
        schemaVersionId,
        version,
        tables: [appDeclaration("users")],
      }),
    ).rejects.toMatchObject({
      name: "SchemaVersionArtifactConflictError",
      conflict: { reason: "artifactMismatch" },
    });
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();

    const next = await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "after_failed_publication",
    });
    expect(next.table.tableId).toBe(1);
    await expect(
      getSchemaVersionArtifactByVersion(
        persistence.drizzle,
        deploymentId,
        version,
      ),
    ).resolves.toEqual(existing.artifact);
  });

  it("rebuilds and rehashes the whole publication after one stale plan", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_retry";
    await insertDeployment(persistence, deploymentId);
    const input = appSchemaInput(
      deploymentId,
      "schema_app_retry",
      ["users"],
    );
    const initialBindings = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: input.tables },
    );
    const initialCanonical = await canonicalizeSchemaManifestV1(
      decodeSchemaManifestJson(initialBindings.section),
    );
    const baseRepository = publicationRepository(persistence);
    let transactionAttempts = 0;
    const racingRepository = {
      db: persistence.drizzle,
      runTransaction: async <Result>(
        run: (
          tx: AppSchemaVersionArtifactV1Transaction,
        ) => Promise<Result>,
      ): Promise<Result> => {
        transactionAttempts += 1;
        if (transactionAttempts === 1) {
          await ensureTable(persistence, {
            deploymentId,
            namespace: "payload",
            logicalName: "racing_allocation",
          });
        }
        return baseRepository.runTransaction(run);
      },
    } satisfies AppSchemaVersionArtifactV1Repository;

    const result = await ensureAppSchemaVersionArtifactV1WithRepository(
      racingRepository,
      input,
    );

    expect(result.status).toBe("created");
    expect(transactionAttempts).toBe(2);
    const section = decodeSchemaManifestTableDefinitionsV1(
      result.artifact.manifestJson,
    );
    expect(tableIdentities(section)).toEqual([
      { logicalName: "users", tableId: 2 },
    ]);
    expect(Array.from(result.artifact.manifestSha256)).not.toEqual(
      Array.from(initialCanonical.sha256),
    );
    await expectCatalogMatchesSection(persistence, deploymentId, section);
  });

  it("bounds stale retries and propagates every terminal error unchanged", async () => {
    const stale = new SchemaManifestTableBindingPlanStaleError({
      reason: "catalogHighWaterChanged",
      observedTableId: null,
      currentTableId: CatalogTableIdSchema.make(1),
    });
    let staleAttempts = 0;
    await expect(
      runAppSchemaVersionArtifactV1Attempts(
        "deployment_retry_exhausted",
        async () => {
          staleAttempts += 1;
          throw stale;
        },
      ),
    ).rejects.toMatchObject({
      name: "AppSchemaVersionArtifactRetryExhaustedError",
      deploymentId: "deployment_retry_exhausted",
      attempts: MAX_APP_SCHEMA_VERSION_ARTIFACT_ATTEMPTS,
      lastStale: { reason: "catalogHighWaterChanged" },
      cause: stale,
    });
    expect(staleAttempts).toBe(MAX_APP_SCHEMA_VERSION_ARTIFACT_ATTEMPTS);

    const terminal = new SchemaVersionArtifactConflictError({
      reason: "artifactMismatch",
      deploymentId: "deployment_terminal",
      schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_terminal"),
      version: CatalogSchemaVersionSchema.make(1),
    });
    let terminalAttempts = 0;
    await expect(
      runAppSchemaVersionArtifactV1Attempts(
        "deployment_terminal",
        async () => {
          terminalAttempts += 1;
          throw terminal;
        },
      ),
    ).rejects.toBe(terminal);
    expect(terminalAttempts).toBe(1);
  });

  it("rejects caller-computed fields, child tokens, and structural forgeries", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_tokens";
    await insertDeployment(persistence, deploymentId);
    const input = appSchemaInput(
      deploymentId,
      "schema_app_tokens",
      ["users"],
    );

    await expect(
      Reflect.apply(prepareAppSchemaVersionArtifactV1, undefined, [
        persistence.drizzle,
        { ...input, manifest: { caller: true } },
      ]),
    ).rejects.toBeInstanceOf(InvalidAppSchemaVersionArtifactV1InputError);

    const bindingToken = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: input.tables },
    );
    const artifactToken = await prepareSchemaVersionArtifact({
      deploymentId,
      schemaVersionId: input.schemaVersionId,
      version: input.version,
      manifest: decodeSchemaManifestJson(bindingToken.section),
    });
    const invalidTokens: ReadonlyArray<unknown> = [
      bindingToken,
      artifactToken,
      {
        deploymentId,
        schemaVersionId: input.schemaVersionId,
        version: input.version,
      },
    ];
    for (const invalidToken of invalidTokens) {
      await expect(
        persistence.drizzle.transaction((tx) =>
          Reflect.apply(
            ensurePreparedAppSchemaVersionArtifactV1InTransaction,
            undefined,
            [tx, invalidToken],
          ),
        ),
      ).rejects.toBeInstanceOf(
        InvalidPreparedAppSchemaVersionArtifactV1Error,
      );
    }
    await expect(rowCounts(persistence, deploymentId)).resolves.toEqual({
      artifacts: 0,
      tables: 0,
    });
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

function appSchemaInput(
  deploymentId: string,
  schemaVersionId: string,
  logicalNames: ReadonlyArray<string>,
): EnsureAppSchemaVersionArtifactV1Input {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(1),
    tables: logicalNames.map(appDeclaration),
  };
}

function appDeclaration(
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
          name: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}

function tableIdentities(
  section: SchemaManifestTableDefinitionsV1,
): ReadonlyArray<{ readonly logicalName: string; readonly tableId: number }> {
  return section.tables.map((table) => ({
    logicalName: table.logicalName,
    tableId: table.tableId,
  }));
}

async function expectCatalogMatchesSection(
  persistence: PGlitePersistence,
  deploymentId: string,
  section: SchemaManifestTableDefinitionsV1,
): Promise<void> {
  const rows = await catalogRows(persistence, deploymentId);
  for (const table of section.tables) {
    expect(rows).toContainEqual({
      deploymentId,
      logicalName: table.logicalName,
      namespace: table.namespace,
      tableId: table.tableId,
    });
  }
}

interface CatalogRow extends Record<string, unknown> {
  deploymentId: string;
  logicalName: string;
  namespace: string;
  tableId: number;
}

async function catalogRows(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<ReadonlyArray<CatalogRow>> {
  const result = await persistence.query<CatalogRow>(
    `
      select
        deployment_id as "deploymentId",
        logical_name as "logicalName",
        namespace,
        table_id as "tableId"
      from fx_control_table
      where deployment_id = $1
      order by table_id
    `,
    [deploymentId],
  );
  return result.rows;
}

async function rowCounts(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<{ readonly artifacts: number; readonly tables: number }> {
  const [artifactRows, tableRows] = await Promise.all([
    persistence.query<{ count: number }>(
      `
        select count(*)::int as count
        from fx_control_schema_version
        where deployment_id = $1
      `,
      [deploymentId],
    ),
    persistence.query<{ count: number }>(
      `
        select count(*)::int as count
        from fx_control_table
        where deployment_id = $1
      `,
      [deploymentId],
    ),
  ]);
  return {
    artifacts: artifactRows.rows[0]?.count ?? 0,
    tables: tableRows.rows[0]?.count ?? 0,
  };
}

function publicationRepository(
  persistence: PGlitePersistence,
): AppSchemaVersionArtifactV1Repository {
  return {
    db: persistence.drizzle,
    runTransaction: (run) => persistence.drizzle.transaction(run),
  };
}

function ensureTable(
  persistence: PGlitePersistence,
  input: Parameters<typeof ensureStableTableIdentityInTransaction>[1],
) {
  return persistence.drizzle.transaction((tx) =>
    ensureStableTableIdentityInTransaction(tx, input),
  );
}

async function ensureArtifact(
  persistence: PGlitePersistence,
  input: EnsureSchemaVersionArtifactInput,
) {
  const prepared = await prepareSchemaVersionArtifact(input);
  return persistence.drizzle.transaction((tx) =>
    ensureSchemaVersionArtifactInTransaction(tx, prepared),
  );
}
