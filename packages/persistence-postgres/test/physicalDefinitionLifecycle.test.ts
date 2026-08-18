import { Effect } from "effect";
import {
  canonicalAppUniqueConstraintSpecBytesHexV1ToBytes,
  appUniqueConstraintSpecSha256HexV1ToBytes,
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  appUniqueConstraintSetSha256HexV1ToBytes,
  canonicalizeAppUniqueConstraintSetV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
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
  PhysicalDefinitionLifecycleDefinitionNotRetireableError,
  PhysicalDefinitionLifecycleFaultError,
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  createPhysicalDefinitionLifecyclePort,
  finalizePhysicalDefinitionRetirementEffect,
  inspectPhysicalDefinitionLifecycleEffect,
  preparePhysicalDefinitionLifecycleReadinessEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
  validatePhysicalDefinitionLifecycleReadinessInTransactionEffect,
  type PreparedPhysicalDefinitionLifecycleSubject,
} from "../src/physicalDefinitionLifecycle";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { loadPublishedPhysicalRequirementSnapshotV1 } from
  "../src/indexBuildReconciliation";
import { loadAppUniqueConstraintSetEligibilityForReadinessV1Effect } from
  "../src/appUniqueConstraintSetBuildV1";
import { lockScopeClockForShareInTransactionEffect } from "../src/scopeClock";
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
    await expect(runEffectFailure(finalizePhysicalDefinitionRetirementEffect(
      prepared,
      { expectedTransitionFence: 3n },
    ))).resolves.toBeInstanceOf(
      PhysicalDefinitionLifecycleDefinitionNotRetireableError,
    );

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
    const uniqueSet = await canonicalizeAppUniqueConstraintSetV1([{
      logicalUniqueConstraintId: 9_001,
      uniqueConstraintDefinitionId,
      tableId: 1,
      physicalSpecSha256Hex: canonical.sha256Hex,
    }]);
    await fixture.control.query(
      `update fx_control_schema_unique_constraint_set
          set definition_count = 1,
              definition_set_sha256 = $3
        where deployment_id = $1
          and schema_version_id = $2`,
      [
        fixture.deploymentId,
        fixture.active.basis.schemaVersionId,
        appUniqueConstraintSetSha256HexV1ToBytes(uniqueSet.sha256Hex),
      ],
    );
    await fixture.target.query(
      `insert into fx_system_unique_constraint_set_build
         (scope_id, schema_version_id, set_codec_version, definition_count,
          definition_set_sha256, storage_generation,
          storage_generation_fence, epoch, start_commit_seq, lifecycle,
          cursor_codec_version, cursor_definition_id, cursor_row_id,
          attempt_fence)
       values ($1, $2, 1, 1, $3, 'flarexdb_v1', $4, $5, 0,
               'enabled', 1, null, null, 1)`,
      [
        fixture.authority.scopeId,
        fixture.active.basis.schemaVersionId,
        appUniqueConstraintSetSha256HexV1ToBytes(uniqueSet.sha256Hex),
        fixture.authority.storageGenerationFence,
        fixture.authority.epoch,
      ],
    );
    const uniqueEligibility = await runEffect(
      loadAppUniqueConstraintSetEligibilityForReadinessV1Effect(
        fixture.uniqueConstraintEligibility,
        Object.freeze({
          deploymentId: fixture.deploymentId,
          scopeId: fixture.authority.scopeId,
          schemaVersionId: fixture.active.basis.schemaVersionId,
        }),
      ),
    );
    if (uniqueEligibility.status !== "eligible") {
      throw new Error("Expected exact unique-set eligibility.");
    }
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
    await expect(runEffectFailure(finalizePhysicalDefinitionRetirementEffect(
      prepared,
      { expectedTransitionFence: 1n },
    ))).resolves.toMatchObject({
      _tag: "PhysicalDefinitionLifecyclePinnedError",
      pin: {
        owner: "active_application",
        schemaVersionId: fixture.active.basis.schemaVersionId,
      },
    });
    await fixture.target.query(
      `delete from fx_system_application_active_head_v1 where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expect(runEffectFailure(finalizePhysicalDefinitionRetirementEffect(
      prepared,
      { expectedTransitionFence: 1n },
    ))).resolves.toMatchObject({
      _tag: "PhysicalDefinitionLifecyclePinnedError",
      pin: {
        owner: "candidate_validation",
        schemaVersionId: fixture.active.basis.schemaVersionId,
      },
    });
    const requirements = await runEffect(
      loadPublishedPhysicalRequirementSnapshotV1(
        fixture.control.drizzle,
        Object.freeze({
          deploymentId: fixture.deploymentId,
          schemaVersionId: fixture.active.basis.schemaVersionId,
        }),
      ),
    );
    if (requirements === null) {
      throw new Error("Expected published physical requirements.");
    }
    const foreignControlFixture =
      await createApplicationNativeMutationPGliteFixture({
        runtimeHostIdentity: "flarex.test/m05-b2-foreign-control-runtime-host",
        compatibilityDate: "2026-08-18",
      });
    const foreignControlPort = createPhysicalDefinitionLifecyclePort({
      controlDb: foreignControlFixture.control.drizzle,
      authority: fixture.authorityPorts,
    });
    await expect(runEffectFailure(
      preparePhysicalDefinitionLifecycleReadinessEffect(
        foreignControlPort,
        fixture.authority.scopeId,
        requirements,
        uniqueEligibility,
      ),
    )).resolves.toMatchObject({ field: "requirementSnapshot" });
    await expect(runEffectFailure(
      preparePhysicalDefinitionLifecycleReadinessEffect(
        port,
        fixture.authority.scopeId,
        Object.freeze({ ...requirements }),
        uniqueEligibility,
      ),
    )).resolves.toMatchObject({ field: "requirementSnapshot" });
    // SAFETY: this deliberately constructs a structurally valid but unauthentic
    // evidence object to prove process-local issuer identity is required.
    const copiedEligibility = Object.freeze({
      status: "eligible" as const,
      evidence: Object.freeze({ ...uniqueEligibility.evidence }),
    }) as typeof uniqueEligibility;
    await expect(runEffectFailure(
      preparePhysicalDefinitionLifecycleReadinessEffect(
        port,
        fixture.authority.scopeId,
        requirements,
        copiedEligibility,
      ),
    )).resolves.toMatchObject({ field: "uniqueConstraintEligibility" });
    const readiness = await runEffect(
      preparePhysicalDefinitionLifecycleReadinessEffect(
        port,
        fixture.authority.scopeId,
        requirements,
        uniqueEligibility,
      ),
    );
    const eligibility = await fixture.target.drizzle.transaction(tx =>
      runEffect(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield*
          validatePhysicalDefinitionLifecycleReadinessInTransactionEffect(
            port,
            readiness,
            tx,
            fixture.active.basis.authority,
            clock,
          );
      })),
    );
    expect(eligibility).toEqual({
      status: "not_ready",
      definitionKind: "unique_constraint",
      definitionId: uniqueConstraintDefinitionId,
      lifecycle: "draining",
    });

    await fixture.target.query(
      `delete from fx_system_app_schema_candidate_validation where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await fixture.control.query(
      `insert into fx_control_schema_version
         (deployment_id, schema_version_id, version, manifest_codec_version,
          manifest_json, manifest_bytes, manifest_sha256)
       select deployment_id, 'schema_m05_b3_stale_binding', version + 1000,
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
       values ($1, 'schema_m05_b3_stale_binding', 9001, $2, true)`,
      [fixture.deploymentId, uniqueConstraintDefinitionId],
    );
    await expect(runEffectFailure(finalizePhysicalDefinitionRetirementEffect(
      prepared,
      { expectedTransitionFence: 1n },
    ))).resolves.toMatchObject({
      _tag: "PhysicalDefinitionLifecycleConflictError",
      reason: "storedStateInvalid",
    });
    await expect(runEffect(inspectPhysicalDefinitionLifecycleEffect(prepared)))
      .resolves.toMatchObject({
        status: "persisted",
        lifecycle: { lifecycle: "draining", transitionFence: 1n },
      });
    await fixture.control.query(
      `delete from fx_control_schema_version_unique_constraint_binding
        where deployment_id = $1
          and schema_version_id = 'schema_m05_b3_stale_binding'`,
      [fixture.deploymentId],
    );
    await fixture.control.query(
      `delete from fx_control_schema_version
        where deployment_id = $1
          and schema_version_id = 'schema_m05_b3_stale_binding'`,
      [fixture.deploymentId],
    );
    await expect(runEffect(finalizePhysicalDefinitionRetirementEffect(
      prepared,
      { expectedTransitionFence: 1n },
      { faultAfterWrite: () => { throw new Error("rollback M05-B3"); } },
    ))).rejects.toBeInstanceOf(PhysicalDefinitionLifecycleFaultError);
    await expect(runEffect(inspectPhysicalDefinitionLifecycleEffect(prepared)))
      .resolves.toMatchObject({
        status: "persisted",
        lifecycle: { lifecycle: "draining", transitionFence: 1n },
      });
    const originalControlTransaction =
      fixture.control.drizzle.transaction.bind(fixture.control.drizzle);
    const lostSettlementTransaction = <Value>(
      callback: (tx: FlarexMetadataTransaction) => Promise<Value>,
    ) => originalControlTransaction(callback).then(() => {
      throw new Error("lost M05-B3 control transaction response");
    });
    Reflect.set(
      fixture.control.drizzle,
      "transaction",
      lostSettlementTransaction,
    );
    try {
      await expect(runEffectFailure(finalizePhysicalDefinitionRetirementEffect(
        prepared,
        { expectedTransitionFence: 1n },
      ))).resolves.toMatchObject({
        _tag: "PhysicalDefinitionLifecycleTransactionError",
        disposition: "decisionUncertain",
      });
    } finally {
      Reflect.set(
        fixture.control.drizzle,
        "transaction",
        originalControlTransaction,
      );
    }
    await expect(runEffect(inspectPhysicalDefinitionLifecycleEffect(prepared)))
      .resolves.toMatchObject({
        status: "persisted",
        lifecycle: { lifecycle: "retired", transitionFence: 2n },
      });
    await fixture.control.query(
      `insert into fx_control_schema_version
         (deployment_id, schema_version_id, version, manifest_codec_version,
          manifest_json, manifest_bytes, manifest_sha256)
       select deployment_id, 'schema_m05_b3_stale_binding', version + 1000,
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
       values ($1, 'schema_m05_b3_stale_binding', 9001, $2, true)`,
      [fixture.deploymentId, uniqueConstraintDefinitionId],
    );
    await expect(runEffect(finalizePhysicalDefinitionRetirementEffect(
      prepared,
      { expectedTransitionFence: 1n },
    ))).resolves.toMatchObject({
      disposition: "replayed",
      lifecycle: { lifecycle: "retired", transitionFence: 2n },
    });
    await fixture.control.query(
      `delete from fx_control_schema_version_unique_constraint_binding
        where deployment_id = $1
          and schema_version_id = 'schema_m05_b3_stale_binding'`,
      [fixture.deploymentId],
    );
    await fixture.control.query(
      `delete from fx_control_schema_version
        where deployment_id = $1
          and schema_version_id = 'schema_m05_b3_stale_binding'`,
      [fixture.deploymentId],
    );

    const emptyUniqueSet = await canonicalizeAppUniqueConstraintSetV1([]);
    await fixture.control.query(
      `delete from fx_control_schema_version_unique_constraint_binding
        where deployment_id = $1
          and schema_version_id = $2`,
      [fixture.deploymentId, fixture.active.basis.schemaVersionId],
    );
    await fixture.control.query(
      `update fx_control_schema_unique_constraint_set
          set definition_count = 0,
              definition_set_sha256 = $3
        where deployment_id = $1
          and schema_version_id = $2`,
      [
        fixture.deploymentId,
        fixture.active.basis.schemaVersionId,
        appUniqueConstraintSetSha256HexV1ToBytes(emptyUniqueSet.sha256Hex),
      ],
    );
    await expect(runEffectFailure(
      preparePhysicalDefinitionLifecycleReadinessEffect(
        port,
        fixture.authority.scopeId,
        requirements,
        uniqueEligibility,
      ),
    )).resolves.toMatchObject({ field: "uniqueConstraintEligibility" });
  });
});
