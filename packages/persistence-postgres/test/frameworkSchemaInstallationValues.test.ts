import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";
import { encodeCanonicalJson } from "flarex-protocol/json";

// @ts-expect-error Installation values must remain absent from root.
import type { FrameworkSchemaInstallationFrame as RootInstallation } from "../src";
import {
  captureFrameworkSchemaAvailabilityHead,
  captureFrameworkSchemaAvailabilityHistory,
  captureFrameworkSchemaInstallation,
  captureFrameworkSchemaReadiness,
  verifyStoredFrameworkSchemaInstallationValue,
} from "../src/frameworkSchema/installation/canonical";
import {
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationPlanAdmission,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  completeFrameworkMigrationPlanSteps,
  currencyArtifact,
  expectDeeplyFrozen,
  FRAMEWORK_VALUE_LOCATOR,
  frameworkTargetNamespace,
} from "./frameworkMigrationValueFixtures";

type PublicInstallationExport = Extract<
  keyof typeof import("../src"),
  `${string}FrameworkSchemaInstallation${string}` |
    `${string}FRAMEWORK_SCHEMA_INSTALLATION${string}`
>;

const T0 = "2026-09-02T00:00:00.000Z";
const T1 = "2026-09-02T00:01:00.000Z";
const T2 = "2026-09-02T00:02:00.000Z";
const VALIDATION_SHA256 = "cd".repeat(32);
const WITHDRAWAL_SHA256 = "12".repeat(32);

describe("private framework schema installation values", () => {
  it("keeps installation, readiness, and availability private", async () => {
    expectTypeOf<PublicInstallationExport>().toEqualTypeOf<never>();
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/installation/canonical.ts",
    );
  });

  it("captures installation and readiness with exact physical and residual evidence", async () => {
    const values = await installationFixture();

    expect(values.installation.frame.identity.installationSha256)
      .toBe(
        "98ee2b4ead3f4add3cbb4128aeb4dfdfc956b67d9db890261a0545526247367c",
      );
    expect(values.installation.sha256)
      .toBe(
        "b38688025e5e62e82627f87cd4655008b3e98d95fa666321a948c24ee1021e61",
      );
    expect(values.readiness.sha256).toBe(
      "c22200864e60f0471e01b13b0a9cca84ccf23656f2ea76186f465d600305d6d9",
    );
    expect(values.readiness.frame.validatedPhysicalCapabilities)
      .toEqual(values.installation.frame.installedPhysicalCapabilities);
    expect(values.readiness.frame.residualRequirements.map(value => [
      value.capability.capabilityId,
      value.requirement,
    ])).toEqual([
      ["currency.exact-number", "exactNumericCompanionWriteBehavior"],
      ["currency.searchable", "searchableTextQueryBehavior"],
      ["currency.soft-delete", "softDeleteStoreBehavior"],
      ["currency.timestamps", "managedTimestampUpdateBehavior"],
    ]);
    expect(values.readiness.frame).not.toHaveProperty("runtimeSatisfied");
    expectDeeplyFrozen(values.installation);
    expectDeeplyFrozen(values.readiness);
  });

  it("rejects physical evidence that does not exactly belong to the candidate", async () => {
    const values = await planFixture();
    const failure = await runEffectFailure(captureFrameworkSchemaInstallation({
      plan: values.plan,
      admission: values.admission,
      terminal: values.terminal,
      installedStructureSha256: values.plan.physicalLayout.layoutSha256,
      installedPhysicalCapabilities: [],
      installedAt: T1,
    }));
    expect(failure).toMatchObject({
      _tag: "FrameworkSchemaInstallationValueError",
      reason: "evidenceMismatch",
      retryable: false,
    });
  });

  it("maintains append-only availability history and a per-installation head", async () => {
    const values = await installationFixture();
    const ready = await runEffect(captureFrameworkSchemaAvailabilityHistory({
      readiness: values.readiness,
      previous: null,
      status: "ready",
      reasonSha256: null,
      recordedAt: T1,
    }));
    const withdrawn = await runEffect(
      captureFrameworkSchemaAvailabilityHistory({
        readiness: values.readiness,
        previous: ready,
        status: "withdrawn",
        reasonSha256: WITHDRAWAL_SHA256,
        recordedAt: T2,
      }),
    );
    const head = await runEffect(captureFrameworkSchemaAvailabilityHead(
      withdrawn,
    ));

    expect({
      ready: ready.sha256,
      withdrawn: withdrawn.sha256,
      head: head.sha256,
    }).toEqual({
      ready:
        "e14de1d7d77ae4276fef880c124dd0106ce02cfe7b2ebe8c264bac29351b1c29",
      withdrawn:
        "5ae8878930a2fca57e3fc73e6d4dec690fe8255468cbc09a50901823290e23db",
      head:
        "f7ec2bf5aafca78c4187f6f48de083fb705b5017a90acae9ed450d5a6ad4ad6e",
    });
    expect(ready.frame.availabilitySequence).toBe("1");
    expect(withdrawn.frame.availabilitySequence).toBe("2");
    expect(withdrawn.frame.previousAvailability).toEqual({
      availabilitySequence: "1",
      historySha256: ready.sha256,
      status: "ready",
    });
    expect(head.frame).toMatchObject({
      installation: values.installation.frame.identity,
      historySha256: withdrawn.sha256,
      status: "withdrawn",
    });
    expectDeeplyFrozen(ready);
    expectDeeplyFrozen(withdrawn);
    expectDeeplyFrozen(head);
  });

  it("fails closed on noncanonical or digest-mismatched stored bytes", async () => {
    const { installation } = await installationFixture();
    const canonicalBytes = new TextEncoder().encode(
      installation.canonicalJson,
    );
    const verified = await runEffect(
      verifyStoredFrameworkSchemaInstallationValue({
        kind: "installation",
        canonicalBytes,
        sha256Hex: installation.sha256,
      }),
    );
    expect(verified).toEqual(installation.frame);
    expectDeeplyFrozen(verified);

    const corrupt = new Uint8Array(canonicalBytes);
    corrupt[corrupt.byteLength - 2] = 0x20;
    const failure = await runEffectFailure(
      verifyStoredFrameworkSchemaInstallationValue({
        kind: "installation",
        canonicalBytes: corrupt,
        sha256Hex: installation.sha256,
      }),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkSchemaInstallationValueError",
      reason: "storedStateCorrupt",
      retryable: false,
    });

    const altered = {
      ...installation.frame,
      identity: {
        ...installation.frame.identity,
        installationSha256: "00".repeat(32),
      },
    };
    const alteredCanonical = encodeCanonicalJson(altered, cause => {
      throw cause;
    });
    const nestedFailure = await runEffectFailure(
      verifyStoredFrameworkSchemaInstallationValue({
        kind: "installation",
        canonicalBytes: new TextEncoder().encode(alteredCanonical),
        sha256Hex: createHash("sha256").update(alteredCanonical).digest("hex"),
      }),
    );
    expect(nestedFailure).toMatchObject({
      _tag: "FrameworkSchemaInstallationValueError",
      reason: "storedStateCorrupt",
      retryable: false,
    });

    const capability = installation.frame.installedPhysicalCapabilities[0];
    expect(capability).toBeDefined();
    if (capability === undefined) return;
    const coordinateAltered = {
      ...installation.frame,
      installedPhysicalCapabilities: [
        {
          ...capability,
          identity: {
            ...capability.identity,
            lineageId: "different-lineage",
          },
        },
        ...installation.frame.installedPhysicalCapabilities.slice(1),
      ],
    };
    const coordinateCanonical = encodeCanonicalJson(
      coordinateAltered,
      cause => {
        throw cause;
      },
    );
    const coordinateFailure = await runEffectFailure(
      verifyStoredFrameworkSchemaInstallationValue({
        kind: "installation",
        canonicalBytes: new TextEncoder().encode(coordinateCanonical),
        sha256Hex: createHash("sha256").update(coordinateCanonical)
          .digest("hex"),
      }),
    );
    expect(coordinateFailure).toMatchObject({
      _tag: "FrameworkSchemaInstallationValueError",
      reason: "storedStateCorrupt",
      retryable: false,
    });
  });
});

