import {
  type CatalogIndexDefinitionId,
} from "flarex-protocol/catalog";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
} from "flarex-protocol/index-definition";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
} from "flarex-protocol/ordered-index";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

// @ts-expect-error D2b prepared tokens must remain absent from the package root.
import type { PreparedAppCreationTimeIndexDefinitionV1 as RootPreparedAppCreationTimeIndexDefinitionV1 } from "../src";
import type { FlarexPersistence } from "../src";
import {
  getPreparedAppSchemaPublicationV1StateResult,
  InvalidPreparedAppSchemaPublicationV1Error,
  prepareAppSchemaPublicationV1Effect,
} from "../src/appSchemaPublicationPreparation";
import {
  AppCreationTimeIndexDefinitionPersistenceError,
  AppCreationTimeIndexDefinitionChecksumCollisionError,
  AppIndexDefinitionCatalogCorruptionError,
  ensureAppCreationTimeIndexDefinitionV1InTransaction,
  InvalidPreparedAppCreationTimeIndexDefinitionError,
  prepareAppCreationTimeIndexDefinitionsV1Result,
  prepareAppDeveloperIndexDefinitionBindingsV1Result,
  type EnsureAppCreationTimeIndexDefinitionV1Error,
  type EnsureAppCreationTimeIndexDefinitionV1Result,
  type PreparedAppCreationTimeIndexDefinitionV1,
} from "../src/appIndexDefinitions";
import { createPGlitePersistence } from "../src/pglite";
import {
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect,
} from "../src/schemaManifestAppSchemaBindings";
import type { StableTableCatalogTransaction } from "../src/stableTableCatalog";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const prepareAppSchemaPublicationV1 = (
  ...args: Parameters<typeof prepareAppSchemaPublicationV1Effect>
) => runEffect(prepareAppSchemaPublicationV1Effect(...args));

const getPreparedAppSchemaPublicationV1State = (
  ...args: Parameters<typeof getPreparedAppSchemaPublicationV1StateResult>
) => Result.getOrThrow(getPreparedAppSchemaPublicationV1StateResult(...args));

const prepareAppCreationTimeIndexDefinitionsV1 = (
  ...args: Parameters<typeof prepareAppCreationTimeIndexDefinitionsV1Result>
) => Result.getOrThrow(prepareAppCreationTimeIndexDefinitionsV1Result(...args));

type PublicD2bMethod = Extract<
  keyof FlarexPersistence,
  | "prepareAppCreationTimeIndexDefinitionsV1"
  | "ensureAppCreationTimeIndexDefinitionV1InTransaction"
>;

type PublicD2bValueExport = Extract<
  keyof typeof import("../src"),
  | "prepareAppCreationTimeIndexDefinitionsV1"
  | "prepareAppCreationTimeIndexDefinitionsV1Result"
  | "prepareAppDeveloperIndexDefinitionBindingsV1"
  | "prepareAppDeveloperIndexDefinitionBindingsV1Result"
  | "ensureAppCreationTimeIndexDefinitionV1InTransaction"
>;

type ThrowingD2bPreparationExport = Extract<
  keyof typeof import("../src/appIndexDefinitions"),
  | "prepareAppCreationTimeIndexDefinitionsV1"
  | "prepareAppDeveloperIndexDefinitionBindingsV1"
>;

type PreparedTokenStringKey = Extract<
  keyof PreparedAppCreationTimeIndexDefinitionV1,
  string
>;

