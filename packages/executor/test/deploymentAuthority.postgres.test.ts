import { describe, expect, it } from "vitest";
import {
  createPostgresSharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapFrontier,
  type SharedScopeAuthorityBootstrapper,
} from "@flarex/persistence-postgres/postgres";

import { createFlarexExecutor } from "../src";
import {
  postgresUrl,
  withTemporaryPostgresExecutorPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres executor deployment authority", () => {
  it("converges concurrent executor creation on one ready authority pair", async () => {
    await withTemporaryPostgresExecutorPersistence(async (
      persistence,
      executorPersistence,
    ) => {
      const first = createFlarexExecutor({ persistence: executorPersistence });
      const second = createFlarexExecutor({ persistence: executorPersistence });
      const input = {
        deploymentId: "deployment_executor_authority_race",
        projectId: "project_executor_authority_race",
      } as const;

      const results = await Promise.all([
        first.ensureDeployment(input),
        second.ensureDeployment(input),
      ]);

      expect(results.map((result) => result.created).sort()).toEqual([
        false,
        true,
      ]);
      await expect(authorityCounts(persistence)).resolves.toEqual({
        deployments: "1",
        scopes: "1",
        clocks: "1",
        epochs: "1",
        missingScopes: "0",
        missingClocks: "0",
      });
      await expect(first.ensureDeployment(input)).resolves.toMatchObject({
        created: false,
        deployment: { deploymentId: input.deploymentId },
      });
    });
  });

  it("keeps final C2 parity clean after switching to authority-only creation", async () => {
    await withTemporaryPostgresExecutorPersistence(async (
      persistence,
      executorPersistence,
      scopePhysicalLocator,
    ) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_executor_fence",
        projectId: "project_before_executor_fence",
      });
      const bootstrapper = createPostgresSharedScopeAuthorityBootstrapper(
        persistence,
        { physicalLocator: scopePhysicalLocator },
      );
      const preFenceFrontier = await bootstrapper.captureFrontier();
      await runBootstrapToCompletion(bootstrapper, preFenceFrontier);
      await expect(
        bootstrapper.verifyFrontier(preFenceFrontier),
      ).resolves.toMatchObject({ status: "complete_through_frontier" });

      const executor = createFlarexExecutor({
        persistence: executorPersistence,
      });
      const cutoverFrontier = await bootstrapper.captureFrontier();
      await runBootstrapToCompletion(bootstrapper, cutoverFrontier);
      await expect(
        bootstrapper.verifyFrontier(cutoverFrontier),
      ).resolves.toMatchObject({ status: "complete_through_frontier" });

      await executor.ensureDeployment({
        deploymentId: "deployment_after_executor_fence",
        projectId: "project_after_executor_fence",
      });

      const postResumeFrontier = await bootstrapper.captureFrontier();
      await runBootstrapToCompletion(bootstrapper, postResumeFrontier);
      await expect(
        bootstrapper.verifyFrontier(postResumeFrontier),
      ).resolves.toEqual({
        status: "complete_through_frontier",
        frontier: postResumeFrontier,
        counts: {
          deployments: 2n,
          completePairs: 2n,
          missingScopes: 0n,
          missingClocks: 0n,
          locatorConflicts: 0n,
          orphanClocks: 0n,
        },
      });
    });
  });
});

async function runBootstrapToCompletion(
  bootstrapper: SharedScopeAuthorityBootstrapper,
  frontier: SharedScopeAuthorityBootstrapFrontier,
): Promise<void> {
  let after: { readonly deploymentId: string } | undefined;
  while (true) {
    const result = await bootstrapper.runBatch({
      frontier,
      ...(after === undefined ? {} : { after }),
      limit: 1,
    });
    if (result.status === "complete") return;
    after = result.nextAfter;
  }
}

async function authorityCounts(
  persistence: Parameters<
    Parameters<typeof withTemporaryPostgresExecutorPersistence>[0]
  >[0],
): Promise<{
  deployments: string;
  scopes: string;
  clocks: string;
  epochs: string;
  missingScopes: string;
  missingClocks: string;
}> {
  const result = await persistence.query<{
    deployments: string;
    scopes: string;
    clocks: string;
    epochs: string;
    missing_scopes: string;
    missing_clocks: string;
  }>(`
    select
      (select count(*)::text from deployments) as deployments,
      (select count(*)::text from fx_control_scope) as scopes,
      (select count(*)::text from fx_system_scope_clock) as clocks,
      (select count(distinct epoch)::text from fx_system_scope_clock) as epochs,
      (
        select count(*)::text
        from deployments d
        left join fx_control_scope s on s.deployment_id = d.deployment_id
        where s.id is null
      ) as missing_scopes,
      (
        select count(*)::text
        from fx_control_scope s
        left join fx_system_scope_clock c on c.scope_id = s.id
        where c.scope_id is null
      ) as missing_clocks
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Authority count query returned no row.");
  return {
    deployments: row.deployments,
    scopes: row.scopes,
    clocks: row.clocks,
    epochs: row.epochs,
    missingScopes: row.missing_scopes,
    missingClocks: row.missing_clocks,
  };
}
