import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EnsureStableTableIdentityInput,
  FlarexPersistence,
  StableTableIdentity,
} from "../src";
import {
  decodeStableTableIdentityByIdInputResult,
  decodeStableTableIdentityResult,
  ensureStableTableIdentityInTransaction,
  getStableTableIdentityByIdEffect,
  getStableTableIdentityByIdForPromiseTransaction,
  getStableTableIdentityByName,
  InvalidStableTableIdentityInputError,
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

type PublicPromiseIdReaderExport = Extract<
  keyof typeof import("../src"),
  "getStableTableIdentityById"
>;

describe("stable table catalog", () => {
  it("keeps allocation transaction-only and analyzer ordinals out of input", () => {
    expectTypeOf<AnalyzerOrdinalAccepted>().toEqualTypeOf<false>();
    expectTypeOf<PublicAllocatorMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicPromiseIdReaderExport>().toEqualTypeOf<never>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureStableTableIdentityInTransaction>[0]
      >();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof getStableTableIdentityByIdForPromiseTransaction>[0]
      >();
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
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId: "deployment_catalog_a",
        namespace: "payload",
        logicalName: "users",
      }),
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
      stableTableIdReadDatabase(() => Promise.reject(rejection)),
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

  it("reports malformed stored ID rows as typed catalog corruption", async () => {
    const failure = await runEffectFailure(getStableTableIdentityByIdEffect(
      stableTableIdReadDatabase(() => Promise.resolve([{
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
    const db = stableTableIdReadDatabase(() => {
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

    await expect(
      persistence.drizzle.transaction((tx) =>
        ensureStableTableIdentityInTransaction(tx, {
          deploymentId: "deployment_invalid_name",
          namespace: "app",
          logicalName: "analyzer_ordinal",
          // @ts-expect-error Analyzer ordinals are forbidden allocator input.
          tableId: 17,
        }),
      ),
    ).rejects.toMatchObject({
      name: "InvalidStableTableIdentityInputError",
      field: "tableId",
    });
  });

  it("does not consume an identity when the owning transaction rolls back", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_catalog_rollback",
      projectId: "project_catalog_rollback",
    });

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await ensureStableTableIdentityInTransaction(tx, {
          deploymentId: "deployment_catalog_rollback",
          namespace: "app",
          logicalName: "rolled_back",
        });
        throw new Error("injected rollback");
      }),
    ).rejects.toThrow("injected rollback");

    const committed = await ensure(persistence, {
      deploymentId: "deployment_catalog_rollback",
      namespace: "app",
      logicalName: "committed",
    });
    expect(committed).toMatchObject({
      status: "created",
      table: { tableId: 1 },
    });
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId: "deployment_catalog_rollback",
        namespace: "app",
        logicalName: "rolled_back",
      }),
    ).resolves.toBeNull();
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
  return persistence.drizzle.transaction((tx) =>
    ensureStableTableIdentityInTransaction(tx, input),
  );
}

function stableTableIdReadDatabase(
  run: () => Promise<readonly unknown[]>,
): FlarexMetadataDatabase {
  const query = {
    from: () => query,
    where: () => query,
    limit: () => run(),
  };
  return { select: () => query } as unknown as FlarexMetadataDatabase;
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