describe("table-owned app creation-time index definitions", () => {
  it("keeps the derived row primitive package-internal and identity-only", () => {
    expectTypeOf<PublicD2bMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicD2bValueExport>().toEqualTypeOf<never>();
    expectTypeOf<ThrowingD2bPreparationExport>().toEqualTypeOf<never>();
    expectTypeOf<PreparedTokenStringKey>().toEqualTypeOf<
      "deploymentId" | "tableId"
    >();
    expectTypeOf<
      EnsureAppCreationTimeIndexDefinitionV1Result["definition"]["access"]["kind"]
    >().toEqualTypeOf<"by_creation_time">();
    expectTypeOf<
      ReturnType<typeof ensureAppCreationTimeIndexDefinitionV1InTransaction>
    >().toEqualTypeOf<Effect.Effect<
      EnsureAppCreationTimeIndexDefinitionV1Result,
      EnsureAppCreationTimeIndexDefinitionV1Error
    >>();
    expectTypeOf<FlarexPersistence>()
      .not.toMatchTypeOf<
        Parameters<
          typeof ensureAppCreationTimeIndexDefinitionV1InTransaction
        >[0]
      >();
  });

  it("derives, creates, and exactly replays the complete intrinsic set", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_exact";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users"), appTable("posts")],
    );
    await applyTablePlan(persistence, fixture.publication);

    expect(Object.isFrozen(fixture.tokens)).toBe(true);
    expect(fixture.tokens.map((token) => token.tableId)).toEqual([1, 2]);
    for (const token of fixture.tokens) {
      expect(Object.isFrozen(token)).toBe(true);
      expect(Object.keys(token).sort()).toEqual(["deploymentId", "tableId"]);
    }

    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      new Error("D2b must not hash while holding the deployment lock"),
    );
    try {
      const created: EnsureAppCreationTimeIndexDefinitionV1Result[] = [];
      for (const token of fixture.tokens) {
        created.push(await ensurePrepared(persistence, token));
      }
      const replayed: EnsureAppCreationTimeIndexDefinitionV1Result[] = [];
      for (const token of fixture.tokens) {
        replayed.push(await ensurePrepared(persistence, token));
      }

      expect(created.map((result) => result.definitionStatus)).toEqual([
        "created",
        "created",
      ]);
      expect(replayed.map((result) => result.definitionStatus)).toEqual([
        "existing",
        "existing",
      ]);
      expect(created.map((result) => result.definition.indexDefinitionId))
        .toEqual([1, 2]);
      expect(replayed.map((result) => result.definition.indexDefinitionId))
        .toEqual([1, 2]);
      for (const result of [...created, ...replayed]) {
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.definition)).toBe(true);
        expect(result.definition).toMatchObject({
          access: {
            kind: "by_creation_time",
          },
          physicalSpec: {
            accessPath: "by_creation_time",
            orderedFields: [{ kind: "systemCreationTime" }],
          },
        });
      }
    } finally {
      digest.mockRestore();
    }

    await expect(definitionRows(persistence, deploymentId)).resolves.toEqual([
      {
        index_definition_id: 1,
        access_kind: "by_creation_time",
        access_identity_id: 1,
        table_id: 1,
        logical_index_id: null,
      },
      {
        index_definition_id: 2,
        access_kind: "by_creation_time",
        access_identity_id: 2,
        table_id: 2,
        logical_index_id: null,
      },
    ]);
    await expect(nonDefinitionCounts(persistence)).resolves.toEqual({
      schemaBindings: 0,
      buildStates: 0,
    });

    for (const prepare of [
      prepareAppCreationTimeIndexDefinitionsV1Result,
      prepareAppDeveloperIndexDefinitionBindingsV1Result,
    ]) {
      const forgedPublication = Reflect.apply(
        prepare,
        undefined,
        [{ ...fixture.publication }],
      );
      expect(Result.isFailure(forgedPublication)).toBe(true);
      if (Result.isFailure(forgedPublication)) {
        expect(forgedPublication.failure).toBeInstanceOf(
          InvalidPreparedAppSchemaPublicationV1Error,
        );
      }
    }
    const forgedToken = { ...requiredToken(fixture.tokens, 0) };
    await expect(
      persistence.drizzle.transaction((tx) =>
        runEffect(
          Reflect.apply(
            ensureAppCreationTimeIndexDefinitionV1InTransaction,
            undefined,
            [tx, forgedToken],
          ),
        )
      ),
    ).rejects.toBeInstanceOf(
      InvalidPreparedAppCreationTimeIndexDefinitionError,
    );
  });

  it("rejects missing and stale exact table parents before allocation", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_parent";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users")],
    );
    const token = requiredToken(fixture.tokens, 0);

    await expect(ensurePrepared(persistence, token)).rejects.toMatchObject({
      name: "AppCreationTimeIndexDefinitionParentError",
      issue: { reason: "tableNotFound" },
      expectedLogicalName: "users",
    });
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(0);

    await persistence.query(
      `
        insert into fx_control_table
          (deployment_id, table_id, namespace, logical_name)
        values ($1, $2, 'app', 'taken')
      `,
      [deploymentId, token.tableId],
    );
    await expect(ensurePrepared(persistence, token)).rejects.toMatchObject({
      name: "AppCreationTimeIndexDefinitionParentError",
      issue: {
        reason: "tableBindingChanged",
        currentNamespace: "app",
        currentLogicalName: "taken",
      },
      expectedLogicalName: "users",
    });
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(0);
  });

  it("fails closed on equal-digest unequal canonical evidence", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_collision";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users")],
    );
    await applyTablePlan(persistence, fixture.publication);
    const token = requiredToken(fixture.tokens, 0);
    const created = await ensurePrepared(persistence, token);
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

    await expect(ensurePrepared(persistence, token)).rejects.toBeInstanceOf(
      AppCreationTimeIndexDefinitionChecksumCollisionError,
    );
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(1);
  });

  it("maps invalid prepared replay evidence to catalog corruption", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_replay_corruption";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users")],
    );
    const canonical = await canonicalizeAppIndexPhysicalSpecV1(
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
    );
    const storedRow = {
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
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
    };
    const tx = creationTimeReadTransaction((selectCall) => {
      switch (selectCall) {
        case 1:
          return Promise.resolve([{ deploymentId }]);
        case 2:
          return Promise.resolve([stableTableRow(deploymentId)]);
        case 3:
          return Promise.resolve([storedRow]);
        default:
          throw new Error(`Unexpected select call: ${selectCall}.`);
      }
    });

    const failure = await runEffectFailure(
      ensureAppCreationTimeIndexDefinitionV1InTransaction(
        tx,
        requiredToken(fixture.tokens, 0),
      ),
    );

    expect(failure).toBeInstanceOf(AppIndexDefinitionCatalogCorruptionError);
    expect(failure).toMatchObject({
      detail: "definition 1 has invalid prepared evidence",
    });
  });

  it("preserves prepared replay evidence access failures as defects", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_replay_defect";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users")],
    );
    const defect = new Error("prepared replay evidence access defect");
    const canonical = await canonicalizeAppIndexPhysicalSpecV1(
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
    );
    const storedRow = {
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
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
    };
    const tx = creationTimeReadTransaction((selectCall) => {
      switch (selectCall) {
        case 1:
          return Promise.resolve([{ deploymentId }]);
        case 2:
          return Promise.resolve([stableTableRow(deploymentId)]);
        case 3:
          return Promise.resolve([storedRow]);
        default:
          throw new Error(`Unexpected select call: ${selectCall}.`);
      }
    });

    const exit = await Effect.runPromiseExit(
      ensureAppCreationTimeIndexDefinitionV1InTransaction(
        tx,
        requiredToken(fixture.tokens, 0),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("labels rejected replay reads and rejects the caller-owned transaction", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_sql_failure";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users")],
    );
    const rejection = new Error("creation-time replay query rejected");
    const tx = creationTimeReadTransaction((selectCall) => {
      switch (selectCall) {
        case 1:
          return Promise.resolve([{ deploymentId }]);
        case 2:
          return Promise.resolve([stableTableRow(deploymentId)]);
        case 3:
          return Promise.reject(rejection);
        default:
          throw new Error(`Unexpected select call: ${selectCall}.`);
      }
    });
    const transaction = callerOwnedEffectTransaction(
      ensureAppCreationTimeIndexDefinitionV1InTransaction(
        tx,
        requiredToken(fixture.tokens, 0),
      ),
    );

    await expect(transaction.promise).rejects.toBeInstanceOf(
      AppCreationTimeIndexDefinitionPersistenceError,
    );
    await expect(transaction.promise).rejects.toMatchObject({
      _tag: "AppCreationTimeIndexDefinitionPersistenceError",
      operation: "findExistingDefinition",
      cause: rejection,
    });
    expect(transaction.committed()).toBe(false);
    expect(transaction.rolledBack()).toBe(true);
  });

  it("preserves synchronous lock-query construction failures as defects", async () => {
    const persistence = await migratedPersistence();
    const fixture = await prepareFixture(
      persistence,
      "deployment_creation_time_construction_defect",
      [appTable("users")],
    );
    const defect = new Error("creation-time lock query construction defect");
    const tx = {
      select() {
        throw defect;
      },
    } as unknown as StableTableCatalogTransaction;
    const exit = await Effect.runPromiseExit(
      ensureAppCreationTimeIndexDefinitionV1InTransaction(
        tx,
        requiredToken(fixture.tokens, 0),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending deployment lock before interruption completes", async () => {
    const persistence = await migratedPersistence();
    const fixture = await prepareFixture(
      persistence,
      "deployment_creation_time_interruption",
      [appTable("users")],
    );
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const tx = creationTimeReadTransaction((selectCall) => {
      if (selectCall !== 1) {
        throw new Error(`Unexpected select call: ${selectCall}.`);
      }
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      ensureAppCreationTimeIndexDefinitionV1InTransaction(
        tx,
        requiredToken(fixture.tokens, 0),
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

  it("rolls allocation back and reuses the deployment-wide next identity", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_creation_time_rollback";
    const fixture = await prepareFixture(
      persistence,
      deploymentId,
      [appTable("users"), appTable("posts")],
    );
    await applyTablePlan(persistence, fixture.publication);
    const first = requiredToken(fixture.tokens, 0);
    const second = requiredToken(fixture.tokens, 1);
    await expect(ensurePrepared(persistence, first)).resolves.toMatchObject({
      definitionStatus: "created",
      definition: { indexDefinitionId: 1 },
    });

    let rolledBackId: CatalogIndexDefinitionId | undefined;
    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const result =
          await runEffect(
            ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, second),
          );
        rolledBackId = result.definition.indexDefinitionId;
        throw new Error("injected creation-time definition rollback");
      }),
    ).rejects.toThrow("injected creation-time definition rollback");
    if (rolledBackId === undefined) {
      throw new Error("Rollback test did not observe an allocated identity.");
    }
    expect(rolledBackId).toBe(2);
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(1);

    await expect(ensurePrepared(persistence, second)).resolves.toMatchObject({
      definitionStatus: "created",
      definition: { indexDefinitionId: rolledBackId },
    });
    await expect(definitionCount(persistence, deploymentId)).resolves.toBe(2);
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function prepareFixture(
  persistence: PGlitePersistence,
  deploymentId: string,
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationInputV1>,
) {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  const publication = await prepareAppSchemaPublicationV1(
    persistence.drizzle,
    {
      deploymentId,
      schemaVersionId: CatalogSchemaVersionIdSchema.make(
        `schema_${deploymentId}`,
      ),
      version: CatalogSchemaVersionSchema.make(1),
      tables,
      indexes: [],
    },
  );
  return Object.freeze({
    publication,
    tokens: prepareAppCreationTimeIndexDefinitionsV1(publication),
  });
}

async function applyTablePlan(
  persistence: PGlitePersistence,
  publication: Parameters<
    typeof getPreparedAppSchemaPublicationV1State
  >[0],
): Promise<void> {
  const state = getPreparedAppSchemaPublicationV1State(publication);
  await persistence.drizzle.transaction((tx) =>
    runEffect(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(
        tx,
        state.logicalBindings,
      ),
    )
  );
}

function ensurePrepared(
  persistence: PGlitePersistence,
  prepared: PreparedAppCreationTimeIndexDefinitionV1,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, prepared),
    )
  );
}

function requiredToken(
  tokens: ReadonlyArray<PreparedAppCreationTimeIndexDefinitionV1>,
  index: number,
): PreparedAppCreationTimeIndexDefinitionV1 {
  const token = tokens[index];
  if (token === undefined) throw new Error(`Missing token at index ${index}.`);
  return token;
}

interface CreationTimeQueryStub extends PromiseLike<ReadonlyArray<unknown>> {
  from(): CreationTimeQueryStub;
  where(): CreationTimeQueryStub;
  limit(): CreationTimeQueryStub;
  for(): CreationTimeQueryStub;
}

function creationTimeReadTransaction(
  runSelect: (selectCall: number) => Promise<ReadonlyArray<unknown>>,
): StableTableCatalogTransaction {
  let selectCall = 0;
  return {
    select() {
      selectCall += 1;
      const promise = runSelect(selectCall);
      const query: CreationTimeQueryStub = {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
  } as unknown as StableTableCatalogTransaction;
}

function stableTableRow(deploymentId: string) {
  return Object.freeze({
    deploymentId,
    tableId: 1,
    namespace: "app",
    logicalName: "users",
    createdAt: new Date("2026-07-19T00:00:00.000Z"),
  });
}

function callerOwnedEffectTransaction<Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
): Readonly<{
  promise: Promise<Value>;
  committed(): boolean;
  rolledBack(): boolean;
}> {
  let committed = false;
  let rolledBack = false;
  const promise = runEffect(effect).then(
    (value) => {
      committed = true;
      return value;
    },
    (cause: unknown) => {
      rolledBack = true;
      throw cause;
    },
  );
  return Object.freeze({
    promise,
    committed: () => committed,
    rolledBack: () => rolledBack,
  });
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
        },
      },
    },
  };
}

