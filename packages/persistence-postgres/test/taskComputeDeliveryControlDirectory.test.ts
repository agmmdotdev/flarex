import { PGlite } from "@electric-sql/pglite";
import { Result } from "effect";
import {
  replacementScopeIdV1FromUuid,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createPGlitePersistence,
  createPGliteTaskComputeDeliveryControlDirectoryTarget,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  makeTaskComputeDeliveryControlDirectory,
  type TaskComputeDeliveryControlDirectoryTarget,
} from "../src/taskComputeDeliveryControlDirectory";
import {
  createPostgresTaskComputeDeliveryControlDirectoryResource,
} from "../src/postgresTaskComputeDeliveryControlDirectory";
import { runEffect } from "./effectTestRuntime";

const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 200,
  transactionTimeoutMilliseconds: 300,
  settlementReserveMilliseconds: 1_000,
});
const LOCATOR = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "dte06-c3-control-directory",
  schemaName: "public",
});

describe("DTE06-C3 deadline-owned control directory - PGlite", () => {
  it("classifies a competing pool deadline as invalid pool configuration", () => {
    const result = createPostgresTaskComputeDeliveryControlDirectoryResource(
      { connectionTimeoutMillis: 1 },
      DEADLINE_POLICY,
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) throw new Error("expected pool configuration failure");
    expect(result.failure).toMatchObject({
      reason: "invalid_pool_configuration",
    });
  });

  it("rejects a structurally forged transaction target", () => {
    const forged = Object.freeze({
      kind: "task_compute_delivery_control_directory_target" as const,
    }) as unknown as TaskComputeDeliveryControlDirectoryTarget;
    const result = makeTaskComputeDeliveryControlDirectory(
      forged,
      directoryPolicy(),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) throw new Error("expected forged target failure");
    expect(result.failure).toMatchObject({ reason: "invalid_target" });
  });

  it("preserves one finite scope snapshot across exact continuation", async () => {
    const raw = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db: raw });
      await persistence.migrate();
      const first = scopeIdAt(1);
      const second = scopeIdAt(2);
      const deferred = scopeIdAt(9);
      await insertScope(persistence, first);
      await insertScope(persistence, second);

      const target = Result.getOrThrow(
        createPGliteTaskComputeDeliveryControlDirectoryTarget(
          persistence,
          DEADLINE_POLICY,
        ),
      );
      const directory = Result.getOrThrow(
        makeTaskComputeDeliveryControlDirectory(target, directoryPolicy()),
      );

      expect(directory.settlementBudgetMilliseconds).toBe(1_000);
      const firstPage = await runEffect(directory.discoverEffect({ limit: 1 }));
      expect(firstPage.candidates).toEqual([
        expect.objectContaining({
          deploymentId: deploymentIdFor(first),
          scopeId: first,
        }),
      ]);
      expect(firstPage.continuation).toMatchObject({
        highWaterScopeId: second,
        lastScopeId: first,
      });

      await insertScope(persistence, deferred);
      const secondPage = await runEffect(directory.discoverEffect({
        limit: 1,
        continuation: firstPage.continuation,
      }));
      expect(secondPage.candidates).toEqual([
        expect.objectContaining({
          deploymentId: deploymentIdFor(second),
          scopeId: second,
        }),
      ]);
      expect(secondPage.continuation).toBeNull();

      const freshPage = await runEffect(directory.discoverEffect({ limit: 10 }));
      expect(freshPage.candidates.map(({ scopeId }) => scopeId)).toEqual([
        first,
        second,
        deferred,
      ]);
    } finally {
      await raw.close();
    }
  });
});

function directoryPolicy() {
  return Object.freeze({
    operationName: "DTE06C3.controlDirectoryPGlite",
    input: (reason: string) => new Error(`input:${reason}`),
    corruption: (reason: string) => new Error(`corruption:${reason}`),
    sql: (cause: unknown) => new Error("sql", { cause }),
    decodeDeploymentId: (value: unknown) =>
      typeof value === "string" && value.length > 0
        ? Result.succeed(value)
        : Result.fail(new Error("deployment_invalid")),
  });
}

async function insertScope(
  persistence: PGliteFlarexPersistence,
  scopeId: ReplacementScopeIdV1,
): Promise<void> {
  const deploymentId = deploymentIdFor(scopeId);
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
}

function scopeIdAt(sequence: number): ReplacementScopeIdV1 {
  return replacementScopeIdV1FromUuid(
    `93000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
  );
}

function deploymentIdFor(scopeId: ReplacementScopeIdV1): string {
  return `deployment_control_directory_${scopeId.slice(-12)}`;
}
