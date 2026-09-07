import { captureRelationalPrimaryKey, decodeRelationalPrimaryKey } from "../src/commitPublication/relationalFacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { registerCommerceProfile } from "../src/commerceTransaction/profile";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { captureFreshRelationalMigrationPlan, captureFrameworkMigrationPlanAdmission } from "../src/migrationCoordination/canonical";
import { currencySchemaInput, frameworkTargetNamespace, FRAMEWORK_VALUE_LOCATOR } from "./frameworkMigrationValueFixtures";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("private commerce profile admission", () => {
  it("requires the live descriptor again at admission and keeps initialization requirements adapter-owned", async () => {
    const targetNamespace = await frameworkTargetNamespace();
    const artifact = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a",
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/test-model", revision: "a".repeat(40), paths: ["model.ts"] },
      schema: { ...currencySchemaInput(), owner: "medusa" },
    }));
    const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: artifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace }));
    for (const value of ["😀", "�"]) {
      const key = await runEffect(captureRelationalPrimaryKey(layout, "currency", { code: value }));
      expect(await runEffect(decodeRelationalPrimaryKey(layout, "currency", new TextEncoder().encode(key.canonicalJson)))).toEqual(key.frame);
    }
    for (const value of ["\ud800", "\udfff", "\0"]) expect(await runEffectFailure(captureRelationalPrimaryKey(layout, "currency", { code: value }))).toMatchObject({ reason: "invalidKey" });
    const profile = await runEffect(registerCommerceProfile(artifact.artifact, layout, "test.catalog", {
      stepId: "test.catalog-initialization", datasetSha256: "b".repeat(64), expectedRowCount: 7,
    }));
    const plan = await runEffect(captureFreshRelationalMigrationPlan({ artifact: artifact.artifact, physicalLayout: layout, commerceProfile: profile }));
    const input = { plan, nameAssignments: layout.nameAssignments, previousPlanSha256: null, admittedAt: "2026-09-07T00:00:00.000Z" };
    await runEffectFailure(captureFrameworkMigrationPlanAdmission(input));
    const admitted = await runEffect(captureFrameworkMigrationPlanAdmission({ ...input, commerceProfile: profile }));
    expect(admitted.frame.admissionProfile).toBe("registered-commerce-fresh");
    expect(admitted.frame.artifact).toEqual(artifact.artifact.identity);
    const alienArtifact = await runEffect(captureRelationalSchemaArtifact({
      deploymentId: "deployment-a", provenance: { kind: "sourceSnapshot", repository: "https://example.com/other-model", revision: "c".repeat(40), paths: ["model.ts"] }, schema: { ...currencySchemaInput(), owner: "medusa" },
    }));
    const alienLayout = await runEffect(captureRelationalPhysicalLayout({ artifact: alienArtifact.artifact, physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace }));
    const alien = await runEffect(registerCommerceProfile(alienArtifact.artifact, alienLayout, "test.catalog", {
      stepId: "test.catalog-initialization", datasetSha256: "b".repeat(64), expectedRowCount: 7,
    }));
    await runEffectFailure(captureFrameworkMigrationPlanAdmission({ ...input, commerceProfile: alien }));
    // A forged descriptor fails before any layout fields are read.
    expect(await runEffect(Effect.result(registerCommerceProfile(artifact.artifact, { ...layout }, "test.catalog", {
      stepId: "test.catalog-initialization", datasetSha256: "b".repeat(64), expectedRowCount: 7,
    })))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
