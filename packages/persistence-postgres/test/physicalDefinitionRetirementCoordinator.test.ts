import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogUniqueConstraintDefinitionId,
} from
  "flarex-protocol/catalog";
import { describe, expect, it } from "vitest";

import {
  PhysicalDefinitionLifecycleConflictError,
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  createPhysicalDefinitionLifecyclePort,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../src/physicalDefinitionLifecycle";
import { runPhysicalDefinitionRetirementStepEffect } from
  "../src/physicalDefinitionRetirementCoordinator";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import { installRetireableUniqueConstraintDefinition } from
  "./physicalDefinitionRetirementCoordinatorSupport";

describe("M05-B4 physical-definition retirement coordinator", {
  timeout: 180_000,
}, () => {
  it("takes one manual step and cold-replays authority before finalization", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-b4-runtime-host",
      compatibilityDate: "2026-08-22",
    });
    const logicalUniqueConstraintId = 9_201;
    const uniqueConstraintDefinitionId =
      decodeCatalogUniqueConstraintDefinitionId(9_201);
    await installRetireableUniqueConstraintDefinition(fixture.control, {
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
          controlDb: fixture.control.drizzle,
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

    await fixture.control.query(
      `insert into fx_control_schema_version
         (deployment_id, schema_version_id, version, manifest_codec_version,
          manifest_json, manifest_bytes, manifest_sha256)
       select deployment_id, 'schema_m05_b4_drift', version + 1000,
              manifest_codec_version, manifest_json, manifest_bytes,
              manifest_sha256
         from fx_control_schema_version
        where deployment_id = $1 and schema_version_id = $2`,
      [fixture.deploymentId, fixture.active.basis.schemaVersionId],
    );
    await fixture.control.query(
      `insert into fx_control_schema_version_unique_constraint_binding
         (deployment_id, schema_version_id, logical_unique_constraint_id,
          unique_constraint_definition_id, required_for_activation)
       values ($1, 'schema_m05_b4_drift', $2, $3, true)`,
      [
        fixture.deploymentId,
        logicalUniqueConstraintId,
        uniqueConstraintDefinitionId,
      ],
    );
    await expect(runEffectFailure(
      runPhysicalDefinitionRetirementStepEffect(
        createPhysicalDefinitionLifecyclePort({
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
        }),
        subject,
      ),
    )).resolves.toBeInstanceOf(PhysicalDefinitionLifecycleConflictError);
    await fixture.control.query(
      `delete from fx_control_schema_version_unique_constraint_binding
        where deployment_id = $1
          and schema_version_id = 'schema_m05_b4_drift'`,
      [fixture.deploymentId],
    );
    await expect(runColdStep()).resolves.toMatchObject({
      status: "waiting",
      reason: "pinned",
      pin: { owner: "active_application" },
      lifecycle: { lifecycle: "draining", transitionFence: 1n },
    });
    await fixture.target.query(
      `delete from fx_system_application_active_head where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expect(runColdStep()).resolves.toMatchObject({
      status: "waiting",
      reason: "pinned",
      pin: { owner: "candidate_validation" },
      lifecycle: { lifecycle: "draining", transitionFence: 1n },
    });
    await fixture.target.query(
      `delete from fx_system_app_schema_candidate_validation
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expect(runColdStep()).resolves.toMatchObject({
      status: "retired",
      disposition: "transitioned",
      lifecycle: { lifecycle: "retired", transitionFence: 2n },
    });
    await fixture.control.query(
      `insert into fx_control_schema_version_unique_constraint_binding
         (deployment_id, schema_version_id, logical_unique_constraint_id,
          unique_constraint_definition_id, required_for_activation)
       values ($1, 'schema_m05_b4_drift', $2, $3, true)`,
      [
        fixture.deploymentId,
        logicalUniqueConstraintId,
        uniqueConstraintDefinitionId,
      ],
    );
    await expect(runEffectFailure(
      runPhysicalDefinitionRetirementStepEffect(
        createPhysicalDefinitionLifecyclePort({
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
        }),
        subject,
      ),
    )).resolves.toBeInstanceOf(PhysicalDefinitionLifecycleConflictError);
    await fixture.control.query(
      `delete from fx_control_schema_version_unique_constraint_binding
        where deployment_id = $1
          and schema_version_id = 'schema_m05_b4_drift'`,
      [fixture.deploymentId],
    );
    await expect(runColdStep()).resolves.toMatchObject({
      status: "retired",
      disposition: "replayed",
      lifecycle: { lifecycle: "retired", transitionFence: 2n },
    });
  });

  it("begins a new draining step from persisted active state", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-b4-persisted-active-runtime-host",
      compatibilityDate: "2026-08-22",
    });
    const definition = await fixture.control.query<{
      index_definition_id: number;
    }>(
      `select index_definition_id
         from fx_control_index_definition
        where deployment_id = $1
        order by index_definition_id
        limit 1`,
      [fixture.deploymentId],
    );
    const indexDefinitionId = decodeCatalogIndexDefinitionId(
      definition.rows[0]?.index_definition_id,
    );
    const subject = Object.freeze({
      definitionKind: "index" as const,
      deploymentId: fixture.deploymentId,
      indexDefinitionId,
    });
    const initialPort = createPhysicalDefinitionLifecyclePort({
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
    });
    const prepared = await runEffect(
      preparePhysicalDefinitionLifecycleSubjectEffect(initialPort, subject),
    );
    await runEffect(beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 0n },
    ));
    await runEffect(cancelPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 1n },
    ));

    await expect(runEffect(runPhysicalDefinitionRetirementStepEffect(
      createPhysicalDefinitionLifecyclePort({
        controlDb: fixture.control.drizzle,
        authority: fixture.authorityPorts,
      }),
      subject,
    ))).resolves.toMatchObject({
      status: "draining",
      disposition: "transitioned",
      lifecycle: { lifecycle: "draining", transitionFence: 3n },
    });
  });
});
