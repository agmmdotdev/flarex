import { it, expect } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { legacyWriterExclusionScenario } from "./legacyWriterExclusionScenario";
import { createApplicationNativeMutationPGliteFixtureWithPersistence } from "./fixtures/applicationNativeMutationTestFixture";
import { relationReadinessFixture, prepareReadinessEvidence } from "./applicationRelationReadinessFixture";
import { ensureRelationBuildTestWebCrypto } from "./applicationRelationBuildTestSupport";
import { runEffect } from "./effectTestRuntime";

it("excludes legacy writes under active contract 1 (PGlite)", async () => {
  ensureRelationBuildTestWebCrypto();
  const fixture = await createApplicationNativeMutationPGliteFixtureWithPersistence({
    runtimeHostIdentity: "legacy-exclusion", compatibilityDate: "2026-09-19",
  }, { control: await createMigratedPGlitePersistence(), target: await createMigratedPGlitePersistence() });
  await legacyWriterExclusionScenario({ target: fixture.target, ports: fixture.sessionAuthority,
    deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, schemaVersionId: fixture.schemaAuthority.schemaVersionId });
}, 60_000);

it("excludes material and net-zero legacy writes after contract 2 activation while preserving prior replay (PGlite)", async () => {
  const fixture = await relationReadinessFixture();
  await legacyWriterExclusionScenario({ target: fixture.persistence, ports: fixture.pointCommitAuthority,
    deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, schemaVersionId: fixture.relation.binding.schemaVersionId }, async () => {
    await prepareReadinessEvidence(fixture);
    expect(await runEffect(fixture.fold.settle(fixture.input))).toMatchObject({ status: "ready" });
    expect(await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null })))
      .toMatchObject({ status: "activated" });
  });
}, 60_000);