async function planFixture() {
  const artifact = await currencyArtifact();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: await frameworkTargetNamespace(),
  }));
  const plan = await runEffect(captureFreshRelationalMigrationPlan({
    artifact: artifact.artifact,
    physicalLayout,
  }));
  const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
    plan,
    nameAssignments: physicalLayout.nameAssignments,
    previousPlanSha256: null,
    admittedAt: T0,
  }));
  const attempt = await runEffect(captureFrameworkMigrationAttemptStart({
    admission,
    attemptId: "attempt-currency",
    attemptFence: "1",
    leaseOwnerId: "worker-a",
    leaseExpiresAt: T1,
    previousAttemptId: null,
    startedAt: T0,
  }));
  const stepReceipts = await completeFrameworkMigrationPlanSteps(
    plan,
    attempt,
    T1,
  );
  const terminal = await runEffect(captureFrameworkMigrationAttemptTerminal({
    attempt,
    outcome: {
      kind: "succeeded",
      requiredStepSetSha256: plan.requiredStepSetSha256,
    },
    stepReceipts,
    terminalAt: T1,
  }));
  return { plan, admission, terminal };
}

async function installationFixture() {
  const values = await planFixture();
  const capabilities = values.plan.physicalLayout.frame
    .requiredPhysicalCapabilities;
  const installation = await runEffect(captureFrameworkSchemaInstallation({
    ...values,
    installedStructureSha256: values.plan.physicalLayout.layoutSha256,
    installedPhysicalCapabilities: [...capabilities],
    installedAt: T1,
  }));
  const residualRequirements = capabilities.map(capability => ({
    capability: capability.identity,
    requirement: capability.residualRequirement,
  }));
  const readiness = await runEffect(captureFrameworkSchemaReadiness({
    installation,
    validationSha256: VALIDATION_SHA256,
    validatedStructureSha256: installation.frame.installedStructureSha256,
    validatedPhysicalCapabilities: [...capabilities],
    residualRequirements,
    validatedAt: T1,
  }));
  return { ...values, installation, readiness };
}
