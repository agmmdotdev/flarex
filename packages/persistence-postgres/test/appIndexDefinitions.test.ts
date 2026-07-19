import {
  CatalogIndexDefinitionIdSchema,
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
  MAX_CATALOG_INDEX_DEFINITION_ID,
  type CatalogIndexDefinitionId,
  type CatalogIndexId,
} from "flarex-protocol/catalog";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
} from "flarex-protocol/index-definition";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  APP_BY_ID_PHYSICAL_SPEC_V1,
} from "flarex-protocol/ordered-index";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
  type CatalogSchemaVersionId,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  AppIndexDefinitionCatalogCorruptionError,
  AppIndexDefinitionChecksumCollisionError,
  AppIndexDefinitionReadPersistenceError,
  AppSchemaVersionIndexBindingPersistenceError,
  getAppIndexDefinitionByIdEffect,
  getAppSchemaVersionIndexBindingEffect,
  listAppIndexDefinitionsForLogicalIndexEffect,
  listAppSchemaVersionIndexBindingsEffect,
  type AppSchemaVersionIndexBindingRecord,
  type FlarexPersistence,
  type ReadAppIndexDefinitionError,
  type ReadAppSchemaVersionIndexBindingError,
} from "../src";
import {
  AppIndexDefinitionIdExhaustedError,
  AppIndexDefinitionPreparationError,
  AppDeveloperIndexDefinitionPersistenceError,
  AppSchemaVersionIndexBindingConflictError,
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
  InvalidAppIndexDefinitionBindingInputError,
  InvalidPreparedAppIndexDefinitionBindingError,
  prepareAppDeveloperIndexDefinitionBindingV1Effect,
  type EnsureAppDeveloperIndexDefinitionBindingV1Result,
  type EnsureAppDeveloperIndexDefinitionBindingV1Error,
  type PrepareAppDeveloperIndexDefinitionBindingV1Error,
  type PrepareAppDeveloperIndexDefinitionBindingV1Input,
  type PreparedAppDeveloperIndexDefinitionBindingV1,
} from "../src/appIndexDefinitions";
import { createPGlitePersistence } from "../src/pglite";
import {
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect,
  prepareSchemaManifestAppSchemaBindingsV1Effect,
} from "../src/schemaManifestAppSchemaBindings";
import {
  fxControlIndexDefinitions,
} from "../src/schema";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  prepareSchemaVersionArtifactEffect,
} from "../src/schemaVersionArtifacts";
import type { StableTableCatalogTransaction } from "../src/stableTableCatalog";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const prepareSchemaManifestAppSchemaBindingsV1 = (
  ...args: Parameters<typeof prepareSchemaManifestAppSchemaBindingsV1Effect>
) => runEffect(prepareSchemaManifestAppSchemaBindingsV1Effect(...args));

const prepareSchemaVersionArtifact = (
  ...args: Parameters<typeof prepareSchemaVersionArtifactEffect>
) => runEffect(prepareSchemaVersionArtifactEffect(...args));

const ensureSchemaVersionArtifactInTransaction = (
  ...args: Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>
) => runEffect(ensureSchemaVersionArtifactInTransactionEffect(...args));

const prepareAppDeveloperIndexDefinitionBindingV1 = (
  ...args: Parameters<typeof prepareAppDeveloperIndexDefinitionBindingV1Effect>
) => runEffect(prepareAppDeveloperIndexDefinitionBindingV1Effect(...args));

const getAppIndexDefinitionById = (
  ...args: Parameters<typeof getAppIndexDefinitionByIdEffect>
) => runEffect(getAppIndexDefinitionByIdEffect(...args));

const listAppIndexDefinitionsForLogicalIndex = (
  ...args: Parameters<typeof listAppIndexDefinitionsForLogicalIndexEffect>
) => runEffect(listAppIndexDefinitionsForLogicalIndexEffect(...args));

type PublicMutationMethod = Extract<
  keyof FlarexPersistence,
  | "prepareAppDeveloperIndexDefinitionBindingV1"
  | "ensureAppDeveloperIndexDefinitionBindingV1InTransaction"
  | "allocateIndexDefinitionId"
>;

type PublicMutationExport = Extract<
  keyof typeof import("../src"),
  | "prepareAppDeveloperIndexDefinitionBindingV1"
  | "ensureAppDeveloperIndexDefinitionBindingV1InTransaction"
  | "allocateIndexDefinitionId"
>;

type CallerSuppliedDefinitionInput = Pick<
  PrepareAppDeveloperIndexDefinitionBindingV1Input,
  | "deploymentId"
  | "schemaVersionId"
  | "tableId"
  | "logicalIndexId"
  | "logicalSpec"
> & {
  readonly indexDefinitionId: CatalogIndexDefinitionId;
};

type CallerSuppliedDefinitionAccepted = CallerSuppliedDefinitionInput extends
  PrepareAppDeveloperIndexDefinitionBindingV1Input
  ? true
  : false;

