import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../src/appUniqueConstraintCommitV1";
import {
  AppUniqueConstraintSetBuildReclamationError,
  MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
  advanceAppUniqueConstraintSetBackfillV1Effect,
  createAppUniqueConstraintSetEligibilityPortV1,
  installAppSchemaCandidateWithWorkspaceReclamationEffect,
  reclaimSupersededAppUniqueConstraintSetBuildEffect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../src/transactionSessionAttemptKernel";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../src/transactionSessionActivation";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("M05-A unique-set build workspace reclamation", { timeout: 180_000 }, () => {
  it("atomically reclaims the exact candidate displaced by private installation", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a2-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const port = fixture.uniqueConstraintEligibility;
    const activeSchemaVersionId = fixture.active.basis.schemaVersionId;
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, activeSchemaVersionId),
    ));

    const candidateA = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateA"),
    );
    await closeEmptySet(fixture, candidateA.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        port,
        fixture.candidateValidation,
        buildInput(fixture, candidateA.schemaVersionId),
      ),
    )).resolves.toMatchObject({
      installation: { disposition: "superseded" },
      workspace: {
        disposition: "retained",
        reason: "activeSchema",
        schemaVersionId: activeSchemaVersionId,
      },
    });

    const candidateB = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateB"),
    );
    const replaced = await runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        port,
        fixture.candidateValidation,
        buildInput(fixture, candidateB.schemaVersionId),
      ),
    );
    expect(replaced).toMatchObject({
      installation: { disposition: "superseded" },
      workspace: {
        disposition: "deleted",
        schemaVersionId: candidateA.schemaVersionId,
      },
    });
    await expectBuildPresence(fixture, candidateA.schemaVersionId, false);

    await closeEmptySet(fixture, candidateB.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidateB.schemaVersionId),
    ));
    const candidateC = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateC"),
    );
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        port,
        fixture.candidateValidation,
        buildInput(fixture, candidateC.schemaVersionId),
        {
          candidateValidation: {
            faultAfter: point => {
              if (point === "afterInstallWrite") {
                throw new Error("rollback M05-A2 after candidate install");
              }
            },
          },
        },
      ),
    )).rejects.toBeDefined();
    await expectBuildPresence(fixture, candidateB.schemaVersionId, true);
    await expectCurrentCandidate(fixture, candidateB.schemaVersionId);
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        port,
        fixture.candidateValidation,
        buildInput(fixture, candidateC.schemaVersionId),
        {
          uniqueConstraintBuild: {
            faultAfter: point => {
              if (point === "afterWorkspaceDelete") {
                throw new Error("rollback M05-A2 after workspace delete");
              }
            },
          },
        },
      ),
    )).rejects.toBeDefined();
    await expectBuildPresence(fixture, candidateB.schemaVersionId, true);
    const current = await fixture.target.query<{ schema_version_id: string }>(
      `select schema_version_id
         from fx_system_app_schema_candidate_validation
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    expect(current.rows).toEqual([{
      schema_version_id: candidateB.schemaVersionId,
    }]);
    let lifecycle: "building" | "backfilling" | "validating" | "enabled" =
      "building";
    for (let step = 0; step < 4 && lifecycle !== "enabled"; step += 1) {
      const advanced = await runEffect(
        advanceAppUniqueConstraintSetBackfillV1Effect(
          buildPorts(fixture),
          Object.freeze({
            ...buildInput(fixture, candidateB.schemaVersionId),
            pageSize: 1,
          }),
        ),
      );
      lifecycle = advanced.lifecycle;
    }
    expect(lifecycle).toBe("enabled");
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        port,
        fixture.candidateValidation,
        buildInput(fixture, candidateC.schemaVersionId),
      ),
    )).resolves.toMatchObject({
      installation: { disposition: "superseded" },
      workspace: {
        disposition: "retained",
        reason: "buildEnabled",
        schemaVersionId: candidateB.schemaVersionId,
      },
    });
    await expectBuildPresence(fixture, candidateB.schemaVersionId, true);
  });

  it("refuses the active and current candidate schemas but reclaims a superseded schema", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const port = createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts,
    }, createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle));

    const activeSchemaVersionId = fixture.active.basis.schemaVersionId;
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, activeSchemaVersionId),
    ));
    await expectReclamationRefusal(
      fixture,
      port,
      activeSchemaVersionId,
      "activeSchema",
    );
    const activeDigest = await fixture.target.query<{ head_sha256_hex: string }>(
      `select encode(head_sha256, 'hex') head_sha256_hex
         from fx_system_application_active_head where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await fixture.target.query(
      `update fx_system_application_active_head
          set head_sha256 = decode(repeat('00', 32), 'hex')
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expectReclamationRefusal(
      fixture,
      port,
      activeSchemaVersionId,
      "activeSchemaStateInvalid",
    );
    await fixture.target.query(
      `update fx_system_application_active_head
          set head_sha256 = decode($2, 'hex') where scope_id = $1`,
      [fixture.authority.scopeId, activeDigest.rows[0]?.head_sha256_hex],
    );

    const candidateManifest = manifestWithOptionalField(
      fixture.active.basis.manifest,
      "candidateOnly",
    );
    const candidate = await fixture.publishManagedSchemaCandidate(
      candidateManifest,
    );
    await closeEmptySet(fixture, candidate.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidate.schemaVersionId),
    ));
    await runEffect(installAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      buildInput(fixture, candidate.schemaVersionId),
    ));
    await expectReclamationRefusal(
      fixture,
      port,
      candidate.schemaVersionId,
      "currentCandidate",
    );
    const candidateDigest = await fixture.target.query<{
      frame_sha256_hex: string;
    }>(
      `select encode(frame_sha256, 'hex') frame_sha256_hex
         from fx_system_app_schema_candidate_validation where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await fixture.target.query(
      `update fx_system_app_schema_candidate_validation
          set frame_sha256 = decode(repeat('00', 32), 'hex')
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expectReclamationRefusal(
      fixture,
      port,
      candidate.schemaVersionId,
      "candidateSchemaStateInvalid",
    );
    await fixture.target.query(
      `update fx_system_app_schema_candidate_validation
          set frame_sha256 = decode($2, 'hex') where scope_id = $1`,
      [fixture.authority.scopeId, candidateDigest.rows[0]?.frame_sha256_hex],
    );

    const supersededManifest = manifestWithOptionalField(
      fixture.active.basis.manifest,
      "supersededOnly",
    );
    const superseded = await fixture.publishManagedSchemaCandidate(
      supersededManifest,
    );
    await closeEmptySet(fixture, superseded.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, superseded.schemaVersionId),
    ));
    await expect(runEffect(
      reclaimSupersededAppUniqueConstraintSetBuildEffect(
        port,
        buildInput(fixture, superseded.schemaVersionId),
      ),
    )).resolves.toMatchObject({
      status: "reclaimed",
      disposition: "deleted",
      schemaVersionId: superseded.schemaVersionId,
      lifecycle: "declared",
    });
    await expect(runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, superseded.schemaVersionId),
    ))).resolves.toMatchObject({ disposition: "created" });
  });

  it("cold-replays an atomically committed supersession after a lost response", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a2-uncertain-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const candidateA = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateA"),
    );
    await closeEmptySet(fixture, candidateA.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    await runEffect(installAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    const candidateB = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateB"),
    );
    const metadata = await fixture.authorityPorts.scopeMetadata
      .getScopeMetadataByDeploymentId(fixture.deploymentId);
    if (metadata === null) throw new Error("M05-A2 scope metadata is missing.");
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.target.drizzle,
    );
    let transactionCount = 0;
    const uncertainTarget = createLocatedAppSchemaCandidateValidationTarget(
      fixture.target.drizzle,
      metadata.physicalLocator,
      async work => {
        transactionCount += 1;
        const result = await baseRunner(work);
        if (transactionCount === 2) {
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost M05-A2 transaction response"),
          }));
        }
        return result;
      },
    );
    const uncertainAuthority = Object.freeze({
      ...fixture.authorityPorts,
      scopeClockTargets: Object.freeze({
        resolve: async () => uncertainTarget,
      }),
    });
    const uncertainCandidateValidation = createAppSchemaCandidateValidationPort({
      controlDb: fixture.control.drizzle,
      authority: uncertainAuthority,
    });
    const uncertainEligibility = createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: fixture.control.drizzle,
      authority: uncertainAuthority,
    }, createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle));
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        uncertainEligibility,
        uncertainCandidateValidation,
        buildInput(fixture, candidateB.schemaVersionId),
      ),
    )).rejects.toMatchObject({
      _tag: "AppUniqueConstraintSetBuildIntegrationV1Error",
      retryable: true,
    });
    expect(transactionCount).toBe(2);
    await expectBuildPresence(fixture, candidateA.schemaVersionId, false);
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        fixture.uniqueConstraintEligibility,
        fixture.candidateValidation,
        buildInput(fixture, candidateB.schemaVersionId),
      ),
    )).resolves.toMatchObject({
      installation: { disposition: "replayed" },
      workspace: { disposition: "not_applicable" },
    });
  });

  it("fails closed when the observed candidate head moves before admission", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a2-head-drift-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const candidateA = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateA"),
    );
    await closeEmptySet(fixture, candidateA.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    await runEffect(installAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    const requestedCandidate = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "requested"),
    );
    const racingCandidate = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "racing"),
    );
    const metadata = await fixture.authorityPorts.scopeMetadata
      .getScopeMetadataByDeploymentId(fixture.deploymentId);
    if (metadata === null) throw new Error("M05-A2 scope metadata is missing.");
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.target.drizzle,
    );
    let transactionCount = 0;
    const racingTarget = createLocatedAppSchemaCandidateValidationTarget(
      fixture.target.drizzle,
      metadata.physicalLocator,
      async work => {
        transactionCount += 1;
        if (transactionCount === 2) {
          await runEffect(installAppSchemaCandidateValidationEffect(
            fixture.candidateValidation,
            buildInput(fixture, racingCandidate.schemaVersionId),
          ));
        }
        return baseRunner(work);
      },
    );
    const racingAuthority = Object.freeze({
      ...fixture.authorityPorts,
      scopeClockTargets: Object.freeze({
        resolve: async () => racingTarget,
      }),
    });
    const racingCandidateValidation = createAppSchemaCandidateValidationPort({
      controlDb: fixture.control.drizzle,
      authority: racingAuthority,
    });
    const racingEligibility = createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: fixture.control.drizzle,
      authority: racingAuthority,
    }, createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle));
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        racingEligibility,
        racingCandidateValidation,
        buildInput(fixture, requestedCandidate.schemaVersionId),
      ),
    )).rejects.toMatchObject({
      _tag: "AppSchemaCandidateValidationOperationV1Error",
      reason: "superseded",
    });
    expect(transactionCount).toBe(2);
    await expectCurrentCandidate(fixture, racingCandidate.schemaVersionId);
    await expectBuildPresence(fixture, candidateA.schemaVersionId, true);
  });

  it("fails closed when deployment ownership drifts after the head claim", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a2-deployment-drift-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const candidateA = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateA"),
    );
    await closeEmptySet(fixture, candidateA.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    await runEffect(installAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    const requestedCandidate = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "requested"),
    );
    const metadata = await fixture.authorityPorts.scopeMetadata
      .getScopeMetadataByDeploymentId(fixture.deploymentId);
    if (metadata === null) throw new Error("M05-A2 scope metadata is missing.");
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.target.drizzle,
    );
    const driftedDeploymentId = `${fixture.deploymentId}-drift`;
    let transactionCount = 0;
    const driftingTarget = createLocatedAppSchemaCandidateValidationTarget(
      fixture.target.drizzle,
      metadata.physicalLocator,
      async work => {
        transactionCount += 1;
        if (transactionCount === 2) {
          await fixture.target.query(
            `update fx_system_app_schema_candidate_validation
                set deployment_id = $2
              where scope_id = $1`,
            [fixture.authority.scopeId, driftedDeploymentId],
          );
        }
        return baseRunner(work);
      },
    );
    const driftingAuthority = Object.freeze({
      ...fixture.authorityPorts,
      scopeClockTargets: Object.freeze({
        resolve: async () => driftingTarget,
      }),
    });
    const driftingCandidateValidation = createAppSchemaCandidateValidationPort({
      controlDb: fixture.control.drizzle,
      authority: driftingAuthority,
    });
    const driftingEligibility = createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: fixture.control.drizzle,
      authority: driftingAuthority,
    }, createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle));
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        driftingEligibility,
        driftingCandidateValidation,
        buildInput(fixture, requestedCandidate.schemaVersionId),
      ),
    )).rejects.toMatchObject({
      _tag: "AppSchemaCandidateValidationOperationV1Error",
      reason: "superseded",
    });
    expect(transactionCount).toBe(2);
    const durable = await fixture.target.query<{
      deployment_id: string;
      schema_version_id: string;
    }>(
      `select deployment_id, schema_version_id
         from fx_system_app_schema_candidate_validation
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    expect(durable.rows).toEqual([{
      deployment_id: driftedDeploymentId,
      schema_version_id: candidateA.schemaVersionId,
    }]);
    await expectBuildPresence(fixture, candidateA.schemaVersionId, true);
  });

  it("reports an absent displaced workspace without weakening candidate installation", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a2-absent-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const candidateA = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateA"),
    );
    await runEffect(installAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    const candidateB = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateB"),
    );
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        fixture.uniqueConstraintEligibility,
        fixture.candidateValidation,
        buildInput(fixture, candidateB.schemaVersionId),
      ),
    )).resolves.toMatchObject({
      installation: { disposition: "superseded" },
      workspace: {
        disposition: "already_absent",
        schemaVersionId: candidateA.schemaVersionId,
      },
    });
    await expectCurrentCandidate(fixture, candidateB.schemaVersionId);
  });

  it("reuses one exact build-directory slot during candidate supersession", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a2-directory-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const candidateA = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateA"),
    );
    await closeEmptySet(fixture, candidateA.schemaVersionId);
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    await runEffect(installAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      buildInput(fixture, candidateA.schemaVersionId),
    ));
    for (
      let ordinal = 0;
      ordinal < MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1 - 1;
      ordinal += 1
    ) {
      await fixture.target.query(
        `insert into fx_system_unique_constraint_set_build
          (scope_id, schema_version_id, set_codec_version, definition_count,
           definition_set_sha256, storage_generation,
           storage_generation_fence, epoch, start_commit_seq, lifecycle,
           cursor_codec_version, cursor_definition_id, cursor_row_id,
           attempt_fence)
         values ($1, $2, 1, 0, decode(repeat('cd', 32), 'hex'),
                 'flarexdb_v1', 1, $3, 0, 'enabled', 1, null, null, 1)`,
        [
          fixture.authority.scopeId,
          `m05_a2_capacity_${ordinal}`,
          fixture.authority.epoch,
        ],
      );
    }
    expect(await buildDirectoryCount(fixture)).toBe(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    );
    const candidateB = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidateB"),
    );
    await closeEmptySet(fixture, candidateB.schemaVersionId);
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        fixture.uniqueConstraintEligibility,
        fixture.candidateValidation,
        buildInput(fixture, candidateB.schemaVersionId),
      ),
    )).resolves.toMatchObject({
      installation: { disposition: "superseded" },
      workspace: {
        disposition: "deleted",
        schemaVersionId: candidateA.schemaVersionId,
      },
    });
    expect(await buildDirectoryCount(fixture)).toBe(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1 - 1,
    );
    await expect(runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts(fixture),
      buildInput(fixture, candidateB.schemaVersionId),
    ))).resolves.toMatchObject({ disposition: "created" });
    expect(await buildDirectoryCount(fixture)).toBe(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    );
  });

  it("rejects a structurally copied candidate-validation capability", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-a2-composition-runtime-host",
      compatibilityDate: "2026-08-16",
    });
    const candidate = await fixture.publishManagedSchemaCandidate(
      manifestWithOptionalField(fixture.active.basis.manifest, "candidate"),
    );
    const copiedCandidateValidation = Object.freeze({
      ...fixture.candidateValidation,
    });
    await expect(runEffect(
      installAppSchemaCandidateWithWorkspaceReclamationEffect(
        fixture.uniqueConstraintEligibility,
        copiedCandidateValidation,
        buildInput(fixture, candidate.schemaVersionId),
      ),
    )).rejects.toMatchObject({
      _tag: "AppUniqueConstraintSetBuildReclamationError",
      reason: "invalidPort",
      retryable: false,
    });
  });
});

