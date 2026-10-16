import { eq } from "drizzle-orm";
import { PglitePreparedQuery } from "drizzle-orm/pglite";
import { fxControlTables } from "../../../src/database/schema";
import {
  lockInstallationForCurrentTransaction,
  closeInstallationAdmission,
} from "../../../src/installation/installationLifecycle";
import {
  createMigratedPGlitePersistence,
} from "../../support/pgliteTestFixture";
import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, onTestFinished, vi } from "vitest";

import type {
  EnsureStableTableIdentityInput,
  EnsureStableTableIdentityResult,
  FlarexPersistence,
  StableTableIdentity,
} from "../../../src";
import {
  decodeStableTableIdentityByIdInputResult,
  decodeEnsureStableTableIdentityInputResult,
  decodeStableTableIdentityNameResult,
  decodeStableTableIdentityResult,
  ensureStableTableIdentityEffect,
  getStableTableIdentityByIdEffect,
  getStableTableIdentityByNameEffect,
  InvalidStableTableIdentityInputError,
  StableTableCatalogAllocationPersistenceError,
  StableTableCatalogAllocationTransactionError,
  StableTableCatalogCorruptionError,
  StableTableCatalogDeploymentNotFoundError,
  StableTableCatalogIdExhaustedError,
  StableTableIdentityPersistenceError,
} from "../../../src/storage/catalog/stableTableCatalog";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

interface AnalyzerDerivedTableIdentity {
  readonly deploymentId: string;
  readonly namespace: "app";
  readonly logicalName: string;
  readonly tableId: number;
}

type AnalyzerOrdinalAccepted = AnalyzerDerivedTableIdentity extends
  EnsureStableTableIdentityInput
  ? true
  : false;

type PublicAllocatorMethod = Extract<
  keyof FlarexPersistence,
  "ensureStableTableIdentity" | "allocateStableTableIdentity"
>;

type PublicPromiseReaderExport = Extract<
  keyof typeof import("../../../src"),
  "getStableTableIdentityById" | "getStableTableIdentityByName"
>;

type PublicAllocatorExport = Extract<
  keyof typeof import("../../../src"),
  "ensureStableTableIdentityEffect" | "ensureStableTableIdentityInTransaction"
>;

type InternalPromiseReaderExport = Extract<
  keyof typeof import("../../../src/storage/catalog/stableTableCatalog"),
  "getStableTableIdentityByIdForPromiseTransaction"
>;

