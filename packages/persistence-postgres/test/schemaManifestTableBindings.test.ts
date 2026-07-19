import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionSchema,
  decodeSchemaManifestAppTableName,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  FlarexMetadataDatabase,
  FlarexPersistence,
} from "../src";
import { getSchemaVersionArtifactByVersion } from "../src/schemaVersionArtifacts";
import { createPGlitePersistence } from "../src/pglite";
import {
  applySchemaManifestAppTableBindingsV1InTransaction,
  decodeSchemaManifestAppTableBindingRows,
  decodeSchemaManifestAppTableBindingRowsResult,
  InvalidPreparedSchemaManifestTableBindingsError,
  InvalidSchemaManifestTableBindingInputError,
  prepareSchemaManifestAppTableBindingsV1Effect,
  prepareSchemaManifestAppTableBindingsV1,
  type PrepareSchemaManifestAppTableBindingsV1Error,
  SchemaManifestTableBindingPersistenceError,
  SchemaManifestTableBindingCorruptionError,
  type SchemaManifestAppTableBindingRow,
  type PlannedAppTableBinding,
  type PrepareSchemaManifestAppTableBindingsV1Input,
  type PreparedSchemaManifestAppTableBindingsV1,
  verifyInsertedSchemaManifestAppTableBindingRowsResult,
} from "../src/schemaManifestTableBindings";
import {
  ensureStableTableIdentityEffect,
  getStableTableIdentityByNameEffect,
  StableTableCatalogDeploymentNotFoundError,
} from "../src/stableTableCatalog";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type PublicBindingMethod = Extract<
  keyof FlarexPersistence,
  | "prepareSchemaManifestAppTableBindingsV1"
  | "prepareSchemaManifestAppTableBindingsV1Effect"
  | "applySchemaManifestAppTableBindingsV1InTransaction"
>;

type PublicBindingExport = Extract<
  keyof typeof import("../src"),
  | "prepareSchemaManifestAppTableBindingsV1"
  | "prepareSchemaManifestAppTableBindingsV1Effect"
  | "applySchemaManifestAppTableBindingsV1InTransaction"
>;

