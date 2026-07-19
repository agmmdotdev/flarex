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
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EnsureAppTableDefinitionsArtifactV1Input,
  EnsureSchemaVersionArtifactInput,
  EnsureSchemaVersionArtifactResult,
  FlarexPersistence,
} from "../src";
import {
  AppTableDefinitionsArtifactV1RetryExhaustedError,
  AppTableDefinitionsArtifactV1TransactionError,
  ensureAppTableDefinitionsArtifactV1WithRepositoryEffect,
  ensurePreparedAppTableDefinitionsArtifactV1InTransactionEffect,
  InvalidAppTableDefinitionsArtifactV1InputError,
  InvalidPreparedAppTableDefinitionsArtifactV1Error,
  MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS,
  prepareAppTableDefinitionsArtifactV1Effect,
  runAppTableDefinitionsArtifactV1AttemptsEffect,
  type AppTableDefinitionsArtifactV1Repository,
  type AppTableDefinitionsArtifactV1Transaction,
  type EnsureAppTableDefinitionsArtifactV1Error,
  type PrepareAppTableDefinitionsArtifactV1Error,
  type PreparedAppTableDefinitionsArtifactV1,
} from "../src/appTableDefinitionsArtifacts";
import { createPGlitePersistence } from "../src/pglite";
import {
  prepareSchemaManifestAppTableBindingsV1Effect,
  SchemaManifestTableBindingPlanStaleError,
} from "../src/schemaManifestTableBindings";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactByVersionEffect,
  prepareSchemaVersionArtifactEffect,
  SchemaVersionArtifactConflictError,
} from "../src/schemaVersionArtifacts";
import {
  ensureStableTableIdentityEffect,
  getStableTableIdentityByNameEffect,
} from "../src/stableTableCatalog";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const getSchemaVersionArtifactByVersion = (
  ...args: Parameters<typeof getSchemaVersionArtifactByVersionEffect>
) => runEffect(getSchemaVersionArtifactByVersionEffect(...args));

type PublicInternalCompatibilityExport = Extract<
  keyof typeof import("../src"),
  | "prepareAppTableDefinitionsArtifactV1Effect"
  | "ensurePreparedAppTableDefinitionsArtifactV1InTransactionEffect"
  | "ensureAppTableDefinitionsArtifactV1WithRepositoryEffect"
  | "runAppTableDefinitionsArtifactV1AttemptsEffect"
  | "prepareSchemaVersionArtifactEffect"
  | "ensureSchemaVersionArtifactInTransactionEffect"
  | "ensureStableTableIdentityEffect"
>;

type PublicCompatibilityMethod = Extract<
  keyof FlarexPersistence,
  "ensureAppTableDefinitionsArtifactV1"
>;

type CallerComputedManifest = Omit<
  EnsureAppTableDefinitionsArtifactV1Input,
  "manifest"
> & {
  readonly manifest: { readonly caller: true };
};

type CallerComputedManifestAccepted = CallerComputedManifest extends
  EnsureAppTableDefinitionsArtifactV1Input
  ? true
  : false;

