import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureFrameworkMigrationAttemptStartInTransactionEffect,
} from "../src/migrationCoordination/migrationAttemptRepository";
import {
  ensureFrameworkMigrationAttemptTerminalInTransactionEffect,
} from "../src/migrationCoordination/migrationAttemptTerminalRepository";
import {
  ensureFrameworkMigrationStepReceiptInTransactionEffect,
} from "../src/migrationCoordination/migrationStepReceiptRepository";
import type {
  FrameworkMigrationStep,
  FreshRelationalMigrationPlan,
} from "../src/migrationCoordination/model";
import {
  captureRelationalStructuralValidationSha256Effect,
  executeRelationalStructuralStepEffect,
  issueRelationalStructuralRunnerTokenEffect,
  observeRelationalStructuralStepEffect,
  preflightRelationalStructuralPlanEffect,
  RelationalStructuralRunnerError,
  type RelationalStructuralRunnerToken,
} from "../src/migrationCoordination/relationalStructuralRunner";
import {
  restoredFrameworkMigrationAttemptTerminalStepReceipts,
  type RestoredFrameworkMigrationStepReceipt,
} from "../src/migrationCoordination/storedRestoration";
import {
  makeFrameworkMigrationSessionDriver,
  makeFrameworkMigrationTargetEffect,
  runFrameworkMigrationTargetTransactionEffect,
  type FrameworkMigrationTarget,
  type FrameworkMigrationSessionDriver,
  type RunFrameworkMigrationDriverTransaction,
} from "../src/migrationCoordination/targetSession";
import { makePGliteFrameworkMigrationTargetEffect } from
  "../src/migrationCoordination/pgliteTarget";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import type {
  RelationalPhysicalForeignKey,
  RelationalPhysicalIndex,
  RelationalPhysicalKey,
  RelationalPhysicalLayout,
  RelationalPhysicalTable,
} from "../src/relationalSchema/physical/model";
import type { RelationalTableIdentity } from
  "../src/relationalSchema/model";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulTerminalGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import {
  currencyArtifact,
  FRAMEWORK_VALUE_LOCATOR,
  completeFrameworkMigrationPlanSteps,
  frameworkTargetNamespace,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

type PublicStructuralRunnerExport = Extract<
  keyof typeof import("../src"),
  `${string}RelationalStructuralRunner${string}` |
    `${string}RelationalStructuralStep${string}`
>;

type RelationalPhysicalTableOperation = Pick<
  RelationalPhysicalTable,
  "identity" | "name" | "scopeColumn" | "columns" | "keys" | "checks"
>;

const TEST_TIMEOUT = 180_000;
const TRANSACTION_REQUEST = Object.freeze({
  kind: "ordinary" as const,
  lockTimeoutMilliseconds: 5_000,
  statementTimeoutMilliseconds: 30_000,
});

describe("private relational structural runner", () => {
  it("keeps its token source-private, frozen, and process-authenticated", async () => {
    expectTypeOf<PublicStructuralRunnerExport>().toEqualTypeOf<never>();
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/relationalStructuralRunner.ts",
    );

    const fixture = await createSyntheticRunnerFixture();
    expect(Object.isFrozen(fixture.token)).toBe(true);

    // SAFETY: this deliberately invalid assertion bypasses the compile-time
    // brand so the WeakMap-backed runtime capability boundary is exercised.
    const forged = Object.freeze({}) as RelationalStructuralRunnerToken;
    const failure = await runEffectFailure(
      preflightRelationalStructuralPlanEffect(forged),
    );
    expectRunnerFailure(failure, "invalidAuthority");
  }, TEST_TIMEOUT);

  it("executes the exact seven-step expansion plan and observes every postcondition", async () => {
    const fixture = await createSyntheticRunnerFixture();
    await runEffect(preflightRelationalStructuralPlanEffect(fixture.token));

    const observations = await runEffect(
      runFrameworkMigrationTargetTransactionEffect(
        fixture.target,
        TRANSACTION_REQUEST,
        transaction => Effect.gen(function* () {
          const results: Array<Readonly<{
            before: "absent" | "exact";
            after: "absent" | "exact";
            observedPostconditionSha256: string;
          }>> = [];
          for (const step of fixture.plan.frame.steps) {
            const before = yield* observeRelationalStructuralStepEffect(
              fixture.token,
              transaction,
              step,
            );
            const execution = yield* executeRelationalStructuralStepEffect(
              fixture.token,
              transaction,
              step,
            );
            const after = yield* observeRelationalStructuralStepEffect(
              fixture.token,
              transaction,
              step,
            );
            results.push(Object.freeze({
              before,
              after,
              observedPostconditionSha256:
                execution.observedPostconditionSha256,
            }));
          }
          return Object.freeze(results);
        }),
      ),
    );

    expect(fixture.plan.frame.steps.map(step =>
      step.operation.codec.format
    )).toEqual([
      "flarex.relational-create-table",
      "flarex.relational-create-table",
      "flarex.relational-create-index",
      "flarex.relational-add-foreign-key",
      "flarex.relational-add-foreign-key",
      "flarex.relational-add-foreign-key",
      "flarex.relational-validate-structure",
    ]);
    expect(observations.map(observation => observation.before)).toEqual([
      "absent",
      "absent",
      "absent",
      "absent",
      "absent",
      "absent",
      "exact",
    ]);
    expect(observations.every(observation =>
      observation.after === "exact"
    )).toBe(true);
    expect(observations.map(observation =>
      observation.observedPostconditionSha256
    )).toEqual(fixture.plan.frame.steps.map(step =>
      step.postconditionSha256
    ));
  }, TEST_TIMEOUT);

  it("rolls structural DDL back with the target transaction", async () => {
    const fixture = await createSyntheticRunnerFixture();
    const step = requireTableSteps(fixture.plan)[0];
    expect(step).toBeDefined();
    if (step === undefined) return;
    const rollback = Object.freeze({
      _tag: "DeliberateRelationalStructuralRollback",
    } as const);

    const failure = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        fixture.target,
        TRANSACTION_REQUEST,
        transaction => executeRelationalStructuralStepEffect(
          fixture.token,
          transaction,
          step,
        ).pipe(Effect.flatMap(() => Effect.fail(rollback))),
      ),
    );
    expect(failure).toBe(rollback);

    const afterRollback = await observeStep(
      fixture.target,
      fixture.token,
      step,
    );
    expect(afterRollback).toBe("absent");
  }, TEST_TIMEOUT);

  it("refuses exact pre-existing structure without an authenticated receipt", async () => {
    const fixture = await createSyntheticRunnerFixture();
    const step = requireTableSteps(fixture.plan)[0];
    expect(step).toBeDefined();
    if (step === undefined) return;

    await executeStep(fixture.target, fixture.token, step);
    const failure = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        fixture.target,
        TRANSACTION_REQUEST,
        transaction => executeRelationalStructuralStepEffect(
          fixture.token,
          transaction,
          step,
        ),
      ),
    );
    expectRunnerFailure(failure, "unreceiptedStructure");
  }, TEST_TIMEOUT);

  it("rejects a wrong table behind the exact physical name", async () => {
    const fixture = await createSyntheticRunnerFixture();
    const step = requireTableSteps(fixture.plan)[0];
    expect(step).toBeDefined();
    if (step === undefined) return;
    const table = tableOperation(step);
    await executeSql(
      fixture.persistence.drizzle,
      `CREATE TABLE ${qualified(fixture.schemaName, table.name)} (` +
        `${identifier(table.scopeColumn.name)} uuid NOT NULL)`,
    );

    const failure = await observeStepFailure(
      fixture.target,
      fixture.token,
      step,
    );
    expectRunnerFailure(failure, "catalogMismatch");
  }, TEST_TIMEOUT);

  it("requires a real default, accepts normalized integer syntax, and rejects changed value", async () => {
    const fixture = await createSyntheticRunnerFixture();
    const step = requireTableSteps(fixture.plan).find(candidate =>
      tableOperation(candidate).columns.some(column =>
        column.default.kind === "integerLiteral"
      )
    );
    expect(step).toBeDefined();
    if (step === undefined) return;
    await executeStep(fixture.target, fixture.token, step);
    const table = tableOperation(step);
    const column = table.columns.find(candidate =>
      candidate.default.kind === "integerLiteral"
    );
    expect(column).toBeDefined();
    if (column === undefined) return;
    await executeSql(
      fixture.persistence.drizzle,
      `ALTER TABLE ${qualified(fixture.schemaName, table.name)} ` +
        `ALTER COLUMN ${identifier(column.name)} DROP DEFAULT`,
    );
    const absentFailure = await observeStepFailure(
      fixture.target,
      fixture.token,
      step,
    );
    expectRunnerFailure(absentFailure, "catalogMismatch");

    await executeSql(
      fixture.persistence.drizzle,
      `ALTER TABLE ${qualified(fixture.schemaName, table.name)} ` +
        `ALTER COLUMN ${identifier(column.name)} SET DEFAULT ((0))`,
    );
    expect(await observeStep(
      fixture.target,
      fixture.token,
      step,
    )).toBe("exact");

    await executeSql(
      fixture.persistence.drizzle,
      `ALTER TABLE ${qualified(fixture.schemaName, table.name)} ` +
        `ALTER COLUMN ${identifier(column.name)} SET DEFAULT 1`,
    );

    const failure = await observeStepFailure(
      fixture.target,
      fixture.token,
      step,
    );
    expectRunnerFailure(failure, "catalogMismatch");
  }, TEST_TIMEOUT);

  it("rejects btree direction, null placement, opclass, collation, and INCLUDE drift", async () => {
    const fixture = await createSyntheticRunnerFixture();
    const tableSteps = requireTableSteps(fixture.plan);
    await executeSteps(fixture.target, fixture.token, tableSteps);
    const step = requireIndexStep(fixture.plan);
    const index = indexOperation(step);
    const sourceTable = requireTableForIdentity(
      fixture.plan.physicalLayout,
      index.table,
    );
    const keyColumns = index.columns.map(identifier);
    const [firstColumn, secondColumn] = keyColumns;
    const includedColumn = sourceTable.columns.find(column =>
      !index.columns.includes(column.name)
    )?.name;
    expect(keyColumns).toHaveLength(2);
    expect(firstColumn).toBeDefined();
    expect(secondColumn).toBeDefined();
    expect(includedColumn).toBeDefined();
    if (
      firstColumn === undefined || secondColumn === undefined ||
      includedColumn === undefined
    ) return;

    const variants = [
      `${firstColumn}, ${secondColumn} DESC NULLS FIRST`,
      `${firstColumn}, ${secondColumn} text_pattern_ops`,
      `${firstColumn}, ${secondColumn} COLLATE "C"`,
      `${keyColumns.join(", ")}) INCLUDE (${identifier(includedColumn)}`,
    ];
    for (const columns of variants) {
      await executeSql(
        fixture.persistence.drizzle,
        `CREATE INDEX ${identifier(index.name)} ON ` +
          `${qualified(fixture.schemaName, sourceTable.name)} USING btree (` +
          `${columns})`,
      );
      const failure = await observeStepFailure(
        fixture.target,
        fixture.token,
        step,
      );
      expectRunnerFailure(failure, "catalogMismatch");
      await executeSql(
        fixture.persistence.drizzle,
        `DROP INDEX ${qualified(fixture.schemaName, index.name)}`,
      );
    }
  }, TEST_TIMEOUT);

  it("rejects NULLS NOT DISTINCT key drift", async () => {
    const fixture = await createSyntheticRunnerFixture();
    const step = requireTableSteps(fixture.plan).find(candidate =>
      tableOperation(candidate).keys.some(key => key.kind === "unique")
    );
    expect(step).toBeDefined();
    if (step === undefined) return;
    await executeStep(fixture.target, fixture.token, step);
    const table = tableOperation(step);
    const key = table.keys.find(candidate => candidate.kind === "unique");
    expect(key).toBeDefined();
    if (key === undefined) return;
    await dropConstraint(
      fixture.persistence.drizzle,
      fixture.schemaName,
      table,
      key,
    );
    const columns = key.columns.map(identifier);
    await executeSql(
      fixture.persistence.drizzle,
      `ALTER TABLE ${qualified(fixture.schemaName, table.name)} ` +
        `ADD CONSTRAINT ${identifier(key.name)} UNIQUE NULLS NOT DISTINCT (` +
        `${columns.join(", ")})`,
    );
    const nullsFailure = await observeStepFailure(
      fixture.target,
      fixture.token,
      step,
    );
    expectRunnerFailure(nullsFailure, "catalogMismatch");
    await dropConstraint(
      fixture.persistence.drizzle,
      fixture.schemaName,
      table,
      key,
    );
  }, TEST_TIMEOUT);

  it("rejects a same-name foreign key with MATCH FULL semantics", async () => {
    const fixture = await createSyntheticRunnerFixture();
    await executeSteps(
      fixture.target,
      fixture.token,
      requireTableSteps(fixture.plan),
    );
    const step = requireOrdinaryForeignKeyStep(fixture.plan);
    const foreignKey = foreignKeyOperation(step);
    if (foreignKey.kind !== "foreignKey") {
      throw new Error("Expected the ordinary fixture foreign key");
    }
    const sourceTable = requireTableForIdentity(
      fixture.plan.physicalLayout,
      foreignKey.sourceTable,
    );
    await executeSql(
      fixture.persistence.drizzle,
      `ALTER TABLE ${qualified(fixture.schemaName, sourceTable.name)} ` +
        `ADD CONSTRAINT ${identifier(foreignKey.name)} FOREIGN KEY (` +
        `${foreignKey.sourceColumns.map(identifier).join(", ")}) ` +
        `REFERENCES ${qualified(
          fixture.schemaName,
          foreignKey.targetTableName,
        )} (${foreignKey.targetColumns.map(identifier).join(", ")}) ` +
        "MATCH FULL ON DELETE RESTRICT ON UPDATE RESTRICT",
    );

    const failure = await observeStepFailure(
      fixture.target,
      fixture.token,
      step,
    );
    expectRunnerFailure(failure, "catalogMismatch");
  }, TEST_TIMEOUT);

  it("rejects a same-name non-foreign-key constraint before structural DDL", async () => {
    const fixture = await createSyntheticRunnerFixture();
    await executeSteps(
      fixture.target,
      fixture.token,
      requireTableSteps(fixture.plan),
    );
    const step = requireOrdinaryForeignKeyStep(fixture.plan);
    const foreignKey = foreignKeyOperation(step);
    if (foreignKey.kind !== "foreignKey") {
      throw new Error("Expected the ordinary fixture foreign key");
    }
    const sourceTable = requireTableForIdentity(
      fixture.plan.physicalLayout,
      foreignKey.sourceTable,
    );
    await executeSql(
      fixture.persistence.drizzle,
      `ALTER TABLE ${qualified(fixture.schemaName, sourceTable.name)} ` +
        `ADD CONSTRAINT ${identifier(foreignKey.name)} CHECK (true)`,
    );

    const observeFailure = await observeStepFailure(
      fixture.target,
      fixture.token,
      step,
    );
    expectRunnerFailure(observeFailure, "catalogMismatch");

    const closedTransaction = await fixture.persistence.drizzle.transaction(
      async transaction => transaction,
    );
    let rawExecuteCalls = 0;
    const countedTransaction = new Proxy(closedTransaction, {
      get: (target, property, receiver) => property === "execute"
        ? (query: Parameters<typeof closedTransaction.execute>[0]) => {
            rawExecuteCalls += 1;
            return fixture.persistence.drizzle.execute(query);
          }
        : Reflect.get(target, property, receiver),
    });
    const runTransactionEffect: RunFrameworkMigrationDriverTransaction =
      (_request, work) => work(countedTransaction);
    const driver = makeFrameworkMigrationSessionDriver(
      fixture.persistence.drizzle,
      runTransactionEffect,
    );
    const countedTarget = await makeTarget(
      fixture.persistence.drizzle,
      driver,
      fixture.plan,
    );
    const countedToken = await runEffect(
      issueRelationalStructuralRunnerTokenEffect(countedTarget, fixture.plan),
    );
    const executeFailure = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        countedTarget,
        TRANSACTION_REQUEST,
        transaction => executeRelationalStructuralStepEffect(
          countedToken,
          transaction,
          step,
        ),
      ),
    );
    expectRunnerFailure(executeFailure, "catalogMismatch");
    expect(rawExecuteCalls).toBe(1);
  }, TEST_TIMEOUT);

  it("rejects equal-but-distinct steps and cross-target transactions before raw SQL", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const plan = await captureSyntheticPlan();
    const closedTransaction = await persistence.drizzle.transaction(
      async transaction => transaction,
    );
    let rawExecuteCalls = 0;
    const countedTransaction = new Proxy(closedTransaction, {
      get: (target, property, receiver) => property === "execute"
        ? () => {
            rawExecuteCalls += 1;
            throw new Error("Runner reached raw SQL after rejected authority");
          }
        : Reflect.get(target, property, receiver),
    });
    const runTransactionEffect: RunFrameworkMigrationDriverTransaction =
      (_request, work) => work(countedTransaction);
    const driver = makeFrameworkMigrationSessionDriver(
      persistence.drizzle,
      runTransactionEffect,
    );
    const firstTarget = await makeTarget(
      persistence.drizzle,
      driver,
      plan,
    );
    const secondTarget = await makeTarget(
      persistence.drizzle,
      driver,
      plan,
    );
    const token = await runEffect(
      issueRelationalStructuralRunnerTokenEffect(firstTarget, plan),
    );
    const step = plan.frame.steps[0];
    expect(step).toBeDefined();
    if (step === undefined) return;
    const clonedStep = Object.freeze({ ...step });

    const clonedFailure = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        firstTarget,
        TRANSACTION_REQUEST,
        transaction => observeRelationalStructuralStepEffect(
          token,
          transaction,
          clonedStep,
        ),
      ),
    );
    expectRunnerFailure(clonedFailure, "invalidAuthority");
    expect(rawExecuteCalls).toBe(0);

    const crossTargetFailure = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        secondTarget,
        TRANSACTION_REQUEST,
        transaction => observeRelationalStructuralStepEffect(
          token,
          transaction,
          step,
        ),
      ),
    );
    expect(crossTargetFailure).toMatchObject({
      _tag: "FrameworkMigrationTargetCompositionError",
      reason: "targetMismatch",
    });
    expect(rawExecuteCalls).toBe(0);
  }, TEST_TIMEOUT);

  it("maps a synchronous raw execute throw to typed resource failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const plan = await captureSyntheticPlan();
    const closedTransaction = await persistence.drizzle.transaction(
      async transaction => transaction,
    );
    const executeCause = new Error("synchronous structural execute failure");
    const throwingTransaction = new Proxy(closedTransaction, {
      get: (target, property, receiver) => property === "execute"
        ? () => {
            throw executeCause;
          }
        : Reflect.get(target, property, receiver),
    });
    const runTransactionEffect: RunFrameworkMigrationDriverTransaction =
      (_request, work) => work(throwingTransaction);
    const driver = makeFrameworkMigrationSessionDriver(
      persistence.drizzle,
      runTransactionEffect,
    );
    const target = await makeTarget(persistence.drizzle, driver, plan);
    const token = await runEffect(
      issueRelationalStructuralRunnerTokenEffect(target, plan),
    );
    const step = plan.frame.steps[0];
    expect(step).toBeDefined();
    if (step === undefined) return;

    const failure = await runEffectFailure(
      runFrameworkMigrationTargetTransactionEffect(
        target,
        TRANSACTION_REQUEST,
        transaction => observeRelationalStructuralStepEffect(
          token,
          transaction,
          step,
        ),
      ),
    );
    expectRunnerFailure(failure, "resourceFailure");
    expect(failure).toMatchObject({ cause: executeCause });
  }, TEST_TIMEOUT);

  it("maps malformed raw execute result shapes to typed resource failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const plan = await captureSyntheticPlan();
    const closedTransaction = await persistence.drizzle.transaction(
      async transaction => transaction,
    );
    const step = plan.frame.steps[0];
    expect(step).toBeDefined();
    if (step === undefined) return;
    const malformedResults = Object.freeze([
      Object.freeze({ rows: "not-an-array" }),
      Object.freeze({ rows: Object.freeze([42]) }),
    ]);
    for (const malformedResult of malformedResults) {
      const malformedTransaction = new Proxy(closedTransaction, {
        get: (target, property, receiver) => property === "execute"
          ? () => Promise.resolve(malformedResult)
          : Reflect.get(target, property, receiver),
      });
      const runTransactionEffect: RunFrameworkMigrationDriverTransaction =
        (_request, work) => work(malformedTransaction);
      const driver = makeFrameworkMigrationSessionDriver(
        persistence.drizzle,
        runTransactionEffect,
      );
      const target = await makeTarget(persistence.drizzle, driver, plan);
      const token = await runEffect(
        issueRelationalStructuralRunnerTokenEffect(target, plan),
      );
      const failure = await runEffectFailure(
        runFrameworkMigrationTargetTransactionEffect(
          target,
          TRANSACTION_REQUEST,
          transaction => observeRelationalStructuralStepEffect(
            token,
            transaction,
            step,
          ),
        ),
      );
      expectRunnerFailure(failure, "resourceFailure");
    }
  }, TEST_TIMEOUT);

  it("authenticates only one complete coherent restored receipt chain", async () => {
    const values = await createSuccessfulTerminalPlanValues();
    const firstPersistence = await createMigratedPGlitePersistence();
    const firstGraph = await firstPersistence.drizzle.transaction(
      transaction => storeSuccessfulTerminalGraphInTransaction(
        transaction,
        values,
      ),
    );
    const firstReceipts =
      restoredFrameworkMigrationAttemptTerminalStepReceipts(
        firstGraph.terminal,
      );
    const secondAttemptTerminal = await firstPersistence.drizzle.transaction(
      async transaction => {
        const attemptValue = await runEffect(
          captureFrameworkMigrationAttemptStart({
            admission: firstGraph.admission.admission,
            attemptId: "attempt-b",
            attemptFence: "2",
            leaseOwnerId: "worker-b",
            leaseExpiresAt: "2026-08-27T08:40:00.000Z",
            previousAttemptId: firstGraph.attempt.attempt.frame.attemptId,
            startedAt: "2026-08-27T08:39:00.000Z",
          }),
        );
        const attempt = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            firstGraph.admission,
            firstGraph.attempt,
            attemptValue,
          ),
        );
        const receiptValues = await completeFrameworkMigrationPlanSteps(
          attempt.plan.plan,
          attempt.attempt,
          "2026-08-27T08:41:00.000Z",
        );
        const restoredByStepId = new Map<
          string,
          RestoredFrameworkMigrationStepReceipt
        >();
        const receipts: RestoredFrameworkMigrationStepReceipt[] = [];
        for (const receiptValue of receiptValues) {
          const dependencies = receiptValue.frame.dependencyReceipts.map(
            reference => {
              const dependency = restoredByStepId.get(reference.stepId);
              if (dependency === undefined) {
                throw new Error("Fixture dependency receipt is missing");
              }
              return dependency;
            },
          );
          const receipt = await runEffect(
            ensureFrameworkMigrationStepReceiptInTransactionEffect(
              transaction,
              attempt,
              dependencies,
              receiptValue,
            ),
          );
          restoredByStepId.set(receipt.receipt.frame.stepId, receipt);
          receipts.push(receipt);
        }
        const terminalValue = await runEffect(
          captureFrameworkMigrationAttemptTerminal({
            attempt: attempt.attempt,
            outcome: Object.freeze({
              kind: "succeeded",
              requiredStepSetSha256:
                attempt.plan.plan.requiredStepSetSha256,
            }),
            stepReceipts: receiptValues,
            terminalAt: "2026-08-27T08:42:00.000Z",
          }),
        );
        return runEffect(
          ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            attempt,
            receipts,
            terminalValue,
          ),
        );
      },
    );
    const secondAttemptReceipts =
      restoredFrameworkMigrationAttemptTerminalStepReceipts(
        secondAttemptTerminal,
      );
    expect(firstReceipts).toBeDefined();
    expect(secondAttemptReceipts).toBeDefined();
    if (firstReceipts === undefined || secondAttemptReceipts === undefined) {
      return;
    }
    const plan = firstGraph.plan.plan;
    const target = await makePGliteTarget(
      firstPersistence.drizzle,
      plan,
    );
    const token = await runEffect(
      issueRelationalStructuralRunnerTokenEffect(target, plan),
    );

    expect(firstReceipts).toHaveLength(plan.frame.steps.length);
    expect(firstReceipts.map((receipt, ordinal) => ({
      attempt: receipt.attempt === firstGraph.attempt,
      plan: receipt.attempt.plan.plan === plan,
      stepId: receipt.receipt.frame.stepId ===
        plan.frame.steps[ordinal]?.stepId,
      stepSha256: receipt.receipt.frame.stepSha256 ===
        plan.frame.steps[ordinal]?.stepSha256,
      preconditionSha256: receipt.receipt.frame.preconditionSha256 ===
        plan.frame.steps[ordinal]?.preconditionSha256,
      postconditionSha256: receipt.receipt.frame.postconditionSha256 ===
        plan.frame.steps[ordinal]?.postconditionSha256,
      observedPostconditionSha256:
        receipt.receipt.frame.observedPostconditionSha256 ===
          plan.frame.steps[ordinal]?.postconditionSha256,
    }))).toEqual(plan.frame.steps.map(() => ({
      attempt: true,
      plan: true,
      stepId: true,
      stepSha256: true,
      preconditionSha256: true,
      postconditionSha256: true,
      observedPostconditionSha256: true,
    })));

    const validationSha256 = await runEffect(
      captureRelationalStructuralValidationSha256Effect(
        token,
        firstReceipts,
      ),
    );
    expect(validationSha256).toMatch(/^[0-9a-f]{64}$/u);

    const firstReceipt = firstReceipts[0];
    const secondAttemptReceipt = secondAttemptReceipts[0];
    const secondReceipt = firstReceipts[1];
    expect(firstReceipt).toBeDefined();
    expect(secondAttemptReceipt).toBeDefined();
    expect(secondReceipt).toBeDefined();
    if (
      firstReceipt === undefined ||
      secondAttemptReceipt === undefined ||
      secondReceipt === undefined
    ) return;

    // SAFETY: this deliberately invalid assertion bypasses the compile-time
    // restored-receipt contract to exercise its process-local WeakSet owner.
    const clonedReceipt = Object.freeze({
      ...firstReceipt,
    }) as RestoredFrameworkMigrationStepReceipt;
    const invalidChains = [
      Object.freeze([clonedReceipt, ...firstReceipts.slice(1)]),
      Object.freeze([
        secondAttemptReceipt,
        ...firstReceipts.slice(1),
      ]),
      Object.freeze([
        secondReceipt,
        firstReceipt,
        ...firstReceipts.slice(2),
      ]),
    ];
    for (const receipts of invalidChains) {
      const failure = await runEffectFailure(
        captureRelationalStructuralValidationSha256Effect(token, receipts),
      );
      expectRunnerFailure(failure, "invalidAuthority");
    }
  }, TEST_TIMEOUT);

  it("installs canonical exact-numeric raw JSONB defaults and rejects value or precision drift", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const artifact = await currencyArtifact();
    const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
      artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR,
      targetNamespace: await frameworkTargetNamespace(),
    }));
    const plan = await runEffect(captureFreshRelationalMigrationPlan({
      artifact: artifact.artifact,
      physicalLayout,
    }));
    await establishTargetNamespace(persistence.drizzle, plan);
    const target = await makePGliteTarget(persistence.drizzle, plan);
    const token = await runEffect(
      issueRelationalStructuralRunnerTokenEffect(target, plan),
    );
    await runEffect(preflightRelationalStructuralPlanEffect(token));
    await executeSteps(target, token, plan.frame.steps);
    const step = requireTableStepsByCount(plan, 1)[0];
    expect(step).toBeDefined();
    if (step === undefined) return;
    const table = tableOperation(step);
    const rawColumn = table.columns.find(column =>
      column.default.kind === "exactNumericRawLiteral"
    );
    expect(rawColumn).toBeDefined();
    if (
      rawColumn === undefined ||
      rawColumn.default.kind !== "exactNumericRawLiteral"
    ) return;
    expect(await observeStep(target, token, step)).toBe("exact");

    await executeSql(
      persistence.drizzle,
      `ALTER TABLE ${qualified(plan.frame.targetNamespace.schemaName, table.name)} ` +
        `ALTER COLUMN ${identifier(rawColumn.name)} SET DEFAULT ` +
        `'${JSON.stringify({
          precision: rawColumn.default.precision,
          value: rawColumn.default.value,
        })}'::jsonb`,
    );
    expect(await observeStep(target, token, step)).toBe("exact");

    const driftCases = [
      Object.freeze({
        value: `${rawColumn.default.value}1`,
        precision: rawColumn.default.precision,
      }),
      Object.freeze({
        value: rawColumn.default.value,
        precision: rawColumn.default.precision + 1,
      }),
    ];
    for (const drift of driftCases) {
      await executeSql(
        persistence.drizzle,
        `ALTER TABLE ${qualified(
          plan.frame.targetNamespace.schemaName,
          table.name,
        )} ALTER COLUMN ${identifier(rawColumn.name)} SET DEFAULT ` +
          `'${JSON.stringify(drift)}'::jsonb`,
      );
      const failure = await observeStepFailure(target, token, step);
      expectRunnerFailure(failure, "catalogMismatch");
    }
  }, TEST_TIMEOUT);
});