describe("immutable app index definitions", () => {
  it("keeps physical IDs distinct and definition writes internal", () => {
    expectTypeOf<PublicMutationMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicMutationExport>().toEqualTypeOf<never>();
    expectTypeOf<CallerSuppliedDefinitionAccepted>().toEqualTypeOf<false>();
    expectTypeOf<CatalogIndexDefinitionId>()
      .not.toEqualTypeOf<CatalogIndexId>();
    expectTypeOf<
      AppSchemaVersionIndexBindingRecord["requiredForActivation"]
    >().toEqualTypeOf<true>();
    expectTypeOf<
      EnsureAppDeveloperIndexDefinitionBindingV1Result["definition"]["access"]["kind"]
    >().toEqualTypeOf<"developer">();
    expectTypeOf<
      ReturnType<
        typeof ensureAppDeveloperIndexDefinitionBindingV1InTransaction
      >
    >().toEqualTypeOf<Effect.Effect<
      EnsureAppDeveloperIndexDefinitionBindingV1Result,
      EnsureAppDeveloperIndexDefinitionBindingV1Error
    >>();
    expectTypeOf<FlarexPersistence>()
      .not.toMatchTypeOf<
        Parameters<
          typeof ensureAppDeveloperIndexDefinitionBindingV1InTransaction
        >[0]
      >();
    expectTypeOf<
      ReturnType<typeof getAppSchemaVersionIndexBindingEffect>
    >().toEqualTypeOf<Effect.Effect<
      AppSchemaVersionIndexBindingRecord | null,
      ReadAppSchemaVersionIndexBindingError
    >>();
    expectTypeOf<
      ReturnType<typeof listAppSchemaVersionIndexBindingsEffect>
    >().toEqualTypeOf<Effect.Effect<
      ReadonlyArray<AppSchemaVersionIndexBindingRecord>,
      ReadAppSchemaVersionIndexBindingError
    >>();
    expectTypeOf<
      ReturnType<typeof prepareAppDeveloperIndexDefinitionBindingV1Effect>
    >().toEqualTypeOf<Effect.Effect<
      PreparedAppDeveloperIndexDefinitionBindingV1,
      PrepareAppDeveloperIndexDefinitionBindingV1Error
    >>();
    expectTypeOf<
      ReturnType<typeof getAppIndexDefinitionByIdEffect>
    >().toEqualTypeOf<Effect.Effect<
      import("../src").AppIndexDefinitionRecord | null,
      ReadAppIndexDefinitionError
    >>();
    expectTypeOf<
      ReturnType<typeof listAppIndexDefinitionsForLogicalIndexEffect>
    >().toEqualTypeOf<Effect.Effect<
      ReadonlyArray<import("../src").AppIndexDefinitionRecord>,
      ReadAppIndexDefinitionError
    >>();
  });

  it("reuses exact definitions and keeps changed generations coexisting", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_generations";
    await insertDeployment(persistence, deploymentId);
    const v1 = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_v1",
      1,
      ["email"],
    );
    const created = await ensurePrepared(
      persistence,
      await prepareDefinition(v1),
    );
    const replay = await ensurePrepared(
      persistence,
      await prepareDefinition(v1),
    );

    expect(created).toMatchObject({
      definitionStatus: "created",
      bindingStatus: "created",
      definition: {
        indexDefinitionId: 1,
        access: { kind: "developer", tableId: 1, logicalIndexId: 1 },
        physicalSpec: {
          accessPath: "developer",
          keyCodecVersion: 1,
          collation: "binaryUtf8",
          maxEncodedKeyBytes: 2_048,
        },
      },
      binding: {
        schemaVersionId: "schema_definition_v1",
        logicalIndexId: 1,
        indexDefinitionId: 1,
        requiredForActivation: true,
      },
    });
    expect(replay.definitionStatus).toBe("existing");
    expect(replay.bindingStatus).toBe("existing");
    expect(replay.definition).toEqual(created.definition);
    expect(replay.binding).toEqual(created.binding);

    const v2 = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_v2",
      2,
      ["email"],
    );
    const reused = await ensurePrepared(
      persistence,
      await prepareDefinition(v2),
    );
    expect(reused).toMatchObject({
      definitionStatus: "existing",
      bindingStatus: "created",
      definition: { indexDefinitionId: 1 },
      binding: { indexDefinitionId: 1 },
    });

    const v3 = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_v3",
      3,
      ["profile.email"],
    );
    const replacement = await ensurePrepared(
      persistence,
      await prepareDefinition(v3),
    );
    expect(replacement).toMatchObject({
      definitionStatus: "created",
      bindingStatus: "created",
      definition: { indexDefinitionId: 2 },
      binding: { indexDefinitionId: 2 },
    });

    await expect(
      listAppIndexDefinitionsForLogicalIndex(
        persistence.drizzle,
        deploymentId,
        CatalogIndexIdSchema.make(1),
      ),
    ).resolves.toMatchObject([
      { indexDefinitionId: 1 },
      { indexDefinitionId: 2 },
    ]);
    await expect(
      runEffect(
        getAppSchemaVersionIndexBindingEffect(
          persistence.drizzle,
          deploymentId,
          schemaId("schema_definition_v1"),
          CatalogIndexIdSchema.make(1),
        ),
      ),
    ).resolves.toMatchObject({ indexDefinitionId: 1 });
    await expect(
      runEffect(
        getAppSchemaVersionIndexBindingEffect(
          persistence.drizzle,
          deploymentId,
          schemaId("schema_definition_v3"),
          CatalogIndexIdSchema.make(1),
        ),
      ),
    ).resolves.toMatchObject({ indexDefinitionId: 2 });
    await expect(
      runEffect(
        listAppSchemaVersionIndexBindingsEffect(
          persistence.drizzle,
          deploymentId,
          schemaId("schema_definition_v2"),
        ),
      ),
    ).resolves.toMatchObject([{ indexDefinitionId: 1 }]);

    expectTypeOf(created.definition.physicalSpecBytesHex)
      .toMatchTypeOf<string>();
    expectTypeOf(created.definition.physicalSpecSha256Hex)
      .toMatchTypeOf<string>();
    await expect(
      getAppIndexDefinitionById(
        persistence.drizzle,
        deploymentId,
        CatalogIndexDefinitionIdSchema.make(1),
      ),
    ).resolves.toEqual(replay.definition);
  });

  it("rejects invalid schema-binding read input before constructing SQL", async () => {
    let selected = false;
    const db = {
      select(): never {
        selected = true;
        throw new Error("Invalid input must not construct a query.");
      },
    } as unknown as StableTableCatalogTransaction;

    const failure = await runEffectFailure(
      listAppSchemaVersionIndexBindingsEffect(
        db,
        "",
        schemaId("schema_definition_invalid_read"),
      ),
    );

    expect(failure).toBeInstanceOf(InvalidAppIndexDefinitionBindingInputError);
    expect(failure).toMatchObject({
      issue: { reason: "invalidDeploymentId" },
    });
    expect(selected).toBe(false);
  });

  it("maps rejected schema-binding reads once at their SQL edge", async () => {
    const listRejection = new Error("schema binding list query rejected");
    const listDb = developerSelectTransaction(() =>
      Promise.reject(listRejection)
    );

    const listFailure = await runEffectFailure(
      listAppSchemaVersionIndexBindingsEffect(
        listDb,
        "deployment_index_definition_binding_read_failure",
        schemaId("schema_definition_binding_read_failure"),
      ),
    );

    expect(listFailure).toBeInstanceOf(
      AppSchemaVersionIndexBindingPersistenceError,
    );
    expect(listFailure).toMatchObject({
      _tag: "AppSchemaVersionIndexBindingPersistenceError",
      operation: "listBySchemaVersion",
      cause: listRejection,
    });

    const readRejection = new Error("schema binding exact query rejected");
    const readDb = developerSelectTransaction(() =>
      Promise.reject(readRejection)
    );
    const readFailure = await runEffectFailure(
      getAppSchemaVersionIndexBindingEffect(
        readDb,
        "deployment_index_definition_binding_read_failure",
        schemaId("schema_definition_binding_read_failure"),
        CatalogIndexIdSchema.make(1),
      ),
    );
    expect(readFailure).toMatchObject({
      _tag: "AppSchemaVersionIndexBindingPersistenceError",
      operation: "readByLogicalIndexId",
      cause: readRejection,
    });
  });

  it("preserves schema-binding query construction failures as defects", async () => {
    const defect = new Error("schema binding query construction defect");
    const db = {
      select(): never {
        throw defect;
      },
    } as unknown as StableTableCatalogTransaction;

    const exit = await Effect.runPromiseExit(
      listAppSchemaVersionIndexBindingsEffect(
        db,
        "deployment_index_definition_binding_read_defect",
        schemaId("schema_definition_binding_read_defect"),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("maps malformed stored schema bindings to catalog corruption", async () => {
    const db = developerSelectTransaction(() => Promise.resolve([{
      deploymentId: "deployment_index_definition_binding_corruption",
      schemaVersionId: "schema_definition_binding_corruption",
      logicalIndexId: 1,
      indexDefinitionId: 1,
      requiredForActivation: false,
      createdAt: new Date(),
    }]));

    const failure = await runEffectFailure(
      listAppSchemaVersionIndexBindingsEffect(
        db,
        "deployment_index_definition_binding_corruption",
        schemaId("schema_definition_binding_corruption"),
      ),
    );

    expect(failure).toBeInstanceOf(AppIndexDefinitionCatalogCorruptionError);
    expect(failure).toMatchObject({
      detail: expect.stringContaining("invalid activation requirement"),
    });
  });

  it("waits for a pending schema-binding read before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const db = developerSelectTransaction(() => {
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      listAppSchemaVersionIndexBindingsEffect(
        db,
        "deployment_index_definition_binding_interruption",
        schemaId("schema_definition_binding_interruption"),
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
      query.resolve([]);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("rejects invalid definition-read input before constructing SQL", async () => {
    let selected = false;
    const db = {
      select(): never {
        selected = true;
        throw new Error("Invalid input must not construct a query.");
      },
    } as unknown as StableTableCatalogTransaction;

    const failure = await runEffectFailure(
      getAppIndexDefinitionByIdEffect(
        db,
        "",
        CatalogIndexDefinitionIdSchema.make(1),
      ),
    );

    expect(failure).toBeInstanceOf(InvalidAppIndexDefinitionBindingInputError);
    expect(failure).toMatchObject({
      issue: { reason: "invalidDeploymentId" },
    });
    expect(selected).toBe(false);
  });

  it("maps physical-spec canonicalization rejection to typed preparation failure", async () => {
    const rejection = new Error("physical index digest rejected");
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      rejection,
    );
    try {
      const failure = await runEffectFailure(
        prepareAppDeveloperIndexDefinitionBindingV1Effect({
          deploymentId: "deployment_index_definition_prepare_failure",
          schemaVersionId: schemaId("schema_definition_prepare_failure"),
          tableId: CatalogTableIdSchema.make(1),
          logicalIndexId: CatalogIndexIdSchema.make(2),
          logicalSpec: developerLogicalSpec(["email"]),
        }),
      );

      expect(failure).toBeInstanceOf(AppIndexDefinitionPreparationError);
      expect(failure).toMatchObject({
        _tag: "AppIndexDefinitionPreparationError",
        deploymentId: "deployment_index_definition_prepare_failure",
        schemaVersionId: "schema_definition_prepare_failure",
        logicalIndexId: 2,
        cause: rejection,
      });
    } finally {
      digest.mockRestore();
    }
  });

  it("maps rejected definition reads once at their SQL edge", async () => {
    const readRejection = new Error("definition read query rejected");
    const readFailure = await runEffectFailure(
      getAppIndexDefinitionByIdEffect(
        developerSelectTransaction(() => Promise.reject(readRejection)),
        "deployment_index_definition_read_failure",
        CatalogIndexDefinitionIdSchema.make(1),
      ),
    );
    expect(readFailure).toBeInstanceOf(
      AppIndexDefinitionReadPersistenceError,
    );
    expect(readFailure).toMatchObject({
      _tag: "AppIndexDefinitionReadPersistenceError",
      operation: "readByDefinitionId",
      cause: readRejection,
    });

    const listRejection = new Error("definition list query rejected");
    const listFailure = await runEffectFailure(
      listAppIndexDefinitionsForLogicalIndexEffect(
        developerSelectTransaction(() => Promise.reject(listRejection)),
        "deployment_index_definition_list_failure",
        CatalogIndexIdSchema.make(1),
      ),
    );
    expect(listFailure).toMatchObject({
      _tag: "AppIndexDefinitionReadPersistenceError",
      operation: "listByLogicalIndexId",
      cause: listRejection,
    });
  });

  it("preserves definition-read query construction failures as defects", async () => {
    const defect = new Error("definition read query construction defect");
    const db = {
      select(): never {
        throw defect;
      },
    } as unknown as StableTableCatalogTransaction;

    const exit = await Effect.runPromiseExit(
      getAppIndexDefinitionByIdEffect(
        db,
        "deployment_index_definition_read_defect",
        CatalogIndexDefinitionIdSchema.make(1),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it(
    "maps invalid stored physical evidence to catalog corruption",
    async () => {
      const deploymentId =
        "deployment_index_definition_evidence_corruption";
      const canonical = await canonicalizeAppIndexPhysicalSpecV1(
        APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
      );
      const db = developerSelectTransaction(() => Promise.resolve([{
        deploymentId,
        indexDefinitionId: 1,
        accessKind: "by_creation_time",
        accessIdentityId: 1,
        tableId: 1,
        logicalIndexId: null,
        physicalSpecCodecVersion: 2,
        physicalSpecJson: canonical.physicalSpec,
        physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
          canonical.canonicalBytesHex,
        ),
        physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
          canonical.sha256Hex,
        ),
        createdAt: new Date(),
      }]));

      const failure = await runEffectFailure(
        getAppIndexDefinitionByIdEffect(
          db,
          deploymentId,
          CatalogIndexDefinitionIdSchema.make(1),
        ),
      );

      expect(failure).toBeInstanceOf(AppIndexDefinitionCatalogCorruptionError);
      expect(failure).toMatchObject({
        detail: "definition 1 has an invalid physical specification",
      });
    },
  );

  it(
    "preserves stored physical-evidence row access failures as defects",
    async () => {
      const deploymentId = "deployment_index_definition_evidence_defect";
      const defect = new Error("physical evidence row access defect");
      const canonical = await canonicalizeAppIndexPhysicalSpecV1(
        APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
      );
      const db = developerSelectTransaction(() => Promise.resolve([{
        deploymentId,
        indexDefinitionId: 1,
        accessKind: "by_creation_time",
        accessIdentityId: 1,
        tableId: 1,
        logicalIndexId: null,
        physicalSpecCodecVersion: canonical.codecVersion,
        physicalSpecJson: canonical.physicalSpec,
        get physicalSpecBytes(): Uint8Array {
          throw defect;
        },
        physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
          canonical.sha256Hex,
        ),
        createdAt: new Date(),
      }]));

      const exit = await Effect.runPromiseExit(
        getAppIndexDefinitionByIdEffect(
          db,
          deploymentId,
          CatalogIndexDefinitionIdSchema.make(1),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.hasFails(exit.cause)).toBe(false);
        expect(exit.cause.toString()).toContain(defect.message);
      }
    },
  );

  it(
    "preserves stored physical-spec JSON row access failures as defects",
    async () => {
      const deploymentId = "deployment_index_definition_json_defect";
      const defect = new Error("physical-spec JSON row access defect");
      const canonical = await canonicalizeAppIndexPhysicalSpecV1(
        APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
      );
      const db = developerSelectTransaction(() => Promise.resolve([{
        deploymentId,
        indexDefinitionId: 1,
        accessKind: "by_creation_time",
        accessIdentityId: 1,
        tableId: 1,
        logicalIndexId: null,
        physicalSpecCodecVersion: canonical.codecVersion,
        get physicalSpecJson(): never {
          throw defect;
        },
        physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
          canonical.canonicalBytesHex,
        ),
        physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
          canonical.sha256Hex,
        ),
        createdAt: new Date(),
      }]));

      const exit = await Effect.runPromiseExit(
        getAppIndexDefinitionByIdEffect(
          db,
          deploymentId,
          CatalogIndexDefinitionIdSchema.make(1),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.hasFails(exit.cause)).toBe(false);
        expect(exit.cause.toString()).toContain(defect.message);
      }
    },
  );

  it("waits for a pending definition read before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const db = developerSelectTransaction(() => {
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      listAppIndexDefinitionsForLogicalIndexEffect(
        db,
        "deployment_index_definition_read_interruption",
        CatalogIndexIdSchema.make(1),
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
      query.resolve([]);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("rejects missing or mismatched parents and forged prepared tokens", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_parents";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_parent",
      1,
      ["email"],
      [appTable("users"), appTable("products")],
    );

    const missingSchema = await prepareAppDeveloperIndexDefinitionBindingV1({
      ...definitionInput(registered),
      schemaVersionId: schemaId("missing_definition_schema"),
    });
    await expect(ensurePrepared(persistence, missingSchema)).rejects.toMatchObject({
      name: "AppIndexDefinitionParentError",
      issue: { reason: "schemaVersionNotFound" },
    });

    const missingLogical = await prepareAppDeveloperIndexDefinitionBindingV1({
      ...definitionInput(registered),
      logicalIndexId: CatalogIndexIdSchema.make(99),
    });
    await expect(ensurePrepared(persistence, missingLogical)).rejects.toMatchObject({
      name: "AppIndexDefinitionParentError",
      issue: { reason: "logicalIndexNotFound" },
    });

    const wrongTable = await prepareAppDeveloperIndexDefinitionBindingV1({
      ...definitionInput(registered),
      tableId: CatalogTableIdSchema.make(
        registered.tableId === 1 ? 2 : 1,
      ),
    });
    await expect(ensurePrepared(persistence, wrongTable)).rejects.toMatchObject({
      name: "AppIndexDefinitionParentError",
      issue: { reason: "logicalIndexTableMismatch" },
    });

    await expect(
      persistence.drizzle.transaction((tx) =>
        runEffect(
          Reflect.apply(
            ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
            undefined,
            [
              tx,
              {
                deploymentId,
                schemaVersionId: registered.schemaVersionId,
                tableId: registered.tableId,
                logicalIndexId: registered.logicalIndexId,
              },
            ],
          ),
        )
      ),
    ).rejects.toBeInstanceOf(InvalidPreparedAppIndexDefinitionBindingError);

    await expect(
      prepareAppDeveloperIndexDefinitionBindingV1({
        ...definitionInput(registered),
        // @ts-expect-error Physical IDs are repository-generated.
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(7),
      }),
    ).rejects.toBeInstanceOf(InvalidAppIndexDefinitionBindingInputError);
  });

  it("maps a rejected developer parent read once at its SQL edge", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_sql_failure";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_sql_failure",
      1,
      ["email"],
    );
    const prepared = await prepareDefinition(registered);
    const rejection = new Error("developer schema parent query rejected");
    const tx = developerSelectTransaction((selectCall) => {
      switch (selectCall) {
        case 1:
          return Promise.resolve([{ deploymentId }]);
        case 2:
          return Promise.reject(rejection);
        default:
          throw new Error(`Unexpected select call: ${selectCall}.`);
      }
    });

    const failure = await runEffectFailure(
      ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared),
    );
    expect(failure).toBeInstanceOf(
      AppDeveloperIndexDefinitionPersistenceError,
    );
    expect(failure).toMatchObject({
      _tag: "AppDeveloperIndexDefinitionPersistenceError",
      operation: "readSchemaParent",
      cause: rejection,
    });
  });

  it("preserves developer query construction failures as defects", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_construction_defect";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_construction_defect",
      1,
      ["email"],
    );
    const prepared = await prepareDefinition(registered);
    const defect = new Error("developer schema parent construction defect");
    const tx = developerSelectTransaction((selectCall) => {
      if (selectCall === 1) return Promise.resolve([{ deploymentId }]);
      throw defect;
    });
    const exit = await Effect.runPromiseExit(
      ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending developer parent read before interruption completes", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_interruption";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_interruption",
      1,
      ["email"],
    );
    const prepared = await prepareDefinition(registered);
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const tx = developerSelectTransaction((selectCall) => {
      if (selectCall === 1) return Promise.resolve([{ deploymentId }]);
      if (selectCall === 2) {
        entered.resolve(undefined);
        return query.promise;
      }
      throw new Error(`Unexpected select call: ${selectCall}.`);
    });
    const fiber = Effect.runFork(
      ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared),
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
      query.resolve([]);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("rolls a newly allocated definition back when its binding conflicts", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_conflict";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_conflict",
      1,
      ["email"],
    );
    await ensurePrepared(persistence, await prepareDefinition(registered));

    const competing = await prepareAppDeveloperIndexDefinitionBindingV1({
      ...definitionInput(registered),
      logicalSpec: developerLogicalSpec(["profile.email"]),
    });
    await expect(ensurePrepared(persistence, competing)).rejects.toBeInstanceOf(
      AppSchemaVersionIndexBindingConflictError,
    );
    await expect(
      persistence.drizzle.transaction(async (tx) => {
        try {
          await runEffect(
            ensureAppDeveloperIndexDefinitionBindingV1InTransaction(
              tx,
              competing,
            ),
          );
          throw new Error("Expected a binding conflict inside transaction.");
        } catch (error) {
          expect(error).toBeInstanceOf(
            AppSchemaVersionIndexBindingConflictError,
          );
        }
      }),
    ).resolves.toBeUndefined();
    await expect(definitionCounts(persistence, deploymentId)).resolves.toEqual({
      definitions: 1,
      bindings: 1,
    });
  });

  it("preserves developer checksum collision identity on replay", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_replay_collision";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_replay_collision",
      1,
      ["email"],
    );
    const prepared = await prepareDefinition(registered);
    const created = await ensurePrepared(persistence, prepared);
    const corrupted = canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
      created.definition.physicalSpecBytesHex,
    );
    const firstByte = corrupted[0];
    if (firstByte === undefined) {
      throw new Error("Expected nonempty canonical physical-spec bytes.");
    }
    corrupted[0] = firstByte === 0 ? 1 : 0;
    await persistence.query(
      `
        update fx_control_index_definition
        set physical_spec_bytes = $3
        where deployment_id = $1 and index_definition_id = $2
      `,
      [deploymentId, created.definition.indexDefinitionId, corrupted],
    );

    const replay = ensurePrepared(persistence, prepared);
    await expect(replay).rejects.toBeInstanceOf(
      AppIndexDefinitionChecksumCollisionError,
    );
    await expect(replay).rejects.toMatchObject({
      _tag: "AppIndexDefinitionChecksumCollisionError",
      deploymentId,
      logicalIndexId: registered.logicalIndexId,
      existingIndexDefinitionId: created.definition.indexDefinitionId,
    });
    await expect(definitionCounts(persistence, deploymentId)).resolves.toEqual({
      definitions: 1,
      bindings: 1,
    });
  });

  it("does not consume definition IDs when the caller transaction rolls back", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_rollback";
    await insertDeployment(persistence, deploymentId);
    const v1 = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_rollback_v1",
      1,
      ["email"],
    );
    const v2 = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_rollback_v2",
      2,
      ["profile.email"],
    );
    await ensurePrepared(persistence, await prepareDefinition(v1));
    const replacement = await prepareDefinition(v2);

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await runEffect(
          ensureAppDeveloperIndexDefinitionBindingV1InTransaction(
            tx,
            replacement,
          ),
        );
        throw new Error("injected definition rollback");
      }),
    ).rejects.toThrow("injected definition rollback");
    await expect(definitionCounts(persistence, deploymentId)).resolves.toEqual({
      definitions: 1,
      bindings: 1,
    });

    const committed = await ensurePrepared(persistence, replacement);
    expect(committed.definition.indexDefinitionId).toBe(2);
  });

  it("performs no Web Crypto while the deployment transaction is locked", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_no_locked_crypto";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_no_locked_crypto",
      1,
      ["email"],
    );
    const prepared = await prepareDefinition(registered);
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      new Error("Web Crypto must stay outside the SQL lock"),
    );
    try {
      await expect(ensurePrepared(persistence, prepared)).resolves.toMatchObject({
        definitionStatus: "created",
        bindingStatus: "created",
      });
      await expect(ensurePrepared(persistence, prepared)).resolves.toMatchObject({
        definitionStatus: "existing",
        bindingStatus: "existing",
      });
    } finally {
      digest.mockRestore();
    }
  });

  it("supports table-owned creation-time definitions without fake logical IDs", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_intrinsic";
    await insertDeployment(persistence, deploymentId);
    await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_intrinsic",
      1,
      ["email"],
    );
    const creation = await canonicalizeAppIndexPhysicalSpecV1(
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
    );

    await expect(
      persistence.drizzle.insert(fxControlIndexDefinitions).values({
        deploymentId,
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(50),
        accessKind: "by_creation_time",
        accessIdentityId: CatalogTableIdSchema.make(1),
        tableId: CatalogTableIdSchema.make(1),
        logicalIndexId: null,
        physicalSpecCodecVersion: creation.codecVersion,
        physicalSpecJson: creation.physicalSpec,
        physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
          creation.canonicalBytesHex,
        ),
        physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
          creation.sha256Hex,
        ),
      }),
    ).resolves.toBeDefined();
    await expect(
      getAppIndexDefinitionById(
        persistence.drizzle,
        deploymentId,
        CatalogIndexDefinitionIdSchema.make(50),
      ),
    ).resolves.toMatchObject({
      access: { kind: "by_creation_time", tableId: 1 },
      physicalSpec: { accessPath: "by_creation_time" },
    });

    const byId = await canonicalizeAppIndexPhysicalSpecV1(
      APP_BY_ID_PHYSICAL_SPEC_V1,
    );
    await expect(
      persistence.query(
        `
          insert into fx_control_index_definition
            (
              deployment_id,
              index_definition_id,
              access_kind,
              access_identity_id,
              table_id,
              logical_index_id,
              physical_spec_codec_version,
              physical_spec_json,
              physical_spec_bytes,
              physical_spec_sha256
            )
          values ($1, $2, $3, $4, $5, null, $6, $7::jsonb, $8, $9)
        `,
        [
          deploymentId,
          51,
          "by_id",
          1,
          1,
          byId.codecVersion,
          JSON.stringify(byId.physicalSpec),
          canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
            byId.canonicalBytesHex,
          ),
          appIndexPhysicalSpecSha256HexV1ToBytes(byId.sha256Hex),
        ],
      ),
    ).rejects.toThrow();

  });

  it("enforces composite ownership and detects stored canonical corruption", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_constraints";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_constraints",
      1,
      ["email"],
    );
    const ensured = await ensurePrepared(
      persistence,
      await prepareDefinition(registered),
    );

    await expect(
      persistence.query(
        `
          insert into fx_control_schema_version_index_binding
            (
              deployment_id,
              schema_version_id,
              logical_index_id,
              index_definition_id,
              required_for_activation
            )
          values ($1, $2, $3, $4, true)
        `,
        [deploymentId, "schema_definition_constraints", 2, 1],
      ),
    ).rejects.toThrow();

    await expect(
      persistence.query(
        `
          update fx_control_schema_version_index_binding
          set required_for_activation = false
          where deployment_id = $1
            and schema_version_id = $2
            and logical_index_id = $3
        `,
        [deploymentId, "schema_definition_constraints", 1],
      ),
    ).rejects.toThrow();

    const oversizedSpec = {
      ...ensured.definition.physicalSpec,
      orderedFields: [
        { kind: "documentPath", path: "a".repeat(131_073) },
      ],
    };
    const oversizedJson = JSON.stringify(oversizedSpec);
    const oversizedLogicalSizes = await persistence.query<{
      json_size: number;
    }>(
      "select octet_length($1::jsonb::text)::int as json_size",
      [oversizedJson],
    );
    expect(oversizedLogicalSizes.rows[0]?.json_size).toBeGreaterThan(
      MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
    );

    const invalidSpecs: ReadonlyArray<{
      readonly id: number;
      readonly spec: unknown;
    }> = [
      { id: 90, spec: {} },
      { id: 91, spec: oversizedSpec },
    ];
    for (const invalid of invalidSpecs) {
      await expect(
        persistence.query(
          `
            insert into fx_control_index_definition
              (
                deployment_id,
                index_definition_id,
                access_kind,
                access_identity_id,
                table_id,
                logical_index_id,
                physical_spec_codec_version,
                physical_spec_json,
                physical_spec_bytes,
                physical_spec_sha256
              )
            values ($1, $2, 'developer', 1, 1, 1, 1, $3::jsonb, $4, $5)
          `,
          [
            deploymentId,
            invalid.id,
            JSON.stringify(invalid.spec),
            new Uint8Array([1]),
            new Uint8Array(32).fill(1),
          ],
        ),
      ).rejects.toThrow();
    }

    const corrupted = canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
      ensured.definition.physicalSpecBytesHex,
    );
    corrupted[0] = corrupted[0] === 0 ? 1 : 0;
    await persistence.query(
      `
        update fx_control_index_definition
        set physical_spec_bytes = $3
        where deployment_id = $1 and index_definition_id = $2
      `,
      [deploymentId, 1, corrupted],
    );
    await expect(
      getAppIndexDefinitionById(
        persistence.drizzle,
        deploymentId,
        CatalogIndexDefinitionIdSchema.make(1),
      ),
    ).rejects.toBeInstanceOf(AppIndexDefinitionCatalogCorruptionError);
  });

  it("fails closed at the deployment-local physical ID ceiling", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_exhausted";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_exhausted",
      1,
      ["email"],
    );
    const creation = await canonicalizeAppIndexPhysicalSpecV1(
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
    );
    await persistence.drizzle.insert(fxControlIndexDefinitions).values({
      deploymentId,
      indexDefinitionId: CatalogIndexDefinitionIdSchema.make(
        MAX_CATALOG_INDEX_DEFINITION_ID,
      ),
      accessKind: "by_creation_time",
      accessIdentityId: registered.tableId,
      tableId: registered.tableId,
      logicalIndexId: null,
      physicalSpecCodecVersion: creation.codecVersion,
      physicalSpecJson: creation.physicalSpec,
      physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
        creation.canonicalBytesHex,
      ),
      physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
        creation.sha256Hex,
      ),
    });

    await expect(
      ensurePrepared(persistence, await prepareDefinition(registered)),
    ).rejects.toBeInstanceOf(AppIndexDefinitionIdExhaustedError);
  });

  it("accepts the largest closed v1 physical-spec envelope", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_index_definition_max_spec";
    await insertDeployment(persistence, deploymentId);
    const sharedSegments = Array.from(
      { length: 127 },
      () => "a".repeat(64),
    );
    const fields = Array.from({ length: 15 }, (_, index) =>
      [
        ...sharedSegments,
        `${"z".repeat(63)}${String.fromCharCode(97 + index)}`,
      ].join(".")
    );
    const registered = await registerAppSchemaVersion(
      persistence,
      deploymentId,
      "schema_definition_max_spec",
      1,
      fields,
    );
    const result = await ensurePrepared(
      persistence,
      await prepareDefinition(registered),
    );
    const sizes = await persistence.query<{ json_size: number }>(
      `
        select octet_length(physical_spec_json::text)::int as json_size
        from fx_control_index_definition
        where deployment_id = $1 and index_definition_id = 1
      `,
      [deploymentId],
    );

    expect(result.definition.physicalSpecBytesHex.length / 2)
      .toBeLessThanOrEqual(
        MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
      );
    expect(sizes.rows[0]?.json_size).toBeLessThanOrEqual(
      MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
    );
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

interface RegisteredAppSchemaVersion {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: ReturnType<typeof CatalogTableIdSchema.make>;
  readonly logicalIndexId: ReturnType<typeof CatalogIndexIdSchema.make>;
  readonly logicalSpec: SchemaManifestAppSchemaV1["indexBindings"]["indexes"][number]["spec"];
}

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

async function registerAppSchemaVersion(
  persistence: PGlitePersistence,
  deploymentId: string,
  schemaVersionIdValue: string,
  version: number,
  fields: ReadonlyArray<string>,
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationInputV1> = [
    appTable("users"),
  ],
): Promise<RegisteredAppSchemaVersion> {
  const plan = await prepareSchemaManifestAppSchemaBindingsV1(
    persistence.drizzle,
    {
      deploymentId,
      tables,
      indexes: [appIndex("users", "by_email", fields)],
    },
  );
  const manifest = await persistence.drizzle.transaction((tx) =>
    runEffect(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, plan),
    )
  );
  const preparedArtifact = await prepareSchemaVersionArtifact({
    deploymentId,
    schemaVersionId: schemaId(schemaVersionIdValue),
    version: CatalogSchemaVersionSchema.make(version),
    manifest,
  });
  await persistence.drizzle.transaction((tx) =>
    ensureSchemaVersionArtifactInTransaction(tx, preparedArtifact)
  );
  const table = manifest.tableDefinitions.tables.find(
    (candidate) => candidate.logicalName === "users",
  );
  const index = manifest.indexBindings.indexes.find(
    (candidate) => candidate.descriptor === "by_email",
  );
  if (table === undefined || index === undefined) {
    throw new Error("Registered app schema did not contain its users index.");
  }
  return Object.freeze({
    deploymentId,
    schemaVersionId: schemaId(schemaVersionIdValue),
    tableId: table.tableId,
    logicalIndexId: index.logicalIndexId,
    logicalSpec: index.spec,
  });
}