describe("schema manifest app table bindings", () => {
  it("keeps optimistic planning and allocation behind concrete boundaries", () => {
    expectTypeOf<PublicBindingMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicBindingExport>().toEqualTypeOf<never>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<
          typeof applySchemaManifestAppTableBindingsV1InTransaction
        >[0]
      >();
    expectTypeOf<PrepareSchemaManifestAppTableBindingsV1Input>()
      .not.toMatchTypeOf<PreparedSchemaManifestAppTableBindingsV1>();
    expectTypeOf<
      PreparedSchemaManifestAppTableBindingsV1["section"]
    >().toEqualTypeOf<SchemaManifestTableDefinitionsV1>();
    expectTypeOf<
      ReturnType<typeof prepareSchemaManifestAppTableBindingsV1Effect>
    >().toEqualTypeOf<Effect.Effect<
      PreparedSchemaManifestAppTableBindingsV1,
      PrepareSchemaManifestAppTableBindingsV1Error
    >>();
  });

  it("maps preparation deployment-read rejection to its tagged error", async () => {
    const rejection = new Error("binding preparation deployment read rejected");
    const db = schemaBindingSelectDatabase(() => Promise.reject(rejection));

    const failure = await runEffectFailure(
      prepareSchemaManifestAppTableBindingsV1Effect(db, {
        deploymentId: "deployment_binding_prepare_rejection",
        tables: [appDeclaration("users")],
      }),
    );

    expect(failure).toBeInstanceOf(SchemaManifestTableBindingPersistenceError);
    expect(failure).toMatchObject({
      _tag: "SchemaManifestTableBindingPersistenceError",
      operation: "readDeployment",
      cause: rejection,
    });
  });

  it("preserves preparation query construction failures as defects", async () => {
    const defect = new Error("binding preparation query construction defect");
    const db = {
      select(): never {
        throw defect;
      },
    } as unknown as FlarexMetadataDatabase;

    const exit = await Effect.runPromiseExit(
      prepareSchemaManifestAppTableBindingsV1Effect(db, {
        deploymentId: "deployment_binding_prepare_defect",
        tables: [appDeclaration("users")],
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending preparation read before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const db = schemaBindingSelectDatabase(() => {
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      prepareSchemaManifestAppTableBindingsV1Effect(db, {
        deploymentId: "deployment_binding_prepare_interruption",
        tables: [appDeclaration("users")],
      }),
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

  it("decodes stable binding rows through Result without capturing defects", () => {
    const deploymentId = "deployment_binding_result";
    const logicalName = decodeSchemaManifestAppTableName("users");
    const row = {
      deploymentId,
      logicalName,
      tableId: decodeCatalogTableId(1),
    } satisfies SchemaManifestAppTableBindingRow;

    const decoded = decodeSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      [logicalName],
      [row],
    );
    expect(Result.getOrThrow(decoded).get(logicalName)).toBe(row.tableId);

    const invalidRow = new Proxy(row, {
      get(target, property, receiver) {
        return property === "tableId"
          ? "invalid-table-id"
          : Reflect.get(target, property, receiver);
      },
    });
    const invalid = decodeSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      [logicalName],
      [invalidRow],
    );
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toBeInstanceOf(
        SchemaManifestTableBindingCorruptionError,
      );
      expect(invalid.failure).toMatchObject({
        _tag: "SchemaManifestTableBindingCorruptionError",
        deploymentId,
        detail: "invalid stored table ID: invalid-table-id",
      });
    }
    const unreachedRow = new Proxy(row, {
      get() {
        throw new Error("later binding row must not be inspected");
      },
    });
    expect(Result.isFailure(decodeSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      [logicalName],
      [invalidRow, unreachedRow],
    ))).toBe(true);
    expect(() => decodeSchemaManifestAppTableBindingRows(
      deploymentId,
      [logicalName],
      [invalidRow],
    )).toThrow(SchemaManifestTableBindingCorruptionError);

    const cause = new Error("binding row accessor failed");
    const throwingRow = new Proxy(row, {
      get(target, property, receiver) {
        if (property === "logicalName") throw cause;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => decodeSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      [logicalName],
      [throwingRow],
    )).toThrow(cause);
  });

  it("verifies inserted binding rows through Result before rollback projection", () => {
    const deploymentId = "deployment_binding_insert_result";
    const logicalName = decodeSchemaManifestAppTableName("users");
    const tableId = decodeCatalogTableId(1);
    const planned = [{
      logicalName,
      tableId,
      wasMissing: true,
    }] satisfies ReadonlyArray<PlannedAppTableBinding>;
    const row = {
      deploymentId,
      logicalName,
      tableId,
    } satisfies SchemaManifestAppTableBindingRow;

    expect(Result.isSuccess(
      verifyInsertedSchemaManifestAppTableBindingRowsResult(
        deploymentId,
        planned,
        [row],
      ),
    )).toBe(true);

    const crossDeployment =
      verifyInsertedSchemaManifestAppTableBindingRowsResult(
        deploymentId,
        planned,
        [{ ...row, deploymentId: "another_deployment" }],
      );
    expect(Result.isFailure(crossDeployment)).toBe(true);
    if (Result.isFailure(crossDeployment)) {
      expect(crossDeployment.failure.detail).toBe(
        "cross-deployment insert row returned for another_deployment",
      );
    }

    const invalidRow = new Proxy(row, {
      get(target, property, receiver) {
        return property === "tableId"
          ? "invalid-table-id"
          : Reflect.get(target, property, receiver);
      },
    });
    const invalid = verifyInsertedSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      planned,
      [invalidRow],
    );
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toMatchObject({
        _tag: "SchemaManifestTableBindingCorruptionError",
        deploymentId,
        detail: "invalid stored table ID: invalid-table-id",
      });
    }

    const unreachedRow = new Proxy(row, {
      get() {
        throw new Error("later inserted row must not be inspected");
      },
    });
    expect(Result.isFailure(
      verifyInsertedSchemaManifestAppTableBindingRowsResult(
        deploymentId,
        planned,
        [invalidRow, unreachedRow],
      ),
    )).toBe(true);

    const mismatched = verifyInsertedSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      planned,
      [{ ...row, tableId: decodeCatalogTableId(2) }],
    );
    expect(Result.isFailure(mismatched)).toBe(true);
    if (Result.isFailure(mismatched)) {
      expect(mismatched.failure.detail).toBe(
        "insert did not return planned binding users/1",
      );
    }

    const duplicate = verifyInsertedSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      planned,
      [row, row],
    );
    expect(Result.isFailure(duplicate)).toBe(true);
    if (Result.isFailure(duplicate)) {
      expect(duplicate.failure.detail).toBe(
        "insert returned duplicate planned binding users",
      );
    }

    const extraLogicalName = decodeSchemaManifestAppTableName("posts");
    const extra = verifyInsertedSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      planned,
      [
        row,
        {
          ...row,
          logicalName: extraLogicalName,
          tableId: decodeCatalogTableId(2),
        },
      ],
    );
    expect(Result.isFailure(extra)).toBe(true);
    if (Result.isFailure(extra)) {
      expect(extra.failure.detail).toBe(
        "insert returned an unexpected number of planned bindings",
      );
    }

    const cause = new Error("inserted row accessor failed");
    const throwingRow = new Proxy(row, {
      get(target, property, receiver) {
        if (property === "logicalName") throw cause;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => verifyInsertedSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      planned,
      [throwingRow],
    )).toThrow(cause);
  });

  it("plans name-order candidates and replays the exact committed bindings", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_deterministic";
    await insertDeployment(persistence, deploymentId);

    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("products")],
      },
    );

    expect(tableIdentities(plan.section)).toEqual([
      { logicalName: "products", tableId: 1 },
      { logicalName: "users", tableId: 2 },
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.section)).toBe(true);
    expect(Object.isFrozen(plan.section.tables)).toBe(true);
    expect(Object.isFrozen(plan.section.tables[0]?.definition.documentType))
      .toBe(true);

    const first = await apply(persistence, plan);
    const replay = await apply(persistence, plan);
    const replanned = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("products"), appDeclaration("users")],
      },
    );
    const replayFromFreshPlan = await apply(persistence, replanned);

    expect(first).toEqual(plan.section);
    expect(replay).toEqual(plan.section);
    expect(replayFromFreshPlan).toEqual(plan.section);
    expect(
      await getSchemaVersionArtifactByVersion(
        persistence.drizzle,
        deploymentId,
        CatalogSchemaVersionSchema.make(1),
      ),
    ).toBeNull();
  });

  it("keeps existing IDs and emits the final section in numeric ID order", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_existing";
    await insertDeployment(persistence, deploymentId);

    const users = await ensureTable(persistence, {
      deploymentId,
      namespace: "app",
      logicalName: "users",
    });
    await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "payload_internal",
    });

    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("products")],
      },
    );
    expect(tableIdentities(plan.section)).toEqual([
      { logicalName: "users", tableId: users.table.tableId },
      { logicalName: "products", tableId: 3 },
    ]);

    await apply(persistence, plan);
    await expect(
      readStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "products",
      }),
    ).resolves.toMatchObject({ tableId: 3 });
  });

  it("rejects malformed and duplicate declarations before allocating", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_invalid";
    await insertDeployment(persistence, deploymentId);

    await expect(
      Reflect.apply(prepareSchemaManifestAppTableBindingsV1, undefined, [
        persistence.drizzle,
        {
          deploymentId,
          tables: [
            { ...appDeclaration("users"), tableId: 42 },
          ],
        },
      ]),
    ).rejects.toBeInstanceOf(InvalidSchemaManifestTableBindingInputError);
    await expect(
      prepareSchemaManifestAppTableBindingsV1(persistence.drizzle, {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("users")],
      }),
    ).rejects.toBeInstanceOf(InvalidSchemaManifestTableBindingInputError);
    await expect(
      readStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();
  });

  it("fails stale when an unrelated allocation changes the observed frontier", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_stale_frontier";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [appDeclaration("users")] },
    );

    await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "payload_internal",
    });

    await expect(apply(persistence, plan)).rejects.toMatchObject({
      name: "SchemaManifestTableBindingPlanStaleError",
      stale: { reason: "catalogHighWaterChanged" },
    });
    await expect(
      readStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();
  });

  it("fails stale when a planned logical name is bound to another ID", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_changed";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [appDeclaration("users")] },
    );

    await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "payload_internal",
    });
    await ensureTable(persistence, {
      deploymentId,
      namespace: "app",
      logicalName: "users",
    });

    await expect(apply(persistence, plan)).rejects.toMatchObject({
      name: "SchemaManifestTableBindingPlanStaleError",
      stale: {
        reason: "bindingChanged",
        logicalName: "users",
        plannedTableId: 1,
        currentTableId: 2,
      },
    });
  });

  it("fails stale rather than completing a partially applied plan", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_partial";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("products")],
      },
    );

    await ensureTable(persistence, {
      deploymentId,
      namespace: "app",
      logicalName: "products",
    });

    await expect(apply(persistence, plan)).rejects.toMatchObject({
      name: "SchemaManifestTableBindingPlanStaleError",
      stale: { reason: "partiallyApplied" },
    });
    await expect(
      readStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();
  });

  it("rolls planned IDs back with the caller-owned transaction", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_rollback";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [appDeclaration("users")] },
    );

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await applySchemaManifestAppTableBindingsV1InTransaction(tx, plan);
        throw new Error("injected rollback");
      }),
    ).rejects.toThrow("injected rollback");
    await expect(
      readStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();

    await expect(apply(persistence, plan)).resolves.toEqual(plan.section);
  });

  it("rolls inserted rows back when Result verification rejects RETURNING", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_returning_rollback";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [appDeclaration("users")] },
    );
    await persistence.exec(`
      create function fx_test_corrupt_binding_returning() returns trigger
      language plpgsql
      as $$
      begin
        new.logical_name := new.logical_name || '_corrupt';
        return new;
      end;
      $$;

      create trigger fx_test_corrupt_binding_returning
      before insert on fx_control_table
      for each row execute function fx_test_corrupt_binding_returning();
    `);

    await expect(apply(persistence, plan)).rejects.toBeInstanceOf(
      SchemaManifestTableBindingCorruptionError,
    );
    await expect(
      readStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();
    await expect(
      readStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users_corrupt",
      }),
    ).resolves.toBeNull();
  });

  it("supports empty schemas, rejects missing deployments, and authenticates plans", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_empty";
    await expect(
      prepareSchemaManifestAppTableBindingsV1(persistence.drizzle, {
        deploymentId: "missing_binding_deployment",
        tables: [],
      }),
    ).rejects.toBeInstanceOf(StableTableCatalogDeploymentNotFoundError);

    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [] },
    );
    await expect(apply(persistence, plan)).resolves.toMatchObject({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [],
    });

    await expect(
      persistence.drizzle.transaction((tx) =>
        Reflect.apply(
          applySchemaManifestAppTableBindingsV1InTransaction,
          undefined,
          [tx, { deploymentId, section: plan.section }],
        ),
      ),
    ).rejects.toBeInstanceOf(InvalidPreparedSchemaManifestTableBindingsError);
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