describe("table-only app definitions artifact compatibility", () => {
  it("keeps one high-level facade and hides every swappable child boundary", () => {
    expectTypeOf<PublicInternalCompatibilityExport>().toEqualTypeOf<never>();
    expectTypeOf<PublicCompatibilityMethod>()
      .toEqualTypeOf<"ensureAppTableDefinitionsArtifactV1">();
    expectTypeOf<CallerComputedManifestAccepted>().toEqualTypeOf<false>();
    expectTypeOf<
      Awaited<
        ReturnType<FlarexPersistence["ensureAppTableDefinitionsArtifactV1"]>
      >
    >().toEqualTypeOf<EnsureSchemaVersionArtifactResult>();
    expectTypeOf<
      ReturnType<typeof prepareAppTableDefinitionsArtifactV1Effect>
    >().toEqualTypeOf<Effect.Effect<
      PreparedAppTableDefinitionsArtifactV1,
      PrepareAppTableDefinitionsArtifactV1Error
    >>();
    expectTypeOf<
      ReturnType<
        typeof ensureAppTableDefinitionsArtifactV1WithRepositoryEffect
      >
    >().toEqualTypeOf<Effect.Effect<
      EnsureSchemaVersionArtifactResult,
      EnsureAppTableDefinitionsArtifactV1Error
    >>();
  });

  it("maps transaction infrastructure rejection once to its tagged failure", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_table_artifact_transaction_rejection";
    await insertDeployment(persistence, deploymentId);
    const rejection = new Error("table artifact transaction rejected");
    const repository = {
      db: persistence.drizzle,
      runTransaction<Result>(): Promise<Result> {
        return Promise.reject(rejection);
      },
    } satisfies AppTableDefinitionsArtifactV1Repository;

    const failure = await runEffectFailure(
      ensureAppTableDefinitionsArtifactV1WithRepositoryEffect(
        repository,
        appSchemaInput(deploymentId, "schema_transaction_rejection", ["users"]),
      ),
    );

    expect(failure).toBeInstanceOf(
      AppTableDefinitionsArtifactV1TransactionError,
    );
    expect(failure).toMatchObject({ cause: rejection });
  });

  it("preserves input accessor failures as defects", async () => {
    const persistence = await migratedPersistence();
    const defect = new Error("table artifact input ownKeys defect");
    const input = new Proxy(
      appSchemaInput("deployment_input_defect", "schema_input_defect", ["users"]),
      {
        ownKeys(): never {
          throw defect;
        },
      },
    );

    const exit = await Effect.runPromiseExit(
      prepareAppTableDefinitionsArtifactV1Effect(persistence.drizzle, input),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for the transaction owner to settle before interruption completes", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_table_artifact_interruption";
    await insertDeployment(persistence, deploymentId);
    const entered = deferredValue<void>();
    const release = deferredValue<void>();
    const repository = {
      db: persistence.drizzle,
      async runTransaction<Result>(
        run: (tx: AppTableDefinitionsArtifactV1Transaction) => Promise<Result>,
      ): Promise<Result> {
        const result = await persistence.drizzle.transaction(run);
        entered.resolve(undefined);
        await release.promise;
        return result;
      },
    } satisfies AppTableDefinitionsArtifactV1Repository;
    const fiber = Effect.runFork(
      ensureAppTableDefinitionsArtifactV1WithRepositoryEffect(
        repository,
        appSchemaInput(deploymentId, "schema_interruption", ["users"]),
      ),
    );

    await entered.promise;
    const completion = runEffect(Fiber.await(fiber));
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then(() => {
      interruptionSettled = true;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve(undefined);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("atomically ensures coherent mappings and replays the exact artifact", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_publish";
    await insertDeployment(persistence, deploymentId);
    const input = appSchemaInput(
      deploymentId,
      "schema_app_publish",
      ["users", "products"],
    );

    const created = await persistence.ensureAppTableDefinitionsArtifactV1(input);
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

    const reversed = await persistence.ensureAppTableDefinitionsArtifactV1({
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
      await persistence.ensureAppTableDefinitionsArtifactV1(input);
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
      persistence.ensureAppTableDefinitionsArtifactV1({
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
      runEffect(
        getStableTableIdentityByNameEffect(persistence.drizzle, {
          deploymentId,
          namespace: "app",
          logicalName: "users",
        }),
      ),
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
    const initialBindings = await runEffect(
      prepareSchemaManifestAppTableBindingsV1Effect(persistence.drizzle, {
        deploymentId,
        tables: input.tables,
      }),
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
          tx: AppTableDefinitionsArtifactV1Transaction,
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
    } satisfies AppTableDefinitionsArtifactV1Repository;

    const result = await runEffect(
      ensureAppTableDefinitionsArtifactV1WithRepositoryEffect(
        racingRepository,
        input,
      ),
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
      runEffect(runAppTableDefinitionsArtifactV1AttemptsEffect(
        "deployment_retry_exhausted",
        () => {
          staleAttempts += 1;
          return Effect.fail(stale);
        },
      )),
    ).rejects.toMatchObject({
      name: "AppTableDefinitionsArtifactV1RetryExhaustedError",
      deploymentId: "deployment_retry_exhausted",
      attempts: MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS,
      lastStale: { reason: "catalogHighWaterChanged" },
      cause: stale,
    });
    expect(staleAttempts).toBe(MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS);

    const terminal = new SchemaVersionArtifactConflictError({
      reason: "artifactMismatch",
      deploymentId: "deployment_terminal",
      schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_terminal"),
      version: CatalogSchemaVersionSchema.make(1),
    });
    let terminalAttempts = 0;
    await expect(
      runEffect(runAppTableDefinitionsArtifactV1AttemptsEffect(
        "deployment_terminal",
        () => {
          terminalAttempts += 1;
          return Effect.fail(terminal);
        },
      )),
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
      runEffect(Reflect.apply(
        prepareAppTableDefinitionsArtifactV1Effect,
        undefined,
        [persistence.drizzle, { ...input, manifest: { caller: true } }],
      )),
    ).rejects.toBeInstanceOf(InvalidAppTableDefinitionsArtifactV1InputError);

    const bindingToken = await runEffect(
      prepareSchemaManifestAppTableBindingsV1Effect(persistence.drizzle, {
        deploymentId,
        tables: input.tables,
      }),
    );
    const artifactToken = await runEffect(prepareSchemaVersionArtifactEffect({
      deploymentId,
      schemaVersionId: input.schemaVersionId,
      version: input.version,
      manifest: decodeSchemaManifestJson(bindingToken.section),
    }));
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
        persistence.drizzle.transaction((tx) => runEffect(Reflect.apply(
          ensurePreparedAppTableDefinitionsArtifactV1InTransactionEffect,
          undefined,
          [tx, invalidToken],
        ))),
      ).rejects.toBeInstanceOf(
        InvalidPreparedAppTableDefinitionsArtifactV1Error,
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
): EnsureAppTableDefinitionsArtifactV1Input {
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
): AppTableDefinitionsArtifactV1Repository {
  return {
    db: persistence.drizzle,
    runTransaction: (run) => persistence.drizzle.transaction(run),
  };
}

function deferredValue<Value>(): Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
}> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve(value: Value) {
      if (resolvePromise === undefined) {
        throw new Error("Deferred value was not initialized.");
      }
      resolvePromise(value);
    },
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function ensureTable(
  persistence: PGlitePersistence,
  input: Parameters<typeof ensureStableTableIdentityEffect>[1],
) {
  return runEffect(ensureStableTableIdentityEffect(persistence.drizzle, input));
}

async function ensureArtifact(
  persistence: PGlitePersistence,
  input: EnsureSchemaVersionArtifactInput,
) {
  const prepared = await runEffect(prepareSchemaVersionArtifactEffect(input));
  return persistence.drizzle.transaction((tx) => runEffect(
    ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
  ));
}