async function definitionRows(
  persistence: PGlitePersistence,
  deploymentId: string,
) {
  const result = await persistence.query<{
    index_definition_id: number;
    access_kind: string;
    access_identity_id: number;
    table_id: number;
    logical_index_id: number | null;
  }>(
    `
      select
        index_definition_id,
        access_kind,
        access_identity_id,
        table_id,
        logical_index_id
      from fx_control_index_definition
      where deployment_id = $1
      order by index_definition_id
    `,
    [deploymentId],
  );
  return result.rows;
}

async function definitionCount(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<number> {
  const result = await persistence.query<{ count: number }>(
    `
      select count(*)::int as count
      from fx_control_index_definition
      where deployment_id = $1
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected physical-definition count.");
  return row.count;
}

async function nonDefinitionCounts(
  persistence: PGlitePersistence,
): Promise<{ readonly schemaBindings: number; readonly buildStates: number }> {
  const result = await persistence.query<{
    schema_bindings: number;
    build_states: number;
  }>(
    `
      select
        (select count(*)::int
          from fx_control_schema_version_index_binding) as schema_bindings,
        (select count(*)::int
          from fx_system_index_build_state) as build_states
    `,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected intrinsic side-effect counts.");
  return {
    schemaBindings: row.schema_bindings,
    buildStates: row.build_states,
  };
}
