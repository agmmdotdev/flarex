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
  installAppSchemaCandidateWithWorkspaceReclamationEffect,
  reclaimSupersededAppUniqueConstraintSetBuildEffect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPostgresFixture,
  type ApplicationNativeMutationPostgresFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres(
  "real PostgreSQL M05-A selected-schema refusal",
  { timeout: 180_000 },
  () => {
    it("atomically installs the replacement and reclaims its displaced workspace", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const fixture = await createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: "flarex.test/m05-a2-postgres-runtime-host",
          compatibilityDate: "2026-08-16",
        }, { control, target });
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
        const durable = await fixture.target.query<{
          candidate_schema_version_id: string;
          displaced_build_count: string;
        }>(
          `select candidate.schema_version_id candidate_schema_version_id,
                  count(build.schema_version_id)::text displaced_build_count
             from fx_system_app_schema_candidate_validation candidate
             left join fx_system_unique_constraint_set_build build
               on build.scope_id = candidate.scope_id
              and build.schema_version_id = $2
            where candidate.scope_id = $1
            group by candidate.schema_version_id`,
          [fixture.authority.scopeId, candidateA.schemaVersionId],
        );
        expect(durable.rows).toEqual([{
          candidate_schema_version_id: candidateB.schemaVersionId,
          displaced_build_count: "0",
        }]);
      });
    });

    it("refuses active/current-candidate workspaces and reclaims superseded state", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const fixture = await createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: "flarex.test/m05-a-postgres-runtime-host",
          compatibilityDate: "2026-08-16",
        }, { control, target });
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
        const activeDigest = await fixture.target.query<{
          head_sha256_hex: string;
        }>(
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

        const candidate = await fixture.publishManagedSchemaCandidate(
          manifestWithOptionalField(
            fixture.active.basis.manifest,
            "candidateOnly",
          ),
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

        const superseded = await fixture.publishManagedSchemaCandidate(
          manifestWithOptionalField(
            fixture.active.basis.manifest,
            "supersededOnly",
          ),
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
          disposition: "deleted",
          schemaVersionId: superseded.schemaVersionId,
          lifecycle: "declared",
        });
      });
    });
  },
);

function buildPorts(fixture: ApplicationNativeMutationPostgresFixture) {
  return Object.freeze({
    controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts,
  });
}

function buildInput(
  fixture: ApplicationNativeMutationPostgresFixture,
  schemaVersionId: ApplicationNativeMutationPostgresFixture["active"]["basis"]["schemaVersionId"],
) {
  return Object.freeze({ deploymentId: fixture.deploymentId, schemaVersionId });
}

async function closeEmptySet(
  fixture: ApplicationNativeMutationPostgresFixture,
  schemaVersionId: ApplicationNativeMutationPostgresFixture["active"]["basis"]["schemaVersionId"],
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
  fixture: ApplicationNativeMutationPostgresFixture,
  port: Parameters<
    typeof reclaimSupersededAppUniqueConstraintSetBuildEffect
  >[0],
  schemaVersionId: ApplicationNativeMutationPostgresFixture["active"]["basis"]["schemaVersionId"],
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