function definitionInput(
  registered: RegisteredAppSchemaVersion,
): PrepareAppDeveloperIndexDefinitionBindingV1Input {
  return {
    deploymentId: registered.deploymentId,
    schemaVersionId: registered.schemaVersionId,
    tableId: registered.tableId,
    logicalIndexId: registered.logicalIndexId,
    logicalSpec: registered.logicalSpec,
  };
}

function prepareDefinition(
  registered: RegisteredAppSchemaVersion,
): Promise<PreparedAppDeveloperIndexDefinitionBindingV1> {
  return prepareAppDeveloperIndexDefinitionBindingV1(
    definitionInput(registered),
  );
}

function ensurePrepared(
  persistence: PGlitePersistence,
  prepared: PreparedAppDeveloperIndexDefinitionBindingV1,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared),
    )
  );
}

interface DeveloperSelectQuery
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): DeveloperSelectQuery;
  where(): DeveloperSelectQuery;
  limit(): DeveloperSelectQuery;
  orderBy(): DeveloperSelectQuery;
  for(): DeveloperSelectQuery;
}

function developerSelectTransaction(
  run: (selectCall: number) => Promise<ReadonlyArray<unknown>>,
): StableTableCatalogTransaction {
  let selectCall = 0;
  return {
    select() {
      selectCall += 1;
      const promise = run(selectCall);
      const query: DeveloperSelectQuery = {
        from: () => query,
        where: () => query,
        limit: () => query,
        orderBy: () => query,
        for: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
  } as unknown as StableTableCatalogTransaction;
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

function schemaId(value: string): CatalogSchemaVersionId {
  return CatalogSchemaVersionIdSchema.make(value);
}

function developerLogicalSpec(
  fields: ReadonlyArray<string>,
): RegisteredAppSchemaVersion["logicalSpec"] {
  return decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
    kind: "developerOrdered",
    specVersion: 1,
    fields,
  });
}

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
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
          name: {
            fieldType: { type: "string" },
            optional: false,
          },
          email: {
            fieldType: { type: "string" },
            optional: true,
          },
          profile: {
            fieldType: {
              type: "object",
              value: {
                email: {
                  fieldType: { type: "string" },
                  optional: true,
                },
              },
            },
            optional: true,
          },
        },
      },
    },
  };
}

async function definitionCounts(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<{ readonly definitions: number; readonly bindings: number }> {
  const result = await persistence.query<{
    definitions: number;
    bindings: number;
  }>(
    `
      select
        (
          select count(*)::int
          from fx_control_index_definition
          where deployment_id = $1
        ) as definitions,
        (
          select count(*)::int
          from fx_control_schema_version_index_binding
          where deployment_id = $1
        ) as bindings
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Definition count query returned no row.");
  return row;
}
import { setTimeout as delay } from "node:timers/promises";