async function createSyntheticRunnerFixture() {
  const persistence = await createMigratedPGlitePersistence();
  const plan = await captureSyntheticPlan();
  await establishTargetNamespace(persistence.drizzle, plan);
  const target = await makePGliteTarget(persistence.drizzle, plan);
  const token = await runEffect(
    issueRelationalStructuralRunnerTokenEffect(target, plan),
  );
  return Object.freeze({
    persistence,
    plan,
    target,
    token,
    schemaName: plan.frame.targetNamespace.schemaName,
  });
}

async function captureSyntheticPlan(): Promise<FreshRelationalMigrationPlan> {
  const artifact = await syntheticSystemArtifact();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: await frameworkTargetNamespace(),
  }));
  return runEffect(captureFreshRelationalMigrationPlan({
    artifact: artifact.artifact,
    physicalLayout,
  }));
}

async function establishTargetNamespace(
  database: Parameters<typeof executeSql>[0],
  plan: FreshRelationalMigrationPlan,
): Promise<void> {
  const schemaName = plan.frame.targetNamespace.schemaName;
  await executeSql(database, `CREATE SCHEMA ${identifier(schemaName)}`);
  await executeSql(
    database,
    `CREATE TABLE ${qualified(schemaName, "fx_system_scope_clock")} (` +
      "scope_uuid uuid NOT NULL, " +
      "CONSTRAINT \"fx_system_scope_clock_scope_uuid_unique\" " +
      "UNIQUE (scope_uuid))",
  );
}

