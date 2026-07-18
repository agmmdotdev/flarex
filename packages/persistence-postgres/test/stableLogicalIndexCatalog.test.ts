import {
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  getStableLogicalIndexIdentityByIdEffect,
  getStableLogicalIndexIdentityByNameEffect,
  InvalidStableLogicalIndexIdentityInputError,
  StableLogicalIndexCatalogCorruptionError,
  StableLogicalIndexIdentityPersistenceError,
  type StableLogicalIndexIdentity,
} from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import { fxControlIndexes, fxControlTables } from "../src/schema";
import { decodeStableLogicalIndexIdentityResult } from
  "../src/stableLogicalIndexCatalog";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

type PublicPromiseReaderExport = Extract<
  keyof typeof import("../src"),
  | "getStableLogicalIndexIdentityById"
  | "getStableLogicalIndexIdentityByName"
>;

describe("stable logical index catalog reads", () => {
  it("exposes Effect readers without retaining an unowned Promise facade", () => {
    expectTypeOf<PublicPromiseReaderExport>().toEqualTypeOf<never>();
    expectTypeOf<StableLogicalIndexIdentity["logicalIndexId"]>()
      .toEqualTypeOf<ReturnType<typeof CatalogIndexIdSchema.make>>();
  });

  it("reads deployment-qualified identities by ID and name and returns null when absent", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_logical_index_reads";
    const tableId = CatalogTableIdSchema.make(1);
    const logicalIndexId = CatalogIndexIdSchema.make(1);
    await persistence.insertDeploymentMetadata({
      deploymentId,
      projectId: "project_logical_index_reads",
    });
    await persistence.drizzle.insert(fxControlTables).values({
      deploymentId,
      tableId,
      namespace: "app",
      logicalName: "products",
    });
    await persistence.drizzle.insert(fxControlIndexes).values({
      deploymentId,
      logicalIndexId,
      tableId,
      descriptor: "by_sku",
    });

    const byId = await runEffect(getStableLogicalIndexIdentityByIdEffect(
      persistence.drizzle,
      deploymentId,
      logicalIndexId,
    ));
    const byName = await runEffect(getStableLogicalIndexIdentityByNameEffect(
      persistence.drizzle,
      { deploymentId, tableId, descriptor: "by_sku" },
    ));

    expect(byId).toMatchObject({
      deploymentId,
      logicalIndexId: 1,
      tableId: 1,
      descriptor: "by_sku",
    });
    expect(byId?.createdAt).toBeInstanceOf(Date);
    expect(byName).toEqual(byId);
    await expect(runEffect(getStableLogicalIndexIdentityByIdEffect(
      persistence.drizzle,
      deploymentId,
      CatalogIndexIdSchema.make(2),
    ))).resolves.toBeNull();
    await expect(runEffect(getStableLogicalIndexIdentityByNameEffect(
      persistence.drizzle,
      { deploymentId, tableId, descriptor: "missing" },
    ))).resolves.toBeNull();
  });

  it("decodes a stored row with an owned Date snapshot", () => {
    const storedDate = new Date("2026-07-18T10:00:00.000Z");
    const decoded = Result.getOrThrow(decodeStableLogicalIndexIdentityResult({
      deploymentId: "deployment_logical_index_decode",
      logicalIndexId: CatalogIndexIdSchema.make(1),
      tableId: CatalogTableIdSchema.make(2),
      descriptor: "by_email",
      createdAt: storedDate,
    }));

    expect(decoded.createdAt).not.toBe(storedDate);
    expect(decoded.createdAt.getTime()).toBe(storedDate.getTime());
  });

  it("fails invalid input before constructing a query", async () => {
    const db = queryConstructionDefectDatabase();
    const byId = await runEffectFailure(getStableLogicalIndexIdentityByIdEffect(
      db,
      " ",
      CatalogIndexIdSchema.make(1),
    ));
    const byName = await runEffectFailure(
      getStableLogicalIndexIdentityByNameEffect(db, {
        deploymentId: "deployment_logical_index_invalid",
        tableId: CatalogTableIdSchema.make(1),
        descriptor: "",
      }),
    );

    expect(byId).toBeInstanceOf(InvalidStableLogicalIndexIdentityInputError);
    expect(byId).toMatchObject({
      _tag: "InvalidStableLogicalIndexIdentityInputError",
      field: "deploymentId",
    });
    expect(byName).toMatchObject({
      _tag: "InvalidStableLogicalIndexIdentityInputError",
      field: "descriptor",
    });
  });

  it("maps a rejected Drizzle query once at the persistence edge", async () => {
    const rejection = new Error("logical index query rejected");
    const failure = await runEffectFailure(getStableLogicalIndexIdentityByIdEffect(
      logicalIndexReadDatabase(() => Promise.reject(rejection)),
      "deployment_logical_index_sql_failure",
      CatalogIndexIdSchema.make(1),
    ));

    expect(failure).toBeInstanceOf(StableLogicalIndexIdentityPersistenceError);
    expect(failure).toMatchObject({
      _tag: "StableLogicalIndexIdentityPersistenceError",
      operation: "getById",
      cause: rejection,
    });
  });

  it("reports malformed stored identity rows as typed catalog corruption", async () => {
    const failure = await runEffectFailure(getStableLogicalIndexIdentityByNameEffect(
      logicalIndexReadDatabase(() => Promise.resolve([{
        deploymentId: "deployment_logical_index_corruption",
        logicalIndexId: CatalogIndexIdSchema.make(1),
        tableId: CatalogTableIdSchema.make(1),
        descriptor: "",
        createdAt: new Date(),
      }])),
      {
        deploymentId: "deployment_logical_index_corruption",
        tableId: CatalogTableIdSchema.make(1),
        descriptor: "by_name",
      },
    ));

    expect(failure).toBeInstanceOf(StableLogicalIndexCatalogCorruptionError);
    expect(failure).toMatchObject({
      _tag: "StableLogicalIndexCatalogCorruptionError",
      detail: "descriptor is blank",
    });
  });

  it("waits for a pending Drizzle query before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<readonly []>();
    const db = logicalIndexReadDatabase(() => {
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(getStableLogicalIndexIdentityByIdEffect(
      db,
      "deployment_logical_index_interruption",
      CatalogIndexIdSchema.make(1),
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

  it("preserves unexpected input accessor failures as defects", async () => {
    const defect = new Error("logical index input accessor defect");
    const input = new Proxy(
      {
        deploymentId: "deployment_logical_index_defect",
        tableId: CatalogTableIdSchema.make(1),
        descriptor: "by_name",
      },
      {
        get(target, property, receiver) {
          if (property === "descriptor") throw defect;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const exit = await Effect.runPromiseExit(
      getStableLogicalIndexIdentityByNameEffect(
        queryConstructionDefectDatabase(),
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
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

function logicalIndexReadDatabase(
  run: () => Promise<readonly unknown[]>,
): FlarexMetadataDatabase {
  const query = {
    from: () => query,
    where: () => query,
    limit: () => run(),
  };
  return { select: () => query } as unknown as FlarexMetadataDatabase;
}

function queryConstructionDefectDatabase(): FlarexMetadataDatabase {
  return {
    select() {
      throw new Error("query construction should not run");
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