function buildPorts(fixture: ApplicationNativeMutationPGliteFixture) {
  return Object.freeze({
    controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts,
  });
}

function buildInput(
  fixture: ApplicationNativeMutationPGliteFixture,
  schemaVersionId: ApplicationNativeMutationPGliteFixture["active"]["basis"]["schemaVersionId"],
) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    schemaVersionId,
  });
}

async function closeEmptySet(
  fixture: ApplicationNativeMutationPGliteFixture,
  schemaVersionId: ApplicationNativeMutationPGliteFixture["active"]["basis"]["schemaVersionId"],
) {
  const prepared = await runEffect(
    prepareAppUniqueConstraintSetClosureV1Effect(
      fixture.control.drizzle,
      buildInput(fixture, schemaVersionId),
    ),
  );
  await fixture.control.drizzle.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
  ));
}

async function expectReclamationRefusal(
  fixture: ApplicationNativeMutationPGliteFixture,
  port: Parameters<
    typeof reclaimSupersededAppUniqueConstraintSetBuildEffect
  >[0],
  schemaVersionId: ApplicationNativeMutationPGliteFixture["active"]["basis"]["schemaVersionId"],
  reason:
    | "activeSchema"
    | "currentCandidate"
    | "activeSchemaStateInvalid"
    | "candidateSchemaStateInvalid",
) {
  const failure = await runEffectFailure(
    reclaimSupersededAppUniqueConstraintSetBuildEffect(
      port,
      buildInput(fixture, schemaVersionId),
    ),
  );
  expect(failure).toBeInstanceOf(AppUniqueConstraintSetBuildReclamationError);
  expect(failure).toMatchObject({ reason, retryable: false });
}