function makePGliteTarget(
  database: Parameters<typeof executeSql>[0],
  plan: FreshRelationalMigrationPlan,
): Promise<FrameworkMigrationTarget> {
  return runEffect(makePGliteFrameworkMigrationTargetEffect({
    persistence: { drizzle: database },
    deploymentId: plan.frame.targetNamespace.deploymentId,
    canonicalPhysicalDatabaseIdentity:
      plan.frame.targetNamespace.physicalDatabaseIdentity,
    physicalLocator: plan.frame.physicalLocator,
  }));
}

function makeTarget(
  database: Parameters<typeof executeSql>[0],
  driver: FrameworkMigrationSessionDriver,
  plan: FreshRelationalMigrationPlan,
): Promise<FrameworkMigrationTarget> {
  return runEffect(makeFrameworkMigrationTargetEffect({
    database,
    driver,
    deploymentId: plan.frame.targetNamespace.deploymentId,
    canonicalPhysicalDatabaseIdentity:
      plan.frame.targetNamespace.physicalDatabaseIdentity,
    physicalLocator: plan.frame.physicalLocator,
  }));
}

function observeStep(
  target: FrameworkMigrationTarget,
  token: RelationalStructuralRunnerToken,
  step: FrameworkMigrationStep,
) {
  return runEffect(runFrameworkMigrationTargetTransactionEffect(
    target,
    TRANSACTION_REQUEST,
    transaction => observeRelationalStructuralStepEffect(
      token,
      transaction,
      step,
    ),
  ));
}