interface SchemaBindingSelectQuery
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): SchemaBindingSelectQuery;
  where(): SchemaBindingSelectQuery;
  limit(): SchemaBindingSelectQuery;
}

function schemaBindingSelectDatabase(
  run: () => Promise<ReadonlyArray<unknown>>,
): FlarexMetadataDatabase {
  return {
    select() {
      const promise = run();
      const query: SchemaBindingSelectQuery = {
        from: () => query,
        where: () => query,
        limit: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
  } as unknown as FlarexMetadataDatabase;
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

function readStableTableIdentityByName(
  db: Parameters<typeof getStableTableIdentityByNameEffect>[0],
  input: Parameters<typeof getStableTableIdentityByNameEffect>[1],
) {
  return runEffect(getStableTableIdentityByNameEffect(db, input));
}

function apply(
  persistence: PGlitePersistence,
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): Promise<SchemaManifestTableDefinitionsV1> {
  return persistence.drizzle.transaction((tx) =>
    applySchemaManifestAppTableBindingsV1InTransaction(tx, prepared),
  );
}

function ensureTable(
  persistence: PGlitePersistence,
  input: Parameters<typeof ensureStableTableIdentityEffect>[1],
) {
  return runEffect(ensureStableTableIdentityEffect(persistence.drizzle, input));
}
