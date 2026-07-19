import {
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
  MAX_CATALOG_INDEX_ID,
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import type {
  SchemaManifestAppIndexDeclarationInputV1,
  SchemaManifestAppSchemaV1,
  SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  getStableLogicalIndexIdentityByIdEffect,
  getStableLogicalIndexIdentityByNameEffect,
  type FlarexPersistence,
} from "../src";
import { createPGlitePersistence } from "../src/pglite";
import {
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect,
  type ApplySchemaManifestAppSchemaBindingsV1Error,
  decodeSchemaManifestAppIndexBindingRowsResult,
  InvalidPreparedSchemaManifestAppSchemaBindingsError,
  InvalidSchemaManifestAppSchemaBindingInputError,
  prepareSchemaManifestAppSchemaBindingsV1Effect,
  SchemaManifestAppSchemaBindingPersistenceError,
  type SchemaManifestAppIndexBindingRow,
  type PreparedSchemaManifestAppSchemaBindingsV1,
  verifyInsertedSchemaManifestAppIndexBindingRowsResult,
} from "../src/schemaManifestAppSchemaBindings";
import {
  applySchemaManifestAppTableBindingsV1InTransactionEffect,
  prepareSchemaManifestAppTableBindingsV1Effect,
} from "../src/schemaManifestTableBindings";
import { StableLogicalIndexCatalogIdExhaustedError } from "../src/stableLogicalIndexCatalogAllocation";
import { StableLogicalIndexCatalogCorruptionError } from "../src/stableLogicalIndexCatalogError";
import {
  ensureStableTableIdentityEffect,
  StableTableCatalogDeploymentNotFoundError,
} from "../src/stableTableCatalog";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const prepareSchemaManifestAppSchemaBindingsV1 = (
  ...args: Parameters<typeof prepareSchemaManifestAppSchemaBindingsV1Effect>
) => runEffect(prepareSchemaManifestAppSchemaBindingsV1Effect(...args));

type PublicMutationMethod = Extract<
  keyof FlarexPersistence,
  | "ensureStableLogicalIndexIdentityInTransaction"
  | "prepareSchemaManifestAppSchemaBindingsV1"
  | "prepareSchemaManifestAppSchemaBindingsV1Effect"
  | "applySchemaManifestAppSchemaBindingsV1InTransaction"
  | "applySchemaManifestAppSchemaBindingsV1InTransactionEffect"
>;

type PublicMutationExport = Extract<
  keyof typeof import("../src"),
  | "ensureStableLogicalIndexIdentityInTransaction"
  | "prepareSchemaManifestAppSchemaBindingsV1"
  | "prepareSchemaManifestAppSchemaBindingsV1Effect"
  | "applySchemaManifestAppSchemaBindingsV1InTransaction"
  | "applySchemaManifestAppSchemaBindingsV1InTransactionEffect"
  | "nextStableLogicalIndexCatalogId"
  | "nextStableLogicalIndexCatalogIdResult"
>;

describe("schema manifest app-schema bindings", () => {
  it("keeps logical allocation internal and table/index ID brands distinct", () => {
    expectTypeOf<PublicMutationMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicMutationExport>().toEqualTypeOf<never>();
    expectTypeOf<CatalogTableId>().not.toEqualTypeOf<CatalogIndexId>();
    expectTypeOf<
      PreparedSchemaManifestAppSchemaBindingsV1["manifest"]
    >().toEqualTypeOf<SchemaManifestAppSchemaV1>();
    expectTypeOf<
      ReturnType<
        typeof applySchemaManifestAppSchemaBindingsV1InTransactionEffect
      >
    >().toEqualTypeOf<Effect.Effect<
      SchemaManifestAppSchemaV1,
      ApplySchemaManifestAppSchemaBindingsV1Error
    >>();
  });

  it("decodes requested logical-index rows through Result without capturing defects", () => {
    const deploymentId = "deployment_app_schema_read_result";
    const tableId = CatalogTableIdSchema.make(1);
    const logicalIndexId = CatalogIndexIdSchema.make(1);
    const requested = [{ tableId, descriptor: "by_name" }];
    const row = {
      deploymentId,
      tableId,
      descriptor: "by_name",
      logicalIndexId,
    } satisfies SchemaManifestAppIndexBindingRow;

    const decoded = decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      requested,
      [
        row,
        {
          ...row,
          descriptor: "by_unrequested",
          logicalIndexId: "invalid-but-unrequested",
        },
      ],
    );
    expect(Result.getOrThrow(decoded).get("1\u0000by_name")).toBe(
      logicalIndexId,
    );

    const crossDeploymentRow = new Proxy(row, {
      get(target, property, receiver) {
        if (property === "deploymentId") return "another_deployment";
        if (property === "tableId") {
          throw new Error("table ID must not be read after deployment failure");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const crossDeployment = decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      requested,
      [crossDeploymentRow],
    );
    expect(Result.isFailure(crossDeployment)).toBe(true);
    if (Result.isFailure(crossDeployment)) {
      expect(crossDeployment.failure).toMatchObject({
        _tag: "StableLogicalIndexCatalogCorruptionError",
        detail: "cross-deployment row returned for another_deployment",
      });
    }

    const invalidTableRow = new Proxy(row, {
      get(target, property, receiver) {
        return property === "tableId"
          ? "invalid-table-id"
          : Reflect.get(target, property, receiver);
      },
    });
    const unreachedRow = new Proxy(row, {
      get() {
        throw new Error("later logical-index row must not be inspected");
      },
    });
    const invalidTable = decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      requested,
      [invalidTableRow, unreachedRow],
    );
    expect(Result.isFailure(invalidTable)).toBe(true);
    if (Result.isFailure(invalidTable)) {
      expect(invalidTable.failure.detail).toBe(
        "invalid table ID: invalid-table-id",
      );
    }

    const invalidIndexRow = new Proxy(row, {
      get(target, property, receiver) {
        return property === "logicalIndexId"
          ? "invalid-logical-index-id"
          : Reflect.get(target, property, receiver);
      },
    });
    const invalidIndex = decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      requested,
      [invalidIndexRow, unreachedRow],
    );
    expect(Result.isFailure(invalidIndex)).toBe(true);
    if (Result.isFailure(invalidIndex)) {
      expect(invalidIndex.failure.detail).toBe(
        "invalid logical index ID: invalid-logical-index-id",
      );
    }

    const duplicateRow = new Proxy(row, {
      get(target, property, receiver) {
        if (property === "logicalIndexId") {
          throw new Error("duplicate logical index ID must not be decoded");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const duplicate = decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      requested,
      [row, duplicateRow],
    );
    expect(Result.isFailure(duplicate)).toBe(true);
    if (Result.isFailure(duplicate)) {
      expect(duplicate.failure.detail).toBe(
        "duplicate logical identity for table 1 descriptor by_name",
      );
    }

    const defect = new Error("logical-index descriptor accessor failed");
    const throwingRow = new Proxy(row, {
      get(target, property, receiver) {
        if (property === "descriptor") throw defect;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      requested,
      [throwingRow],
    )).toThrow(defect);
  });

  it("verifies inserted logical-index rows through Result before rollback projection", () => {
    const deploymentId = "deployment_app_schema_insert_result";
    const planned = [{
      tableId: CatalogTableIdSchema.make(1),
      descriptor: "by_name",
      logicalIndexId: CatalogIndexIdSchema.make(1),
    }];
    const row = {
      deploymentId,
      tableId: CatalogTableIdSchema.make(1),
      descriptor: "by_name",
      logicalIndexId: CatalogIndexIdSchema.make(1),
    } satisfies SchemaManifestAppIndexBindingRow;

    expect(Result.isSuccess(
      verifyInsertedSchemaManifestAppIndexBindingRowsResult(
        deploymentId,
        planned,
        [row],
      ),
    )).toBe(true);

    const crossDeployment =
      verifyInsertedSchemaManifestAppIndexBindingRowsResult(
        deploymentId,
        planned,
        [{ ...row, deploymentId: "another_deployment" }],
      );
    expect(Result.isFailure(crossDeployment)).toBe(true);
    if (Result.isFailure(crossDeployment)) {
      expect(crossDeployment.failure.detail).toBe(
        "insert returned cross-deployment row for another_deployment",
      );
    }

    const invalidTableRow = new Proxy(row, {
      get(target, property, receiver) {
        return property === "tableId"
          ? "invalid-table-id"
          : Reflect.get(target, property, receiver);
      },
    });
    const invalidTable = verifyInsertedSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      planned,
      [invalidTableRow],
    );
    expect(Result.isFailure(invalidTable)).toBe(true);
    if (Result.isFailure(invalidTable)) {
      expect(invalidTable.failure).toBeInstanceOf(
        StableLogicalIndexCatalogCorruptionError,
      );
      expect(invalidTable.failure.detail).toBe(
        "invalid table ID: invalid-table-id",
      );
    }

    const invalidIndexRow = new Proxy(row, {
      get(target, property, receiver) {
        return property === "logicalIndexId"
          ? "invalid-logical-index-id"
          : Reflect.get(target, property, receiver);
      },
    });
    const invalidIndex = verifyInsertedSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      planned,
      [invalidIndexRow],
    );
    expect(Result.isFailure(invalidIndex)).toBe(true);
    if (Result.isFailure(invalidIndex)) {
      expect(invalidIndex.failure.detail).toBe(
        "invalid logical index ID: invalid-logical-index-id",
      );
    }

    const unreachedRow = new Proxy(row, {
      get() {
        throw new Error("later inserted index row must not be inspected");
      },
    });
    expect(Result.isFailure(
      verifyInsertedSchemaManifestAppIndexBindingRowsResult(
        deploymentId,
        planned,
        [invalidIndexRow, unreachedRow],
      ),
    )).toBe(true);

    const mismatch = verifyInsertedSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      planned,
      [{ ...row, logicalIndexId: CatalogIndexIdSchema.make(2) }],
    );
    expect(Result.isFailure(mismatch)).toBe(true);
    if (Result.isFailure(mismatch)) {
      expect(mismatch.failure.detail).toBe(
        "insert did not return planned binding 1/by_name/1",
      );
    }

    const duplicate = verifyInsertedSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      planned,
      [row, row],
    );
    expect(Result.isFailure(duplicate)).toBe(true);
    if (Result.isFailure(duplicate)) {
      expect(duplicate.failure.detail).toBe(
        "insert returned duplicate logical identity for table 1 descriptor by_name",
      );
    }

    const extra = verifyInsertedSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      planned,
      [
        row,
        {
          ...row,
          descriptor: "by_email",
          logicalIndexId: CatalogIndexIdSchema.make(2),
        },
      ],
    );
    expect(Result.isFailure(extra)).toBe(true);
    if (Result.isFailure(extra)) {
      expect(extra.failure.detail).toBe(
        "insert returned an unexpected number of planned logical index bindings",
      );
    }

    const cause = new Error("inserted index row accessor failed");
    const throwingRow = new Proxy(row, {
      get(target, property, receiver) {
        if (property === "descriptor") throw cause;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => verifyInsertedSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      planned,
      [throwingRow],
    )).toThrow(cause);
  });

  it("maps a combined-plan logical-index read rejection to its tagged error", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_read_failure";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    const rejection = new Error("combined logical-index read rejected");
    const tx = schemaBindingSelectTransaction((selectCall) =>
      selectCall === 1
        ? Promise.resolve([{ deploymentId }])
        : selectCall === 2
          ? Promise.resolve([])
          : Promise.reject(rejection)
    );

    const failure = await runEffectFailure(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, plan),
    );

    expect(failure).toBeInstanceOf(
      SchemaManifestAppSchemaBindingPersistenceError,
    );
    expect(failure).toMatchObject({
      _tag: "SchemaManifestAppSchemaBindingPersistenceError",
      operation: "readIndexBindings",
      cause: rejection,
    });
  });

  it("preserves combined-plan query construction failures as defects", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_construction_defect";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    const defect = new Error("combined logical-index query construction defect");
    const tx = schemaBindingSelectTransaction((selectCall) => {
      if (selectCall === 3) throw defect;
      return selectCall === 1
        ? Promise.resolve([{ deploymentId }])
        : Promise.resolve([]);
    });

    const exit = await Effect.runPromiseExit(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, plan),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a combined-plan logical-index read before interruption completes", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_interruption";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const tx = schemaBindingSelectTransaction((selectCall) => {
      if (selectCall === 1) return Promise.resolve([{ deploymentId }]);
      if (selectCall === 2) return Promise.resolve([]);
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, plan),
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

  it("allocates deterministically, replays exactly, and reuses identity when fields change", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_deterministic";
    await insertDeployment(persistence, deploymentId);

    const plan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("users"), appTable("products")],
        indexes: [
          appIndex("users", "by_email", ["email"]),
          appIndex("products", "by_sku", ["sku"]),
        ],
      },
    );

    expect(tableBindings(plan.manifest)).toEqual([
      { tableId: 1, logicalName: "products" },
      { tableId: 2, logicalName: "users" },
    ]);
    expect(indexBindings(plan.manifest)).toEqual([
      { logicalIndexId: 1, tableId: 1, descriptor: "by_sku", fields: ["sku"] },
      { logicalIndexId: 2, tableId: 2, descriptor: "by_email", fields: ["email"] },
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.manifest)).toBe(true);
    expect(Object.isFrozen(plan.manifest.indexBindings.indexes)).toBe(true);
    expect(Object.isFrozen(plan.manifest.indexBindings.indexes[0]?.spec.fields))
      .toBe(true);

    await expect(apply(persistence, plan)).resolves.toBe(plan.manifest);
    await expect(apply(persistence, plan)).resolves.toBe(plan.manifest);

    const changed = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("products"), appTable("users")],
        indexes: [
          appIndex("products", "by_sku", ["sku"]),
          appIndex("users", "by_email", ["profile.email"]),
        ],
      },
    );
    await expect(apply(persistence, changed)).resolves.toBe(changed.manifest);
    expect(indexBindings(changed.manifest)).toEqual([
      { logicalIndexId: 1, tableId: 1, descriptor: "by_sku", fields: ["sku"] },
      {
        logicalIndexId: 2,
        tableId: 2,
        descriptor: "by_email",
        fields: ["profile.email"],
      },
    ]);
    await expect(
      runEffect(
        getStableLogicalIndexIdentityByNameEffect(persistence.drizzle, {
          deploymentId,
          tableId: CatalogTableIdSchema.make(2),
          descriptor: "by_email",
        }),
      ),
    ).resolves.toMatchObject({ logicalIndexId: 2 });
    await expect(
      runEffect(
        getStableLogicalIndexIdentityByIdEffect(
          persistence.drizzle,
          deploymentId,
          CatalogIndexIdSchema.make(1),
        ),
      ),
    ).resolves.toMatchObject({ tableId: 1, descriptor: "by_sku" });

    const artifacts = await persistence.query<{ count: string }>(
      `select count(*)::text as count from fx_control_schema_version`,
    );
    expect(artifacts.rows).toEqual([{ count: "0" }]);
  });

  it("assigns new descriptors new IDs and permits one descriptor on different tables", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_identity";
    await insertDeployment(persistence, deploymentId);
    const initial = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("products"), appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    await apply(persistence, initial);

    const next = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("users"), appTable("products")],
        indexes: [
          appIndex("products", "by_name", ["name"]),
          appIndex("users", "by_display_name", ["email"]),
          appIndex("users", "by_name", ["name"]),
        ],
      },
    );
    await apply(persistence, next);
    expect(indexBindings(next.manifest)).toEqual([
      { logicalIndexId: 1, tableId: 2, descriptor: "by_name", fields: ["name"] },
      { logicalIndexId: 2, tableId: 1, descriptor: "by_name", fields: ["name"] },
      {
        logicalIndexId: 3,
        tableId: 2,
        descriptor: "by_display_name",
        fields: ["email"],
      },
    ]);
  });

  it("rejects undeclared tables, reserved indexes, missing deployments, and forged plans", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_invalid";
    await insertDeployment(persistence, deploymentId);

    await expect(
      prepareSchemaManifestAppSchemaBindingsV1(persistence.drizzle, {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("products", "by_sku", ["sku"])],
      }),
    ).rejects.toMatchObject({
      name: "InvalidSchemaManifestAppSchemaBindingInputError",
      issue: { reason: "undeclaredIndexTable" },
    });
    await expect(
      prepareSchemaManifestAppSchemaBindingsV1(persistence.drizzle, {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_id", ["name"])],
      }),
    ).rejects.toBeInstanceOf(InvalidSchemaManifestAppSchemaBindingInputError);
    await expect(
      prepareSchemaManifestAppSchemaBindingsV1(persistence.drizzle, {
        deploymentId: "missing_app_schema_deployment",
        tables: [],
        indexes: [],
      }),
    ).rejects.toBeInstanceOf(StableTableCatalogDeploymentNotFoundError);

    const empty = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [], indexes: [] },
    );
    await expect(apply(persistence, empty)).resolves.toEqual({
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: {
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [],
      },
      indexBindings: {
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: [],
      },
    });
    await expect(
      persistence.drizzle.transaction((tx) =>
        runEffect(
          applySchemaManifestAppSchemaBindingsV1InTransactionEffect(
            tx,
            // @ts-expect-error The test deliberately forges the opaque token.
            { deploymentId, manifest: empty.manifest },
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(
      InvalidPreparedSchemaManifestAppSchemaBindingsError,
    );

    const counts = await catalogCounts(persistence, deploymentId);
    expect(counts).toEqual({ tables: 0, indexes: 0 });
  });

  it("fails stale when either catalog frontier advances", async () => {
    const persistence = await migratedPersistence();
    const tableDeployment = "deployment_app_schema_table_frontier";
    await insertDeployment(persistence, tableDeployment);
    const tablePlan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId: tableDeployment,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    await ensureTable(persistence, {
      deploymentId: tableDeployment,
      namespace: "payload",
      logicalName: "payload_internal",
    });
    await expect(apply(persistence, tablePlan)).rejects.toMatchObject({
      name: "SchemaManifestAppSchemaBindingPlanStaleError",
      stale: { reason: "tableCatalogHighWaterChanged" },
    });

    const indexDeployment = "deployment_app_schema_index_frontier";
    await insertDeployment(persistence, indexDeployment);
    const tableOnly = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      { deploymentId: indexDeployment, tables: [appTable("users")], indexes: [] },
    );
    await apply(persistence, tableOnly);
    const indexPlan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId: indexDeployment,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    await insertRawIndex(persistence, indexDeployment, 1, 1, "by_other");
    await expect(apply(persistence, indexPlan)).rejects.toMatchObject({
      name: "SchemaManifestAppSchemaBindingPlanStaleError",
      stale: { reason: "indexCatalogHighWaterChanged" },
    });
  });

  it("detects changed index bindings and cross-catalog partial application", async () => {
    const persistence = await migratedPersistence();
    const changedDeployment = "deployment_app_schema_binding_changed";
    await insertDeployment(persistence, changedDeployment);
    const tableOnly = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      { deploymentId: changedDeployment, tables: [appTable("users")], indexes: [] },
    );
    await apply(persistence, tableOnly);
    const changedPlan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId: changedDeployment,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    await insertRawIndex(persistence, changedDeployment, 1, 1, "by_other");
    await insertRawIndex(persistence, changedDeployment, 2, 1, "by_name");
    await expect(apply(persistence, changedPlan)).rejects.toMatchObject({
      name: "SchemaManifestAppSchemaBindingPlanStaleError",
      stale: {
        reason: "indexBindingChanged",
        plannedLogicalIndexId: 1,
        currentLogicalIndexId: 2,
      },
    });

    const partialDeployment = "deployment_app_schema_partial";
    await insertDeployment(persistence, partialDeployment);
    const combinedPlan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId: partialDeployment,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    const separateTablePlan = await runEffect(
      prepareSchemaManifestAppTableBindingsV1Effect(persistence.drizzle, {
        deploymentId: partialDeployment,
        tables: [appTable("users")],
      }),
    );
    await persistence.drizzle.transaction((tx) =>
      runEffect(
        applySchemaManifestAppTableBindingsV1InTransactionEffect(
          tx,
          separateTablePlan,
        ),
      ),
    );
    await expect(apply(persistence, combinedPlan)).rejects.toMatchObject({
      name: "SchemaManifestAppSchemaBindingPlanStaleError",
      stale: {
        reason: "partiallyApplied",
        applied: [{ kind: "table", logicalName: "users", tableId: 1 }],
        missing: [
          {
            kind: "index",
            tableId: 1,
            descriptor: "by_name",
            logicalIndexId: 1,
          },
        ],
      },
    });
    expect(await catalogCounts(persistence, partialDeployment)).toEqual({
      tables: 1,
      indexes: 0,
    });
  });

  it("rolls table and index mappings back together and reuses the exact plan", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_rollback";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await runEffect(
          applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, plan),
        );
        throw new Error("injected app-schema rollback");
      }),
    ).rejects.toThrow("injected app-schema rollback");
    expect(await catalogCounts(persistence, deploymentId)).toEqual({
      tables: 0,
      indexes: 0,
    });
    await expect(apply(persistence, plan)).resolves.toBe(plan.manifest);
    expect(await catalogCounts(persistence, deploymentId)).toEqual({
      tables: 1,
      indexes: 1,
    });
  });

  it("rolls both catalogs back when Result verification rejects index RETURNING", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_returning_rollback";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppSchemaBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      },
    );
    await persistence.exec(`
      create function fx_test_corrupt_index_binding_returning() returns trigger
      language plpgsql
      as $$
      begin
        new.descriptor := new.descriptor || '_corrupt';
        return new;
      end;
      $$;

      create trigger fx_test_corrupt_index_binding_returning
      before insert on fx_control_index
      for each row execute function fx_test_corrupt_index_binding_returning();
    `);

    await expect(apply(persistence, plan)).rejects.toBeInstanceOf(
      StableLogicalIndexCatalogCorruptionError,
    );
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 0,
      indexes: 0,
    });
  });

  it("enforces logical catalog constraints and deployment-qualified table ownership", async () => {
    const persistence = await migratedPersistence();
    await insertDeployment(persistence, "deployment_index_constraints_a");
    await insertDeployment(persistence, "deployment_index_constraints_b");
    await ensureTable(persistence, {
      deploymentId: "deployment_index_constraints_a",
      namespace: "app",
      logicalName: "users",
    });
    await ensureTable(persistence, {
      deploymentId: "deployment_index_constraints_b",
      namespace: "app",
      logicalName: "users",
    });
    await insertRawIndex(
      persistence,
      "deployment_index_constraints_a",
      1,
      1,
      "by_name",
    );

    await expect(
      insertRawIndex(
        persistence,
        "deployment_index_constraints_a",
        1,
        1,
        "by_email",
      ),
    ).rejects.toThrow();
    await expect(
      insertRawIndex(
        persistence,
        "deployment_index_constraints_a",
        2,
        1,
        "by_name",
      ),
    ).rejects.toThrow();
    await expect(
      insertRawIndex(
        persistence,
        "deployment_index_constraints_a",
        2,
        2,
        "cross_deployment",
      ),
    ).rejects.toThrow();
    await expect(
      insertRawIndex(
        persistence,
        "deployment_index_constraints_a",
        0,
        1,
        "zero_id",
      ),
    ).rejects.toThrow();
    await expect(
      insertRawIndex(
        persistence,
        "deployment_index_constraints_a",
        2,
        1,
        "\u00a0",
      ),
    ).rejects.toThrow();

    await expect(
      insertRawIndex(
        persistence,
        "deployment_index_constraints_b",
        1,
        1,
        "by_name",
      ),
    ).resolves.toBeUndefined();
  });

  it("fails before planning past the deployment-local logical ID limit", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_app_schema_exhausted";
    await insertDeployment(persistence, deploymentId);
    await ensureTable(persistence, {
      deploymentId,
      namespace: "app",
      logicalName: "users",
    });
    await insertRawIndex(
      persistence,
      deploymentId,
      MAX_CATALOG_INDEX_ID,
      1,
      "by_last",
    );

    await expect(
      prepareSchemaManifestAppSchemaBindingsV1(persistence.drizzle, {
        deploymentId,
        tables: [appTable("users")],
        indexes: [appIndex("users", "by_name", ["name"])],
      }),
    ).rejects.toBeInstanceOf(StableLogicalIndexCatalogIdExhaustedError);
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
          sku: {
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

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
}

function tableBindings(manifest: SchemaManifestAppSchemaV1) {
  return manifest.tableDefinitions.tables.map((table) => ({
    tableId: table.tableId,
    logicalName: table.logicalName,
  }));
}

function indexBindings(manifest: SchemaManifestAppSchemaV1) {
  return manifest.indexBindings.indexes.map((index) => ({
    logicalIndexId: index.logicalIndexId,
    tableId: index.tableId,
    descriptor: index.descriptor,
    fields: index.spec.fields,
  }));
}

function apply(
  persistence: PGlitePersistence,
  prepared: PreparedSchemaManifestAppSchemaBindingsV1,
): Promise<SchemaManifestAppSchemaV1> {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, prepared),
    ),
  );
}