function observeStepFailure(
  target: FrameworkMigrationTarget,
  token: RelationalStructuralRunnerToken,
  step: FrameworkMigrationStep,
) {
  return runEffectFailure(runFrameworkMigrationTargetTransactionEffect(
    target,
    TRANSACTION_REQUEST,
    transaction => observeRelationalStructuralStepEffect(
      token,
      transaction,
      step,
    ),
  ));
}

function executeStep(
  target: FrameworkMigrationTarget,
  token: RelationalStructuralRunnerToken,
  step: FrameworkMigrationStep,
) {
  return runEffect(runFrameworkMigrationTargetTransactionEffect(
    target,
    TRANSACTION_REQUEST,
    transaction => executeRelationalStructuralStepEffect(
      token,
      transaction,
      step,
    ),
  ));
}

function executeSteps(
  target: FrameworkMigrationTarget,
  token: RelationalStructuralRunnerToken,
  steps: readonly FrameworkMigrationStep[],
) {
  return runEffect(runFrameworkMigrationTargetTransactionEffect(
    target,
    TRANSACTION_REQUEST,
    transaction => Effect.gen(function* () {
      for (const step of steps) {
        yield* executeRelationalStructuralStepEffect(token, transaction, step);
      }
    }),
  ));
}

async function executeSql(
  database: Awaited<
    ReturnType<typeof createMigratedPGlitePersistence>
  >["drizzle"],
  statement: string,
): Promise<void> {
  await database.execute(sql.raw(statement));
}

