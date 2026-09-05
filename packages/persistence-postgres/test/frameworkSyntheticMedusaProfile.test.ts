import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import {
  captureFreshRelationalMigrationPlan,
  captureFrameworkMigrationPlanAdmission,
  verifyStoredFrameworkMigrationValue,
} from "../src/migrationCoordination/canonical";
import {
  currencySchemaInput,
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
} from "./frameworkMigrationValueFixtures";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("private synthetic Medusa migration admission", () => {
  it.each(["system", "medusa"] as const)(
    "authenticates the exact %s owner and fresh profile on cold restoration",
    async (owner) => {
      const { artifact } = await runEffect(
        captureRelationalSchemaArtifact({
          deploymentId: "deployment-a",
          provenance: {
            kind: "synthetic",
            fixtureId: "owner-correct-currency",
          },
          schema: { ...currencySchemaInput(), owner },
        }),
      );
      const physicalLayout = await runEffect(
        captureRelationalPhysicalLayout({
          artifact,
          physicalLocator: FRAMEWORK_VALUE_LOCATOR,
          targetNamespace: await frameworkTargetNamespace(),
        }),
      );
      const plan = await runEffect(
        captureFreshRelationalMigrationPlan({ artifact, physicalLayout }),
      );
      const admission = await runEffect(
        captureFrameworkMigrationPlanAdmission({
          plan,
          nameAssignments: physicalLayout.nameAssignments,
          previousPlanSha256: null,
          admittedAt: "2026-09-05T00:00:00.000Z",
        }),
      );
      expect(plan.frame.collision.owner).toBe(owner);
      expect(admission.frame.admissionProfile).toBe(`synthetic-${owner}-fresh`);
      await runEffect(
        verifyStoredFrameworkMigrationValue({
          kind: "plan",
          canonicalBytes: new TextEncoder().encode(plan.canonicalJson),
          sha256Hex: plan.migrationPlanSha256,
        }),
      );
      await runEffect(
        verifyStoredFrameworkMigrationValue({
          kind: "planAdmission",
          canonicalBytes: new TextEncoder().encode(admission.canonicalJson),
          sha256Hex: admission.sha256,
        }),
      );
      const forged = encodeCanonicalJson(
        {
          ...admission.frame,
          admissionProfile:
            owner === "system"
              ? "synthetic-medusa-fresh"
              : "synthetic-system-fresh",
        },
        (cause) => {
          throw cause;
        },
      );
      expect(
        await runEffectFailure(
          verifyStoredFrameworkMigrationValue({
            kind: "planAdmission",
            canonicalBytes: new TextEncoder().encode(forged),
            sha256Hex: createHash("sha256").update(forged).digest("hex"),
          }),
        ),
      ).toMatchObject({ reason: "storedStateCorrupt" });
    },
  );
  it.each(["system", "medusa"] as const)(
    "refuses source-snapshot provenance for %s",
    async (owner) => {
      const { artifact } = await runEffect(
        captureRelationalSchemaArtifact({
          deploymentId: "deployment-a",
          schema: { ...currencySchemaInput(), owner },
          provenance: {
            kind: "sourceSnapshot",
            repository: "fixture",
            revision: "abc",
            paths: ["currency.ts"],
          },
        }),
      );
      const physicalLayout = await runEffect(
        captureRelationalPhysicalLayout({
          artifact,
          physicalLocator: FRAMEWORK_VALUE_LOCATOR,
          targetNamespace: await frameworkTargetNamespace(),
        }),
      );
      expect(
        await runEffectFailure(
          captureFreshRelationalMigrationPlan({ artifact, physicalLayout }),
        ),
      ).toMatchObject({ reason: "unsupportedArtifact" });
    },
  );
});