interface SchemaBindingSelectQuery
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): SchemaBindingSelectQuery;
  where(): SchemaBindingSelectQuery;
  limit(): SchemaBindingSelectQuery;
  orderBy(): SchemaBindingSelectQuery;
  for(): SchemaBindingSelectQuery;
}

function schemaBindingSelectTransaction(
  run: (selectCall: number) => Promise<ReadonlyArray<unknown>>,
) {
  let selectCall = 0;
  return {
    select() {
      selectCall += 1;
      const promise = run(selectCall);
      const query: SchemaBindingSelectQuery = {
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
  } as unknown as Parameters<
    typeof applySchemaManifestAppSchemaBindingsV1InTransactionEffect
  >[0];
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

async function insertRawIndex(
  persistence: PGlitePersistence,
  deploymentId: string,
  logicalIndexId: number,
  tableId: number,
  descriptor: string,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_control_index
        (deployment_id, logical_index_id, table_id, descriptor)
      values ($1, $2, $3, $4)
    `,
    [deploymentId, logicalIndexId, tableId, descriptor],
  );
}

async function catalogCounts(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<{ readonly tables: number; readonly indexes: number }> {
  const rows = await persistence.query<{
    tables: number;
    indexes: number;
  }>(
    `
      select
        (
          select count(*)::int
          from fx_control_table
          where deployment_id = $1
        ) as tables,
        (
          select count(*)::int
          from fx_control_index
          where deployment_id = $1
        ) as indexes
    `,
    [deploymentId],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error("Catalog count query returned no row.");
  return row;
}
