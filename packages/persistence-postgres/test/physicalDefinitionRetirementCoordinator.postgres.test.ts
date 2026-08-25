import { decodeCatalogUniqueConstraintDefinitionId } from
  "flarex-protocol/catalog";
import { describe, expect, it } from "vitest";

import { createPhysicalDefinitionLifecyclePort } from
  "../src/physicalDefinitionLifecycle";
import { runPhysicalDefinitionRetirementStepEffect } from
  "../src/physicalDefinitionRetirementCoordinator";
import { runEffect } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPostgresFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import { installRetireableUniqueConstraintDefinition } from
  "./physicalDefinitionRetirementCoordinatorSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres(
  "M05-B4 physical-definition retirement coordinator - PostgreSQL",
  { timeout: 480_000 },
  () => {
    it("rechecks pins and exact replay through fresh manual invocations", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const fixture = await createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: "flarex.test/m05-b4-postgres-runtime-host",
          compatibilityDate: "2026-08-22",
        }, { control, target });
        const logicalUniqueConstraintId = 9_202;
        const uniqueConstraintDefinitionId =
          decodeCatalogUniqueConstraintDefinitionId(9_202);
        await installRetireableUniqueConstraintDefinition(control, {
          deploymentId: fixture.deploymentId,
          schemaVersionId: fixture.active.basis.schemaVersionId,
          logicalUniqueConstraintId,
          uniqueConstraintDefinitionId,
        });
        const subject = Object.freeze({
          definitionKind: "unique_constraint" as const,
          deploymentId: fixture.deploymentId,
          uniqueConstraintDefinitionId,
        });
        const runColdStep = () => runEffect(
          runPhysicalDefinitionRetirementStepEffect(
            createPhysicalDefinitionLifecyclePort({
              controlDb: control.drizzle,
              authority: fixture.authorityPorts,
            }),
            subject,
          ),
        );

        await expect(runColdStep()).resolves.toMatchObject({
          status: "draining",
          disposition: "created",
          lifecycle: { lifecycle: "draining", transitionFence: 1n },
        });
        await expect(runColdStep()).resolves.toMatchObject({
          status: "waiting",
          reason: "pinned",
          pin: { owner: "active_application" },
        });
        await target.query(
          `delete from fx_system_application_active_head where scope_id = $1`,
          [fixture.authority.scopeId],
        );
        await expect(runColdStep()).resolves.toMatchObject({
          status: "waiting",
          reason: "pinned",
          pin: { owner: "candidate_validation" },
        });
        await target.query(
          `delete from fx_system_app_schema_candidate_validation
            where scope_id = $1`,
          [fixture.authority.scopeId],
        );
        await expect(runColdStep()).resolves.toMatchObject({
          status: "retired",
          disposition: "transitioned",
          lifecycle: { lifecycle: "retired", transitionFence: 2n },
        });
        await expect(runColdStep()).resolves.toMatchObject({
          status: "retired",
          disposition: "replayed",
          lifecycle: { lifecycle: "retired", transitionFence: 2n },
        });
      });
    });
  },
);
