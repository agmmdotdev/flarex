import { Effect } from "effect";
import {
  canonicalAppUniqueConstraintSpecBytesHexV1ToBytes,
  appUniqueConstraintSpecSha256HexV1ToBytes,
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  decodeAppIndexPhysicalSpecSha256HexV1,
} from "flarex-protocol/index-definition";
import { describe, expect, it } from "vitest";

import {
  InvalidPreparedPhysicalDefinitionLifecycleSubjectError,
  PhysicalDefinitionLifecycleConflictError,
  PhysicalDefinitionLifecycleFaultError,
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  createPhysicalDefinitionLifecyclePort,
  inspectPhysicalDefinitionLifecycleEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
  type PreparedPhysicalDefinitionLifecycleSubject,
} from "../src/physicalDefinitionLifecycle";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("M05-B1 physical-definition lifecycle", { timeout: 180_000 }, () => {
  it("fences draining, exact replay, cancellation, rollback, and corruption", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-b1-runtime-host",
      compatibilityDate: "2026-08-18",
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
    const port = createPhysicalDefinitionLifecyclePort({
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
    });
    const prepared = await runEffect(
      preparePhysicalDefinitionLifecycleSubjectEffect(port, {
        definitionKind: "index",
        deploymentId: fixture.deploymentId,
        indexDefinitionId,
      }),
    );

    await expect(runEffect(inspectPhysicalDefinitionLifecycleEffect(prepared)))
      .resolves.toEqual({ status: "implicitActive" });
    const draining = await runEffect(beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 0n },
    ));
    expect(draining).toMatchObject({
      disposition: "created",
      lifecycle: { lifecycle: "draining", transitionFence: 1n },
    });
    await expect(runEffect(beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 0n },
    ))).resolves.toMatchObject({
      disposition: "replayed",
      lifecycle: { lifecycle: "draining", transitionFence: 1n },
    });
    await expect(runEffectFailure(beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 1n },
    ))).resolves.toBeInstanceOf(PhysicalDefinitionLifecycleConflictError);

    await expect(runEffect(cancelPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 1n },
      { faultAfterWrite: () => { throw new Error("rollback M05-B1"); } },
    ))).rejects.toBeInstanceOf(PhysicalDefinitionLifecycleFaultError);
    await expect(runEffect(inspectPhysicalDefinitionLifecycleEffect(prepared)))
      .resolves.toMatchObject({
        status: "persisted",
        lifecycle: { lifecycle: "draining", transitionFence: 1n },
      });

    const active = await runEffect(cancelPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 1n },
    ));
    expect(active).toMatchObject({
      disposition: "transitioned",
      lifecycle: { lifecycle: "active", transitionFence: 2n },
    });
    const concurrent = await Promise.all([
      runEffect(beginPhysicalDefinitionDrainingEffect(
        prepared,
        { expectedTransitionFence: 2n },
      )),
      runEffect(beginPhysicalDefinitionDrainingEffect(
        prepared,
        { expectedTransitionFence: 2n },
      )),
    ]);
    expect(concurrent.map(result => result.disposition).sort()).toEqual([
      "replayed",
      "transitioned",
    ]);
    expect(concurrent.every(result =>
      result.lifecycle.lifecycle === "draining" &&
      result.lifecycle.transitionFence === 3n
    )).toBe(true);
    const persisted = concurrent[0]!.lifecycle;

    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set physical_spec_sha256 = $3
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId, new Uint8Array(32)],
    );
    await expect(runEffectFailure(inspectPhysicalDefinitionLifecycleEffect(
      prepared,
    ))).resolves.toMatchObject({ reason: "storedStateInvalid" });
    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set physical_spec_sha256 = $3
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [
        fixture.authority.scopeId,
        indexDefinitionId,
        appIndexPhysicalSpecSha256HexV1ToBytes(
          decodeAppIndexPhysicalSpecSha256HexV1(
            persisted.physicalSpecSha256Hex,
          ),
        ),
      ],
    );

    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set storage_generation_fence = storage_generation_fence + 1
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId],
    );
    await expect(runEffectFailure(inspectPhysicalDefinitionLifecycleEffect(
      prepared,
    ))).resolves.toMatchObject({ reason: "storedStateInvalid" });
    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set storage_generation_fence = $3
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [
        fixture.authority.scopeId,
        indexDefinitionId,
        fixture.authority.storageGenerationFence,
      ],
    );

    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set epoch = 'epoch_corrupt'
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId],
    );
    await expect(runEffectFailure(inspectPhysicalDefinitionLifecycleEffect(
      prepared,
    ))).resolves.toMatchObject({ reason: "storedStateInvalid" });
    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set epoch = $3
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId, fixture.authority.epoch],
    );

    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set lifecycle = 'active'
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId],
    );
    await expect(runEffectFailure(beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 2n },
    ))).resolves.toMatchObject({ reason: "storedStateInvalid" });
    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set lifecycle = 'draining', transition_fence = 4
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId],
    );
    await expect(runEffectFailure(beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 2n },
    ))).resolves.toMatchObject({ reason: "storedStateInvalid" });
    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set transition_fence = 3
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId],
    );

    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set deployment_id = 'corrupt-deployment'
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId],
    );
    await expect(runEffectFailure(inspectPhysicalDefinitionLifecycleEffect(
      prepared,
    ))).resolves.toBeInstanceOf(PhysicalDefinitionLifecycleConflictError);
    await fixture.target.query(
      `update fx_system_physical_definition_lifecycle
          set deployment_id = $3
        where scope_id = $1
          and definition_kind = 'index'
          and definition_id = $2`,
      [fixture.authority.scopeId, indexDefinitionId, fixture.deploymentId],
    );

    const forged = Object.freeze({}) as PreparedPhysicalDefinitionLifecycleSubject;
    await expect(runEffectFailure(inspectPhysicalDefinitionLifecycleEffect(forged)))
      .resolves.toBeInstanceOf(
        InvalidPreparedPhysicalDefinitionLifecycleSubjectError,
      );
  });

  it("authenticates a unique-constraint definition and its current binding", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-b1-unique-runtime-host",
      compatibilityDate: "2026-08-18",
    });
    const uniqueConstraintDefinitionId =
      decodeCatalogUniqueConstraintDefinitionId(9_001);
    const canonical = await canonicalizeAppUniqueConstraintPhysicalSpecV1({
      kind: "appUniqueConstraint",
      specVersion: 1,
      orderedFields: ["name"],
      sparse: false,
      localePolicy: { kind: "none" },
      keyCodecIdentity: "flarex.unique-key/ordered-index-components/v1",
      keyCodecVersion: 1,
    });
    await fixture.control.query(
      `insert into fx_control_unique_constraint
         (deployment_id, logical_unique_constraint_id, table_id, descriptor)
       values ($1, 9001, 1, 'unique_name')`,
      [fixture.deploymentId],
    );
    await fixture.control.query(
      `insert into fx_control_unique_constraint_definition
         (deployment_id, unique_constraint_definition_id,
          logical_unique_constraint_id, table_id,
          physical_spec_codec_version, physical_spec_json,
          physical_spec_bytes, physical_spec_sha256)
       values ($1, $2, 9001, 1, 1, $3::jsonb, $4, $5)`,
      [
        fixture.deploymentId,
        uniqueConstraintDefinitionId,
        JSON.stringify(canonical.physicalSpec),
        canonicalAppUniqueConstraintSpecBytesHexV1ToBytes(
          canonical.canonicalBytesHex,
        ),
        appUniqueConstraintSpecSha256HexV1ToBytes(canonical.sha256Hex),
      ],
    );
    await fixture.control.query(
      `insert into fx_control_schema_version_unique_constraint_binding
         (deployment_id, schema_version_id, logical_unique_constraint_id,
          unique_constraint_definition_id, required_for_activation)
       values ($1, $3, 9001, $2, true)`,
      [
        fixture.deploymentId,
        uniqueConstraintDefinitionId,
        fixture.active.basis.schemaVersionId,
      ],
    );
    const port = createPhysicalDefinitionLifecyclePort({
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
    });
    const prepared = await runEffect(
      preparePhysicalDefinitionLifecycleSubjectEffect(port, {
        definitionKind: "unique_constraint",
        deploymentId: fixture.deploymentId,
        uniqueConstraintDefinitionId,
      }),
    );
    await expect(runEffect(beginPhysicalDefinitionDrainingEffect(
      prepared,
      { expectedTransitionFence: 0n },
    ))).resolves.toMatchObject({
      disposition: "created",
      lifecycle: {
        definitionKind: "unique_constraint",
        definitionId: uniqueConstraintDefinitionId,
        lifecycle: "draining",
      },
    });
  });
});