describe("stable table catalog", { concurrent: false }, () => {
  it("keeps allocation internal and analyzer ordinals out of input", () => {
    expectTypeOf<AnalyzerOrdinalAccepted>().toEqualTypeOf<false>();
    expectTypeOf<PublicAllocatorMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicPromiseReaderExport>().toEqualTypeOf<never>();
    expectTypeOf<PublicAllocatorExport>().toEqualTypeOf<never>();
    expectTypeOf<Parameters<typeof ensureStableTableIdentityEffect>[0]>()
      .toEqualTypeOf<FlarexMetadataDatabase>();
    expectTypeOf<InternalPromiseReaderExport>().toEqualTypeOf<never>();
    expectTypeOf<StableTableIdentity["tableId"]>()
      .toEqualTypeOf<CatalogTableId>();
  });

  it("keeps ID input validation pure and classifies invalid caller values", () => {
    const invalidDeployment = decodeStableTableIdentityByIdInputResult(
      " ",
      CatalogTableIdSchema.make(1),
    );
    const invalidTableId = decodeStableTableIdentityByIdInputResult(
      "deployment_catalog_input",
      0,
    );
    const invalidBoth = decodeStableTableIdentityByIdInputResult(" ", 0);

    expect(Result.isFailure(invalidDeployment)).toBe(true);
    if (Result.isFailure(invalidDeployment)) {
      expect(invalidDeployment.failure).toMatchObject({
        _tag: "InvalidStableTableIdentityInputError",
        field: "deploymentId",
      });
    }
    expect(Result.isFailure(invalidTableId)).toBe(true);
    if (Result.isFailure(invalidTableId)) {
      expect(invalidTableId.failure).toMatchObject({
        _tag: "InvalidStableTableIdentityInputError",
        field: "tableId",
      });
    }
    expect(Result.isFailure(invalidBoth)).toBe(true);
    if (Result.isFailure(invalidBoth)) {
      expect(invalidBoth.failure.field).toBe("deploymentId");
    }
  });

  it("keeps name input validation ordered and pure", () => {
    const invalidDeployment = decodeStableTableIdentityNameResult({
      deploymentId: " ",
      namespace: "app",
      logicalName: "",
    });
    const invalidLogicalName = decodeStableTableIdentityNameResult({
      deploymentId: "deployment_catalog_name_input",
      namespace: "app",
      logicalName: "\t\n",
    });
    const invalidNamespace = decodeStableTableIdentityNameResult({
      deploymentId: "deployment_catalog_name_input",
      // @ts-expect-error Exercises the importable JavaScript boundary.
      namespace: "commerce",
      logicalName: "users",
    });

    expect(Result.isFailure(invalidDeployment)).toBe(true);
    if (Result.isFailure(invalidDeployment)) {
      expect(invalidDeployment.failure.field).toBe("deploymentId");
    }
    expect(Result.isFailure(invalidLogicalName)).toBe(true);
    if (Result.isFailure(invalidLogicalName)) {
      expect(invalidLogicalName.failure.field).toBe("logicalName");
    }
    expect(Result.isFailure(invalidNamespace)).toBe(true);
    if (Result.isFailure(invalidNamespace)) {
      expect(invalidNamespace.failure.field).toBe("namespace");
    }
  });

  it("rejects caller-supplied table IDs before other allocator input", () => {
    const invalid = decodeEnsureStableTableIdentityInputResult({
      deploymentId: " ",
      namespace: "app",
      logicalName: "",
      // @ts-expect-error Exercises the importable JavaScript boundary.
      tableId: 17,
    });

    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toMatchObject({ field: "tableId" });
    }
  });

  it("decodes stored identities with an owned Date snapshot", () => {
    const storedDate = new Date("2026-07-19T00:00:00.000Z");
    const decoded = Result.getOrThrow(decodeStableTableIdentityResult({
      deploymentId: "deployment_catalog_decode",
      tableId: CatalogTableIdSchema.make(1),
      namespace: "app",
      logicalName: "users",
      createdAt: storedDate,
    }));

    expect(decoded.createdAt).not.toBe(storedDate);
    expect(decoded.createdAt.getTime()).toBe(storedDate.getTime());
  });

  it("maps rejected ID reads once at the Drizzle boundary", async () => {
    const rejection = new Error("stable table ID query rejected");
    const failure = await runEffectFailure(getStableTableIdentityByIdEffect(
      stableTableReadDatabase(() => Promise.reject(rejection)),
      "deployment_catalog_sql_failure",
      CatalogTableIdSchema.make(1),
    ));

    expect(failure).toBeInstanceOf(StableTableIdentityPersistenceError);
    expect(failure).toMatchObject({
      _tag: "StableTableIdentityPersistenceError",
      operation: "getById",
      cause: rejection,
    });
  });

  it("maps rejected name reads once at the shared Drizzle boundary", async () => {
    const rejection = new Error("stable table name query rejected");
    const failure = await runEffectFailure(getStableTableIdentityByNameEffect(
      stableTableReadDatabase(() => Promise.reject(rejection)),
      {
        deploymentId: "deployment_catalog_name_sql_failure",
        namespace: "app",
        logicalName: "users",
      },
    ));

    expect(failure).toBeInstanceOf(StableTableIdentityPersistenceError);
    expect(failure).toMatchObject({
      _tag: "StableTableIdentityPersistenceError",
      operation: "getByName",
      cause: rejection,
    });
  });

  it("distinguishes transaction infrastructure rejection", async () => {
    const rejection = new Error("transaction begin rejected");
    const db = {
      transaction: () => Promise.reject(rejection),
    } as unknown as FlarexMetadataDatabase;

    const failure = await runEffectFailure(ensureStableTableIdentityEffect(
      db,
      {
        deploymentId: "deployment_catalog_transaction_failure",
        namespace: "app",
        logicalName: "users",
      },
    ));

    expect(failure).toBeInstanceOf(
      StableTableCatalogAllocationTransactionError,
    );
    expect(failure).toMatchObject({
      _tag: "StableTableCatalogAllocationTransactionError",
      cause: rejection,
      callbackCause: undefined,
    });
  });

  it("waits for the allocator transaction before interruption completes", async () => {
    const entered = deferredValue<void>();
    const transaction = deferredValue<EnsureStableTableIdentityResult>();
    const db = {
      transaction() {
        entered.resolve(undefined);
        return transaction.promise;
      },
    } as unknown as FlarexMetadataDatabase;
    const fiber = Effect.runFork(ensureStableTableIdentityEffect(db, {
      deploymentId: "deployment_catalog_allocation_interruption",
      namespace: "app",
      logicalName: "users",
    }));

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
      transaction.resolve({
        status: "created",
        table: {
          deploymentId: "deployment_catalog_allocation_interruption",
          namespace: "app",
          logicalName: "users",
          tableId: CatalogTableIdSchema.make(1),
          createdAt: new Date("2026-07-19T00:00:00.000Z"),
        },
      });
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("preserves unexpected name-input accessor failures as defects", async () => {
    const defect = new Error("stable table name accessor defect");
    const input = new Proxy(
      {
        deploymentId: "deployment_catalog_name_defect",
        namespace: "app" as const,
        logicalName: "users",
      },
      {
        get(target, property, receiver) {
          if (property === "logicalName") throw defect;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const exit = await Effect.runPromiseExit(
      getStableTableIdentityByNameEffect(
        queryConstructionDefectDatabase(new Error("query should not run")),
        input,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("reports malformed stored ID rows as typed catalog corruption", async () => {
    const failure = await runEffectFailure(getStableTableIdentityByIdEffect(
      stableTableReadDatabase(() => Promise.resolve([{
        deploymentId: "deployment_catalog_corruption",
        tableId: CatalogTableIdSchema.make(1),
        namespace: "app",
        logicalName: "",
        createdAt: new Date(),
      }])),
      "deployment_catalog_corruption",
      CatalogTableIdSchema.make(1),
    ));

    expect(failure).toBeInstanceOf(StableTableCatalogCorruptionError);
    expect(failure).toMatchObject({
      _tag: "StableTableCatalogCorruptionError",
      detail: "logical name is blank",
    });
  });

  it("short-circuits malformed stored namespaces as typed corruption", async () => {
    let logicalNameObserved = false;
    const row = {
      deploymentId: "deployment_catalog_namespace_corruption",
      tableId: CatalogTableIdSchema.make(1),
      namespace: "invalid_namespace",
      get logicalName(): never {
        logicalNameObserved = true;
        throw new Error("later logical-name accessor must not run");
      },
      createdAt: new Date(),
    };

    const failure = await runEffectFailure(getStableTableIdentityByIdEffect(
      stableTableReadDatabase(() => Promise.resolve([row])),
      "deployment_catalog_namespace_corruption",
      CatalogTableIdSchema.make(1),
    ));

    expect(failure).toBeInstanceOf(StableTableCatalogCorruptionError);
    expect(failure).toMatchObject({
      detail: "invalid namespace: invalid_namespace",
    });
    expect(logicalNameObserved).toBe(false);
  });

  it("preserves stored namespace accessor failures as defects", async () => {
    const defect = new Error("stored table namespace accessor defect");
    const row = {
      deploymentId: "deployment_catalog_namespace_defect",
      tableId: CatalogTableIdSchema.make(1),
      get namespace(): never {
        throw defect;
      },
      logicalName: "users",
      createdAt: new Date(),
    };

    const exit = await Effect.runPromiseExit(getStableTableIdentityByIdEffect(
      stableTableReadDatabase(() => Promise.resolve([row])),
      "deployment_catalog_namespace_defect",
      CatalogTableIdSchema.make(1),
    ));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending ID read before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<readonly []>();
    const db = stableTableReadDatabase(() => {
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(getStableTableIdentityByIdEffect(
      db,
      "deployment_catalog_interruption",
      CatalogTableIdSchema.make(1),
    ));

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

  it("preserves synchronous Drizzle construction failures as defects", async () => {
    const defect = new Error("stable table query construction defect");
    const exit = await Effect.runPromiseExit(getStableTableIdentityByIdEffect(
      queryConstructionDefectDatabase(defect),
      "deployment_catalog_defect",
      CatalogTableIdSchema.make(1),
    ));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  describe("database-backed catalog cases", { concurrent: false }, () => {
    let persistence: PGlitePersistence;
    let dispose: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      persistence = await createMigratedPGlitePersistence(cleanup => { dispose = cleanup; });
    }, 120_000);

    afterAll(async () => { await dispose?.(); }, 120_000);

    it("allocates once, replays exactly, and supports deployment-qualified reads", async () => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_catalog_a",
        projectId: "project_catalog_a",
      });

      const users = await ensure(persistence, {
        deploymentId: "deployment_catalog_a",
        namespace: "app",
        logicalName: "users",
      });
      const replay = await ensure(persistence, {
        deploymentId: "deployment_catalog_a",
        namespace: "app",
        logicalName: "users",
      });
      const payloadUsers = await ensure(persistence, {
        deploymentId: "deployment_catalog_a",
        namespace: "payload",
        logicalName: "users",
      });
      const products = await ensure(persistence, {
        deploymentId: "deployment_catalog_a",
        namespace: "app",
        logicalName: "products",
      });

      expect(users).toMatchObject({ status: "created", table: { tableId: 1 } });
      expect(replay).toEqual({ status: "existing", table: users.table });
      expect(payloadUsers).toMatchObject({
        status: "created",
        table: { tableId: 2 },
      });
      expect(products).toMatchObject({ status: "created", table: { tableId: 3 } });
      expect(users.table.createdAt).toBeInstanceOf(Date);

      await expect(
        runEffect(
          getStableTableIdentityByIdEffect(
            persistence.drizzle,
            "deployment_catalog_a",
            users.table.tableId,
          ),
        ),
      ).resolves.toEqual(users.table);
      await expect(
        runEffect(
          getStableTableIdentityByNameEffect(persistence.drizzle, {
            deploymentId: "deployment_catalog_a",
            namespace: "payload",
            logicalName: "users",
          }),
        ),
      ).resolves.toEqual(payloadUsers.table);
      await expect(
        runEffect(
          getStableTableIdentityByIdEffect(
            persistence.drizzle,
            "deployment_catalog_a",
            CatalogTableIdSchema.make(99),
          ),
        ),
      ).resolves.toBeNull();
    });

    it("maps rejected allocator queries once and rolls back", async () => {
      const rejection = new Error("deployment lock rejected");
      const transaction = await stableTableAllocationDatabase(persistence, "deployment_catalog_allocation_sql_failure", {
        rejection: { operation: "lockDeployment", cause: rejection },
      });

      const failure = await runEffectFailure(ensureStableTableIdentityEffect(
        transaction.db,
        {
          deploymentId: "deployment_catalog_allocation_sql_failure",
          namespace: "app",
          logicalName: "users",
        },
      ));

      expect(failure).toBeInstanceOf(
        StableTableCatalogAllocationPersistenceError,
      );
      expect(failure).toMatchObject({
        _tag: "StableTableCatalogAllocationPersistenceError",
        operation: "lockDeployment",
        cause: rejection,
      });
      expect(transaction.committed()).toBe(false);
      expect(transaction.rolledBack()).toBe(true);
    });

    it("preserves allocator query-construction failures as defects", async () => {
      const defect = new Error("deployment lock construction defect");
      const transaction = await stableTableAllocationDatabase(persistence, "deployment_catalog_allocation_defect", {
        constructionDefect: { operation: "lockDeployment", cause: defect },
      });

      const exit = await Effect.runPromiseExit(ensureStableTableIdentityEffect(
        transaction.db,
        {
          deploymentId: "deployment_catalog_allocation_defect",
          namespace: "app",
          logicalName: "users",
        },
      ));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.hasFails(exit.cause)).toBe(false);
        expect(exit.cause.toString()).toContain(defect.message);
      }
      expect(transaction.committed()).toBe(false);
      expect(transaction.rolledBack()).toBe(true);
    });

    it("isolates the compact identity sequence by deployment", async () => {
      for (const suffix of ["a", "b"] as const) {
        await persistence.insertDeploymentMetadata({
          deploymentId: `deployment_isolated_${suffix}`,
          projectId: `project_isolated_${suffix}`,
        });
      }

      const [first, second] = await Promise.all([
        ensure(persistence, {
          deploymentId: "deployment_isolated_a",
          namespace: "medusa",
          logicalName: "product",
        }),
        ensure(persistence, {
          deploymentId: "deployment_isolated_b",
          namespace: "medusa",
          logicalName: "product",
        }),
      ]);

      expect(first.table.tableId).toBe(1);
      expect(second.table.tableId).toBe(1);
      expect(first.table.deploymentId).not.toBe(second.table.deploymentId);
    });

    it("fails closed for invalid ownership and names", async () => {

      await expect(
        ensure(persistence, {
          deploymentId: "missing_deployment",
          namespace: "app",
          logicalName: "users",
        }),
      ).rejects.toBeInstanceOf(StableTableCatalogDeploymentNotFoundError);

      await expect(
        ensure(persistence, {
          deploymentId: " ",
          namespace: "app",
          logicalName: "users",
        }),
      ).rejects.toBeInstanceOf(InvalidStableTableIdentityInputError);

      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_invalid_name",
        projectId: "project_invalid_name",
      });
      await expect(
        ensure(persistence, {
          deploymentId: "deployment_invalid_name",
          namespace: "system",
          logicalName: "\t\n",
        }),
      ).rejects.toBeInstanceOf(InvalidStableTableIdentityInputError);

      await expect(runEffect(
        ensureStableTableIdentityEffect(persistence.drizzle, {
            deploymentId: "deployment_invalid_name",
            namespace: "app",
            logicalName: "analyzer_ordinal",
            // @ts-expect-error Analyzer ordinals are forbidden allocator input.
            tableId: 17,
          }),
      )).rejects.toMatchObject({
        name: "InvalidStableTableIdentityInputError",
        field: "tableId",
      });
    });

    it("rolls back when post-insert verification returns typed corruption", async () => {
      const transaction = await stableTableAllocationDatabase(persistence, "deployment_catalog_rollback", { insertedRows: [] });

      const failure = await runEffectFailure(ensureStableTableIdentityEffect(
        transaction.db,
        {
          deploymentId: "deployment_catalog_rollback",
          namespace: "app",
          logicalName: "rolled_back",
        },
      ));

      expect(failure).toBeInstanceOf(StableTableCatalogCorruptionError);
      expect(failure).toMatchObject({ detail: "insert returned no row" });
      expect(transaction.committed()).toBe(false);
      expect(transaction.rolledBack()).toBe(true);
      expect(await transaction.catalogRows()).toEqual([]);
    });

    it("retains callback failure when transaction rollback fails differently", async () => {
      const rollbackFailure = new Error("allocator rollback failed");
      const transaction = await stableTableAllocationDatabase(persistence, "deployment_catalog_rollback_failure", {
        insertedRows: [],
        rollbackFailure,
      });

      const failure = await runEffectFailure(ensureStableTableIdentityEffect(
        transaction.db,
        {
          deploymentId: "deployment_catalog_rollback_failure",
          namespace: "app",
          logicalName: "rolled_back",
        },
      ));

      expect(failure).toBeInstanceOf(
        StableTableCatalogAllocationTransactionError,
      );
      expect(failure).toMatchObject({ cause: rollbackFailure });
      if (failure instanceof StableTableCatalogAllocationTransactionError) {
        const callbackCause = failure.callbackCause;
        if (callbackCause === undefined) {
          throw new Error("Expected the transaction error to retain callback Cause.");
        }
        expect(Cause.hasFails(callbackCause)).toBe(true);
        expect(callbackCause.toString()).toContain(
          "insert returned no row",
        );
      }
      expect(transaction.committed()).toBe(false);
      expect(transaction.rolledBack()).toBe(true);
      expect(await transaction.catalogRows()).toEqual([]);
    });

    it("enforces catalog constraints below the typed API", async () => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_catalog_constraints",
        projectId: "project_catalog_constraints",
      });

      for (const row of [
        { tableId: 0, namespace: "app", logicalName: "zero" },
        { tableId: 1, namespace: "commerce", logicalName: "namespace" },
        { tableId: 1, namespace: "app", logicalName: "\t\n" },
      ]) {
        await expect(
          persistence.query(
            `
            insert into fx_control_table
              (deployment_id, table_id, namespace, logical_name)
            values ($1, $2, $3, $4)
          `,
            [
              "deployment_catalog_constraints",
              row.tableId,
              row.namespace,
              row.logicalName,
            ],
          ),
        ).rejects.toThrow();
      }

      await persistence.query(
        `
        insert into fx_control_table
          (deployment_id, table_id, namespace, logical_name)
        values ($1, $2, $3, $4)
      `,
        [
          "deployment_catalog_constraints",
          2_147_483_647,
          "system",
          "maximum_table_id",
        ],
      );
      await expect(
        ensure(persistence, {
          deploymentId: "deployment_catalog_constraints",
          namespace: "app",
          logicalName: "after_maximum",
        }),
      ).rejects.toBeInstanceOf(StableTableCatalogIdExhaustedError);
    });
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createMigratedPGlitePersistence>>;

function ensure(
  persistence: PGlitePersistence,
  input: EnsureStableTableIdentityInput,
) {
  return runEffect(ensureStableTableIdentityEffect(persistence.drizzle, input));
}

function stableTableReadDatabase(
  run: () => Promise<readonly unknown[]>,
): FlarexMetadataDatabase {
  const query = {
    from: () => query,
    where: () => query,
    limit: () => run(),
  };
  return { select: () => query } as unknown as FlarexMetadataDatabase;
}

interface StableTableAllocationDatabaseOptions {
  readonly insertedRows?: readonly unknown[];
  readonly rollbackFailure?: unknown;
  readonly rejection?: Readonly<{
    operation: "lockDeployment";
    cause: unknown;
  }>;
  readonly constructionDefect?: Readonly<{
    operation: "lockDeployment";
    cause: unknown;
  }>;
}

async function stableTableAllocationDatabase(
  persistence: PGlitePersistence,
  deploymentId: string,
  options: StableTableAllocationDatabaseOptions = {},
) {
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "project_allocator_fault" });
  let committed = false;
  let rolledBack = false;
  const transaction = persistence.drizzle.transaction.bind(persistence.drizzle);
  const fault = vi.spyOn(persistence.drizzle, "transaction").mockImplementation(async (run, config) => {
    try {
      const result = await transaction(async tx => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        let emptyInsertResult = false;
        let rejection = options.rejection;
        const execute = PglitePreparedQuery.prototype.execute;
        const queryFault = vi.spyOn(PglitePreparedQuery.prototype, "execute").mockImplementation(async function (
          this: typeof PglitePreparedQuery.prototype, ...args
        ) {
          if (rejection !== undefined) {
            const cause = rejection.cause;
            rejection = undefined;
            throw cause;
          }
          const rows = await execute.apply(this, args);
          if (emptyInsertResult) {
            emptyInsertResult = false;
            return options.insertedRows;
          }
          return rows;
        });
        const selectFault = options.constructionDefect === undefined ? undefined :
          vi.spyOn(tx, "select").mockImplementationOnce(() => { throw options.constructionDefect?.cause; });
        const insert = tx.insert.bind(tx);
        const insertFault = options.insertedRows === undefined ? undefined :
          vi.spyOn(tx, "insert").mockImplementation((...args: Parameters<typeof insert>) => {
            emptyInsertResult = true;
            return insert(...args);
          });
        try {
          return await run(tx);
        } finally {
          insertFault?.mockRestore();
          selectFault?.mockRestore();
          queryFault.mockRestore();
          closeInstallationAdmission(tx);
        }
      }, config);
      committed = true;
      return result;
    } catch (cause: unknown) {
      rolledBack = true;
      if (options.rollbackFailure !== undefined) throw options.rollbackFailure;
      throw cause;
    }
  });
  onTestFinished(() => fault.mockRestore());
  return Object.freeze({
    db: persistence.drizzle,
    committed: () => committed,
    rolledBack: () => rolledBack,
    catalogRows: () => persistence.drizzle.select().from(fxControlTables)
      .where(eq(fxControlTables.deploymentId, deploymentId)),
  });
}

function queryConstructionDefectDatabase(
  defect: Error,
): FlarexMetadataDatabase {
  return {
    select() {
      throw defect;
    },
  } as unknown as FlarexMetadataDatabase;
}

function deferredValue<A>(): Readonly<{
  promise: Promise<A>;
  resolve(value: A): void;
}> {
  let resolvePromise: ((value: A) => void) | undefined;
  const promise = new Promise<A>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve(value: A) {
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