async function dropConstraint(
  database: Parameters<typeof executeSql>[0],
  schemaName: string,
  table: RelationalPhysicalTableOperation,
  key: RelationalPhysicalKey,
): Promise<void> {
  await executeSql(
    database,
    `ALTER TABLE ${qualified(schemaName, table.name)} ` +
      `DROP CONSTRAINT ${identifier(key.name)}`,
  );
}

function requireTableSteps(
  plan: FreshRelationalMigrationPlan,
): readonly FrameworkMigrationStep[] {
  return requireTableStepsByCount(plan, 2);
}

function requireTableStepsByCount(
  plan: FreshRelationalMigrationPlan,
  expectedCount: number,
): readonly FrameworkMigrationStep[] {
  const steps = plan.frame.steps.filter(step => "table" in step.operation);
  if (steps.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} create-table steps`);
  }
  return steps;
}

function requireIndexStep(
  plan: FreshRelationalMigrationPlan,
): FrameworkMigrationStep {
  const step = plan.frame.steps.find(candidate =>
    "index" in candidate.operation
  );
  if (step === undefined) {
    throw new Error("Expected the synthetic create-index step");
  }
  return step;
}

function requireOrdinaryForeignKeyStep(
  plan: FreshRelationalMigrationPlan,
): FrameworkMigrationStep {
  const step = plan.frame.steps.find(candidate =>
    "foreignKey" in candidate.operation &&
    foreignKeyOperation(candidate).kind === "foreignKey"
  );
  if (step === undefined) {
    throw new Error("Expected the synthetic ordinary foreign-key step");
  }
  return step;
}

function tableOperation(
  step: FrameworkMigrationStep,
): RelationalPhysicalTableOperation {
  if (!("table" in step.operation)) {
    throw new Error("Expected a create-table operation");
  }
  // SAFETY: the authenticated model's operation union was narrowed by its
  // table member; this recovers the physical table projection used by tests.
  return step.operation.table as RelationalPhysicalTableOperation;
}

function indexOperation(
  step: FrameworkMigrationStep,
): RelationalPhysicalIndex {
  if (!("index" in step.operation)) {
    throw new Error("Expected a create-index operation");
  }
  // SAFETY: the authenticated model's operation union was narrowed by its
  // index member; this recovers the exact physical index projection.
  return step.operation.index as RelationalPhysicalIndex;
}

function foreignKeyOperation(
  step: FrameworkMigrationStep,
): RelationalPhysicalForeignKey {
  if (!("foreignKey" in step.operation)) {
    throw new Error("Expected an add-foreign-key operation");
  }
  // SAFETY: the authenticated model's operation union was narrowed by its
  // foreignKey member; this recovers the exact physical FK projection.
  return step.operation.foreignKey as RelationalPhysicalForeignKey;
}

function requireTableForIdentity(
  layout: RelationalPhysicalLayout,
  identity: RelationalTableIdentity,
): RelationalPhysicalTable {
  const table = layout.frame.tables.find(candidate =>
    candidate.identity.owner === identity.owner &&
    candidate.identity.lineageId === identity.lineageId &&
    candidate.identity.tableId === identity.tableId
  );
  if (table === undefined) {
    throw new Error("Expected physical table identity in fixture layout");
  }
  return table;
}

function expectRunnerFailure(
  failure: unknown,
  reason: RelationalStructuralRunnerError["reason"],
): void {
  expect(failure).toBeInstanceOf(RelationalStructuralRunnerError);
  expect(failure).toMatchObject({
    _tag: "RelationalStructuralRunnerError",
    reason,
  });
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function qualified(schemaName: string, objectName: string): string {
  return `${identifier(schemaName)}.${identifier(objectName)}`;
}
