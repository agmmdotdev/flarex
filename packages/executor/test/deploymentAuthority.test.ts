import { describe, expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import {
  executionArtifactRefForSourcePackage,
  type ArtifactSourcePackage,
} from "flarex/artifacts";
import type { SharedDatabaseScopePhysicalLocator } from "@flarex/persistence-postgres";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityBootstrapper,
  createPGliteSharedScopeAuthorityProvisioner,
  SharedScopeAuthorityConflictError,
  type SharedScopeAuthorityBootstrapFrontier,
  type SharedScopeAuthorityBootstrapper,
} from "@flarex/persistence-postgres/pglite";

import {
  createFlarexExecutor,
  withReadyDeploymentAuthority,
} from "../src";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "executor_test",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const uuids = {
  scopeA: "20000000-0000-4000-8000-000000000001",
  epochA: "20000000-0000-4000-8000-000000000002",
  scopeB: "20000000-0000-4000-8000-000000000003",
  epochB: "20000000-0000-4000-8000-000000000004",
  scopeC: "20000000-0000-4000-8000-000000000005",
  epochC: "20000000-0000-4000-8000-000000000006",
} as const;

describe("executor deployment authority composition", () => {
  it("creates only ready shared authority through every future deployment path", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const executorPersistence = withReadyDeploymentAuthority(
      persistence,
      createPGliteSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          uuids.scopeA,
          uuids.epochA,
          uuids.scopeB,
          uuids.epochB,
          uuids.scopeC,
          uuids.epochC,
        ),
      }),
    );
    const executor = createFlarexExecutor({ persistence: executorPersistence });

    expect("insertDeploymentMetadata" in executorPersistence).toBe(false);
    const projectedAuthority = await executorPersistence.ensureDeploymentAuthority({
      deploymentId: "deployment_authority_facade",
      projectId: "project_authority_facade",
    });
    expect(projectedAuthority).toEqual({
      createdDeployment: true,
      deployment: {
        deploymentId: "deployment_authority_facade",
        projectId: "project_authority_facade",
        activePackageId: null,
        activeSchemaVersion: 0,
        createdAt: expect.any(Date),
      },
    });
    await expect(
      executor.ensureDeployment({
        deploymentId: "deployment_authority_direct",
        projectId: "project_authority_direct",
      }),
    ).resolves.toMatchObject({
      created: true,
      deployment: { deploymentId: "deployment_authority_direct" },
    });
    await expect(
      executor.ensureDeployment({
        deploymentId: "deployment_authority_direct",
        projectId: "project_authority_direct",
      }),
    ).resolves.toMatchObject({ created: false });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_authority_package",
      projectId: "project_authority_package",
      sourcePackage: sourcePackage(),
    });
    expect(registered.createdDeployment).toBe(true);
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_authority_package",
      projectId: "project_authority_package",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    await expect(authorityRows(persistence)).resolves.toEqual({
      deployments: "3",
      scopes: "3",
      clocks: "3",
      missingScopes: "0",
      missingClocks: "0",
    });
    const directScope = await persistence.getScopeMetadataByDeploymentId(
      "deployment_authority_direct",
    );
    expect(directScope).toMatchObject({
      physicalLocator: sharedLocator,
    });
    if (directScope === null) {
      throw new Error("Direct deployment scope authority was not created.");
    }
    await expect(
      persistence.getScopeClock(directScope.scopeId),
    ).resolves.toMatchObject({
      storageGeneration: "legacy_v1",
      storageGenerationFence: 1n,
      lastCommitSeq: 0n,
      lastOutboxSeq: 0n,
      epoch: `epoch_${uuids.epochB}`,
    });
  });

  it("fails closed before package writes when an existing scope lost its clock", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_missing_clock",
      projectId: "project_missing_clock",
    });
    await persistence.insertScopeMetadata({
      scopeId: ScopeIdSchema.make(`scope_${uuids.scopeA}`),
      deploymentId: "deployment_missing_clock",
      physicalLocator: sharedLocator,
    });
    const executor = createFlarexExecutor({
      persistence: withReadyDeploymentAuthority(
        persistence,
        createPGliteSharedScopeAuthorityProvisioner(persistence, {
          physicalLocator: sharedLocator,
          randomUuid: () => {
            throw new Error("Existing scope authority must not be regenerated.");
          },
        }),
      ),
    });
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());

    await expect(
      executor.registerDeploymentPackage({
        deploymentId: "deployment_missing_clock",
        projectId: "project_missing_clock",
        sourcePackage: sourcePackage(),
      }),
    ).rejects.toMatchObject({
      name: SharedScopeAuthorityConflictError.name,
      conflict: { reason: "clockMissingForExistingScope" },
    });
    await expect(
      persistence.getDeploymentPackageMetadata(
        "deployment_missing_clock",
        ref.artifactId,
      ),
    ).resolves.toBeNull();
    await expect(
      persistence.getScopeClock(ScopeIdSchema.make(`scope_${uuids.scopeA}`)),
    ).resolves.toBeNull();
  });

  it("rolls back a new deployment when authority initialization fails", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const executor = createFlarexExecutor({
      persistence: withReadyDeploymentAuthority(
        persistence,
        createPGliteSharedScopeAuthorityProvisioner(persistence, {
          physicalLocator: sharedLocator,
          randomUuid: () => "not-a-uuid",
        }),
      ),
    });

    await expect(
      executor.ensureDeployment({
        deploymentId: "deployment_rolled_back",
        projectId: "project_rolled_back",
      }),
    ).rejects.toThrow("scopeId is not a lowercase RFC 4122 UUID v4");
    await expect(
      persistence.getDeploymentMetadata("deployment_rolled_back"),
    ).resolves.toBeNull();
    await expect(authorityRows(persistence)).resolves.toEqual({
      deployments: "0",
      scopes: "0",
      clocks: "0",
      missingScopes: "0",
      missingClocks: "0",
    });
  });

  it("keeps a fresh C2 parity frontier clean after the creation fence", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_before_fence",
      projectId: "project_before_fence",
    });
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    );
    const beforeFenceFrontier = await bootstrapper.captureFrontier();
    await runBootstrapToCompletion(bootstrapper, beforeFenceFrontier);
    await expect(
      bootstrapper.verifyFrontier(beforeFenceFrontier),
    ).resolves.toMatchObject({ status: "complete_through_frontier" });

    const executor = createFlarexExecutor({
      persistence: withReadyDeploymentAuthority(
        persistence,
        createPGliteSharedScopeAuthorityProvisioner(persistence, {
          physicalLocator: sharedLocator,
          randomUuid: uuidSequence(uuids.scopeB, uuids.epochB),
        }),
      ),
    });
    const cutoverFrontier = await bootstrapper.captureFrontier();
    await runBootstrapToCompletion(bootstrapper, cutoverFrontier);
    await expect(
      bootstrapper.verifyFrontier(cutoverFrontier),
    ).resolves.toMatchObject({ status: "complete_through_frontier" });

    await executor.ensureDeployment({
      deploymentId: "deployment_after_fence",
      projectId: "project_after_fence",
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

async function authorityRows(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
): Promise<{
  deployments: string;
  scopes: string;
  clocks: string;
  missingScopes: string;
  missingClocks: string;
}> {
  const result = await persistence.query<{
    deployments: string;
    scopes: string;
    clocks: string;
    missing_scopes: string;
    missing_clocks: string;
  }>(`
    select
      (select count(*)::text from deployments) as deployments,
      (select count(*)::text from fx_control_scope) as scopes,
      (select count(*)::text from fx_system_scope_clock) as clocks,
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
    missingScopes: row.missing_scopes,
    missingClocks: row.missing_clocks,
  };
}

function sourcePackage(): ArtifactSourcePackage {
  return {
    modules: [
      {
        path: "functions.js",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
    ],
    functions: [],
    execution: "_flarex/execution.js",
  };
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("UUID sequence exhausted.");
    }
    return value;
  };
}
