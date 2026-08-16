import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  installAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../src/appUniqueConstraintCommitV1";
import {
  AppUniqueConstraintSetBuildReclamationError,
  createAppUniqueConstraintSetEligibilityPortV1,
  reclaimSupersededAppUniqueConstraintSetBuildEffect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("M05-A unique-set build workspace reclamation", { timeout: 180_000 }, () => {
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
         from fx_system_application_active_head_v1 where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await fixture.target.query(
      `update fx_system_application_active_head_v1
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
      `update fx_system_application_active_head_v1
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