async function expectBuildPresence(
  fixture: ApplicationNativeMutationPGliteFixture,
  schemaVersionId: ApplicationNativeMutationPGliteFixture["active"]["basis"]["schemaVersionId"],
  expected: boolean,
) {
  const rows = await fixture.target.query<{ present: boolean }>(
    `select exists(
       select 1
         from fx_system_unique_constraint_set_build
        where scope_id = $1 and schema_version_id = $2
     ) present`,
    [fixture.authority.scopeId, schemaVersionId],
  );
  expect(rows.rows[0]?.present).toBe(expected);
}

async function expectCurrentCandidate(
  fixture: ApplicationNativeMutationPGliteFixture,
  schemaVersionId: ApplicationNativeMutationPGliteFixture["active"]["basis"]["schemaVersionId"],
) {
  const rows = await fixture.target.query<{ schema_version_id: string }>(
    `select schema_version_id
       from fx_system_app_schema_candidate_validation
      where scope_id = $1`,
    [fixture.authority.scopeId],
  );
  expect(rows.rows).toEqual([{ schema_version_id: schemaVersionId }]);
}

async function buildDirectoryCount(
  fixture: ApplicationNativeMutationPGliteFixture,
) {
  const result = await fixture.target.query<{ build_count: string }>(
    `select count(*)::text build_count
       from fx_system_unique_constraint_set_build
      where scope_id = $1`,
    [fixture.authority.scopeId],
  );
  return Number(result.rows[0]?.build_count ?? "0");
}

function manifestWithOptionalField(
  manifest: ApplicationManifestV1,
  fieldName: string,
): ApplicationManifestV1 {
  const table = manifest.schema.tables[0];
  if (table === undefined || table.validator.type !== "object") {
    throw new Error("Expected the Application fixture's users object table.");
  }
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    ...manifest,
    schema: {
      ...manifest.schema,
      tables: [{
        ...table,
        validator: {
          ...table.validator,
          value: {
            ...table.validator.value,
            [fieldName]: {
              fieldType: { type: "string" },
              optional: true,
            },
          },
        },
      }, ...manifest.schema.tables.slice(1)],
    },
  })).manifest;
}
