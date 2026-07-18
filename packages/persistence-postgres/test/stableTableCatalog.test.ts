import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EnsureStableTableIdentityInput,
  EnsureStableTableIdentityResult,
  FlarexPersistence,
  StableTableIdentity,
} from "../src";
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
} from "../src/stableTableCatalog";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
  keyof typeof import("../src"),
  "getStableTableIdentityById" | "getStableTableIdentityByName"
>;

type PublicAllocatorExport = Extract<
  keyof typeof import("../src"),
  "ensureStableTableIdentityEffect" | "ensureStableTableIdentityInTransaction"
>;

type InternalPromiseReaderExport = Extract<
  keyof typeof import("../src/stableTableCatalog"),
  "getStableTableIdentityByIdForPromiseTransaction"
>;

describe("stable table catalog", () => {
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

  it("allocates once, replays exactly, and supports deployment-qualified reads", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
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

  it("keeps ID input validation pure and classifies invalid caller values", () => {
    const invalidDeployment = decodeStableTableIdentityByIdInputResult(
      " ",
      CatalogTableIdSchema.make(1),
    );
    const invalidTableId = decodeStableTableIdentityByIdInputResult(
      "deployment_catalog_input",
      0,
    );

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

  it("maps rejected allocator queries once and rolls back", async () => {
    const rejection = new Error("deployment lock rejected");
    const transaction = stableTableAllocationDatabase({
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

  it("preserves allocator query-construction failures as defects", async () => {
    const defect = new Error("deployment lock construction defect");
    const transaction = stableTableAllocationDatabase({
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

  it("isolates the compact identity sequence by deployment", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const transaction = stableTableAllocationDatabase({ insertedRows: [] });

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
  });

  it("retains callback failure when transaction rollback fails differently", async () => {
    const rollbackFailure = new Error("allocator rollback failed");
    const transaction = stableTableAllocationDatabase({
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
  });

  it("enforces catalog constraints below the typed API", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
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

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

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

type StableTableAllocationOperation =
  StableTableCatalogAllocationPersistenceError["operation"];

interface StableTableAllocationDatabaseOptions {
  readonly insertedRows?: readonly unknown[];
  readonly rollbackFailure?: unknown;
  readonly rejection?: Readonly<{
    operation: StableTableAllocationOperation;
    cause: unknown;
  }>;
  readonly constructionDefect?: Readonly<{
    operation: StableTableAllocationOperation;
    cause: unknown;
  }>;
}

function stableTableAllocationDatabase(
  options: StableTableAllocationDatabaseOptions = {},
): Readonly<{
  db: FlarexMetadataDatabase;
  committed(): boolean;
  rolledBack(): boolean;
}> {
  let committed = false;
  let rolledBack = false;
  let selectCount = 0;
  const row = {
    deploymentId: "deployment_catalog_rollback",
    namespace: "app",
    logicalName: "rolled_back",
    tableId: CatalogTableIdSchema.make(1),
    createdAt: new Date("2026-07-19T00:00:00.000Z"),
  } as const;

  const query = (
    operation: StableTableAllocationOperation | "getByName",
    rows: readonly unknown[],
  ) => {
    if (
      options.constructionDefect !== undefined
      && options.constructionDefect.operation === operation
    ) {
      throw options.constructionDefect.cause;
    }
    const run = () =>
      options.rejection !== undefined
        && options.rejection.operation === operation
        ? Promise.reject(options.rejection.cause)
        : Promise.resolve(rows);
    const builder = {
      from: () => builder,
      where: () => builder,
      limit: () => builder,
      orderBy: () => builder,
      for: () => run(),
      then: <Success, Failure = never>(
        onSuccess?: ((value: readonly unknown[]) => Success | PromiseLike<Success>)
          | null,
        onFailure?: ((reason: unknown) => Failure | PromiseLike<Failure>) | null,
      ) => run().then(onSuccess, onFailure),
    };
    return builder;
  };

  const tx = {
    select() {
      selectCount += 1;
      if (selectCount === 1) {
        return query("lockDeployment", [{
          deploymentId: "deployment_catalog_rollback",
        }]);
      }
      if (selectCount === 2) {
        return query("getByName", []);
      }
      return query("readHighWater", []);
    },
    insert() {
      const builder = {
        values: () => builder,
        returning: () => query("insert", options.insertedRows ?? [row]),
      };
      return builder;
    },
  };
  const db = {
    async transaction(
      run: (transaction: typeof tx) => Promise<unknown>,
    ): Promise<unknown> {
      try {
        const value = await run(tx);
        committed = true;
        return value;
      } catch (cause) {
        rolledBack = true;
        if (options.rollbackFailure !== undefined) {
          throw options.rollbackFailure;
        }
        throw cause;
      }
    },
  } as unknown as FlarexMetadataDatabase;

  return Object.freeze({
    db,
    committed: () => committed,
    rolledBack: () => rolledBack,
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
