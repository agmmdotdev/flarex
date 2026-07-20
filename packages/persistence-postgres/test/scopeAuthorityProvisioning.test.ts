import { eq } from "drizzle-orm";
import { Result } from "effect";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeEpoch,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type FlarexPersistence,
  ScopeClockCorruptionError,
  type SharedDatabaseScopePhysicalLocator,
} from "../src";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  InvalidGeneratedScopeAuthorityIdError,
  ScopeAuthorityIdGenerationExhaustedError,
  UnsupportedScopeAuthorityProvisioningTopologyError,
  type EnsureSharedScopeAuthorityInput,
  type SharedScopeAuthorityProvisionerOptions,
} from "../src/pglite";
import {
  generateScopeAuthorityEpochResult,
} from "../src/scopeAuthorityIds";
import { fxSystemScopeClocks } from "../src/schema";

const sharedLocator = {
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies SharedDatabaseScopePhysicalLocator;

const uuids = {
  scopeA: "00000000-0000-4000-8000-000000000001",
  epochA: "00000000-0000-4000-8000-000000000002",
  scopeB: "00000000-0000-4000-8000-000000000003",
  epochB: "00000000-0000-4000-8000-000000000004",
  collision: "00000000-0000-4000-8000-000000000005",
} as const;

type ForbiddenEnsureInputField = Extract<
  keyof EnsureSharedScopeAuthorityInput,
  | "scopeId"
  | "epoch"
  | "storageGeneration"
  | "storageGenerationFence"
  | "lastCommitSeq"
  | "lastOutboxSeq"
>;

type ForbiddenRootProvisioningMethod = Extract<
  keyof FlarexPersistence,
  | "ensureScopeAuthority"
  | "ensureSharedScopeAuthority"
  | "insertScopeClock"
  | "provisionScopeAuthority"
>;

describe("shared scope authority provisioning", () => {
  it("keeps generated authority and mutation facts outside per-call input", () => {
    expectTypeOf<ForbiddenEnsureInputField>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenRootProvisioningMethod>().toEqualTypeOf<never>();
    expectTypeOf<SharedScopeAuthorityProvisionerOptions["physicalLocator"]>()
      .toEqualTypeOf<SharedDatabaseScopePhysicalLocator>();
  });

  it("keeps invalid epoch generation typed without catching generator defects", () => {
    const generated = generateScopeAuthorityEpochResult(() => uuids.epochA);
    expectTypeOf(generated).toEqualTypeOf<Result.Result<
      ScopeEpoch,
      InvalidGeneratedScopeAuthorityIdError
    >>();
    expect(Result.getOrThrow(generated)).toBe(`epoch_${uuids.epochA}`);

    const invalid = generateScopeAuthorityEpochResult(() => "not-a-uuid");
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toMatchObject({
        _tag: "InvalidGeneratedScopeAuthorityIdError",
        field: "epoch",
        value: "not-a-uuid",
      });
    }

    const defect = new Error("scope authority UUID generator defect");
    expect(() => generateScopeAuthorityEpochResult(() => {
      throw defect;
    })).toThrow(defect);
  });

  it("creates a deployment, locator, and explicit legacy clock atomically", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    );

    const result = await provisioner.ensure({
      deploymentId: "deployment_provision_fresh",
      projectId: "project_provision_fresh",
    });

    expect(result).toMatchObject({
      status: "created",
      createdDeployment: true,
      deployment: {
        deploymentId: "deployment_provision_fresh",
        projectId: "project_provision_fresh",
        activePackageId: null,
        activeSchemaVersion: 0,
      },
      scope: {
        scopeId: `scope_${uuids.scopeA}`,
        deploymentId: "deployment_provision_fresh",
        activeSchemaVersionId: null,
        physicalLocator: sharedLocator,
      },
      clock: {
        scopeId: `scope_${uuids.scopeA}`,
        storageGeneration: "legacy_v1",
        storageGenerationFence: 1n,
        lastCommitSeq: 0n,
        lastOutboxSeq: 0n,
        epoch: `epoch_${uuids.epochA}`,
      },
    });
    expect(result.deployment.createdAt).toBeInstanceOf(Date);
    expect(result.scope.createdAt).toBeInstanceOf(Date);
    expect(result.clock.updatedAt).toBeInstanceOf(Date);
    await expect(authorityCounts(persistence)).resolves.toEqual({
      deployments: "1",
      scopes: "1",
      clocks: "1",
    });
  });

  it("adds both authority rows to an existing deployment", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_existing",
      projectId: "project_existing",
    });
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    );

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_existing",
        projectId: "project_existing",
      }),
    ).resolves.toMatchObject({
      status: "created_scope_and_clock",
      createdDeployment: false,
      scope: { scopeId: `scope_${uuids.scopeA}` },
      clock: { epoch: `epoch_${uuids.epochA}` },
    });
  });

  it("fails closed when an existing locator is missing its clock", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make(`scope_${uuids.scopeA}`);
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_missing_clock",
      projectId: "project_missing_clock",
    });
    await persistence.insertScopeMetadata({
      scopeId,
      deploymentId: "deployment_missing_clock",
      physicalLocator: sharedLocator,
    });
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => {
          throw new Error("Normal provisioning must not repair a missing clock.");
        },
      },
    );

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_missing_clock",
        projectId: "project_missing_clock",
      }),
    ).rejects.toMatchObject({
      name: "SharedScopeAuthorityConflictError",
      conflict: {
        reason: "clockMissingForExistingScope",
        scopeId,
      },
    });
    await expect(persistence.getScopeClock(scopeId)).resolves.toBeNull();
  });

  it("returns existing authority without consuming IDs or resetting an advanced clock", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const firstProvisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    );
    const input = {
      deploymentId: "deployment_retry",
      projectId: "project_retry",
    } satisfies EnsureSharedScopeAuthorityInput;
    const first = await firstProvisioner.ensure(input);
    const advancedAt = new Date("2026-07-12T00:00:00.000Z");
    await persistence.drizzle
      .update(fxSystemScopeClocks)
      .set({
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(7n),
        lastCommitSeq: CommitSeqSchema.make(11n),
        lastOutboxSeq: OutboxSeqSchema.make(13n),
        epoch: ScopeEpochSchema.make("epoch_advanced"),
        updatedAt: advancedAt,
      })
      .where(eq(fxSystemScopeClocks.scopeId, first.scope.scopeId));
    const retryProvisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => {
          throw new Error("An idempotent retry must not generate new IDs.");
        },
      },
    );

    const retried = await retryProvisioner.ensure(input);

    expect(retried).toMatchObject({
      status: "already_provisioned",
      createdDeployment: false,
      scope: { scopeId: first.scope.scopeId },
      clock: {
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: 7n,
        lastCommitSeq: 11n,
        lastOutboxSeq: 13n,
        epoch: "epoch_advanced",
        updatedAt: advancedAt,
      },
    });
  });

  it("projects typed stored-clock corruption only at the transaction owner", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const input = {
      deploymentId: "deployment_corrupt_clock",
      projectId: "project_corrupt_clock",
    } satisfies EnsureSharedScopeAuthorityInput;
    const created = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    ).ensure(input);
    await persistence.exec(`
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_storage_generation_check
    `);
    await persistence.query(
      `
        update fx_system_scope_clock
        set storage_generation = 'corrupt_generation'
        where scope_id = $1
      `,
      [created.scope.scopeId],
    );
    const retry = createPGliteSharedScopeAuthorityProvisioner(persistence, {
      physicalLocator: sharedLocator,
      randomUuid: () => {
        throw new Error("Corrupt stored authority must not generate IDs.");
      },
    });

    await expect(retry.ensure(input)).rejects.toBeInstanceOf(
      ScopeClockCorruptionError,
    );
  });

  it("rejects project and immutable locator conflicts without changing authority", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    );
    const created = await provisioner.ensure({
      deploymentId: "deployment_conflict",
      projectId: "project_conflict",
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_conflict",
        projectId: "project_other",
      }),
    ).rejects.toMatchObject({
      name: "SharedScopeAuthorityConflictError",
      conflict: { reason: "projectMismatch" },
    });
    const conflictingLocator = {
      ...sharedLocator,
      databaseKey: "secondary",
    } satisfies SharedDatabaseScopePhysicalLocator;
    const conflictingProvisioner =
      createPGliteSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: conflictingLocator,
        randomUuid: () => {
          throw new Error("A locator conflict must not generate IDs.");
        },
      });
    await expect(
      conflictingProvisioner.ensure({
        deploymentId: "deployment_conflict",
        projectId: "project_conflict",
      }),
    ).rejects.toMatchObject({
      name: "SharedScopeAuthorityConflictError",
      conflict: { reason: "physicalLocatorMismatch" },
    });
    await expect(
      persistence.getScopeClock(created.scope.scopeId),
    ).resolves.toEqual(created.clock);
  });

  it("skips scope and orphan-clock collisions before publishing a locator", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const collisionScopeId = ScopeIdSchema.make(`scope_${uuids.collision}`);
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_collision_owner",
      projectId: "project_collision_owner",
    });
    await persistence.insertScopeMetadata({
      scopeId: collisionScopeId,
      deploymentId: "deployment_collision_owner",
      physicalLocator: sharedLocator,
    });
    await persistence.query(
      `
        insert into fx_system_scope_clock (
          scope_id,
          storage_generation,
          epoch
        ) values ($1, 'legacy_v1', $2)
      `,
      [
        ScopeIdSchema.make(`scope_${uuids.scopeB}`),
        ScopeEpochSchema.make(`epoch_${uuids.epochB}`),
      ],
    );
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          uuids.collision,
          uuids.scopeB,
          uuids.scopeA,
          uuids.epochA,
        ),
      },
    );

    const result = await provisioner.ensure({
      deploymentId: "deployment_after_collisions",
      projectId: "project_after_collisions",
    });

    expect(result.scope.scopeId).toBe(`scope_${uuids.scopeA}`);
    expect(result.clock.epoch).toBe(`epoch_${uuids.epochA}`);
  });

  it("rolls back deployment and locator when generated epoch validation fails", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, "not-a-uuid"),
      },
    );

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_rollback",
        projectId: "project_rollback",
      }),
    ).rejects.toMatchObject({
      name: "InvalidGeneratedScopeAuthorityIdError",
      field: "epoch",
    });
    await expect(authorityCounts(persistence)).resolves.toEqual({
      deployments: "0",
      scopes: "0",
      clocks: "0",
    });
  });

  it("fails after bounded scope-ID collisions and rolls back a fresh deployment", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const collisionScopeId = ScopeIdSchema.make(`scope_${uuids.collision}`);
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_exhaustion_owner",
      projectId: "project_exhaustion_owner",
    });
    await persistence.insertScopeMetadata({
      scopeId: collisionScopeId,
      deploymentId: "deployment_exhaustion_owner",
      physicalLocator: sharedLocator,
    });
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => uuids.collision,
      },
    );

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_exhausted",
        projectId: "project_exhausted",
      }),
    ).rejects.toBeInstanceOf(ScopeAuthorityIdGenerationExhaustedError);
    await expect(
      persistence.getDeploymentMetadata("deployment_exhausted"),
    ).resolves.toBeNull();
  });

  it("generates production-format scope and epoch IDs by default", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator: sharedLocator },
    );

    const result = await provisioner.ensure({
      deploymentId: "deployment_generated_ids",
      projectId: "project_generated_ids",
    });

    expect(result.scope.scopeId).toMatch(
      /^scope_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.clock.epoch).toMatch(
      /^epoch_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("captures the trusted locator when the provisioner is constructed", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const configuredLocator = {
      kind: "shared_database",
      databaseKey: "primary",
      schemaName: "public",
    } satisfies SharedDatabaseScopePhysicalLocator;
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: configuredLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    );
    configuredLocator.databaseKey = "mutated-after-construction";

    const result = await provisioner.ensure({
      deploymentId: "deployment_captured_locator",
      projectId: "project_captured_locator",
    });

    expect(result.scope.physicalLocator).toEqual(sharedLocator);
  });

  it("rejects invalid locators and unsupported topologies before writes", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    expect(() =>
      createPGliteSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: { ...sharedLocator, databaseKey: "\t" },
      }),
    ).toThrow();
    expect(() =>
      Reflect.apply(createPGliteSharedScopeAuthorityProvisioner, undefined, [
        persistence,
        {
          physicalLocator: {
            kind: "database_per_scope",
            databaseKey: "other",
            schemaName: "public",
          },
        },
      ]),
    ).toThrow(UnsupportedScopeAuthorityProvisioningTopologyError);
    await expect(authorityCounts(persistence)).resolves.toEqual({
      deployments: "0",
      scopes: "0",
      clocks: "0",
    });
  });

  it("reports invalid generated scope IDs as typed errors", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => "NOT-A-LOWERCASE-UUID",
      },
    );

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_bad_scope_id",
        projectId: "project_bad_scope_id",
      }),
    ).rejects.toBeInstanceOf(InvalidGeneratedScopeAuthorityIdError);
  });
});

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("UUID test sequence was exhausted.");
    }
    index += 1;
    return value;
  };
}

async function authorityCounts(
  persistence: Pick<FlarexPersistence, "query">,
): Promise<{
  readonly deployments: string;
  readonly scopes: string;
  readonly clocks: string;
}> {
  const result = await persistence.query<{
    deployments: string;
    scopes: string;
    clocks: string;
  }>(`
    select
      (select count(*)::text from deployments) as deployments,
      (select count(*)::text from fx_control_scope) as scopes,
      (select count(*)::text from fx_system_scope_clock) as clocks
  `);
  const counts = result.rows[0];
  if (counts === undefined) {
    throw new Error("Authority count query returned no row.");
  }
  return counts;
}
