import { describe, expect, it } from "vitest";

import {
  deleteExecutorOccProofDeployment,
  executorOccProofStartBody,
  listExecutorOccProofDeploymentRows,
  runExecutorOccProof,
  verifyExecutorOccProofState,
} from "./executorOccProof";
import {
  h04Fixture,
  h04ServiceBindingHop,
  type ServiceBindingPostgresRuntime,
  withTemporaryServiceBindingPostgres,
} from "./serviceBindingPostgresHarness";
import { proveExclusiveHostedExecutorOccProofRunClaim } from "./hostedServiceBindingPostgresHarness";

describe(
  "private named executor service binding against real PostgreSQL",
  { timeout: 120_000 },
  () => {
    it("proves authenticated invoke, stale OCC conflict, abort, and fresh convergence", async () => {
      await withTemporaryServiceBindingPostgres(
        runH04Scenario,
        async (persistence, evidence) => {
          await verifyExecutorOccProofState(persistence, h04Fixture, evidence);
          const cleanup = await deleteExecutorOccProofDeployment(
            persistence,
            h04Fixture.deploymentId,
          );
          await expect(
            listExecutorOccProofDeploymentRows(
              persistence,
              h04Fixture.deploymentId,
              cleanup.scopeIds,
            ),
          ).resolves.toEqual([]);
          await proveExclusiveHostedExecutorOccProofRunClaim(
            persistence,
            "deployment_h05_run_claim_probe",
          );
        },
      );
    });
  },
);

async function runH04Scenario(runtime: ServiceBindingPostgresRuntime) {
  expect(runtime.callerBindingKeys).toEqual(["FLAREX_EXECUTOR"]);
  expect(runtime.executorBindingKeys).toEqual([
    "FLAREX_EXECUTOR_TOKEN",
    "HYPERDRIVE_CACHE_DISABLED",
  ]);
  await expect(runtime.executorDirectUrl()).rejects.toThrow(
    'Direct access disabled in "flarex-executor" worker',
  );

  const unauthorized = await runtime.request(
    "/invoke/start",
    executorOccProofStartBody(h04Fixture),
    { authorized: false },
  );
  expect(unauthorized.headers.get(h04ServiceBindingHop.header)).toBe(
    h04ServiceBindingHop.value,
  );
  expect(unauthorized.status).toBe(401);
  await expect(unauthorized.json()).resolves.toEqual({
    error: "unauthorized",
    message: "Unauthorized Flarex executor request.",
  });

  return await runExecutorOccProof(runtime, h04Fixture);
}
